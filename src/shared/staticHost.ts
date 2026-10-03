/**
 * Static hosting (GitHub Pages): there is no server, so every `/api/...` call is answered at once with "503" instead of going to the
 * network (the app already treats that as "server not available" and falls back), and root-relative files (`/venues/...`, `/maps/...`)
 * get the site's base path in front. Only active in a build made with VITE_STATIC=1; a no-op everywhere else.
 */
export const STATIC_HOST = import.meta.env.VITE_STATIC === "1";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function staticFetch(real: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/") && !input.startsWith("//")) {
      if (input.startsWith("/api/")) return Promise.resolve(new Response(JSON.stringify({ error: "no server on this site" }), { status: 503, headers: { "Content-Type": "application/json" } }));
      return real(`${BASE}${input}`, init);
    }
    return real(input, init);
  }) as typeof fetch;
}

if (STATIC_HOST && typeof window !== "undefined") window.fetch = staticFetch(window.fetch.bind(window));
