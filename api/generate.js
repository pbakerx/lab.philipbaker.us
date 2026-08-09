// lab.philipbaker.us/api/generate
//
// Streams a self-contained HTML widget back to /widget-maker/ as Server-Sent
// Events. The browser never sees the Anthropic key — it lives in the Vercel
// project env as ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";

// Everything here is tuned around one hard number: a Vercel function on this
// plan is killed at 60s of wall clock (vercel.json → functions.maxDuration, which
// Hobby caps at 60). A good widget is 10-15KB of HTML, and Opus 5 writes it at
// roughly 200 bytes/sec, so the budget is genuinely tight — hence low effort and
// the length discipline in the system prompt.
//
// If the Vercel project moves to Pro, raise maxDuration to 300 and set
// WIDGET_MAKER_EFFORT=high; that removes the constraint entirely.
//
//   WIDGET_MAKER_EFFORT=high|xhigh   more thinking (needs a higher maxDuration)
//   WIDGET_MAKER_SPEED=fast          use fast mode (~2.5x output, premium rate).
//                                    Requires fast-mode access on the org — as of
//                                    writing this org's fast-mode limit is 0/min,
//                                    so the request 429s and falls back below.
//   WIDGET_MAKER_MODEL=claude-opus-5     faster writer, if builds keep timing out
const MODEL = process.env.WIDGET_MAKER_MODEL || "claude-fable-5";
const MAX_TOKENS = 24000;
const EFFORT = process.env.WIDGET_MAKER_EFFORT || "high";
const FAST = process.env.WIDGET_MAKER_SPEED === "fast";

// Fable 5 thinks on every request and can't be told not to — an explicit
// `thinking` config is rejected outright, so we simply never send one. Its
// safety classifiers can also decline a request (HTTP 200, stop_reason
// "refusal"), so we opt into server-side fallbacks: a declined build is re-run
// on Anthropic's recommended fallback model inside the same call instead of
// coming back empty.
const BETAS = ["server-side-fallback-2026-07-01"];

// ── Guardrails ───────────────────────────────────────────────────────────────
// This endpoint spends real money on every call, so keep the obvious doors shut.
const MAX_PROMPT_CHARS = 2000;
const MAX_HTML_CHARS = 400_000;
const RATE_LIMIT = { windowMs: 60_000, max: 8 }; // per IP, per warm instance

// Same-origin only, plus any localhost port for `vercel dev`. We never send CORS
// headers, so a browser on another site can't read the response anyway — this
// just closes the door early and keeps stray embeds off the meter.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin form posts and non-browser callers
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return true;
  return origin === `https://${req.headers.host}`;
}

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear(); // crude ceiling; instances are short-lived
  return recent.length > RATE_LIMIT.max;
}

// ── The system prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the engine behind Widget Maker, a creative sandbox on lab.philipbaker.us.

People type a wish — "a bunch of red balls bouncing around", "asteroids", "a rain
simulator", "a matrix screen", "a tip calculator", "a metronome" — and you build it.
Simulations, generative art, tiny games, instruments, data visualisations, tools,
toys. Whatever they ask for, you make it real and make it good.

# Output format

Return ONE complete HTML document and NOTHING else.

- Begin with \`<!doctype html>\`. End with \`</html>\`.
- No markdown code fences. No explanation, preamble, or commentary — not before the
  document, not after it. The very first characters of your response are \`<!doctype\`.
- Everything inline: one \`<style>\` block in the head, one \`<script>\` block at the
  end of the body. No separate files.
- Include a short, specific \`<title>\` (e.g. "Red Bouncing Balls", "Asteroids",
  "Rain") — it is used as the label in the person's version history.

# The environment you run in

The widget renders inside a sandboxed iframe with no network access and an opaque
origin. Design for that:

- **No external resources of any kind.** No CDN scripts, no \`<link>\` stylesheets,
  no web fonts, no remote images or audio. If you need an asset, generate it in code:
  canvas drawing, inline SVG, CSS gradients, Web Audio, unicode glyphs.
- **No storage APIs.** \`localStorage\`, \`sessionStorage\`, cookies and IndexedDB all
  throw in an opaque origin. Keep state in JavaScript variables.
- **No network calls.** No \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, or \`EventSource\`.
  If the widget wants data, generate it procedurally or embed it as a literal.
- **No \`alert\`, \`prompt\`, or \`confirm\`.** Build real UI instead.
- Modern evergreen browsers only. No frameworks, no transpiling, no \`import\` of
  anything remote. Plain modern JS is perfect.
- Web Audio is available but must start from a user gesture — create or resume the
  \`AudioContext\` inside a click/keydown handler, never on load.

# Fill the frame

The widget IS the page. It is the only thing on screen.

- \`html, body { margin: 0; height: 100%; overflow: hidden; }\` and let the widget
  fill 100% of the viewport. Never leave a white margin or a scrollbar unless
  scrolling is genuinely part of the idea.
- Handle resize. On \`resize\`, re-measure and re-lay-out — don't bake in pixel sizes.
- For canvas: size the backing store to \`clientWidth * devicePixelRatio\` and scale
  the context, so it's crisp on retina. Re-do this on resize.
- Animate with \`requestAnimationFrame\`, and drive motion from delta time (clamped,
  e.g. \`Math.min(dt, 0.05)\`) so it runs the same on a 60Hz and a 120Hz display.
- Support both mouse and touch — use Pointer Events (\`pointerdown\`/\`pointermove\`/
  \`pointerup\`) rather than mouse-only handlers. Call \`e.preventDefault()\` on touch
  where it stops the page fighting you.
- The frame can be small or phone-shaped. Don't assume a desktop viewport.

# Make it good, not just correct

This is the difference between a demo and something worth showing someone.

- **Look considered.** A deliberate palette, real contrast, generous spacing. Default
  to a dark background unless the request implies otherwise — it sits better in the
  frame and makes colour and light read well.
- **Motion has weight.** Easing, momentum, trails, subtle drift. Things that move
  linearly and stop abruptly feel dead.
- **Depth is cheap and effective** — layering, parallax, blur, additive glow
  (\`ctx.globalCompositeOperation = 'lighter'\`), soft shadows, slight transparency.
- **Go a little further than asked.** "Bouncing balls" earns collisions, varied sizes
  and a soft glow. "Rain" earns splashes, depth layers and wind. Add the one or two
  touches the person would have asked for if they'd thought of it — but don't bury
  the actual request under features.
- **Make it interactive** when interaction is natural: cursor attracts or repels,
  click spawns, drag throws, keys steer. A live thing beats a screensaver.
- **Games need to be playable.** Real controls, collision, scoring, a fail state, and
  a way to restart without reloading. Show the controls on screen — briefly, or in a
  corner. Support keyboard AND touch where you can.
- **Tools need to be usable.** Big hit targets, clear labels, sensible defaults,
  visible state. A calculator should take keyboard input too.
- **Perform.** Cap particle counts (a few thousand, not a hundred thousand), reuse
  objects instead of allocating per frame, and stay at 60fps on a laptop.
- Respect \`prefers-reduced-motion\` for decorative ambient motion where it's easy —
  never at the cost of the thing actually being the point.

# Size

Aim for roughly 150-300 lines. That is enough for a genuinely good widget and it
keeps the wait short — the person is watching the code stream in.

Spend those lines on the thing itself: the simulation, the feel, the interaction.
Don't spend them on elaborate settings panels, long option lists, verbose comments,
defensive branches for cases that can't happen, or restating the same CSS three
ways. Terse, well-named code beats a wall of it. If the idea genuinely needs more
room — a full game — take it, but don't pad.

# Robustness

- The code must run first try. No undefined variables, no functions called before
  definition, no typos in property names. Re-read your own code before finishing.
- Guard against zero-size frames, division by zero, and empty arrays.
- Clean up: clear intervals and listeners you replace; don't leak rAF loops.
- No \`debugger\`, no leftover \`console.log\` noise.

# Iterating

When the person asks for a change to an existing widget ("make the rain red", "turn
it into snow", "add a score", "slower"):

- **Return the complete, updated HTML document again** — never a diff, a fragment, or
  a description of what you changed.
- **Change what they asked for and preserve everything else.** Keep the structure,
  the variable names, the tuning, the details they didn't mention. They are building
  on something they already like.
- Take the change seriously in spirit, not just literally. "Turn the rain into snow"
  means slower fall, drift, rounder flakes, settling — not just swapping the colour.
- If a request is ambiguous, choose the most interesting reasonable reading and
  commit to it. Don't ask a question — you have no way to hear the answer.

Now build the thing. Output only the document.`;

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: "Not allowed from this origin." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set on this Vercel project. Add it under Settings → Environment Variables.",
    });
  }

  const gate = process.env.WIDGET_MAKER_PASSCODE;
  if (gate && req.body?.passcode !== gate) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: "Slow down a moment — too many widgets in a minute." });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || "").trim();
  const basePrompt = String(body.basePrompt || "").trim();
  const currentHtml = String(body.currentHtml || "");

  if (!prompt) return res.status(400).json({ error: "Say what to build." });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: "That prompt is too long." });
  }
  if (currentHtml.length > MAX_HTML_CHARS) {
    return res
      .status(400)
      .json({ error: "That widget has grown too large to iterate on." });
  }

  // The current document already embodies every earlier instruction, so the
  // whole history collapses to: what they first asked for, where it got to,
  // and what they want changed now.
  const messages = currentHtml
    ? [
        { role: "user", content: basePrompt || "Build a widget." },
        { role: "assistant", content: currentHtml },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  };

  let produced = 0;
  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  async function run(extra) {
    const stream = client.beta.messages.stream({ ...params, ...extra });
    const abort = () => stream.abort();
    req.on("close", abort);
    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          produced += event.delta.text.length;
          send("delta", { text: event.delta.text });
        }
      }
      return await stream.finalMessage();
    } finally {
      req.off("close", abort);
    }
  }

  // Preferred shape: refusal fallbacks, plus fast mode if it's been enabled.
  const preferred = {
    betas: FAST ? [...BETAS, "fast-mode-2026-02-01"] : BETAS,
    fallbacks: "default",
    ...(FAST ? { speed: "fast" } : {}),
  };

  try {
    let final;
    try {
      final = await run(preferred);
    } catch (err) {
      // These are all opt-in extras the org may not have: fast mode has its own
      // rate limits, and the fallbacks beta may not be enabled. If any of them
      // fails us before a single byte is written, redo the request plainly —
      // the widget matters more than the extras.
      if (produced > 0 || clientGone) throw err;
      send("notice", { message: "Retrying without optional features…" });
      final = await run({});
    }

    if (final.stop_reason === "refusal") {
      send("error", { message: "That one got declined. Try a different idea." });
      return res.end();
    }

    send("done", {
      truncated: final.stop_reason === "max_tokens",
      speed: final.usage?.speed ?? "standard",
      usage: {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cached: final.usage.cache_read_input_tokens ?? 0,
      },
    });
    res.end();
  } catch (err) {
    const raw = err?.message || "";
    const message =
      err?.status === 429
        ? "Anthropic is rate limiting right now — give it a moment."
        : err?.status === 401
          ? "The API key on this project was rejected."
          : /retention/i.test(raw)
            ? // Fable 5 requires 30-day data retention and is unavailable under
              // zero data retention, which reads as a plain 400 on every call.
              `${MODEL} needs 30-day data retention on the Anthropic org. Either change that, or set WIDGET_MAKER_MODEL=claude-opus-5.`
            : raw || "Generation failed.";
    // Headers are already out, so the error has to travel down the stream.
    send("error", { message });
    res.end();
  }
}
