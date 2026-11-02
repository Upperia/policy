// Aktiekompassen – Supabase Edge Function.
// 1) /api/sok och /api/aktie: hämtar kurser och nyckeltal från Yahoo Finance (lib.ts).
// 2) Allt annat: serverar appens filer (index.html, manifest, service worker, ikoner) från
//    GitHub-repot Upperia/policy, mapp aktiekompassen/public, med en kort cache i minnet.
// Ingen portföljdata passerar eller sparas här – allt ligger i mobilens lagring.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { search, quote } from "./lib.ts";

const NAME = "/aktiekompassen";
const FILES = "https://raw.githubusercontent.com/Upperia/policy/main/aktiekompassen/public";
const FILE_CACHE_MS = 5 * 60 * 1000;
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", webmanifest: "application/manifest+json", js: "text/javascript; charset=utf-8",
  png: "image/png", svg: "image/svg+xml", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
};
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheSeconds ? "public, max-age=" + cacheSeconds : "no-store", ...CORS },
  });
}

const files = new Map<string, { at: number; body: Uint8Array; status: number }>();
async function staticFile(name: string): Promise<Response> {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const type = TYPES[ext];
  if (!type || name.includes("..") || name.includes("/")) return json({ error: "Hittades inte" }, 404);
  let hit = files.get(name);
  if (!hit || Date.now() - hit.at > FILE_CACHE_MS) {
    try {
      const r = await fetch(FILES + "/" + name, { headers: { "User-Agent": "aktiekompassen-edge" } });
      const body = new Uint8Array(await r.arrayBuffer());
      if (r.ok || !hit) hit = { at: Date.now(), body, status: r.status };
      else hit.at = Date.now(); // behåll den gamla kopian om GitHub inte svarar
      files.set(name, hit);
    } catch (e) {
      if (!hit) return json({ error: "Kunde inte hämta appens filer: " + String((e as Error).message || e) }, 502);
    }
  }
  if (hit.status !== 200) return json({ error: "Hittades inte" }, 404);
  const longLived = ext === "png" || ext === "svg";
  return new Response(hit.body, {
    headers: { "Content-Type": type, "Cache-Control": longLived ? "public, max-age=86400" : "no-cache", "X-Content-Type-Options": "nosniff", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let path = url.pathname;
  const i = path.indexOf(NAME);
  if (i >= 0) path = path.slice(i + NAME.length);
  if (path === "") {
    // Utan avslutande snedstreck hamnar manifest och service worker utanför appens scope.
    return new Response(null, { status: 301, headers: { Location: url.pathname + "/" + url.search } });
  }
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
    if (path === "/api/status") return json({ ok: true, tid: new Date().toISOString(), filer: FILES });
    if (path.startsWith("/api/")) return json({ error: "Hittades inte" }, 404);
    return staticFile(path === "/" ? "index.html" : path.slice(1));
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
