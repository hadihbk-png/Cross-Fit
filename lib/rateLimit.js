// Small in-memory sliding-window rate limiter (single server process)

function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> timestamps

  const recent = (key, now) => {
    const ts = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (ts.length) hits.set(key, ts); else hits.delete(key);
    return ts;
  };

  setInterval(() => {
    const now = Date.now();
    for (const key of hits.keys()) recent(key, now);
  }, windowMs).unref();

  return {
    // True if the key has used up its allowance (does not count a new hit)
    isLimited(key) {
      return recent(key, Date.now()).length >= max;
    },
    // Counts a hit; returns true if this hit went over the limit
    hit(key) {
      const now = Date.now();
      const ts = recent(key, now);
      if (ts.length >= max) return true;
      ts.push(now);
      hits.set(key, ts);
      return false;
    },
    reset(key) {
      hits.delete(key);
    },
    // Seconds until the oldest hit leaves the window
    retryAfter(key) {
      const ts = recent(key, Date.now());
      return ts.length ? Math.ceil((windowMs - (Date.now() - ts[0])) / 1000) : 0;
    },
  };
}

module.exports = { createLimiter };
