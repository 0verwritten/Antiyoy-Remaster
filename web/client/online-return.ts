const KEY = "antiyoy.authReturnOnline";

export function markOnlineAuthReturn() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // The URL return path remains the fallback when storage is unavailable.
  }
}

export function shouldReturnToOnline(): boolean {
  const fromUrl =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("screen") === "online";
  if (fromUrl) return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearOnlineAuthReturn() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Best effort only.
  }
}
