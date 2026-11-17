// Aktiekompassen – fördjupad analysdata från Yahoo Finance.
// /api/analys sätter ihop allt analysmodellen i appen behöver för en aktie: lönsamhet, tillväxt,
// balansräkning, värdering (inkl. egen P/E-historik och jämförbara bolag), utdelningshistorik,
// trend mot index, analytiker och insynshandel. Alla värden är null när källan saknar dem –
// appen gissar aldrig. Råa anrop (raw*) finns kvar för att verifiera fält.
// deno-lint-ignore-file no-explicit-any
import { UA, getSession } from "./lib.ts";

type FetchFn = (input: string, init?: Record<string, unknown>) => Promise<Response>;
const Q = "https://query2.finance.yahoo.com";

const cache = new Map<string, { at: number; data: unknown }>();
function cached<T>(key: string, maxAgeMs: number): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data as T;
  return null;
}
function remember(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
}

async function getJson(f: FetchFn, url: string, headers: Record<string, string>) {
  const r = await f(url, { headers: { "User-Agent": UA, "Accept": "application/json", ...headers } });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, ok: r.ok, json };
}

const raw = (x: any): number | null => {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object" && "raw" in x) { const v = x.raw; return typeof v === "number" && isFinite(v) ? v : null; }
  return null;
};
const pct = (x: number | null): number | null => (x == null ? null : x * 100);
const div = (a: number | null, b: number | null): number | null => (a != null && b != null && b !== 0 ? a / b : null);
const r2 = (x: number | null, d = 2): number | null => (x == null ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d));
const isoDate = (t: number | null): string | null => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);

/* ---------- Råa anrop (felsökning och verifiering) ---------- */
export async function rawSummary(f: FetchFn, symbol: string, modules: string) {
  const s = await getSession(f);
  const url = Q + "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + encodeURIComponent(modules) + "&crumb=" + encodeURIComponent(s.crumb);
  const r = await getJson(f, url, { "Cookie": s.cookie });
  return { status: r.status, body: r.json };
}
export async function rawTimeseries(f: FetchFn, symbol: string, types: string, years = 6) {
  const now = Math.floor(Date.now() / 1000);
  const url = Q + "/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol) +
    "?symbol=" + encodeURIComponent(symbol) + "&type=" + encodeURIComponent(types) + "&period1=" + (now - years * 365 * 86400) + "&period2=" + now;
  const r = await getJson(f, url, {});
  return { status: r.status, body: r.json };
}
export async function peers(f: FetchFn, symbol: string) {
  const url = Q + "/v6/finance/recommendationsbysymbol/" + encodeURIComponent(symbol);
  const r = await getJson(f, url, {});
  const j = r.json as any;
  const list = (j && j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].recommendedSymbols) || [];
  return { status: r.status, symboler: list.map((x: any) => String(x.symbol)) as string[] };
}
export async function rawQuotes(f: FetchFn, symbols: string[]) {
  const s = await getSession(f);
  const url = Q + "/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(",")) + "&crumb=" + encodeURIComponent(s.crumb);
  const r = await getJson(f, url, { "Cookie": s.cookie });
  return { status: r.status, body: r.json };
}
export async function rawChart(f: FetchFn, symbol: string, range: string, interval: string, events: string) {
  const url = Q + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=" + range + "&interval=" + interval + (events ? "&events=" + events : "");
  const r = await getJson(f, url, {});
  return { status: r.status, body: r.json };
}

/* ---------- Hjälpare mot Yahoo ---------- */
async function summaryModules(f: FetchFn, symbol: string, modules: string): Promise<Record<string, any>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(f, attempt > 0);
    const url = Q + "/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + encodeURIComponent(modules) + "&crumb=" + encodeURIComponent(s.crumb);
    const r = await getJson(f, url, { "Cookie": s.cookie });
    if (r.status === 401 || r.status === 403) { lastErr = new Error("Yahoo nekade (" + r.status + ")"); continue; }
    const j = r.json as any;
    const res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if (!res) throw new Error((j && j.quoteSummary && j.quoteSummary.error && j.quoteSummary.error.description) || "Ingen data för " + symbol);
    return res;
  }
  throw lastErr || new Error("Yahoo svarade inte");
}

type Serie = Array<{ d: string; v: number }>;
async function timeseries(f: FetchFn, symbol: string, types: string[], years = 6): Promise<{ series: Record<string, Serie>; valuta: string | null }> {
  const now = Math.floor(Date.now() / 1000);
  const url = Q + "/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol) +
    "?symbol=" + encodeURIComponent(symbol) + "&type=" + encodeURIComponent(types.join(",")) + "&period1=" + (now - years * 365 * 86400) + "&period2=" + now;
  const r = await getJson(f, url, {});
  const j = r.json as any;
  const rows = (j && j.timeseries && j.timeseries.result) || [];
  const series: Record<string, Serie> = {};
  let valuta: string | null = null;
  rows.forEach((row: any) => {
    const t = row.meta && row.meta.type && row.meta.type[0];
    if (!t) return;
    const arr = (row[t] || []).filter(Boolean) as any[];
    const out: Serie = [];
    arr.forEach((p) => { const v = p && p.reportedValue && p.reportedValue.raw; if (typeof v === "number" && isFinite(v) && p.asOfDate) { out.push({ d: String(p.asOfDate), v }); if (!valuta && p.currencyCode) valuta = String(p.currencyCode); } });
    out.sort((a, b) => a.d.localeCompare(b.d));
    if (out.length) series[t] = out;
  });
  return { series, valuta };
}

async function chart(f: FetchFn, symbol: string, range: string, interval: string, withDiv: boolean) {
  const key = "chart:" + symbol + ":" + range + ":" + interval + (withDiv ? ":div" : "");
  const c = cached<any>(key, 60 * 60 * 1000);
  if (c) return c;
  const url = Q + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=" + range + "&interval=" + interval + (withDiv ? "&events=div" : "");
  const r = await getJson(f, url, {});
  const j = r.json as any;
  const row = j && j.chart && j.chart.result && j.chart.result[0];
  if (!row) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || "Ingen kurshistorik för " + symbol);
  const ts: number[] = row.timestamp || [];
  const closes: Array<number | null> = (row.indicators && row.indicators.quote && row.indicators.quote[0] && row.indicators.quote[0].close) || [];
  const priser: Array<[string, number]> = [];
  ts.forEach((t, i) => { const v = closes[i]; if (typeof v === "number" && isFinite(v)) priser.push([new Date(t * 1000).toISOString().slice(0, 10), v]); });
  const utd: Array<[string, number]> = [];
  if (withDiv && row.events && row.events.dividends) {
    Object.values(row.events.dividends as Record<string, any>).forEach((d: any) => { if (d && typeof d.amount === "number" && d.date) utd.push([new Date(d.date * 1000).toISOString().slice(0, 10), d.amount]); });
    utd.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const out = { valuta: row.meta && row.meta.currency ? String(row.meta.currency) : null, priser, utd };
  remember(key, out);
  return out;
}

async function fxRate(f: FetchFn, from: string, to: string): Promise<number | null> {
  if (!from || !to || from === to) return 1;
  const key = "fx:" + from + to;
  const c = cached<number>(key, 60 * 60 * 1000);
  if (c) return c;
  try {
    const ch = await chart(f, from + to + "=X", "5d", "1d", false);
    const last = ch.priser.length ? ch.priser[ch.priser.length - 1][1] : null;
    if (last && last > 0) { remember(key, last); return last; }
  } catch { /* ingen kurs */ }
  return null;
}

function indexFor(symbol: string): string {
  const suf = symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1).toUpperCase() : "";
  if (suf === "ST") return "^OMXSPI";
  if (suf === "L") return "^FTSE";
  if (suf === "TO" || suf === "V") return "^GSPTSE";
  if (suf === "CO") return "^OMXC25";
  if (suf === "HE") return "^OMXH25";
  if (suf === "OL") return "^OSEAX";
  if (["AS", "PA", "DE", "F", "MI", "MC", "BR", "SW", "VI", "LS"].includes(suf)) return "^STOXX50E";
  return "^GSPC";
}

/* ---------- Beräkningar ---------- */
function retur(priser: Array<[string, number]>, days: number): number | null {
  if (priser.length < 2) return null;
  const last = priser[priser.length - 1];
  const target = new Date(last[0] + "T00:00:00"); target.setDate(target.getDate() - days);
  const iso = target.toISOString().slice(0, 10);
  let base: [string, number] | null = null;
  for (let i = priser.length - 1; i >= 0; i--) { if (priser[i][0] <= iso) { base = priser[i]; break; } }
  if (!base) base = priser[0];
  return base[1] > 0 ? (last[1] / base[1] - 1) * 100 : null;
}
function sma(values: number[], n: number, endIndex?: number): number | null {
  const end = endIndex == null ? values.length : endIndex;
  if (end < n) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += values[i];
  return s / n;
}
function rsi14(values: number[]): number | null {
  if (values.length < 16) return null;
  let gain = 0, loss = 0;
  for (let i = values.length - 14; i < values.length; i++) { const d = values[i] - values[i - 1]; if (d > 0) gain += d; else loss -= d; }
  if (gain + loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = (gain / 14) / (loss / 14);
  return 100 - 100 / (1 + rs);
}
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}
function last(s: Serie | undefined): number | null { return s && s.length ? s[s.length - 1].v : null; }
function prev(s: Serie | undefined): number | null { return s && s.length > 1 ? s[s.length - 2].v : null; }
function cagr(s: Serie | undefined, years: number): number | null {
  if (!s || s.length < years + 1) return null;
  const a = s[s.length - 1 - years].v, b = s[s.length - 1].v;
  if (a <= 0 || b <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

const TS_TYPES = (() => {
  const base = ["TotalRevenue", "NetIncome", "OperatingCashFlow", "FreeCashFlow", "TotalAssets", "LongTermDebt", "TotalDebt", "CurrentAssets", "CurrentLiabilities", "GrossProfit", "EBIT", "OrdinarySharesNumber", "StockholdersEquity", "RetainedEarnings", "TotalLiabilitiesNetMinorityInterest", "InterestExpense", "DilutedEPS", "InvestedCapital", "CashDividendsPaid", "WorkingCapital", "CapitalExpenditure"];
  const quarterly = ["TotalAssets", "StockholdersEquity", "CurrentAssets", "CurrentLiabilities", "LongTermDebt", "TotalDebt", "OrdinarySharesNumber", "RetainedEarnings", "TotalLiabilitiesNetMinorityInterest", "WorkingCapital", "InvestedCapital", "NetIncome", "TotalRevenue"];
  const trailing = ["NetIncome", "OperatingCashFlow", "FreeCashFlow", "EBIT", "TotalRevenue", "GrossProfit", "DilutedEPS", "InterestExpense", "CashDividendsPaid"];
  return base.map((t) => "annual" + t).concat(quarterly.map((t) => "quarterly" + t), trailing.map((t) => "trailing" + t));
})();

function bolagstyp(sector: string | null, industry: string | null): string {
  const i = (industry || "").toLowerCase(), s = (sector || "").toLowerCase();
  if (i.includes("bank")) return "bank";
  if (i.includes("insurance")) return "forsakring";
  if (i.includes("reit") || i.includes("real estate")) return "fastighet";
  if (i.includes("asset management") || i.includes("capital markets") || i.includes("closed-end") || i.includes("conglomerates")) return "investment";
  if (s.includes("financial")) return "finans";
  return "vanlig";
}

export async function analys(f: FetchFn, symbol: string) {
  const key = "analys:" + symbol;
  const c = cached<any>(key, 6 * 60 * 60 * 1000);
  if (c) return c;
  const saknas: string[] = [];
  const mods = "price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,recommendationTrend,calendarEvents,summaryProfile,insiderTransactions,earningsHistory";
  const res = await summaryModules(f, symbol, mods);
  const price = res.price || {}, sd = res.summaryDetail || {}, ks = res.defaultKeyStatistics || {}, fd = res.financialData || {};
  const prof = res.summaryProfile || {};
  const kurs = raw(price.regularMarketPrice) ?? raw(fd.currentPrice);
  const valuta: string | null = typeof price.currency === "string" ? price.currency : null;
  const pence = valuta === "GBp";

  // Bokslutsdata
  let ts: { series: Record<string, Serie>; valuta: string | null } = { series: {}, valuta: null };
  try { ts = await timeseries(f, symbol, TS_TYPES, 6); } catch { saknas.push("bokslut"); }
  const S = ts.series;
  const fc: string | null = (typeof fd.financialCurrency === "string" ? fd.financialCurrency : null) || ts.valuta;
  // k: enheter av kursvalutan per enhet redovisningsvaluta (för belopp per aktie); kMarket: för börsvärde från Yahoo.
  let k = 1;
  if (fc && valuta && fc !== valuta) { const r = await fxRate(f, fc, pence ? "GBP" : valuta); if (r) k = r * (pence ? 100 : 1); }
  else if (pence) k = 100;
  const shares = raw(ks.sharesOutstanding) ?? raw(price.sharesOutstanding) ?? last(S.quarterlyOrdinarySharesNumber) ?? last(S.annualOrdinarySharesNumber);
  const capFromYahoo = raw(price.marketCap) ?? raw(sd.marketCap);
  const marketCap = capFromYahoo ?? (kurs && shares ? kurs * shares : null); // i kursvalutan (pence-noteringar: pund)
  const kMarket = capFromYahoo != null ? (pence ? 1 : k) : k;
  const capFc = marketCap != null ? marketCap / kMarket : null; // börsvärde i redovisningsvalutan

  // Resultat och kassaflöde (senaste 12 mån)
  const revenue = last(S.trailingTotalRevenue) ?? raw(fd.totalRevenue);
  const netIncome = last(S.trailingNetIncome) ?? raw(ks.netIncomeToCommon);
  const ocf = last(S.trailingOperatingCashFlow) ?? raw(fd.operatingCashflow);
  const fcf = last(S.trailingFreeCashFlow) ?? raw(fd.freeCashflow);
  const ebit = last(S.trailingEBIT) ?? last(S.annualEBIT);
  const ebitda = raw(fd.ebitda);
  const grossProfit = last(S.trailingGrossProfit) ?? raw(fd.grossProfits);
  const interest = last(S.trailingInterestExpense) ?? last(S.annualInterestExpense);
  const divPaid = last(S.trailingCashDividendsPaid) ?? last(S.annualCashDividendsPaid);
  // Balans (senaste kvartal, annars år)
  const totalAssets = last(S.quarterlyTotalAssets) ?? last(S.annualTotalAssets);
  const equity = last(S.quarterlyStockholdersEquity) ?? last(S.annualStockholdersEquity);
  const currentAssets = last(S.quarterlyCurrentAssets) ?? last(S.annualCurrentAssets);
  const currentLiabilities = last(S.quarterlyCurrentLiabilities) ?? last(S.annualCurrentLiabilities);
  const ltDebt = last(S.quarterlyLongTermDebt) ?? last(S.annualLongTermDebt);
  const totalDebt = raw(fd.totalDebt) ?? last(S.quarterlyTotalDebt) ?? last(S.annualTotalDebt);
  const cash = raw(fd.totalCash);
  const retained = last(S.quarterlyRetainedEarnings) ?? last(S.annualRetainedEarnings);
  const totalLiab = last(S.quarterlyTotalLiabilitiesNetMinorityInterest) ?? last(S.annualTotalLiabilitiesNetMinorityInterest);
  const workingCapital = last(S.quarterlyWorkingCapital) ?? last(S.annualWorkingCapital) ?? (currentAssets != null && currentLiabilities != null ? currentAssets - currentLiabilities : null);
  const investedCapital = last(S.quarterlyInvestedCapital) ?? last(S.annualInvestedCapital);

  const typ = bolagstyp(prof.sector || null, prof.industry || null);
  const finansiell = typ === "bank" || typ === "forsakring" || typ === "finans";

  // Lönsamhet
  const roe = pct(raw(fd.returnOnEquity)) ?? (netIncome != null && equity ? netIncome / equity * 100 : null);
  const roa = pct(raw(fd.returnOnAssets)) ?? (netIncome != null && totalAssets ? netIncome / totalAssets * 100 : null);
  const roic = ebit != null && investedCapital ? (ebit * 0.78) / investedCapital * 100 : null; // ungefärlig, 22 % schablonskatt
  const bruttomarginal = pct(raw(fd.grossMargins)) ?? (grossProfit != null && revenue ? grossProfit / revenue * 100 : null);
  const rorelsemarginal = pct(raw(fd.operatingMargins)) ?? (ebit != null && revenue ? ebit / revenue * 100 : null);
  const vinstmarginal = pct(raw(fd.profitMargins)) ?? (netIncome != null && revenue ? netIncome / revenue * 100 : null);
  const gm = (y: Serie | undefined, r: Serie | undefined, back: number) => { const a = y && y.length > back ? y[y.length - 1 - back].v : null; const b = r && r.length > back ? r[r.length - 1 - back].v : null; return a != null && b ? a / b * 100 : null; };
  const bruttomarginalFg = gm(S.annualGrossProfit, S.annualTotalRevenue, 1);
  const bruttomarginalNu = gm(S.annualGrossProfit, S.annualTotalRevenue, 0);
  const rorelsemarginalFg = gm(S.annualEBIT, S.annualTotalRevenue, 1);
  const rorelsemarginalNu = gm(S.annualEBIT, S.annualTotalRevenue, 0);
  const vinstkvalitet = ocf != null && netIncome ? ocf / netIncome : null;

  // F-score (två senaste boksluten)
  let fscore: any = null;
  if (!finansiell) {
    const ni0 = last(S.annualNetIncome), ni1 = prev(S.annualNetIncome), ta0 = last(S.annualTotalAssets), ta1 = prev(S.annualTotalAssets);
    const cfo0 = last(S.annualOperatingCashFlow);
    const ltd0 = last(S.annualLongTermDebt), ltd1 = prev(S.annualLongTermDebt);
    const ca0 = last(S.annualCurrentAssets), ca1 = prev(S.annualCurrentAssets), cl0 = last(S.annualCurrentLiabilities), cl1 = prev(S.annualCurrentLiabilities);
    const sh0 = last(S.annualOrdinarySharesNumber), sh1 = prev(S.annualOrdinarySharesNumber);
    const gp0 = last(S.annualGrossProfit), gp1 = prev(S.annualGrossProfit), rev0 = last(S.annualTotalRevenue), rev1 = prev(S.annualTotalRevenue);
    const roa0 = div(ni0, ta0), roa1 = div(ni1, ta1);
    const test = (ok: boolean | null, namn: string, varde: string) => ({ namn, ok, varde });
    const delar = [
      test(roa0 == null ? null : roa0 > 0, "Positiv avkastning på tillgångar", roa0 == null ? "–" : (roa0 * 100).toFixed(1) + " %"),
      test(cfo0 == null ? null : cfo0 > 0, "Positivt kassaflöde från rörelsen", cfo0 == null ? "–" : (cfo0 > 0 ? "ja" : "nej")),
      test(roa0 == null || roa1 == null ? null : roa0 > roa1, "Stigande avkastning på tillgångar", roa0 == null || roa1 == null ? "–" : (roa1 * 100).toFixed(1) + " → " + (roa0 * 100).toFixed(1) + " %"),
      test(cfo0 == null || ni0 == null ? null : cfo0 > ni0, "Kassaflöde större än vinst", cfo0 == null || ni0 == null ? "–" : (cfo0 > ni0 ? "ja" : "nej")),
      test(ltd0 == null || ltd1 == null || !ta0 || !ta1 ? null : ltd0 / ta0 <= ltd1 / ta1, "Minskande långfristig skuld", ltd0 == null || ltd1 == null || !ta0 || !ta1 ? "–" : (ltd1 / ta1 * 100).toFixed(0) + " → " + (ltd0 / ta0 * 100).toFixed(0) + " % av tillgångarna"),
      test(ca0 == null || ca1 == null || !cl0 || !cl1 ? null : ca0 / cl0 > ca1 / cl1, "Stigande balanslikviditet", ca0 == null || ca1 == null || !cl0 || !cl1 ? "–" : (ca1 / cl1).toFixed(2) + " → " + (ca0 / cl0).toFixed(2)),
      test(sh0 == null || sh1 == null ? null : sh0 <= sh1 * 1.01, "Ingen utspädning", sh0 == null || sh1 == null ? "–" : ((sh0 / sh1 - 1) * 100).toFixed(1) + " % fler aktier"),
      test(gp0 == null || gp1 == null || !rev0 || !rev1 ? null : gp0 / rev0 > gp1 / rev1, "Stigande bruttomarginal", gp0 == null || gp1 == null || !rev0 || !rev1 ? "–" : (gp1 / rev1 * 100).toFixed(1) + " → " + (gp0 / rev0 * 100).toFixed(1) + " %"),
      test(rev0 == null || rev1 == null || !ta0 || !ta1 ? null : rev0 / ta0 > rev1 / ta1, "Stigande kapitalomsättning", rev0 == null || rev1 == null || !ta0 || !ta1 ? "–" : (rev1 / ta1).toFixed(2) + " → " + (rev0 / ta0).toFixed(2)),
    ];
    const bedomda = delar.filter((d) => d.ok != null).length;
    fscore = { poang: delar.filter((d) => d.ok).length, av: bedomda, delar, ar: last(S.annualNetIncome) ? S.annualNetIncome[S.annualNetIncome.length - 1].d : null };
  }

  // Altman Z (icke-finansiella)
  let zscore: number | null = null;
  if (!finansiell && totalAssets && totalLiab && workingCapital != null && retained != null && ebit != null && revenue != null && capFc != null) {
    zscore = 1.2 * workingCapital / totalAssets + 1.4 * retained / totalAssets + 3.3 * ebit / totalAssets + 0.6 * capFc / totalLiab + 1.0 * revenue / totalAssets;
  }

  // Tillväxt
  const et = (res.earningsTrend && res.earningsTrend.trend) || [];
  const per = (p: string) => et.find((t: any) => t.period === p) || {};
  const estG = (p: string) => pct(raw(per(p).growth));
  const estRev = (p: string) => pct(raw(per(p).revenueEstimate && per(p).revenueEstimate.growth));
  const revs = ["0y", "+1y"].map((p) => per(p).epsRevisions || {});
  const upp30 = revs.reduce((s, r) => s + (raw(r.upLast30days) || 0), 0), ner30 = revs.reduce((s, r) => s + (raw(r.downLast30days) || 0), 0);
  const trend0y = per("0y").epsTrend || {};
  const estRev90 = raw(trend0y.current) != null && raw(trend0y["90daysAgo"]) ? (raw(trend0y.current)! / raw(trend0y["90daysAgo"])! - 1) * 100 : null;
  const eh = (res.earningsHistory && res.earningsHistory.history) || [];
  const surprises = eh.map((h: any) => raw(h.surprisePercent)).filter((x: any) => x != null) as number[];
  const snittOverraskning = surprises.length ? surprises.reduce((a, b) => a + b, 0) / surprises.length * 100 : null;
  const slagEstimat = eh.filter((h: any) => raw(h.surprisePercent) != null && raw(h.surprisePercent)! > 0).length;

  // Balans och styrka
  const currentRatio = raw(fd.currentRatio) ?? div(currentAssets, currentLiabilities);
  const quickRatio = raw(fd.quickRatio);
  const soliditet = equity != null && totalAssets ? equity / totalAssets * 100 : null;
  const nettoskuld = totalDebt != null && cash != null ? totalDebt - cash : null;
  const nettoskuldEbitda = nettoskuld != null && ebitda && ebitda > 0 ? nettoskuld / ebitda : null;
  const skuldEk = raw(fd.debtToEquity) ?? (totalDebt != null && equity ? totalDebt / equity * 100 : null);
  const rantetackning = ebit != null && interest != null && interest > 0 ? ebit / interest : null;
  const sh = S.quarterlyOrdinarySharesNumber || S.annualOrdinarySharesNumber;
  const utspadning1ar = sh && sh.length >= 5 && S.quarterlyOrdinarySharesNumber ? (sh[sh.length - 1].v / sh[sh.length - 5].v - 1) * 100 : (S.annualOrdinarySharesNumber && S.annualOrdinarySharesNumber.length > 1 ? (last(S.annualOrdinarySharesNumber)! / prev(S.annualOrdinarySharesNumber)! - 1) * 100 : null);
  const ltdNu = last(S.annualLongTermDebt), ltdFg = prev(S.annualLongTermDebt);
  const skuldTrend = ltdNu != null && ltdFg ? (ltdNu / ltdFg - 1) * 100 : null;

  // Värdering
  const trailingPE = raw(sd.trailingPE);
  const epsYahoo = raw(ks.trailingEps) ?? raw(price.epsTrailingTwelveMonths); // per aktie i hela valutan (pund för pence-noteringar)
  const vpa = trailingPE != null && trailingPE > 0 && kurs ? kurs / trailingPE : (epsYahoo != null ? epsYahoo * (pence ? 100 : 1) : null);
  const forwardPE = raw(sd.forwardPE) ?? raw(ks.forwardPE);
  const bookPerShare = raw(ks.bookValue);
  const bvps = bookPerShare != null ? bookPerShare * k : null; // i kursvalutan
  const pb = kurs && bvps && bvps > 0 ? kurs / bvps : raw(ks.priceToBook);
  const ps = capFc != null && revenue ? capFc / revenue : raw(sd.priceToSalesTrailing12Months);
  const evFc = capFc != null ? capFc + (totalDebt ?? 0) - (cash ?? 0) : null;
  const evPositivt = evFc != null && evFc > 0;
  // När nettokassan är större än börsvärdet (EV ≤ 0) blir EV-multiplar meningslösa – då lämnas de tomma och flaggas i stället.
  const evEbitda = evPositivt && ebitda && ebitda > 0 ? evFc! / ebitda : null;
  const evEbit = evPositivt && ebit && ebit > 0 ? evFc! / ebit : null;
  const vinstavkastning = evPositivt && ebit != null ? ebit / evFc! * 100 : null; // Magic Formula: EBIT/EV
  const fcfYield = capFc && fcf != null ? fcf / capFc * 100 : null;
  const tillv1y = estG("+1y"), tillv0y = estG("0y");
  const pegYahoo = raw(ks.pegRatio);
  const peg = pegYahoo ?? (trailingPE && tillv1y && tillv1y > 0 ? trailingPE / tillv1y : null);
  const graham = vpa && vpa > 0 && bvps && bvps > 0 ? Math.sqrt(22.5 * vpa * bvps) : null;
  const riktkurs = raw(fd.targetMeanPrice);

  // Egen P/E-historik (5 år, månadsvis) + utdelningshistorik (10 år)
  let peHist: any = null;
  let utdHist: any = null;
  try {
    const ch = await chart(f, symbol, "10y", "1mo", true);
    const epsSerie = S.annualDilutedEPS || [];
    if (epsSerie.length && kurs) {
      const kEps = pence ? 100 : (fc && valuta && fc !== valuta ? k : 1);
      const pes: number[] = [];
      const start = new Date(); start.setFullYear(start.getFullYear() - 5);
      const startIso = start.toISOString().slice(0, 10);
      ch.priser.forEach(([d, close]) => {
        if (d < startIso) return;
        let eps: number | null = null;
        for (let i = epsSerie.length - 1; i >= 0; i--) { if (epsSerie[i].d <= d) { eps = epsSerie[i].v; break; } }
        if (eps != null && eps > 0) pes.push(close / (eps * kEps));
      });
      if (pes.length >= 12) {
        const sorted = pes.slice().sort((a, b) => a - b);
        const cur = trailingPE;
        const percentil = cur != null ? sorted.filter((x) => x < cur).length / sorted.length * 100 : null;
        peHist = { median: r2(percentile(sorted, 50), 1), p25: r2(percentile(sorted, 25), 1), p75: r2(percentile(sorted, 75), 1), p90: r2(percentile(sorted, 90), 1), percentil: r2(percentil, 0), manader: pes.length };
      }
    }
    if (ch.utd.length) {
      const perAr: Record<string, number> = {};
      ch.utd.forEach(([d, a]) => { const y = d.slice(0, 4); perAr[y] = (perAr[y] || 0) + a; });
      // Alla hela kalenderår från första utdelningen till i fjol; år utan utdelning räknas som 0 (en indragen utdelning bryter sviten).
      const iAr = new Date().getFullYear();
      const forstaAr = Number(Object.keys(perAr).sort()[0]);
      const kompletta: string[] = [];
      for (let y = forstaAr; y < iAr; y++) { const ys = String(y); if (!(ys in perAr)) perAr[ys] = 0; kompletta.push(ys); }
      let utanSankning = 0;
      for (let i = kompletta.length - 1; i > 0; i--) { const nu = perAr[kompletta[i]], fg = perAr[kompletta[i - 1]]; if (nu > 0 && nu >= fg * 0.999) utanSankning++; else break; }
      const n5 = kompletta.length >= 6 ? 5 : kompletta.length - 1;
      const tillv5 = n5 > 0 && perAr[kompletta[kompletta.length - 1 - n5]] > 0 && perAr[kompletta[kompletta.length - 1]] > 0 ? (Math.pow(perAr[kompletta[kompletta.length - 1]] / perAr[kompletta[kompletta.length - 1 - n5]], 1 / n5) - 1) * 100 : null;
      // Sänkt (eller indragen) utdelning: senaste hela kalenderåret lägre än året före.
      const sistaAr = kompletta[kompletta.length - 1], naraAr = kompletta[kompletta.length - 2];
      const sankt = naraAr != null && perAr[naraAr] > 0 && perAr[sistaAr] < perAr[naraAr] * 0.999;
      utdHist = { perAr: kompletta.slice(-10).map((y) => [y, r2(perAr[y], 4)]), arUtanSankning: utanSankning, tillvaxt5ar: r2(tillv5, 1), senast: ch.utd[ch.utd.length - 1][0], sankt };
    }
  } catch { saknas.push("kurshistorik"); }

  // Trend mot index
  let trend: any = { ma50: raw(sd.fiftyDayAverage), ma200: raw(sd.twoHundredDayAverage), ma200Riktning: null, rsi14: null, rs3m: null, rs6m: null, rs12m: null, avk3m: null, avk6m: null, avk12m: null, index: indexFor(symbol), indexAvk12m: null, volatilitet: null };
  try {
    const ch1 = await chart(f, symbol, "1y", "1d", false);
    const closes = ch1.priser.map((p) => p[1]);
    const ma200Nu = sma(closes, 200), ma200Fg = sma(closes, 200, closes.length - 40);
    trend.ma50 = trend.ma50 ?? sma(closes, 50);
    trend.ma200 = trend.ma200 ?? ma200Nu;
    trend.ma200Riktning = ma200Nu != null && ma200Fg ? (ma200Nu / ma200Fg - 1) * 100 : null;
    trend.rsi14 = rsi14(closes);
    trend.avk3m = retur(ch1.priser, 91); trend.avk6m = retur(ch1.priser, 182); trend.avk12m = retur(ch1.priser, 365);
    if (closes.length > 30) { const rets: number[] = []; for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1])); const m = rets.reduce((a, b) => a + b, 0) / rets.length; const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / rets.length; trend.volatilitet = Math.sqrt(v * 252) * 100; }
    try {
      const idx = await chart(f, trend.index, "1y", "1d", false);
      const i3 = retur(idx.priser, 91), i6 = retur(idx.priser, 182), i12 = retur(idx.priser, 365);
      trend.indexAvk12m = i12;
      trend.rs3m = trend.avk3m != null && i3 != null ? trend.avk3m - i3 : null;
      trend.rs6m = trend.avk6m != null && i6 != null ? trend.avk6m - i6 : null;
      trend.rs12m = trend.avk12m != null && i12 != null ? trend.avk12m - i12 : null;
    } catch { saknas.push("index"); }
  } catch { saknas.push("trend"); }
  for (const kk of Object.keys(trend)) if (typeof trend[kk] === "number") trend[kk] = r2(trend[kk], 2);

  // Analytiker
  const rt = (res.recommendationTrend && res.recommendationTrend.trend) || [];
  const andelKop = (t: any) => { const tot = (t.strongBuy || 0) + (t.buy || 0) + (t.hold || 0) + (t.sell || 0) + (t.strongSell || 0); return tot ? ((t.strongBuy || 0) + (t.buy || 0)) / tot * 100 : null; };
  const rtNu = rt.find((t: any) => t.period === "0m"), rt3 = rt.find((t: any) => t.period === "-3m");
  const ce = res.calendarEvents || {};
  const idag = new Date().toISOString().slice(0, 10);
  const rapportDatum: string[] = ((ce.earnings && ce.earnings.earningsDate) || []).map((d: any) => (d && d.fmt) || isoDate(raw(d))).filter(Boolean).sort();
  const kommande = rapportDatum.filter((d) => d >= idag);
  const analytiker = {
    antal: raw(fd.numberOfAnalystOpinions), snitt: raw(fd.recommendationMean), rek: fd.recommendationKey || null,
    riktkurs: r2(riktkurs), riktkursLag: r2(raw(fd.targetLowPrice)), riktkursHog: r2(raw(fd.targetHighPrice)),
    andelKop: r2(rtNu ? andelKop(rtNu) : null, 0), andelKop3mSedan: r2(rt3 ? andelKop(rt3) : null, 0),
    prognos: { vinstIAr: r2(tillv0y, 1), vinstNastaAr: r2(tillv1y, 1), vinstKvartal: r2(estG("0q"), 1), omsattningIAr: r2(estRev("0y"), 1), omsattningNastaAr: r2(estRev("+1y"), 1) },
    revideringar: { upp30: upp30, ner30: ner30, estimat90d: r2(estRev90, 1) },
    overraskning: { snitt: r2(snittOverraskning, 1), slagna: slagEstimat, av: eh.length },
    nastaRapport: kommande.length ? kommande[0] : null,
    senasteRapport: rapportDatum.length && !kommande.length ? rapportDatum[rapportDatum.length - 1] : null,
  };

  // Insynshandel senaste 6 månaderna
  const itx = (res.insiderTransactions && res.insiderTransactions.transactions) || [];
  const sexMan = new Date(); sexMan.setMonth(sexMan.getMonth() - 6);
  const sexManIso = sexMan.toISOString().slice(0, 10);
  let kop = 0, salj = 0, kopVarde = 0, saljVarde = 0;
  itx.forEach((t: any) => {
    const d = t.startDate && t.startDate.fmt; const txt = String(t.transactionText || "").toLowerCase(); const v = raw(t.value) || 0;
    if (!d || d < sexManIso) return;
    if (txt.includes("purchase") || txt.includes(" buy") || txt.startsWith("buy")) { kop++; kopVarde += v; }
    else if (txt.includes("sale")) { salj++; saljVarde += v; }
  });
  const insyn = { kop6m: kop, salj6m: salj, nettoVarde6m: itx.length ? kopVarde - saljVarde : null, andelInsiders: r2(pct(raw(ks.heldPercentInsiders)), 1), andelInstitutioner: r2(pct(raw(ks.heldPercentInstitutions)), 1), transaktioner: itx.length };

  // Utdelning
  const divYield = raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield);
  const utdPerAktie = divYield != null && kurs ? kurs * divYield : null;
  const utdTackning = divPaid != null && divPaid < 0 && fcf != null ? fcf / -divPaid : null;
  const utdelning = {
    direktavkastning: r2(pct(divYield)), direktavkastning5ar: r2(raw(sd.fiveYearAvgDividendYield)), perAktie: r2(utdPerAktie),
    andelAvVinst: r2(pct(raw(sd.payoutRatio)), 0), tackningFcf: r2(utdTackning, 1), arUtanSankning: utdHist ? utdHist.arUtanSankning : null,
    tillvaxt5ar: utdHist ? utdHist.tillvaxt5ar : null, xdag: ce.exDividendDate ? (ce.exDividendDate.fmt || isoDate(raw(ce.exDividendDate))) : null, historik: utdHist ? utdHist.perAr : [],
  };

  // Jämförbara bolag
  let jamfor: any = null;
  try {
    const pk = "peers:" + symbol;
    jamfor = cached<any>(pk, 24 * 60 * 60 * 1000);
    if (!jamfor) {
      const p = await peers(f, symbol);
      const syms = p.symboler.slice(0, 5);
      if (syms.length) {
        const q = await rawQuotes(f, syms);
        const rows = ((q.body as any) && (q.body as any).quoteResponse && (q.body as any).quoteResponse.result) || [];
        const med = (arr: number[]) => { const s = arr.filter((x) => isFinite(x) && x > 0).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
        jamfor = {
          bolag: rows.map((r: any) => ({ symbol: r.symbol, namn: r.shortName || r.longName || r.symbol, pe: r2(r.trailingPE, 1), fpe: r2(r.forwardPE, 1), pb: r2(r.priceToBook, 1), avk52v: r2(r.fiftyTwoWeekChangePercent, 1), rek: r.averageAnalystRating || null })),
          peMedian: r2(med(rows.map((r: any) => r.trailingPE)), 1), fpeMedian: r2(med(rows.map((r: any) => r.forwardPE)), 1), pbMedian: r2(med(rows.map((r: any) => r.priceToBook)), 1),
          avk52vMedian: r2(med(rows.map((r: any) => r.fiftyTwoWeekChangePercent)), 1),
        };
        remember(pk, jamfor);
      }
    }
  } catch { saknas.push("jamforbara"); }

  // Årsserier för appen (senaste 5 boksluten), i redovisningsvalutan
  // Kvartalsvinster: antal kvartal i rad (senaste först) där vinsten är lägre än samma kvartal året före.
  // Yahoo ger bara de fem senaste kvartalen och ibland med luckor, så jämförelsen görs bara när motsvarande kvartal finns (±45 dagar);
  // saknas jämförbart kvartal blir värdet null och regeln slår inte.
  const kv = (S.quarterlyNetIncome || []).slice(-5);
  const dagar = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
  const arFore = (i: number) => kv.find((q) => Math.abs(dagar(q.d, kv[i].d) - 365) <= 45);
  let fallande: number | null = null;
  for (let i = kv.length - 1; i >= 0; i--) {
    const q = arFore(i);
    if (!q) break;
    if (fallande == null) fallande = 0;
    if (kv[i].v < q.v) fallande++; else break;
  }
  const sista = kv.length ? arFore(kv.length - 1) : undefined;
  const kvYoy = sista && sista.v > 0 ? (kv[kv.length - 1].v / sista.v - 1) * 100 : null;
  const kvartal = kv.map((p) => { const oms = (S.quarterlyTotalRevenue || []).find((x) => x.d === p.d); return { datum: p.d, vinst: p.v, omsattning: oms ? oms.v : null }; });
  const arSerie = (S.annualTotalRevenue || []).slice(-5).map((p) => {
    const at = (s: Serie | undefined) => { const hit = s && s.find((x) => x.d === p.d); return hit ? hit.v : null; };
    return { ar: p.d.slice(0, 4), datum: p.d, omsattning: p.v, vinst: at(S.annualNetIncome), kassaflode: at(S.annualOperatingCashFlow), frittKassaflode: at(S.annualFreeCashFlow), vpa: at(S.annualDilutedEPS), egetKapital: at(S.annualStockholdersEquity), utdelningar: at(S.annualCashDividendsPaid), aktier: at(S.annualOrdinarySharesNumber) };
  });

  const flaggor: string[] = [];
  const kursTid = isoDate(raw(price.regularMarketTime));
  const kursAlder = kursTid ? Math.round((Date.now() - new Date(kursTid + "T00:00:00Z").getTime()) / 86400000) : null;
  if (kursAlder != null && kursAlder > 7) flaggor.push("Kursen från källan är gammal (" + kursTid + ") – nyckeltal mot kursen kan vara inaktuella");
  if (fcf != null && fcf < 0) flaggor.push("Negativt fritt kassaflöde senaste 12 månaderna");
  if (netIncome != null && netIncome < 0) flaggor.push("Förlust senaste 12 månaderna");
  if (utspadning1ar != null && utspadning1ar > 3) flaggor.push("Utspädning: " + utspadning1ar.toFixed(1) + " % fler aktier på ett år");
  if (zscore != null && zscore < 1.81) flaggor.push("Altman Z-score " + zscore.toFixed(2) + " – riskzon för finansiell stress");
  if (nettoskuldEbitda != null && nettoskuldEbitda > 4) flaggor.push("Nettoskuld " + nettoskuldEbitda.toFixed(1) + " gånger EBITDA");
  if (rantetackning != null && rantetackning < 1) flaggor.push("Rörelseresultatet täcker inte räntekostnaderna");
  else if (rantetackning != null && rantetackning < 2) flaggor.push("Räntetäckning bara " + rantetackning.toFixed(1) + " gånger");
  if (evFc != null && evFc <= 0) flaggor.push("Nettokassan är större än börsvärdet – EV-baserade mått går inte att räkna");
  if (utdelning.andelAvVinst != null && utdelning.andelAvVinst > 100) flaggor.push("Utdelningen är större än vinsten");
  if (bruttomarginalNu != null && bruttomarginalFg != null && bruttomarginalNu < bruttomarginalFg - 3) flaggor.push("Bruttomarginalen föll " + (bruttomarginalFg - bruttomarginalNu).toFixed(1) + " procentenheter senaste bokslutet");
  if (insyn.salj6m >= 3 && insyn.kop6m === 0) flaggor.push("Bara insynsförsäljningar senaste halvåret (" + insyn.salj6m + " st)");
  if (fallande != null && fallande >= 2) flaggor.push("Vinsten har fallit " + fallande + " kvartal i rad (mot samma kvartal året före)");
  if (utdHist && utdHist.sankt) flaggor.push("Utdelningen sänktes senaste året");
  // Rimlighetskontroll av källdata: vinst per aktie i senaste bokslutet som inte går ihop med kursen tyder på engångspost eller datafel.
  const opalitlig: string[] = []; // delar av underlaget som appen inte ska lita på
  const vpaBokslut = last(S.annualDilutedEPS);
  if (vpaBokslut != null && vpaBokslut > 0 && kurs) {
    const kEps = pence ? 100 : (fc && valuta && fc !== valuta ? k : 1);
    const peBokslut = kurs / (vpaBokslut * kEps);
    if (peBokslut < 2) { flaggor.push("Vinsten per aktie i senaste bokslutet (" + vpaBokslut + " " + (fc || "") + ") går inte ihop med kursen – troligen engångspost eller fel i källan; vinstbaserade mått hoppas över"); opalitlig.push("vinst"); }
  }
  if (kursAlder != null && kursAlder > 7) opalitlig.push("kurs");
  if (vinstkvalitet != null && netIncome != null && netIncome > 0 && vinstkvalitet < 0.5) flaggor.push("Kassaflödet från rörelsen är bara " + Math.round(vinstkvalitet * 100) + " % av vinsten");

  const out = {
    symbol, namn: String(price.longName || price.shortName || symbol), valuta, redovisningsvaluta: fc, bokslutsvaluta: ts.valuta, kurs, kursTid, kursGammal: kursAlder != null && kursAlder > 7,
    profil: { sektor: prof.sector || null, bransch: prof.industry || null, land: prof.country || null, typ, anstallda: prof.fullTimeEmployees || null },
    varden: {
      // Värdering
      pe: r2(trailingPE, 1), pe_forward: r2(forwardPE, 1), peg: r2(peg, 2), ps: r2(ps, 2), pb: r2(pb, 2), ev_ebitda: r2(evEbitda, 1), ev_ebit: r2(evEbit, 1),
      vinstavkastning: r2(vinstavkastning, 1), fcf_yield: r2(fcfYield, 1), graham: r2(graham, 2), uppsida: r2(riktkurs && kurs ? (riktkurs / kurs - 1) * 100 : null, 1),
      pe_median5: peHist ? peHist.median : null, pe_percentil: peHist ? peHist.percentil : null, pe_p90_5: peHist ? peHist.p90 : null,
      pe_jamfor: jamfor ? jamfor.peMedian : null, pb_jamfor: jamfor ? jamfor.pbMedian : null,
      // Kvalitet
      roe: r2(roe, 1), roa: r2(roa, 1), roic: r2(roic, 1), bruttomarginal: r2(bruttomarginal, 1), marginal: r2(rorelsemarginal, 1), vinstmarginal: r2(vinstmarginal, 1),
      bruttomarginal_trend: r2(bruttomarginalNu != null && bruttomarginalFg != null ? bruttomarginalNu - bruttomarginalFg : null, 1),
      marginal_trend: r2(rorelsemarginalNu != null && rorelsemarginalFg != null ? rorelsemarginalNu - rorelsemarginalFg : null, 1),
      vinstkvalitet: r2(vinstkvalitet, 2), fscore: fscore ? fscore.poang : null, fscore_av: fscore ? fscore.av : null,
      // Tillväxt
      oms_tillv: r2(pct(raw(fd.revenueGrowth)), 1), tillv: r2(pct(raw(fd.earningsGrowth) ?? raw(ks.earningsQuarterlyGrowth)), 1),
      oms_cagr3: r2(cagr(S.annualTotalRevenue, 3), 1), vpa_cagr3: r2(cagr(S.annualDilutedEPS, 3), 1),
      prognos_vinst_i_ar: analytiker.prognos.vinstIAr, prognos_vinst_nasta_ar: analytiker.prognos.vinstNastaAr, prognos_oms_nasta_ar: analytiker.prognos.omsattningNastaAr,
      revideringar_netto: upp30 - ner30, estimat_90d: analytiker.revideringar.estimat90d, overraskning: analytiker.overraskning.snitt,
      // Styrka
      skuld: r2(nettoskuldEbitda, 2), skuld_ek: r2(skuldEk, 1), solid: r2(soliditet, 1), rantetackning: r2(rantetackning, 1), balanslikviditet: r2(currentRatio, 2), kassalikviditet: r2(quickRatio, 2),
      zscore: r2(zscore, 2), utspadning: r2(utspadning1ar, 1), skuldtrend: r2(skuldTrend, 1), nettokassa: nettoskuld != null ? nettoskuld < 0 : null,
      // Utdelning
      da: utdelning.direktavkastning, da_5ar: utdelning.direktavkastning5ar, utd: utdelning.perAktie, utdandel: utdelning.andelAvVinst, utd_tackning: utdelning.tackningFcf,
      utd_ar_utan_sankning: utdelning.arUtanSankning, utd_tillvaxt5: utdelning.tillvaxt5ar,
      // Trend & sentiment
      ma50: trend.ma50, ma200: trend.ma200, ma200_riktning: trend.ma200Riktning, rsi: trend.rsi14, avk3m: trend.avk3m, avk6m: trend.avk6m, avk12m: trend.avk12m,
      rs3m: trend.rs3m, rs6m: trend.rs6m, rs12m: trend.rs12m, volatilitet: trend.volatilitet,
      hogst52: r2(raw(sd.fiftyTwoWeekHigh)), lagst52: r2(raw(sd.fiftyTwoWeekLow)), beta: r2(raw(ks.beta) ?? raw(sd.beta), 2),
      blankning: r2(pct(raw(ks.shortPercentOfFloat)), 1), insyn_kop6m: insyn.kop6m, insyn_salj6m: insyn.salj6m, insyn_andel: insyn.andelInsiders,
      analytiker_antal: analytiker.antal, analytiker_snitt: analytiker.snitt, analytiker_andel_kop: analytiker.andelKop, analytiker_andel_kop_3m: analytiker.andelKop3mSedan,
      riktkurs: analytiker.riktkurs, borsvarde: marketCap != null ? r2(marketCap, 0) : null, vpa: r2(vpa, 2),
      // Riskregler och värdering
      vpa_forward: r2(forwardPE != null && forwardPE > 0 && kurs ? kurs / forwardPE : null, 2),
      vinst_kvartal_fallande: fallande, vinst_kvartal_yoy: r2(kvYoy, 1), utd_sankt: utdHist ? utdHist.sankt : null,
    },
    kvartal,
    fscore, zscore: r2(zscore, 2), peHistorik: peHist, utdelning, trend, analytiker, insyn, jamfor, bokslut: arSerie, flaggor, saknas, opalitlig,
    hamtad: new Date().toISOString(),
  };
  remember(key, out);
  return out;
}

// Underlag för backtest (etapp 5): fem års dagliga stängningskurser, utdelningar och årlig vinst per aktie (i kursvalutan).
// Index (^OMXSPI, ^GSPC …) får bara kurser. Lätt anrop utan crumb: chart + fundamentals-timeseries.
export async function backtestData(f: FetchFn, symbol: string) {
  const key = "bt:" + symbol;
  const c = cached<any>(key, 24 * 60 * 60 * 1000);
  if (c) return c;
  const ch = await chart(f, symbol, "5y", "1d", !symbol.startsWith("^"));
  const priser = ch.priser.map(([d, v]) => [d, Math.round(v * 10000) / 10000] as [string, number]);
  let vpa: Array<{ d: string; v: number }> = [];
  let vpaValuta: string | null = null;
  if (!symbol.startsWith("^")) {
    try {
      const ts = await timeseries(f, symbol, ["annualDilutedEPS"], 7);
      vpaValuta = ts.valuta;
      const serie = ts.series.annualDilutedEPS || [];
      const valuta = ch.valuta;
      const pence = valuta === "GBp";
      let k = 1;
      if (vpaValuta && valuta && vpaValuta !== valuta) { const r = await fxRate(f, vpaValuta, pence ? "GBP" : valuta); if (r) k = r * (pence ? 100 : 1); }
      vpa = serie.map((p) => ({ d: p.d, v: Math.round(p.v * k * 10000) / 10000 }));
    } catch { /* ingen vinsthistorik – backtestet hoppar över värderingsdelen */ }
  }
  const out = { symbol, valuta: ch.valuta, index: symbol.startsWith("^") ? null : indexFor(symbol), priser, utd: ch.utd, vpa, vpaValuta, hamtad: new Date().toISOString() };
  remember(key, out);
  return out;
}
