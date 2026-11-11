import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

const RETURN_SCHEME = "com.sportmed.atletasdefuenlabrada:";

function restoreRegistration(urlValue: string) {
  if (!Capacitor.isNativePlatform() || !urlValue.startsWith(RETURN_SCHEME)) return;
  const url = new URL(urlValue);
  if (url.hostname !== "stripe-return") return;

  void Browser.close().catch(() => undefined);
  const next = new URL(window.location.href);
  next.pathname = "/";
  next.hash = "";
  next.search = "";
  next.searchParams.set("access", "1");
  next.searchParams.set("section", "Cuotas");
  url.searchParams.forEach((value, key) => next.searchParams.set(key, value));
  window.location.assign(`${next.pathname}${next.search}`);
}

export async function openStripeCheckout(url: string) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  window.location.assign(url);
}

export function installNativeStripeReturn() {
  if (!Capacitor.isNativePlatform()) return;
  void CapacitorApp.addListener("appUrlOpen", ({ url }) => restoreRegistration(url));
  void CapacitorApp.getLaunchUrl().then(result => {
    if (result?.url) restoreRegistration(result.url);
  });
}
