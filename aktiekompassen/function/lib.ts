// Aktiekompassen – datahämtning från Yahoo Finance.
// Ingen Deno-specifik kod här, så att logiken går att köra och testa i Node med en mockad fetch.

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const Q = "https://query2.finance.yahoo.com";

type FetchFn = (input: string, init?: Record<string, unknown>) => Promise<Response>;
type Session = { cookie: string; crumb: string; at: number };

let session: Session | null = null;
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 10 * 60 * 1000;

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;
  return null;
}
function remember(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
}

// Yahoo kräver en "crumb" + cookie för quoteSummary. Hämtas en gång och återanvänds i 20 minuter.
export async function getSession(f: FetchFn, force = false): Promise<Session> {
  if (!force && session && Date.now() - session.at < 20 * 60 * 1000) return session;
  const r1 = await f("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  const h = r1.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies: string[] = typeof h.getSetCookie === "function" ? h.getSetCookie() : (h.get("set-cookie") ? [h.get("set-cookie") as string] : []);
  const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const r2 = await f(Q + "/v1/test/getcrumb", { headers: { "User-Agent": UA, "Cookie": cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 60 || crumb.includes("<")) {
    throw new Error("Yahoo gav ingen session (crumb " + r2.status + ")");
  }
  session = { cookie, crumb, at: Date.now() };
  return session;
}

async function getJson(f: FetchFn, url: string, headers: Record<string, string>) {
  const r = await f(url, { headers: { "User-Agent": UA, "Accept": "application/json", ...headers } });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, ok: r.ok, json };
}

const raw = (x: unknown): number | null => {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object" && "raw" in (x as Record<string, unknown>)) {
    const v = (x as { raw: unknown }).raw;
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  return null;
};
const pct = (x: number | null): number | null => (x == null ? null : x * 100);

export type Quote = {
  symbol: string; namn: string; valuta: string | null; bors: string | null;
  kurs: number | null; forandring: number | null; kursTid: string | null; fxSek: number | null;
  nyckeltal: Record<string, number | null>; rekommendation: string | null;
  varning: string | null; hamtad: string;
};

// Sök bolag. Stockholm (.ST) först, sedan övriga.
export async function search(f: FetchFn, q: string) {
  const key = "sok:" + q.toLowerCase();
  const c = cached<unknown[]>(key);
  if (c) return c;
  const url = Q + "/v1/finance/search?q=" + encodeURIComponent(q) + "&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false";
  const r = await getJson(f, url, {});
  const j = r.json as { quotes?: Array<Record<string, unknown>> } | null;
  if (!r.ok || !j) throw new Error("Sökningen misslyckades (" + r.status + ")");
  const hits = (j.quotes || [])
    .filter((x) => typeof x.symbol === "string" && (x.quoteType === "EQUITY" || x.quoteType === "ETF"))
    .map((x) => ({
      symbol: String(x.symbol),
      namn: String(x.longname || x.shortname || x.symbol),
      bors: String(x.exchDisp || x.exchange || ""),
      typ: x.quoteType === "ETF" ? "ETF" : "Aktie",
    }));
  hits.sort((a, b) => Number(b.symbol.endsWith(".ST")) - Number(a.symbol.endsWith(".ST")));
  remember(key, hits);
  return hits;
}

async function quoteSummary(f: FetchFn, symbol: string) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(f, attempt > 0);
    const url = Q + "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) +
      "?modules=price,summaryDetail,defaultKeyStatistics,financialData&crumb=" + encodeURIComponent(s.crumb);
    const r = await getJson(f, url, { "Cookie": s.cookie });
    if (r.status === 401 || r.status === 403) { lastErr = new Error("Yahoo nekade (" + r.status + ")"); continue; }
    const j = r.json as { quoteSummary?: { result?: Array<Record<string, Record<string, unknown>>>; error?: { description?: string } } } | null;
    const res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if (!res) throw new Error((j && j.quoteSummary && j.quoteSummary.error && j.quoteSummary.error.description) || "Ingen data för " + symbol);
    return res;
  }
  throw lastErr || new Error("Yahoo svarade inte");
}

// Soliditet (eget kapital / totala tillgångar) från senaste balansräkningen.
async function soliditet(f: FetchFn, symbol: string): Promise<number | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const types = "quarterlyTotalAssets,quarterlyStockholdersEquity,annualTotalAssets,annualStockholdersEquity";
    const url = Q + "/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol) +
      "?symbol=" + encodeURIComponent(symbol) + "&type=" + types + "&period1=" + (now - 3 * 365 * 86400) + "&period2=" + now;
    const r = await getJson(f, url, {});
    const j = r.json as { timeseries?: { result?: Array<Record<string, unknown>> } } | null;
    const result = (j && j.timeseries && j.timeseries.result) || [];
    const pick = (type: string): number | null => {
      const row = result.find((x) => { const m = x.meta as { type?: string[] } | undefined; return m && m.type && m.type[0] === type; });
      const arr = row && (row[type] as Array<{ reportedValue?: { raw?: number } } | null> | undefined);
      if (!arr || !arr.length) return null;
      const last = arr.filter(Boolean).slice(-1)[0];
      const v = last && last.reportedValue && last.reportedValue.raw;
      return typeof v === "number" && isFinite(v) ? v : null;
    };
    const assets = pick("quarterlyTotalAssets") ?? pick("annualTotalAssets");
    const equity = pick("quarterlyStockholdersEquity") ?? pick("annualStockholdersEquity");
    return assets && equity != null && assets > 0 ? (equity / assets) * 100 : null;
  } catch {
    return null;
  }
}

// Kurs via chart-API:t (kräver ingen crumb). Används för valutakurser och som reserv.
async function chartPrice(f: FetchFn, symbol: string): Promise<{ kurs: number | null; valuta: string | null; tid: number | null; namn: string | null; bors: string | null; forandring: number | null }> {
  const url = Q + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5d&interval=1d";
  const r = await getJson(f, url, {});
  const j = r.json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }>; error?: { description?: string } } } | null;
  const meta = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!meta) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || "Ingen kurs för " + symbol);
  const kurs = raw(meta.regularMarketPrice);
  const prev = raw(meta.chartPreviousClose) ?? raw(meta.previousClose);
  return {
    kurs, valuta: typeof meta.currency === "string" ? meta.currency : null,
    tid: raw(meta.regularMarketTime), namn: typeof meta.longName === "string" ? meta.longName : (typeof meta.shortName === "string" ? meta.shortName : null),
    bors: typeof meta.exchangeName === "string" ? meta.exchangeName : null,
    forandring: kurs != null && prev ? ((kurs - prev) / prev) * 100 : null,
  };
}

// Växelkurs: hur många enheter av `to` en enhet av `from` är värd.
async function fxRate(f: FetchFn, from: string, to: string): Promise<number | null> {
  if (!from || !to || from === to) return 1;
  const key = "fx:" + from + to;
  const c = cached<number>(key);
  if (c) return c;
  try {
    const p = await chartPrice(f, from + to + "=X");
    if (p.kurs != null && p.kurs > 0) { remember(key, p.kurs); return p.kurs; }
    return null;
  } catch {
    return null;
  }
}

async function fxToSek(f: FetchFn, valuta: string): Promise<number | null> {
  if (!valuta || valuta === "SEK") return 1;
  const key = "fx:" + valuta;
  const c = cached<number>(key);
  if (c) return c;
  try {
    const v = valuta === "GBp" ? "GBP" : valuta; // London noteras i pence
    const p = await chartPrice(f, v + "SEK=X");
    let fx = p.kurs;
    if (fx != null && valuta === "GBp") fx = fx / 100;
    if (fx != null) remember(key, fx);
    return fx;
  } catch {
    return null;
  }
}

export async function quote(f: FetchFn, symbol: string): Promise<Quote> {
  const key = "aktie:" + symbol;
  const c = cached<Quote>(key);
  if (c) return c;
  let out: Quote;
  try {
    const res = await quoteSummary(f, symbol);
    const price = (res.price || {}) as Record<string, unknown>;
    const sd = (res.summaryDetail || {}) as Record<string, unknown>;
    const ks = (res.defaultKeyStatistics || {}) as Record<string, unknown>;
    const fd = (res.financialData || {}) as Record<string, unknown>;
    const kurs = raw(price.regularMarketPrice) ?? raw(fd.currentPrice);
    const totalDebt = raw(fd.totalDebt), totalCash = raw(fd.totalCash), ebitda = raw(fd.ebitda);
    const skuld = totalDebt != null && totalCash != null && ebitda != null && ebitda > 0 ? (totalDebt - totalCash) / ebitda : null;
    const valuta = typeof price.currency === "string" ? price.currency : null;
    const tid = raw(price.regularMarketTime);
    // Yahoo blandar enheter: Londonaktier noteras i pence men vinst/utdelning per aktie anges i pund,
    // och för bolag som redovisar i en annan valuta än kursen (t.ex. ABB i Stockholm, CHF) blir P/S, P/B
    // och EV/EBITDA fel med en växelkursfaktor. Här räknas de om och kontrolleras mot egna beräkningar.
    const pence = valuta === "GBp";
    const fc = typeof fd.financialCurrency === "string" ? fd.financialCurrency : null;
    let k = 1; // enheter av kursvalutan per enhet redovisningsvaluta
    if (fc && valuta && fc !== valuta) {
      const r = await fxRate(f, fc, pence ? "GBP" : valuta);
      if (r) k = r * (pence ? 100 : 1);
    } else if (pence) k = 100;
    const trailingPE = raw(sd.trailingPE);
    const divYield = raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield);
    let vpa: number | null = null;
    if (trailingPE != null && trailingPE > 0 && kurs) vpa = kurs / trailingPE;
    else { const e = raw(ks.trailingEps) ?? raw(price.epsTrailingTwelveMonths); vpa = e == null ? null : e * (pence ? 100 : 1); }
    let utd: number | null = null;
    if (divYield != null && kurs) utd = kurs * divYield;
    else { const d = raw(sd.dividendRate) ?? raw(sd.trailingAnnualDividendRate); utd = d == null ? null : d * (pence ? 100 : 1); }
    const shares = raw(ks.sharesOutstanding) ?? raw(price.sharesOutstanding);
    const capFromYahoo = raw(price.marketCap) ?? raw(sd.marketCap);
    const marketCap = capFromYahoo ?? (kurs && shares ? kurs * shares : null);
    // Yahoos börsvärde anges i pund för pence-noteringar, annars i kursvalutan; ett eget (kurs × antal aktier) är i kursvalutan.
    const kMarket = capFromYahoo != null ? (pence ? 1 : k) : k;
    const revenue = raw(fd.totalRevenue), bookPerShare = raw(ks.bookValue);
    const pick = (yahoo: number | null, own: number | null): number | null => {
      if (own == null || !isFinite(own)) return yahoo;
      if (yahoo == null) return own;
      return Math.abs(yahoo / own - 1) < 0.25 ? yahoo : own;
    };
    const ps = pick(raw(sd.priceToSalesTrailing12Months), marketCap && revenue && revenue > 0 ? marketCap / (revenue * kMarket) : null);
    const pb = pick(raw(ks.priceToBook), kurs && bookPerShare && bookPerShare > 0 ? kurs / (bookPerShare * k) : null);
    const evOwn = marketCap && ebitda && ebitda > 0 ? (marketCap + ((totalDebt ?? 0) - (totalCash ?? 0)) * kMarket) / (ebitda * kMarket) : null;
    const evEbitda = pick(raw(ks.enterpriseToEbitda), evOwn);
    out = {
      symbol,
      namn: String(price.longName || price.shortName || symbol),
      valuta,
      bors: typeof price.exchangeName === "string" ? price.exchangeName : null,
      kurs,
      forandring: pct(raw(price.regularMarketChangePercent)),
      kursTid: tid ? new Date(tid * 1000).toISOString() : null,
      fxSek: null,
      rekommendation: typeof fd.recommendationKey === "string" ? fd.recommendationKey : null,
      nyckeltal: {
        vpa,
        utd,
        da: pct(divYield),
        pe: trailingPE,
        pe_forward: raw(sd.forwardPE) ?? raw(ks.forwardPE),
        ps,
        pb,
        tillv: pct(raw(fd.earningsGrowth) ?? raw(ks.earningsQuarterlyGrowth)),
        oms_tillv: pct(raw(fd.revenueGrowth)),
        roe: pct(raw(fd.returnOnEquity)),
        marginal: pct(raw(fd.operatingMargins)),
        vinstmarginal: pct(raw(fd.profitMargins)),
        skuld,
        skuld_ek: raw(fd.debtToEquity),
        ev_ebitda: evEbitda,
        utdandel: pct(raw(sd.payoutRatio)),
        hogst52: raw(sd.fiftyTwoWeekHigh),
        lagst52: raw(sd.fiftyTwoWeekLow),
        riktkurs: raw(fd.targetMeanPrice),
        borsvarde: marketCap,
        beta: raw(ks.beta) ?? raw(sd.beta),
        solid: null,
      },
      varning: null,
      hamtad: new Date().toISOString(),
    };
    out.nyckeltal.solid = await soliditet(f, symbol);
  } catch (e) {
    // Reserv: bara kursen, via chart-API:t.
    const p = await chartPrice(f, symbol);
    out = {
      symbol, namn: p.namn || symbol, valuta: p.valuta, bors: p.bors, kurs: p.kurs, forandring: p.forandring,
      kursTid: p.tid ? new Date(p.tid * 1000).toISOString() : null, fxSek: null, rekommendation: null,
      nyckeltal: {}, varning: "Bara kursen kunde hämtas – nyckeltal: " + String((e as Error).message || e), hamtad: new Date().toISOString(),
    };
  }
  out.fxSek = out.valuta ? await fxToSek(f, out.valuta) : null;
  remember(key, out);
  return out;
}

// Dagliga stängningskurser för facit och grafer. range: 3mo, 6mo, 1y, 2y, 5y.
export async function history(f: FetchFn, symbol: string, range: string) {
  const r = ["3mo", "6mo", "1y", "2y", "5y"].includes(range) ? range : "1y";
  const key = "hist:" + symbol + ":" + r;
  const c = cached<unknown>(key);
  if (c) return c;
  const url = Q + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=" + r + "&interval=1d";
  const res = await getJson(f, url, {});
  const j = res.json as { chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }>; error?: { description?: string } } } | null;
  const row = j && j.chart && j.chart.result && j.chart.result[0];
  if (!row) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || "Ingen historik för " + symbol);
  const ts = row.timestamp || [];
  const closes = (row.indicators && row.indicators.quote && row.indicators.quote[0] && row.indicators.quote[0].close) || [];
  const priser: Array<[string, number]> = [];
  ts.forEach((t, i) => { const v = closes[i]; if (typeof v === "number" && isFinite(v)) priser.push([new Date(t * 1000).toISOString().slice(0, 10), Math.round(v * 10000) / 10000]); });
  const out = { symbol, valuta: row.meta && typeof row.meta.currency === "string" ? row.meta.currency : null, range: r, priser };
  remember(key, out);
  return out;
}
