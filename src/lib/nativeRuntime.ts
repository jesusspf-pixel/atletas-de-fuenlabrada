import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export const OFFICIAL_WEB_ORIGIN = "https://www.atletasdefuenlabrada.com";

let installed = false;

/** Connects the bundled mobile app to the official Cloudflare Functions. */
export function installNativeRuntime() {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;

  document.documentElement.dataset.nativePlatform = Capacitor.getPlatform();
  const browserFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      return browserFetch(`${OFFICIAL_WEB_ORIGIN}${input}`, init);
    }
    if (input instanceof URL && input.pathname.startsWith("/api/") && input.origin === window.location.origin) {
      return browserFetch(new URL(`${input.pathname}${input.search}`, OFFICIAL_WEB_ORIGIN), init);
    }
    return browserFetch(input, init);
  };

  void App.addListener("appUrlOpen", ({ url }) => {
    try {
      const incoming = new URL(url);
      if (!["atletasdefuenlabrada.com", "www.atletasdefuenlabrada.com"].includes(incoming.hostname)) return;
      window.location.assign(`${incoming.pathname}${incoming.search}${incoming.hash}`);
    } catch {
      // Ignore malformed third-party links rather than navigating the app.
    }
  });
}
