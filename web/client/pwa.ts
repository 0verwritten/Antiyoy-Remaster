type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallState = "available" | "installed" | "ios" | "unavailable";
export type UpdateState = "checking" | "available" | "current" | "unsupported" | "error";

let installPrompt: InstallPromptEvent | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
const listeners = new Set<() => void>();
const updateListeners = new Set<() => void>();
let waitingWorker: ServiceWorker | null = null;
let updateState: UpdateState = "unsupported";

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

function notifyUpdate() {
  for (const listener of updateListeners) listener();
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

export function getUpdateState(): UpdateState {
  return updateState;
}

export function subscribeToUpdateState(listener: () => void) {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function setUpdateState(next: UpdateState) {
  updateState = next;
  notifyUpdate();
}

function watchRegistration(registration: ServiceWorkerRegistration) {
  const markWaiting = (worker: ServiceWorker | null | undefined) => {
    if (!worker) return;
    waitingWorker = worker;
    setUpdateState("available");
  };
  markWaiting(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) markWaiting(worker);
    });
  });
}

export async function checkForAppUpdate(): Promise<UpdateState> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    setUpdateState("unsupported");
    return updateState;
  }
  setUpdateState("checking");
  try {
    const registration = await (registrationPromise ?? navigator.serviceWorker.ready);
    if (!registration) {
      setUpdateState("unsupported");
      return updateState;
    }
    watchRegistration(registration);
    await registration.update();
    if (registration.waiting) {
      waitingWorker = registration.waiting;
      setUpdateState("available");
    } else {
      setUpdateState("current");
    }
  } catch {
    setUpdateState("error");
  }
  return updateState;
}

export async function applyAppUpdate() {
  if (!waitingWorker) await checkForAppUpdate();
  if (!waitingWorker) return false;
  await new Promise<void>((resolve) => {
    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    setTimeout(resolve, 1500);
  });
  location.reload();
  return true;
}

export async function refreshAppFromServer() {
  const state = await checkForAppUpdate();
  if (state === "available") return applyAppUpdate();
  location.reload();
  return true;
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
      registrationPromise = navigator.serviceWorker.register("/api/sw.js", { scope: "/" }).then((registration) => {
        watchRegistration(registration);
        if (!registration.waiting) setUpdateState("current");
        return registration;
      }, () => {
        setUpdateState("error");
        return null;
      });
    });
  }
}
