const KEY = "antiyoy.authReturnOnline";

export function markOnlineAuthReturn() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // The URL return path remains the fallback when storage is unavailable.
  }
}

export function shouldReturnToOnline(): boolean {
  const fromUrl = screenFromUrl() === "online";
  if (fromUrl) return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function screenFromUrl(): "online" | "settings" | null {
  if (typeof location === "undefined") return null;
  const screen = new URLSearchParams(location.search).get("screen");
  return screen === "online" || screen === "settings" ? screen : null;
}

export function clearOnlineAuthReturn() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Best effort only.
  }
}

export function clearOnlineDeepLink() {
  clearScreenDeepLink("online");
}

export function clearScreenDeepLink(screen: "online" | "settings") {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const url = new URL(location.href);
  if (url.searchParams.get("screen") !== screen) return;
  url.searchParams.delete("screen");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}
