// Request guards shared by the Widget Maker endpoints (/api/favorites,
// /api/widget). Both accept writes from visitors, so both want the same
// origin check and the same cheap per-instance rate limit.

export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return true;
  return origin === `https://${req.headers.host}`;
}

export function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

// In-memory, per warm instance — enough to blunt a loop, not a real quota.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function rateLimited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 500) hits.clear();
    return recent.length > max;
  };
}
