// Runtime access to the hosted campaign level strings. The raw strings live
// in assets/web/campaign-levels.json on the CDN (kept out of the bundle); we
// fetch them once and cache. Fetching the JSON client-side needs no deploy
// claim (it's a plain GET, like loading an image).

const CDN = "https://cdn.jsdelivr.net/gh/0verwritten/Antiyoy-Remaster@master";
const DATA_URL = `${CDN}/assets/web/campaign-levels.json`;

let cache: Record<number, string> | null = null;
let inFlight: Promise<Record<number, string>> | null = null;

/** Fetch + cache the hosted campaign data once. Safe to call repeatedly. */
export function ensureCampaignData(): Promise<Record<number, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`campaign data HTTP ${res.status}`);
        return res.json() as Promise<Record<number, string>>;
      })
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        inFlight = null; // allow a retry
        throw err;
      });
  }
  return inFlight;
}

export function isCampaignDataLoaded(): boolean {
  return cache !== null;
}

/** Raw level string for a fixed level, once data is loaded (else undefined). */
export function getFixedLevelRaw(level: number): string | undefined {
  return cache?.[level];
}
