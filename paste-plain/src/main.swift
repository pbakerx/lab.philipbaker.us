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

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var hotKeyRef: EventHotKeyRef?
    private let launchAtLoginItem = NSMenuItem(
        title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
    private var flashRestore: DispatchWorkItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        setIcon("clipboard")

        let menu = NSMenu()
        menu.delegate = self

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

        registerHotKey()
        registerScrubNotification()
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

    // MARK: - Global hotkey (⌃⌘V)

    private func registerHotKey() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData -> OSStatus in
            guard let userData else { return noErr }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { delegate.pasteFromHotKey() }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), nil)

        let hotKeyID = EventHotKeyID(signature: OSType(0x5050_5354) /* 'PPST' */, id: 1)
        let status = RegisterEventHotKey(
            UInt32(kVK_ANSI_V), UInt32(controlKey | cmdKey), hotKeyID,
            GetApplicationEventTarget(), 0, &hotKeyRef)
        if status != noErr {
            NSLog("PlainPaste: could not register \u{2303}\u{2318}V (error \(status)) — is another app using it?")
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
