// Etapp 3 – riskregler, tes och säljplan, mot mockat API (fixture = riktiga /api/analys-svar).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync } from 'node:fs';
const OUT = './';
const html = readFileSync('../index.html', 'utf8');
const fixture = JSON.parse(readFileSync('./analys-fixture.json', 'utf8'));
// Fixturen saknar etapp 3-fälten – lägg till rimliga värden (NVDA: inga fallande kvartal; CCC: två fallande kvartal + sänkt utdelning).
Object.values(fixture).forEach(a => { a.varden.vinst_kvartal_fallande = 0; a.varden.vinst_kvartal_yoy = 10; a.varden.utd_sankt = false; a.varden.vpa_forward = a.varden.pe_forward > 0 ? Math.round(a.kurs / a.varden.pe_forward * 100) / 100 : null; a.opalitlig = a.opalitlig || []; });
fixture['CCC.L'].varden.vinst_kvartal_fallande = 2; fixture['CCC.L'].varden.utd_sankt = true;
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(8793, r));
const FX = { USD: 9.5, SEK: 1, GBp: 0.125, EUR: 11.0, CAD: 6.8 };
const quoteFrom = (a) => ({ symbol: a.symbol, namn: a.namn, valuta: a.valuta, bors: null, kurs: a.kurs, forandring: 0.4, kursTid: a.kursTid + 'T16:00:00.000Z', fxSek: FX[a.valuta] || 1, rekommendation: null, varning: null, hamtad: new Date().toISOString(),
  nyckeltal: { vpa: a.varden.vpa, utd: a.varden.utd, da: a.varden.da, pe: a.varden.pe, pe_forward: a.varden.pe_forward, ps: a.varden.ps, pb: a.varden.pb, tillv: a.varden.tillv, oms_tillv: a.varden.oms_tillv, roe: a.varden.roe, marginal: a.varden.marginal, vinstmarginal: a.varden.vinstmarginal, skuld: a.varden.skuld, skuld_ek: a.varden.skuld_ek, ev_ebitda: a.varden.ev_ebitda, utdandel: a.varden.utdandel, hogst52: a.varden.hogst52, lagst52: a.varden.lagst52, riktkurs: a.varden.riktkurs, borsvarde: a.varden.borsvarde, beta: a.varden.beta, solid: a.varden.solid } });
// Historik: ett år med en topp 40 % över dagens kurs för BESI (glidande stop), platt för övriga.
const histFor = (sym) => { const a = fixture[sym]; const out = []; const d = new Date(); d.setDate(d.getDate() - 365); for (let i = 0; i < 365; i++) { const x = new Date(d); x.setDate(d.getDate() + i); if (x.getDay() === 0 || x.getDay() === 6) continue; const iso = x.toISOString().slice(0, 10); let c = a.kurs; if (sym === 'BESI.AS' && i > 150 && i < 200) c = a.kurs * 1.4; out.push([iso, c]); } return { symbol: sym, valuta: a.valuta, range: '1y', priser: out }; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = []; const calls = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push(m.text()); });
await page.route('https://pxskckkdftnknqcgpbng.supabase.co/**', async route => {
  const u = new URL(route.request().url()); const sym = u.searchParams.get('symbol'); calls.push(u.pathname.split('/').pop() + ':' + sym);
  if (u.pathname.endsWith('/api/aktie')) { const a = fixture[sym]; return a ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFrom(a)) }) : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Ingen data"}' }); }
  if (u.pathname.endsWith('/api/analys')) { const a = fixture[sym]; return a ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) }) : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Ingen data"}' }); }
  if (u.pathname.endsWith('/api/historik')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture[sym] ? histFor(sym) : { symbol: sym, priser: [] }) });
  return route.fulfill({ status: 404, body: '[]' });
});
// Exempelportfölj med påhittade antal och GAV (valda så att stop-loss slår för NVDA, XNET, BESI och AMSC), plus gårdagens logg med andra beslut (påminnelse).
await page.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const innehav = [['RR', 'RR.L', 20, 1200, 'GBp'], ['NVDA', 'NVDA', 2, 220, 'USD'], ['SPCX', 'SPCX', 2, 140, 'USD'], ['CCC', 'CCC.L', 5, 5500, 'GBp'], ['ABB', 'ABB.ST', 3, 1000, 'SEK'], ['PLEJD', 'PLEJD.ST', 3, 1000, 'SEK'], ['GRGD', 'GRGD.TO', 7, 90, 'CAD'], ['BESI', 'BESI.AS', 2, 240, 'EUR'], ['XNET', 'XNET', 100, 6, 'USD'], ['AMSC', 'AMSC', 12, 55, 'USD']];
  const stocks = innehav.map(x => ({ id: x[0].toLowerCase(), ticker: x[0], symbol: x[1], namn: x[0], antal: x[2], gav: x[3], kurs: null, valuta: x[4], fxSek: 1, hamtad: null, varden: {}, tes: x[0] === 'NVDA' ? 'AI-efterfrågan håller i sig i två år till.' : '', saljplan: x[0] === 'NVDA' ? 'Sälj om bruttomarginalen faller under 65 %.' : '' }));
  const ig = (d0 => { d0.setDate(d0.getDate() - 1); return d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'); })(new Date());
  const logg = [{ d: ig, id: 'nvda', sym: 'NVDA', t: 'NVDA', k: 160, fx: 9.5, v: 'kop_mer', p: 80 }, { d: ig, id: 'rr', sym: 'RR.L', t: 'RR', k: 1300, fx: 0.125, v: 'behall', p: 66 }];
  localStorage.setItem('aktiekompassen-v2', JSON.stringify({ version: 3, settings: { metrics: [{ id: 'hogst52', namn: '52-veckors högsta', enhet: 'kr', dec: 2, kalla: 'hogst52' }], rules: [{ id: 'r4', metric: 'utv_gav', op: '<', value: -20, signal: 'kop', vikt: 1, aktiv: true, namn: 'Öka på nedgång' }, { id: 'r10', metric: 'fran52h', op: '<', value: -25, signal: 'kop', vikt: 1, aktiv: true, namn: 'Långt under toppen' }], kopTroskel: 50, saljTroskel: 50, modell: { stil: 'balanserad' } }, stocks, logg }));
  localStorage.setItem('seeded', '1');
});
const T = (ok, msg) => { console.log((ok ? 'ok   ' : 'FEL  ') + msg); if (!ok) process.exitCode = 1; };
const today = () => page.evaluate(() => (d0 => d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'))(new Date()));
const verdicts = () => page.$$eval('.stock-card', els => Object.fromEntries(els.map(e => [e.querySelector('.ticker').textContent, { chip: e.querySelector('.sc-verdict .chip').textContent, score: e.querySelector('.score-pill').textContent, risk: (e.querySelector('.chip.risk') || {}).textContent || '' }])));

await page.goto('http://localhost:8793/#portfolj');
await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('aktiekompassen-hist') || '{}')).length >= 10, null, { timeout: 25000 }).catch(() => console.log('TIMEOUT hist', errors.join(' | ')));
await page.waitForTimeout(700);
let v = await verdicts();
console.log(JSON.stringify(v));
T(v.NVDA.chip === 'Behåll' && v.NVDA.risk === 'Stop-loss', 'NVDA: stop-loss villkorad → högst Behåll (' + v.NVDA.chip + ' / ' + v.NVDA.risk + ')');
T(v.XNET.chip === 'Sälj' && v.XNET.risk === 'Stop-loss', 'XNET: stop-loss + sviktande fundamenta → Sälj (' + v.XNET.chip + ')');
T(v.RR.chip === 'Minska' && /Dyr/.test(v.RR.risk), 'RR: P/E över egen 90:e percentil → Minska (' + v.RR.chip + ' / ' + v.RR.risk + ')');
T(v.CCC.chip === 'Sälj', 'CCC: två fundamenta-signaler (fallande vinst + sänkt utdelning) → Sälj (' + v.CCC.chip + ')');
T(v.BESI.chip === 'Behåll' && /Stop-loss|Glidande/.test(v.BESI.risk), 'BESI: stop (GAV −37 %, topp −29 %) → högst Behåll (' + v.BESI.chip + ' / ' + v.BESI.risk + ')');
T(v.PLEJD.chip === 'Köp mer', 'PLEJD: inga riskträffar → Köp mer kvar (' + v.PLEJD.chip + ')');
const port = await page.innerText('#app');
T(/Ändrade beslut/.test(port) && /NVDA Köp mer → Behåll/.test(port), 'påminnelsenotis om ändrat beslut på portföljsidan');
await page.screenshot({ path: OUT + 'r-portfolj.png', fullPage: true });

// NVDA-detalj: riskbox, påminnelse med tes, tes-kortet
await page.click('.stock-card:has-text("NVDA")'); await page.waitForTimeout(400);
let det = await page.innerText('#app');
T(/Riskkontroll/i.test(det) && /Modellen säger Köp mer, riskreglerna sänker till Behåll/.test(det), 'NVDA: riskbox förklarar sänkningen');
T(/Påminnelse/i.test(det) && /AI-efterfrågan/.test(det) && /bruttomarginalen/.test(det), 'NVDA: påminnelse visar tes och säljplan');
T(/Tes och säljplan/i.test(det) && /Högsta sedan köp/i.test(det), 'tes-kortet med högsta sedan köp');
// Målkurs under dagens kurs → Målkurs nådd → Minska
await page.fill('input[data-field="malkurs"]', '150'); await page.press('input[data-field="malkurs"]', 'Enter'); await page.waitForTimeout(300);
det = await page.innerText('#app');
T(/Målkursen 150,00 är nådd/.test(det), 'målkurs nådd syns i riskkontrollen');
const chipNow = await page.$eval('.verdict-label', e => e.textContent);
T(chipNow === 'Minska', 'målkurs nådd → Minska (' + chipNow + ')');
await page.fill('input[data-field="malkurs"]', ''); await page.press('input[data-field="malkurs"]', 'Enter'); await page.waitForTimeout(300);
// Stoppkurs över dagens kurs → Sälj
await page.fill('input[data-field="stoppkurs"]', '170'); await page.press('input[data-field="stoppkurs"]', 'Enter'); await page.waitForTimeout(300);
T((await page.$eval('.verdict-label', e => e.textContent)) === 'Sälj', 'stoppkurs nådd → Sälj');
await page.fill('input[data-field="stoppkurs"]', ''); await page.press('input[data-field="stoppkurs"]', 'Enter'); await page.waitForTimeout(300);
// Köpdatum → högsta sedan köp räknas från det datumet
await page.screenshot({ path: OUT + 'r-detail-nvda.png', fullPage: true });
// Registrera köp → tes-dialog när tes saknas (ABB saknar tes)
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("ABB")'); await page.waitForTimeout(300);
await page.click('[data-action=trade]'); await page.waitForTimeout(300);
await page.fill('#f-tantal', '1'); await page.fill('#f-tpris', '830');
await page.click('#sheetForm button[type=submit]'); await page.waitForTimeout(700);
const sheetTitle = await page.$eval('#sheetForm h2', e => e.textContent).catch(() => '');
T(/Din tes för ABB/.test(sheetTitle), 'köp → appen ber om tes och säljplan (' + sheetTitle + ')');
await page.fill('#f-tes', 'Elektrifieringen driver orderingången.'); await page.fill('#f-saljplan', 'Sälj över 1 100 kr.'); await page.fill('#f-malkurs', '1100');
await page.click('#sheetForm button[type=submit]'); await page.waitForTimeout(400);
const abb = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).stocks.find(s => s.id === 'abb'));
T(abb.tes.startsWith('Elektrifieringen') && abb.malkurs === 1100 && abb.antal === 4 && abb.kopDatum == null, 'tes, säljplan och målkurs sparade efter köpet (' + JSON.stringify({ tes: abb.tes, mk: abb.malkurs, antal: abb.antal, kd: abb.kopDatum }) + ')');

// Regler: riskreglerna, ändra åtgärd för stop-loss till Sälj alltid → NVDA Sälj; Bara varna → Köp mer
await page.goto('http://localhost:8793/#regler'); await page.waitForTimeout(300);
const reg = await page.innerText('#app');
T(/Riskregler/i.test(reg) && /Stop-loss från GAV/.test(reg) && /Maxvikt per valuta/.test(reg), 'riskreglerna visas under Regler');
await page.selectOption('select[data-field="risk.stop_gav.atgard"]', 'salj'); await page.waitForTimeout(300);
await page.goto('http://localhost:8793/#portfolj'); await page.waitForTimeout(400);
v = await verdicts();
T(v.NVDA.chip === 'Sälj', 'stop-loss "Sälj alltid" → NVDA Sälj (' + v.NVDA.chip + ')');
await page.goto('http://localhost:8793/#regler'); await page.waitForTimeout(300);
await page.selectOption('select[data-field="risk.stop_gav.atgard"]', 'varna'); await page.waitForTimeout(200);
await page.selectOption('select[data-field="risk.stop_topp.atgard"]', 'varna'); await page.waitForTimeout(300);
await page.goto('http://localhost:8793/#portfolj'); await page.waitForTimeout(400);
v = await verdicts();
T(v.NVDA.chip === 'Köp mer' && v.NVDA.risk === '', 'stopparna "Bara varna" → NVDA Köp mer igen (' + v.NVDA.chip + ')');
// Maxvikt: gör XNET till 60 % av portföljen → Minska? (XNET är redan Sälj av stop-loss som nu bara varnar → fundamenta sviktar men villkorad är av) – kolla chip "Maxvikt" på största
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('aktiekompassen-v2')); const x = d.stocks.find(s => s.id === 'plejd'); x.antal = 40; localStorage.setItem('aktiekompassen-v2', JSON.stringify(d)); });
await page.goto('http://localhost:8793/#portfolj'); await page.reload(); await page.waitForTimeout(600);
v = await verdicts();
T(v.PLEJD.chip === 'Minska' && v.PLEJD.risk === 'Maxvikt', 'maxvikt per aktie → PLEJD Minska (' + v.PLEJD.chip + ' / ' + v.PLEJD.risk + ')');
await page.goto('http://localhost:8793/#regler'); await page.waitForTimeout(300);
await page.click('[data-action=reset-risk]'); await page.waitForTimeout(300);
const risk = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).settings.modell.risk);
T(risk.stop_gav.atgard === 'villkorad' && risk.stop_gav.varde === 20, 'återställning av riskregler');
await page.click('details.krit-master summary').catch(() => {});
await page.screenshot({ path: OUT + 'r-regler.png', fullPage: true });
// Facit: loggen innehåller dagens beslut med riskjusterade värden
const t = await today();
const logg = await page.evaluate((t) => JSON.parse(localStorage.getItem('aktiekompassen-v2')).logg.filter(e => e.d === t).map(e => e.t + ':' + e.v), t);
console.log('LOGG', logg.join(' '));
console.log('CALLS', calls.length);
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'NO ERRORS');
await browser.close(); server.close();
