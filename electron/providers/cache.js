const cache = new Map();

function makeKey(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function getCached(keyObj) {
  return cache.get(makeKey(keyObj));
}

function setCached(keyObj, value, ttlMs = 60_000) {
  const k = makeKey(keyObj);
  cache.set(k, value);
  setTimeout(() => cache.delete(k), ttlMs).unref?.();
}

module.exports = { getCached, setCached };