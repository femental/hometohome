import "server-only";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";
const DEFAULT_TIMEOUT_MS = 5000;

export type LatLng = { lat: number; lng: number };

/**
 * Looks up coordinates for an address via the Kakao Local API.
 * Never throws and never exposes the key: a missing key, HTTP error, timeout, network
 * failure or empty result all yield null (the admin then types lat/lng by hand).
 */
export async function geocodeAddress(
  address: string,
  opts: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<LatLng | null> {
  if (!opts.apiKey) return null;
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(`${ENDPOINT}?query=${encodeURIComponent(address)}`, {
      headers: { Authorization: `KakaoAK ${opts.apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { documents?: { x?: string; y?: string }[] };
    const first = body.documents?.[0];
    if (!first || !first.x || !first.y) return null;
    const lat = Number(first.y);
    const lng = Number(first.x);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
