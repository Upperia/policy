// Etapp 4 – "Är det ett bra köp?": rimlig värdering (Graham, PEG-P/E, DCF, baklänges), jämförbara, analytiker, bokslut.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync } from 'node:fs';
const OUT = '/tmp/claude-0/-home-claude/4fe84917-fde6-5d0a-bfcd-6413ce28e3ee/scratchpad/fn/';
const html = readFileSync('/home/claude/aktiekompassen/public/index.html', 'utf8');
const fixture = JSON.parse(readFileSync('/home/claude/aktiekompassen/test/analys-fixture.json', 'utf8'));
Object.values(fixture).forEach(a => { a.varden.vinst_kvartal_fallande = 0; a.varden.vinst_kvartal_yoy = 10; a.varden.utd_sankt = false; a.varden.vpa_forward = a.varden.pe_forward > 0 ? Math.round(a.kurs / a.varden.pe_forward * 100) / 100 : null; a.opalitlig = a.opalitlig || []; a.kvartal = [{ datum: '2026-06-30', vinst: 1.2e9, omsattning: 5e9 }, { datum: '2026-09-30', vinst: 1.3e9, omsattning: 5.2e9 }]; });
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(8794, r));
const FX = { USD: 9.5, SEK: 1, GBp: 0.125, EUR: 11.0, CAD: 6.8 };
const quoteFrom = (a) => ({ symbol: a.symbol, namn: a.namn, valuta: a.valuta, kurs: a.kurs, forandring: 0.4, kursTid: a.kursTid + 'T16:00:00.000Z', fxSek: FX[a.valuta] || 1, hamtad: new Date().toISOString(), nyckeltal: { vpa: a.varden.vpa, utd: a.varden.utd, da: a.varden.da, pe: a.varden.pe, pe_forward: a.varden.pe_forward, hogst52: a.varden.hogst52, lagst52: a.varden.lagst52, riktkurs: a.varden.riktkurs, solid: a.varden.solid } });

// Oberoende DCF-beräkning (samma antaganden) för kontroll av appens siffror.
function dcf(fcf, g1, krav, evig = 3) { let v = 0, c = fcf, g = g1; for (let t = 1; t <= 10; t++) { if (t > 5) g = g1 + (evig - g1) * (t - 5) / 5; c *= 1 + g / 100; v += c / Math.pow(1 + krav / 100, t); } return v + c * (1 + evig / 100) / ((krav - evig) / 100) / Math.pow(1 + krav / 100, 10); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push(m.text()); });
await page.route('https://pxskckkdftnknqcgpbng.supabase.co/**', async route => {
  const u = new URL(route.request().url()); const sym = u.searchParams.get('symbol'); const a = fixture[sym];
  if (u.pathname.endsWith('/api/aktie')) return a ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFrom(a)) }) : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Ingen data"}' });
  if (u.pathname.endsWith('/api/analys')) return a ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) }) : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Ingen data"}' });
  if (u.pathname.endsWith('/api/historik')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: sym, priser: [] }) });
  if (u.pathname.endsWith('/api/sok')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ symbol: 'ABB.ST', namn: 'ABB Ltd', bors: 'Stockholm', typ: 'Aktie' }]) });
  return route.fulfill({ status: 404, body: '[]' });
});
await page.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const stocks = [{ id: 'nvda', ticker: 'NVDA', symbol: 'NVDA', namn: 'NVIDIA', antal: 2, gav: 220, valuta: 'USD', varden: {} }, { id: 'rr', ticker: 'RR', symbol: 'RR.L', namn: 'Rolls-Royce', antal: 20, gav: 1200, valuta: 'GBp', varden: {} }, { id: 'spcx', ticker: 'SPCX', symbol: 'SPCX', namn: 'SpaceX', antal: 2, gav: 140, valuta: 'USD', varden: {} }, { id: 'xnet', ticker: 'XNET', symbol: 'XNET', namn: 'Xunlei', antal: 100, gav: 6, valuta: 'USD', varden: {} }];
  localStorage.setItem('aktiekompassen-v2', JSON.stringify({ version: 3, settings: { metrics: [], rules: [], modell: { stil: 'balanserad' } }, stocks, logg: [] }));
  localStorage.setItem('seeded', '1');
});
const T = (ok, msg) => { console.log((ok ? 'ok   ' : 'FEL  ') + msg); if (!ok) process.exitCode = 1; };
await page.goto('http://localhost:8794/#portfolj');
await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('aktiekompassen-analys') || '{}')).length >= 4, null, { timeout: 20000 }).catch(() => console.log('TIMEOUT', errors.join(' | ')));
await page.waitForTimeout(400);

// NVDA: kontrollera metoderna mot oberoende beräkning
const a = fixture['NVDA'], kurs = a.kurs;
await page.click('.stock-card:has-text("NVDA")'); await page.waitForTimeout(400);
const txt = await page.innerText('.analys-sida');
T(/Är det ett bra köp\?/i.test(txt) && /Rimlig värdering/i.test(txt), 'analyssidan renderas');
const fcf = kurs * a.varden.fcf_yield / 100;                   // FCF per aktie
const g = a.varden.prognos_vinst_nasta_ar;                     // 69,8 → DCF 25 %
const v9 = dcf(fcf, 25, 9), v10 = dcf(fcf, 25, 10);
const graham = a.varden.graham, peg = Math.min(35, Math.max(8, g)) * a.varden.vpa, rikt = a.analytiker.riktkurs;
const w = [[(v9 + v10) / 2, 2], [peg, 1], [graham, 0.5], [rikt, 1]];
const rimligt = Math.exp(w.reduce((n, x) => n + Math.log(x[0]) * x[1], 0) / w.reduce((n, x) => n + x[1], 0));
const m = txt.match(/Köpvärd under ([\d\s,]+) USD, fullvärderad över ([\d\s,]+) USD/);
const toNum = s => Number(s.replace(/\s/g, '').replace(',', '.'));
console.log('NVDA rimligt (oberoende)', rimligt.toFixed(1), 'köpvärd', (rimligt * 0.8).toFixed(1), 'full', (rimligt * 1.2).toFixed(1), '| app:', m && m[1], m && m[2]);
T(m && Math.abs(toNum(m[1]) - rimligt * 0.8) < 1.5 && Math.abs(toNum(m[2]) - rimligt * 1.2) < 1.5, 'köpvärd/fullvärderad stämmer med oberoende beräkning');
T(new RegExp('Diskonterat kassaflöde \\(DCF\\)\\s+' + Math.round((v9 + v10) / 2) + '|' + Math.round((v9 + v10) / 2 + 0.5)).test(txt.replace(/\s+/g, ' ')) || /DCF/.test(txt), 'DCF-raden finns');
T(/Baklängesräkning/.test(txt) && /kräver .* % årlig tillväxt i fritt kassaflöde/.test(txt), 'baklängesräkning med krävd tillväxt');
T(/Graham-tal/.test(txt) && /PEG-baserat rimligt P\/E/.test(txt) && /Analytikernas riktkurs/.test(txt), 'alla fyra metoder listas');
T(/Jämförbara bolag/i.test(txt) && /TSLA/.test(txt) && /Median liknande/.test(txt), 'jämförbara bolag med median');
T(/Analytikernas bild/i.test(txt) && /54/.test(txt) && /Nästa rapport/i.test(txt), 'analytikernas bild');
T(/Bokslut/i.test(txt) && /2026/.test(txt) && /Senaste kvartalsvinster/.test(txt), 'bokslut och kvartal');
T(/Utdelning per år/i.test(txt), 'utdelningshistorik');
await page.screenshot({ path: OUT + 'a-nvda.png', fullPage: true });

// SPCX: negativt FCF → DCF går inte; XNET: orimlig vinst → inga vinstmetoder
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("SPCX")'); await page.waitForTimeout(300);
const sp = await page.innerText('.analys-sida');
T(/fritt kassaflöde är negativt/i.test(sp), 'SPCX: DCF markeras som ej möjlig');
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("XNET")'); await page.waitForTimeout(300);
const xn = await page.innerText('.analys-sida');
T(!/Graham-tal\s+\d/.test(xn.replace(/\s+/g, ' ')) && !/PEG-baserat rimligt P\/E\s+\d/.test(xn.replace(/\s+/g, ' ')), 'XNET: vinstbaserade metoder hoppas över');
console.log('XNET', xn.slice(0, 300).replace(/\n/g, ' | '));
// RR: pence
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("RR")'); await page.waitForTimeout(300);
const rr = await page.innerText('.analys-sida');
T(/GBp/.test(rr) && /Köpvärd under/.test(rr), 'RR: värdering i pence');
console.log('RR', (rr.match(/Köpvärd under[^\n]*/) || [''])[0]);
await page.screenshot({ path: OUT + 'a-rr.png', fullPage: true });

// Bevakad aktie via sök → analys direkt
await page.click('[data-action=back]'); await page.waitForTimeout(300);
await page.click('[data-action=add-stock]'); await page.waitForTimeout(300);
await page.fill('#f-sok', 'abb'); await page.waitForTimeout(600);
await page.click('.sok-hit'); await page.waitForTimeout(600);
await page.click('#sheetForm button[type=submit]'); await page.waitForTimeout(1200);
const abbTxt = await page.innerText('#app');
T(/ABB/.test(abbTxt) && /Är det ett bra köp\?/i.test(abbTxt) && /Köp|Avvakta|Undvik/.test(abbTxt) && /Köpvärd under/.test(abbTxt), 'bevakad aktie får analyssida och beslut direkt');
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'NO ERRORS');
await browser.close(); server.close();
