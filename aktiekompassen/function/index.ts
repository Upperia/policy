// Aktiekompassen – Supabase Edge Function med appens API.
// /api/sok och /api/aktie hämtar kurser och nyckeltal från Yahoo Finance (lib.ts).
// Själva appen ligger på GitHub Pages: https://upperia.github.io/policy/aktiekompassen/
// Ingen portföljdata passerar eller sparas här – allt ligger i mobilens lagring.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { search, quote, history } from "./lib.ts";

const NAME = "/aktiekompassen";
const APP_URL = "https://upperia.github.io/policy/aktiekompassen/";
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheSeconds ? "public, max-age=" + cacheSeconds : "no-store", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let path = url.pathname;
  const i = path.indexOf(NAME);
  if (i >= 0) path = path.slice(i + NAME.length);
  try {
    if (path === "/api/sok") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return json([]);
      return json(await search(fetch, q), 200, 300);
    }
    if (path === "/api/aktie") {
      const symbol = (url.searchParams.get("symbol") || "").trim();
      if (!symbol) return json({ error: "symbol saknas" }, 400);
      return json(await quote(fetch, symbol));
    }
    if (path === "/api/historik") {
      const symbol = (url.searchParams.get("symbol") || "").trim();
      if (!symbol) return json({ error: "symbol saknas" }, 400);
      return json(await history(fetch, symbol, url.searchParams.get("range") || "1y"), 200, 1800);
    }
    if (path === "/api/status") return json({ ok: true, tid: new Date().toISOString(), app: APP_URL });
    if (path === "" || path === "/" || path === "/index.html") return new Response(null, { status: 302, headers: { Location: APP_URL } });
    return json({ error: "Hittades inte" }, 404);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
