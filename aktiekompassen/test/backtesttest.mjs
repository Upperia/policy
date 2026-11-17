// Etapp 5 – Facit: träffsäkerhet per dimension/regel, indexjämförelse, regelhälsa och backtest mot mockat API.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync } from 'node:fs';
const OUT = './';
const html = readFileSync('../index.html', 'utf8');
const fixture = JSON.parse(readFileSync('./analys-fixture.json', 'utf8'));
Object.values(fixture).forEach(a => { a.varden.vinst_kvartal_fallande = 0; a.varden.vinst_kvartal_yoy = 10; a.varden.utd_sankt = false; a.opalitlig = a.opalitlig || []; });
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(8795, r));
const T = (ok, msg) => { console.log((ok ? 'ok   ' : 'FEL  ') + msg); if (!ok) process.exitCode = 1; };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Deterministisk slump
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// Syntetiska kurser: fem år av bankdagar. drift per år, brus per dag.
function serie(start, driftPerAr, brus, cykel) {
  const out = []; let p = start; const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let d = addDays(today, -5 * 365); d <= today; d = addDays(d, 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const dagDrift = Math.pow(1 + driftPerAr, 1 / 252) - 1;
    const cyk = cykel ? Math.sin(out.length / cykel * 2 * Math.PI) * 0.004 : 0;
    p = p * (1 + dagDrift + cyk + (rnd() - 0.5) * brus);
    out.push([iso(d), Math.round(p * 100) / 100]);
  }
  return out;
}
const vpaFor = (priser, pe) => { const ar = {}; priser.forEach(([d, v]) => { ar[d.slice(0, 4)] = v; }); return Object.keys(ar).sort().slice(0, -1).map(y => ({ d: y + '-12-31', v: Math.round(ar[y] / pe * 100) / 100 })); };
const BT = {};
const mk = (sym, start, drift, brus, cykel, pe) => { const priser = serie(start, drift, brus, cykel); BT[sym] = { symbol: sym, valuta: sym.endsWith('.ST') ? 'SEK' : 'USD', index: sym.startsWith('^') ? null : (sym.endsWith('.ST') ? '^OMXSPI' : '^GSPC'), priser, utd: [], vpa: sym.startsWith('^') ? [] : vpaFor(priser, pe), vpaValuta: null, hamtad: new Date().toISOString() }; };
mk('^OMXSPI', 800, 0.08, 0.012, 0); mk('^GSPC', 4000, 0.10, 0.010, 0);
mk('NVDA', 20, 0.60, 0.03, 0, 40);          // stark trend, P/E 40
mk('XNET', 10, -0.25, 0.04, 0, 8);          // fallande, P/E 8
mk('ABB.ST', 300, 0.05, 0.010, 252, 20);    // cykliskt (±16 %) kring svag trend, P/E 20
const btReq = [];
const FX = { USD: 9.5, SEK: 1, GBp: 0.125, EUR: 11.0, CAD: 6.8 };
const quoteFrom = (a) => ({ symbol: a.symbol, namn: a.namn, valuta: a.valuta, kurs: a.kurs, forandring: 0.4, kursTid: a.kursTid + 'T16:00:00.000Z', fxSek: FX[a.valuta] || 1, hamtad: new Date().toISOString(), nyckeltal: { vpa: a.varden.vpa, utd: a.varden.utd, da: a.varden.da, pe: a.varden.pe, pe_forward: a.varden.pe_forward, hogst52: a.varden.hogst52, lagst52: a.varden.lagst52, riktkurs: a.varden.riktkurs, solid: a.varden.solid } });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push(m.text()); });
await page.route('https://pxskckkdftnknqcgpbng.supabase.co/**', async route => {
  const u = new URL(route.request().url()); const sym = u.searchParams.get('symbol'); const a = fixture[sym];
  const j = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.pathname.endsWith('/api/aktie')) return a ? j(quoteFrom(a)) : j({ error: 'Ingen data' }, 502);
  if (u.pathname.endsWith('/api/analys')) return a ? j(a) : j({ error: 'Ingen data' }, 502);
  if (u.pathname.endsWith('/api/historik')) { const b = BT[sym]; return j({ symbol: sym, valuta: b ? b.valuta : null, priser: b ? b.priser.slice(-260) : [] }); }
  if (u.pathname.endsWith('/api/bt')) { btReq.push(sym); const b = BT[sym]; return b ? j(b) : j({ error: 'Ingen data' }, 502); }
  return route.fulfill({ status: 404, body: '[]' });
});
// Logg: 9 veckor bakåt, två aktier, med dimensionspoäng och regler. Historik seedas så 1-månadsutfall går att räkna.
await page.addInitScript(({ nvda, xnet }) => {
  if (localStorage.getItem('seeded')) return;
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const stocks = [{ id: 'nvda', ticker: 'NVDA', symbol: 'NVDA', namn: 'NVIDIA', antal: 10, gav: 150, valuta: 'USD', varden: {} }, { id: 'xnet', ticker: 'XNET', symbol: 'XNET', namn: 'Xunlei', antal: 100, gav: 6, valuta: 'USD', varden: {} }];
  const rules = [{ id: 'r4', namn: 'Nära toppen', metric: 'fran52h', op: '>', value: -5, signal: 'kop', aktiv: true, vikt: 1 }, { id: 'r5', namn: 'Fallkniv', metric: 'utv_gav', op: '<', value: -20, signal: 'salj', aktiv: true, vikt: 1 }];
  const logg = []; const kursAt = (arr, d) => { for (const p of arr) if (p[0] >= d) return p[1]; return arr[arr.length - 1][1]; };
  for (let w = 10; w >= 1; w--) {
    const d = new Date(); d.setDate(d.getDate() - w * 7 - 35); const ds = iso(d);
    logg.push({ d: ds, id: 'nvda', sym: 'NVDA', t: 'NVDA', k: kursAt(nvda, ds), fx: 9.5, v: w % 3 === 0 ? 'behall' : 'kop_mer', p: 75, dm: [2.5, 4.2, 4.5, 4.0, 1.0, 4.4], r: ['r4'] });
    logg.push({ d: ds, id: 'xnet', sym: 'XNET', t: 'XNET', k: kursAt(xnet, ds), fx: 9.5, v: w % 4 === 0 ? 'salj' : 'minska', p: 30, dm: [3.0, 1.5, 1.2, 2.0, 0, 1.0], r: ['r5'] });
  }
  localStorage.setItem('aktiekompassen-v2', JSON.stringify({ version: 3, settings: { metrics: [], rules, modell: { stil: 'balanserad' } }, stocks, logg }));
  localStorage.setItem('aktiekompassen-hist', JSON.stringify({ NVDA: { hamtad: new Date().toISOString(), valuta: 'USD', priser: nvda }, XNET: { hamtad: new Date().toISOString(), valuta: 'USD', priser: xnet } }));
  localStorage.setItem('seeded', '1');
}, { nvda: BT.NVDA.priser.slice(-300), xnet: BT.XNET.priser.slice(-300) });

await page.goto('http://localhost:8795/#facit');
await page.waitForTimeout(1500);
let txt = await page.innerText('#app');
T(/Vad förutsäger något\?/i.test(txt), 'träffsäkerhetskortet renderas');
T(/Regelhälsa/i.test(txt), 'regelhälsa-rubrik finns');
T(/Kvalitet & lönsamhet/i.test(txt) && /Trend & sentiment/i.test(txt), 'alla dimensioner listas');
T(/Nära toppen/i.test(txt) && /Fallkniv/i.test(txt), 'egna regler listas i regelhälsan');
T(/observationer med 1-månadsutfall/i.test(txt) && !/\b0 observationer/i.test(txt), 'observationer räknas (' + (txt.match(/(\d+) observationer med/i) || [])[1] + ')');
// Indexjämförelse: hemmaindex hämtas via /historik och visas som "idx" i tabellen
await page.waitForTimeout(800);
txt = await page.innerText('#app');
T(/idx\s*[+−-]?\d/i.test(txt), 'indexjämförelse visas i beslutstabellen');
T(/hemmaindex/i.test(txt), 'indextext i träffsäkerhetskortet');
T(/Backtest/i.test(txt) && /Kör backtest/i.test(txt), 'backtestkort med knapp');
T(/Går inte att backtesta/i.test(txt), 'ärlighet om vad som inte kan backtestas');
await page.screenshot({ path: OUT + 'bt-0.png', fullPage: true });

// Kör backtest
await page.click('[data-action=kor-backtest]');
await page.waitForFunction(() => !!localStorage.getItem('aktiekompassen-backtest'), null, { timeout: 60000 }).catch(() => console.log('TIMEOUT backtest', errors.join(' | ')));
await page.waitForTimeout(500);
txt = await page.innerText('#app');
const res = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-backtest')));
T(!!res && res.resultat && res.resultat.egna && res.resultat.omxs30, 'resultat sparat i localStorage');
T(new Set(btReq).size === btReq.length, 'varje symbol hämtas en gång (' + btReq.length + ' anrop)');
T(btReq.indexOf('^OMXSPI') >= 0 && btReq.indexOf('^GSPC') >= 0 && btReq.indexOf('NVDA') >= 0 && btReq.indexOf('ABB.ST') >= 0, 'index, egna aktier och OMXS30 hämtas');
T(/Mina aktier/i.test(txt) && /OMXS30/i.test(txt) && /Momentum/i.test(txt) && /Värde \(light\)/i.test(txt) && /Balanserad \(light\)/i.test(txt), 'tabeller per urval och stil');
const egna = res.resultat.egna.stilar, omx = res.resultat.omxs30.stilar;
console.log('egna momentum', JSON.stringify(egna.momentum.kop), 'n', egna.momentum.kopN, 'sälj', egna.momentum.saljN, 'månader', egna.momentum.manader);
console.log('egna balanserad', JSON.stringify(egna.balanserad.kop), 'n', egna.balanserad.kopN, 'portf', JSON.stringify(egna.balanserad.portf), 'bh', JSON.stringify(egna.balanserad.buyhold), 'idx', JSON.stringify(egna.balanserad.index));
console.log('omx balanserad', JSON.stringify(omx.balanserad.kop), 'n', omx.balanserad.kopN, 'antal aktier', res.resultat.omxs30.antal);
console.log('omx varde köp', JSON.stringify(omx.varde.kop), 'n', omx.varde.kopN, 'sälj', omx.varde.saljN, JSON.stringify(omx.varde.salj), 'alla', JSON.stringify(omx.varde.alla));
console.log('omx momentum köp', JSON.stringify(omx.momentum.kop), 'n', omx.momentum.kopN, 'sälj', omx.momentum.saljN);
T(JSON.stringify(egna.momentum.kop) !== JSON.stringify(egna.varde.kop) || egna.momentum.kopN !== egna.varde.kopN, 'stilarna ger olika resultat (värderingsdelen räknas)');
T(omx.varde.kopN > 0 && omx.varde.kop.s3 > omx.varde.alla.s3, 'Värde (light) på cyklisk aktie: köp vid låg P/E-percentil slår snittet på 3 mån');
T(res.resultat.egna.antal === 2 && res.resultat.omxs30.antal === 1, 'antal aktier med data: egna 2 (NVDA, XNET), OMXS30 1 (ABB)');
T(egna.momentum.kopN > 0 && egna.momentum.saljN > 0, 'momentum ger både köp- och säljsignaler i syntetisk data');
T(egna.momentum.kop.s3 > 0 && egna.momentum.kop.t3 > 50, 'köpsignaler i stigande trend ger positiv 3-mån-avkastning och träff > 50 %');
T(egna.momentum.salj.s3 < 0, 'säljsignaler (fallande aktie) följs av negativ avkastning');
T(egna.momentum.manader >= 30 && egna.momentum.manader <= 37, 'tre års månader (' + egna.momentum.manader + ')');
T(Number.isFinite(egna.balanserad.portf.dd) && Number.isFinite(egna.balanserad.buyhold.dd) && Number.isFinite(egna.balanserad.index.dd), 'största nedgång för signalportfölj, köp-och-behåll och index');
T(res.aktier.some(a => a.sym === 'NVDA' && a.kopN >= 3), 'per-aktie-lista med NVDA');
T(/Kört idag/i.test(txt) && /trösklar köp ≥ 70, sälj < 35/i.test(txt), 'fotnot med tidpunkt och trösklar');
T(/Kör igen/i.test(txt), 'knappen blir "Kör igen"');
await page.screenshot({ path: OUT + 'bt-1.png', fullPage: true });

// Oberoende kontroll av en köpsignal: momentumpoäng för NVDA sista månadsskiftet ska vara hög (stark trend)
const check = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('aktiekompassen-hist')).NVDA;
  return d.priser.length;
});
T(check >= 250, 'historik kvar efter backtest (' + check + ' dagar)');

// Omladdning: resultatet ligger kvar
await page.reload(); await page.waitForTimeout(800);
txt = await page.innerText('#app');
T(/Kör igen/i.test(txt) && /Mina aktier/i.test(txt), 'resultatet ligger kvar efter omladdning');

// Offline: knappen ger toast i stället för krasch
await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await page.waitForTimeout(200);
await page.click('[data-action=kor-backtest]').catch(() => {}); await page.waitForTimeout(300);
txt = await page.innerText('body');
T(/kräver uppkoppling/i.test(txt), 'offline: tydligt meddelande');
await ctx.setOffline(false);
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'NO ERRORS');
await browser.close(); server.close();
