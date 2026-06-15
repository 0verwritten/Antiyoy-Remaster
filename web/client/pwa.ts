type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallState = "available" | "installed" | "ios" | "unavailable";

let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function notify() {
  for (const listener of listeners) listener();
}

export function getInstallState(): InstallState {
  if (isStandalone()) return "installed";
  if (installPrompt) return "available";
  if (isIos()) return "ios";
  return "unavailable";
}

export function subscribeToInstallState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function installApp() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  notify();
  return choice.outcome === "accepted";
}

export function setupPwa() {
  document.title = "Antiyoy Remaster";

  const metadata: Array<[string, string, string]> = [
    ["link", "rel", "manifest"],
    ["link", "rel", "apple-touch-icon"],
    ["meta", "name", "theme-color"],
    ["meta", "name", "apple-mobile-web-app-capable"],
    ["meta", "name", "apple-mobile-web-app-title"],
  ];
  const values = [
    ["href", "/api/manifest.webmanifest"],
    ["href", "/api/app-icon.svg"],
    ["content", "#3a3a33"],
    ["content", "yes"],
    ["content", "Antiyoy"],
  ];
  metadata.forEach(([tag, attribute, selectorValue], index) => {
    if (document.head.querySelector(`${tag}[${attribute}='${selectorValue}']`)) return;
    const element = document.createElement(tag);
    element.setAttribute(attribute, selectorValue);
    element.setAttribute(values[index][0], values[index][1]);
    document.head.appendChild(element);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    notify();
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/api/sw.js", { scope: "/" });
    });
  }
}
