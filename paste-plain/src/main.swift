// PlainPaste — a tiny menu bar app that pastes the clipboard as plain text.
//
//   ⌃⌘V         paste the clipboard stripped to plain text, anywhere
//   menu bar    "Scrub Clipboard" strips formatting in place; paste normally with ⌘V
//
// The paste hotkey synthesizes a ⌘V keystroke, which needs a one-time
// Accessibility grant (System Settings → Privacy & Security → Accessibility).
// Scrubbing needs no permission at all.
//
// Scriptable: `notifyutil -p us.philipbaker.plainpaste.scrub` scrubs the
// clipboard from any script or automation.

import Cocoa
import Carbon.HIToolbox
import ServiceManagement

private let scrubNotification = "us.philipbaker.plainpaste.scrub"

private func logLine(_ message: String) {
    let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/PlainPaste.log")
    let stamp = ISO8601DateFormatter().string(from: Date())
    let line = "\(stamp) \(message)\n"
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? line.data(using: .utf8)!.write(to: url)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var eventTap: CFMachPort?
    private var tapRetryTimer: Timer?
    private let launchAtLoginItem = NSMenuItem(
        title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
    private var flashRestore: DispatchWorkItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        setIcon("clipboard")

        let menu = NSMenu()
        menu.delegate = self

        let about = NSMenuItem(title: "About PlainPaste", action: #selector(showAbout), keyEquivalent: "")
        about.target = self
        menu.addItem(about)
        menu.addItem(.separator())

        let paste = NSMenuItem(title: "Paste Plain Text", action: #selector(pasteFromMenu), keyEquivalent: "v")
        paste.keyEquivalentModifierMask = [.control, .command]
        paste.target = self
        menu.addItem(paste)

        let scrub = NSMenuItem(title: "Scrub Clipboard", action: #selector(scrubFromMenu), keyEquivalent: "")
        scrub.target = self
        menu.addItem(scrub)

        menu.addItem(.separator())
        launchAtLoginItem.target = self
        menu.addItem(launchAtLoginItem)
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit PlainPaste", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)

        statusItem.menu = menu

        // Ask for Accessibility up front — the ⌃⌘V hotkey is the whole point,
        // and the event tap can only be created once the grant exists.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        startHotKeyTapWhenTrusted()
        registerScrubNotification()
    }

    // MARK: - About

    @objc private func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        let base: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12),
            .paragraphStyle: {
                let p = NSMutableParagraphStyle(); p.alignment = .center; return p
            }(),
        ]
        let credits = NSMutableAttributedString(string: "Built by AechTech, LLC\n", attributes: base)
        credits.append(NSAttributedString(
            string: "support@aechtech.com",
            attributes: base.merging([.link: URL(string: "mailto:support@aechtech.com")!]) { $1 }))
        credits.append(NSAttributedString(string: "  \u{00B7}  ", attributes: base))
        credits.append(NSAttributedString(
            string: "aechtech.com",
            attributes: base.merging([.link: URL(string: "https://aechtech.com")!]) { $1 }))
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }

    // MARK: - Actions

    /// Rewrite the pasteboard with only its plain-text string. Returns false if
    /// there is no text on the clipboard (in which case it is left untouched).
    @discardableResult
    private func scrubClipboard() -> Bool {
        let pb = NSPasteboard.general
        guard let plain = plainText(from: pb), !plain.isEmpty else { return false }
        pb.clearContents()
        pb.setString(plain, forType: .string)
        return true
    }

    private func plainText(from pb: NSPasteboard) -> String? {
        if let s = pb.string(forType: .string) { return s }
        // Some sources put only RTF/HTML on the clipboard, with no plain flavor.
        if let attributed = pb.readObjects(forClasses: [NSAttributedString.self])?
            .first as? NSAttributedString {
            return attributed.string
        }
        return nil
    }

    @objc private func scrubFromMenu() {
        if scrubClipboard() { flash() }
    }

    @objc private func pasteFromMenu() {
        // Give the menu time to close and key focus to return to the front app.
        pastePlain(after: 0.2)
    }

    fileprivate func pasteFromHotKey() {
        pastePlain(after: 0.03)
    }

    private func pastePlain(after delay: TimeInterval) {
        guard scrubClipboard() else { return }
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            self.postCommandV()
            self.flash()
        }
    }

    private func postCommandV() {
        let source = CGEventSource(stateID: .combinedSessionState)
        let vKey = CGKeyCode(kVK_ANSI_V)
        // Flags are set explicitly so the physical ⌃ still held from the hotkey
        // doesn't leak into the synthesized keystroke.
        let down = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: true)
        down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: false)
        up?.flags = .maskCommand
        down?.post(tap: .cgSessionEventTap)
        up?.post(tap: .cgSessionEventTap)
    }

    // MARK: - Menu bar feedback

    private func setIcon(_ symbolName: String) {
        statusItem.button?.image = NSImage(
            systemSymbolName: symbolName, accessibilityDescription: "PlainPaste")
    }

    private func flash() {
        flashRestore?.cancel()
        setIcon("checkmark.circle")
        let restore = DispatchWorkItem { [weak self] in self?.setIcon("clipboard") }
        flashRestore = restore
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: restore)
    }

    // MARK: - Launch at login

    func menuWillOpen(_ menu: NSMenu) {
        launchAtLoginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSLog("PlainPaste: launch-at-login toggle failed: \(error)")
        }
    }

    // MARK: - Global hotkey (⌃⌘V) via CGEvent tap

    /// The tap can only be created while the process is Accessibility-trusted,
    /// which on first run happens only after the user grants it — so poll
    /// briefly until the grant lands.
    private func startHotKeyTapWhenTrusted() {
        if startHotKeyTap() { return }
        logLine("waiting for Accessibility grant before starting hotkey tap")
        tapRetryTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            if self.startHotKeyTap() {
                timer.invalidate()
                self.tapRetryTimer = nil
            }
        }
    }

    @discardableResult
    private func startHotKeyTap() -> Bool {
        guard eventTap == nil else { return true }
        guard AXIsProcessTrusted() else { return false }

        let callback: CGEventTapCallBack = { _, type, event, userData in
            guard let userData else { return Unmanaged.passUnretained(event) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                delegate.reenableTap()
                return Unmanaged.passUnretained(event)
            }
            let flags = event.flags
            if event.getIntegerValueField(.keyboardEventKeycode) == Int64(kVK_ANSI_V),
               flags.contains(.maskControl), flags.contains(.maskCommand),
               !flags.contains(.maskShift), !flags.contains(.maskAlternate) {
                logLine("hotkey fired")
                DispatchQueue.main.async { delegate.pasteFromHotKey() }
                return nil  // swallow the ⌃⌘V itself
            }
            return Unmanaged.passUnretained(event)
        }

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
            eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
            callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque())
        else {
            logLine("event tap creation failed despite Accessibility trust")
            return false
        }
        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        logLine("hotkey tap active — \u{2303}\u{2318}V is live")
        return true
    }

    fileprivate func reenableTap() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
            logLine("event tap re-enabled after system disable")
        }
    }

    // MARK: - Darwin notification (scriptable scrub)

    private func registerScrubNotification() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(
            center, Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
                guard let observer else { return }
                let delegate = Unmanaged<AppDelegate>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async { delegate.scrubFromMenu() }
            }, scrubNotification as CFString, nil, .deliverImmediately)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
