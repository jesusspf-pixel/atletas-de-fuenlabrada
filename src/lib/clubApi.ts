import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const CLUB_ORIGIN = "https://atletasdefuenlabrada.com";

/** Public links must never contain the packaged app's localhost origin. */
export function publicClubOrigin(): string {
  return Capacitor.isNativePlatform() ? CLUB_ORIGIN : window.location.origin;
}

/** Only club API paths may carry the user's bearer token through this transport. */
export function clubApiUrl(path: string): string {
  const url = new URL(path, CLUB_ORIGIN);
  if (!path.startsWith("/api/") || url.origin !== CLUB_ORIGIN || !url.pathname.startsWith("/api/") || path.includes("\\")) {
    throw new Error("Ruta de servicio del club no válida.");
  }
  return url.href;
}

// Do not patch global fetch: Supabase and external requests keep their own transport.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = clubApiUrl(path);
  if (!Capacitor.isNativePlatform()) return fetch(path, init);
  if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const headers = new Headers(init.headers);
  let data: unknown;
  if (init.body != null) {
    if (typeof init.body !== "string") throw new Error("Formato de solicitud no compatible.");
    data = headers.get("content-type")?.includes("application/json") ? JSON.parse(init.body) : init.body;
  }
  const result = await CapacitorHttp.request({
    url,
    method: init.method || "GET",
    headers: Object.fromEntries(headers.entries()),
    data,
    responseType: "text",
    connectTimeout: 15000,
    readTimeout: 60000,
    disableRedirects: true,
  });
  if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const empty = [204, 205, 304].includes(result.status) || init.method === "HEAD";
  return new Response(empty ? null : typeof result.data === "string" ? result.data : JSON.stringify(result.data), {
    status: result.status,
    headers: result.headers,
  });
}
