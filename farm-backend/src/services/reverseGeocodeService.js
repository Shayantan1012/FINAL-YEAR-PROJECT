import { ApiError } from "../lib/errors.js";

// A single queue and a small cache keep this user-triggered lookup below the
// public provider's one-request-per-second limit on this server instance.
const cache = new Map();
const pending = new Map();
let queue = Promise.resolve();
let nextRequestAt = 0;

export function reverseAddress(point, endpoint) {
  const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.address);
  if (pending.has(key)) return pending.get(key);

  const job = queue.then(async () => {
    const pause = Math.max(0, nextRequestAt - Date.now());
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    nextRequestAt = Date.now() + 1100;
    const url = new URL(endpoint);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("lat", String(point.latitude));
    url.searchParams.set("lon", String(point.longitude));
    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "HarvestMarketplace/1.0 (farm-to-home checkout address lookup)",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new ApiError(503, "Address lookup is unavailable; enter your street and building details");
    }
    if (!response.ok)
      throw new ApiError(503, "Address lookup is unavailable; enter your street and building details");
    const result = await response.json().catch(() => ({}));
    const address = typeof result.display_name === "string"
      ? result.display_name.trim().slice(0, 500)
      : "";
    if (!address)
      throw new ApiError(404, "No readable address was found for this pin");
    cache.set(key, { address, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return address;
  });
  queue = job.catch(() => {});
  pending.set(key, job);
  void job.finally(() => pending.delete(key)).catch(() => {});
  return job;
}
