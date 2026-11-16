// Etapp 2 – analysmodellen i appen, mot mockat API (fixture = riktiga /api/analys-svar för Pers tio aktier).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync } from 'node:fs';
const OUT = './';
const html = readFileSync('../index.html', 'utf8');
const fixture = JSON.parse(readFileSync('./analys-fixture.json', 'utf8'));
// Exempelportfölj med fixturens tio aktier (antal och GAV påhittade).
const innehav = Object.values(fixture).map((a, i) => ({ ticker: a.symbol.replace(/\.[A-Z]+$/, ''), symbol: a.symbol, namn: a.namn, antal: 1 + (i % 3), gav: Math.round(a.kurs * (i % 2 ? 1.3 : 0.9) * 100) / 100, valuta: a.valuta }));
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(8790, r));
const FX = { USD: 9.5, SEK: 1, GBp: 0.125, EUR: 11.0, CAD: 6.8 };
const quoteFrom = (a) => ({ symbol: a.symbol, namn: a.namn, valuta: a.valuta, bors: null, kurs: a.kurs, forandring: 0.4, kursTid: a.kursTid + 'T16:00:00.000Z', fxSek: FX[a.valuta] || 1, rekommendation: null, varning: null, hamtad: new Date().toISOString(),
  nyckeltal: { vpa: a.varden.vpa, utd: a.varden.utd, da: a.varden.da, pe: a.varden.pe, pe_forward: a.varden.pe_forward, ps: a.varden.ps, pb: a.varden.pb, tillv: a.varden.tillv, oms_tillv: a.varden.oms_tillv, roe: a.varden.roe, marginal: a.varden.marginal, vinstmarginal: a.varden.vinstmarginal, skuld: a.varden.skuld, skuld_ek: a.varden.skuld_ek, ev_ebitda: a.varden.ev_ebitda, utdandel: a.varden.utdandel, hogst52: a.varden.hogst52, lagst52: a.varden.lagst52, riktkurs: a.varden.riktkurs, borsvarde: a.varden.borsvarde, beta: a.varden.beta, solid: a.varden.solid } });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = []; const calls = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push(m.text()); });
await page.route('https://pxskckkdftnknqcgpbng.supabase.co/**', async route => {
  const u = new URL(route.request().url()); calls.push(u.pathname.split('/').pop() + (u.searchParams.get('symbol') ? ':' + u.searchParams.get('symbol') : ''));
  const sym = u.searchParams.get('symbol');
  if (u.pathname.endsWith('/api/aktie')) { const a = fixture[sym]; if (!a) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Ingen data' }) }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFrom(a)) }); }
  if (u.pathname.endsWith('/api/analys')) { const a = fixture[sym]; if (!a) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Ingen data' }) }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) }); }
  if (u.pathname.endsWith('/api/historik')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: sym, valuta: 'USD', priser: [] }) });
  return route.fulfill({ status: 404, body: '[]' });
});
// Lagring som den ser ut hos Per idag: v2-data med den gamla regeluppsättningen (uppgraderingen ska ta bort r1,r2,...).
await page.addInitScript((innehav) => {
  if (localStorage.getItem('seeded')) return;
  const stocks = innehav.map(x => ({ id: x.ticker.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ticker: x.ticker, symbol: x.symbol, namn: x.namn || '', antal: x.antal, gav: x.gav, kurs: null, valuta: x.valuta || 'SEK', fxSek: 1, hamtad: null, varden: {} }));
  const oldRules = [
    { id: 'r1', metric: 'pe', op: '<', value: 15, signal: 'kop', vikt: 2, aktiv: true, namn: 'Lågt värderad' }, { id: 'r2', metric: 'pe', op: '>', value: 30, signal: 'salj', vikt: 2, aktiv: true, namn: 'Högt värderad' },
    { id: 'r3', metric: 'da', op: '>=', value: 4, signal: 'kop', vikt: 1, aktiv: true, namn: 'Hög utdelning' }, { id: 'r4', metric: 'utv_gav', op: '<', value: -20, signal: 'kop', vikt: 1, aktiv: true, namn: 'Öka på nedgång' },
    { id: 'r5', metric: 'utv_gav', op: '>', value: 50, signal: 'salj', vikt: 1, aktiv: true, namn: 'Ta hem vinst' }, { id: 'r6', metric: 'vikt', op: '>', value: 25, signal: 'salj', vikt: 2, aktiv: true, namn: 'För stor andel' },
    { id: 'r7', metric: 'solid', op: '<', value: 30, signal: 'salj', vikt: 1, aktiv: true, namn: 'Svag balansräkning' }, { id: 'r8', metric: 'tillv', op: '>', value: 10, signal: 'kop', vikt: 1, aktiv: true, namn: 'Växande vinst' },
    { id: 'r9', metric: 'tillv', op: '<', value: 0, signal: 'salj', vikt: 1, aktiv: true, namn: 'Fallande vinst' }, { id: 'r10', metric: 'fran52h', op: '<', value: -25, signal: 'kop', vikt: 1, aktiv: true, namn: 'Långt under toppen' },
    { id: 'r11', metric: 'uppsida', op: '>', value: 20, signal: 'kop', vikt: 1, aktiv: true, namn: 'Analytiker ser uppsida' }, { id: 'r12', metric: 'skuld', op: '>', value: 3, signal: 'salj', vikt: 1, aktiv: true, namn: 'Hög skuldsättning' },
  ];
  const metrics = [
    { id: 'vpa', namn: 'Vinst per aktie (VPA)', enhet: 'kr', dec: 2, kalla: 'vpa' }, { id: 'utd', namn: 'Utdelning per aktie', enhet: 'kr', dec: 2, kalla: 'utd' }, { id: 'hogst52', namn: '52-veckors högsta', enhet: 'kr', dec: 2, kalla: 'hogst52' },
    { id: 'lagst52', namn: '52-veckors lägsta', enhet: 'kr', dec: 2, kalla: 'lagst52' }, { id: 'riktkurs', namn: 'Riktkurs', enhet: 'kr', dec: 0, kalla: 'riktkurs' }, { id: 'solid', namn: 'Soliditet', enhet: '%', dec: 0, kalla: 'solid' },
    { id: 'tillv', namn: 'Vinsttillväxt', enhet: '%', dec: 1, kalla: 'tillv' }, { id: 'skuld', namn: 'Nettoskuld / EBITDA', enhet: 'x', dec: 1, kalla: 'skuld' },
  ];
  const logg = [{ d: '2026-11-11', id: 'nvda', sym: 'NVDA', t: 'NVDA', k: 193.16, fx: 9.5, v: 'bevaka', p: 20 }, { d: '2026-11-11', id: 'amsc', sym: 'AMSC', t: 'AMSC', k: 26.5, fx: 9.5, v: 'kop', p: 55 }];
  localStorage.setItem('aktiekompassen-v2', JSON.stringify({ version: 2, settings: { metrics, rules: oldRules, kopTroskel: 50, saljTroskel: 50 }, stocks, logg }));
  localStorage.setItem('seeded', '1');
}, innehav);

const T = (ok, msg) => { console.log((ok ? 'ok   ' : 'FEL  ') + msg); if (!ok) process.exitCode = 1; };
await page.goto('http://localhost:8790/#portfolj');
// Vänta tills alla tio är hämtade (progress borta) och analysen sparad
try { await page.waitForFunction(() => { const a = JSON.parse(localStorage.getItem('aktiekompassen-analys') || '{}'); return Object.keys(a).length >= 10; }, null, { timeout: 20000 }); } catch (e) { console.log('TIMEOUT', errors.join(' | '), calls.join(' '), (await page.innerText('#app')).slice(0, 600)); }
await page.waitForTimeout(600);
const port = await page.innerText('#app');
T(/Ny analysmodell/.test(port), 'uppgraderingsnotis visas');
T(/råd/i.test(port) && /\/100/.test(port), 'råd-rutan med snittpoäng');
const cards = await page.$$eval('.stock-card', els => els.map(e => ({ t: e.querySelector('.ticker').textContent, chip: e.querySelector('.sc-verdict .chip').textContent, score: e.querySelector('.score-pill').textContent, bars: e.querySelectorAll('.dims i').length, skal: e.querySelector('.sc-skal').textContent })));
console.log(JSON.stringify(cards, null, 0));
T(cards.length === 10 && cards.every(c => c.bars === 6), 'tio kort med sex staplar');
T(cards.every(c => /^\d+$/.test(c.score)), 'alla kort har en poäng');
T(cards.every(c => /Köp mer|Behåll|Minska|Sälj/.test(c.chip)), 'alla ägda har ett av de fyra besluten');
const st1 = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('aktiekompassen-v2')); return { rules: d.settings.rules.map(r => r.id), modell: d.settings.modell && d.settings.modell.stil, logg: d.logg.filter(e => e.d === (d0 => d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'))(new Date())).map(e => e.t + ':' + e.v + ':' + e.p), version: d.version }; });
console.log('STATE', JSON.stringify(st1));
T(st1.rules.join(',') === 'r4,r5,r6,r10', 'gamla regler som modellen täcker togs bort (' + st1.rules.join(',') + ')');
T(st1.modell === 'balanserad' && st1.version === 3, 'modellinställningar sparade');
T(st1.logg.length === 10 && st1.logg.every(x => /:(kop_mer|behall|minska|salj):\d+$/.test(x)), 'facit loggar nya beslut med poäng 0–100');
await page.screenshot({ path: OUT + 'm-portfolj.png', fullPage: true });

// Detaljsida NVDA
await page.click('.stock-card:has-text("NVDA")');
await page.waitForTimeout(400);
const det = await page.innerText('#app');
const dims = await page.$$eval('.dim', els => els.map(e => ({ n: e.querySelector('.dim-name').textContent.trim(), p: e.querySelector('.dim-p').textContent.trim(), k: e.querySelectorAll('.krit').length, cls: e.className })));
console.log('NVDA dims', JSON.stringify(dims));
T(dims.length === 6, 'sex dimensioner på detaljsidan');
T(/Talar för/i.test(det) && /Talar emot/i.test(det), 'skäl för och emot visas');
T(/Röda flaggor/i.test(det) && /insynsförsäljningar/i.test(det), 'NVDA:s flaggor visas');
await page.evaluate(() => { document.querySelectorAll('.dim').forEach(d => d.open = true); });
const detOpen = await page.innerText('#app');
T(/Piotroski/.test(detOpen) && /Graham/.test(detOpen) && /Minervini/.test(detOpen), 'källor anges per kriterium');
await page.evaluate(() => { document.querySelectorAll('.dim').forEach(d => d.open = false); });
T(/Analys hämtad/.test(det) && /Semiconductors/.test(det), 'analysrad med bransch');
const nvdaScore = await page.$eval('.d-verdict .score', e => e.textContent);
console.log('NVDA', nvdaScore);
await page.click('.dim:nth-child(1) summary');
await page.waitForTimeout(200);
await page.screenshot({ path: OUT + 'm-detail-nvda.png', fullPage: true });

// Spärren: AMSC har utv_gav < -20 (dippregel) – kolla om spärren slår
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("AMSC")'); await page.waitForTimeout(300);
const amsc = await page.innerText('#app');
console.log('AMSC spärr', /Köp-dippen-spärren/.test(amsc), (amsc.match(/Poäng \d+ av 100[^\n]*/) || [''])[0]);
await page.screenshot({ path: OUT + 'm-detail-amsc.png', fullPage: true });

await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("XNET")'); await page.waitForTimeout(300);
await page.evaluate(() => { document.querySelectorAll('.dim').forEach(d => d.open = true); });
const xnet = await page.innerText('#app');
T(/vinstbaserade kriterier hoppas över/i.test(xnet), 'XNET: orimlig vinst → vinstkriterier hoppas över');
const xnetRoic = await page.$$eval('.krit', els => els.filter(e => /ROIC/.test(e.textContent)).map(e => e.className));
T(xnetRoic.length === 1 && /na/.test(xnetRoic[0]), 'XNET: ROIC visas som saknas (' + xnetRoic.join(',') + ')');
await page.click('[data-action=back]'); await page.waitForTimeout(200);
await page.click('.stock-card:has-text("PLEJD")'); await page.waitForTimeout(300);
const plejd = await page.innerText('#app');
console.log('PLEJD', (plejd.match(/Analys hämtad[^\n]*/) || [''])[0].slice(0, 300));

// Regler: modellsektionen, byt stil → poängen ändras
await page.goto('http://localhost:8790/#regler'); await page.waitForTimeout(300);
const reg = await page.innerText('#app');
T(/Analysmodell/.test(reg) && /Investeringsstil/.test(reg) && /Köp-dippen-spärr/.test(reg), 'modellsektionen finns under Regler');
T(/Dina regler/.test(reg) && !/Lågt värderad/.test(reg) && /För stor andel/.test(reg), 'regellistan är rensad');
await page.click('details.krit-master summary'); await page.waitForTimeout(200);
await page.click('details.krit-grupp:nth-of-type(1) summary').catch(() => {});
await page.screenshot({ path: OUT + 'm-regler.png', fullPage: true });
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).logg.filter(e => e.d === (d0 => d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'))(new Date())).map(e => e.t + ':' + e.p).join(' '));
await page.click('[data-action=set-stil][data-id=momentum]'); await page.waitForTimeout(300);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).logg.filter(e => e.d === (d0 => d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'))(new Date())).map(e => e.t + ':' + e.p).join(' '));
console.log('Balanserad', before); console.log('Momentum  ', after);
T(before !== after, 'stilbyte ändrar poängen');
// Ändra en vikt → stil blir Egen
await page.fill('input[data-field="modell.vikt.V"]', '2,5'); await page.press('input[data-field="modell.vikt.V"]', 'Enter'); await page.waitForTimeout(300);
const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).settings.modell);
T(st2.stil === 'egen' && st2.vikter.V === 2.5, 'egen vikt sparas och stil blir Egen');
// Ändra en gräns och återställ
await page.click('details.krit-master summary').catch(() => {});
await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = true); });
await page.fill('input[data-field="modell.grans.k_roe.bra"]', '20'); await page.press('input[data-field="modell.grans.k_roe.bra"]', 'Enter'); await page.waitForTimeout(300);
const st3 = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).settings.modell.granser);
T(st3.k_roe && st3.k_roe.bra === 20 && st3.k_roe.dalig === 5, 'gränsvärde sparas (' + JSON.stringify(st3) + ')');
await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = true); });
await page.click('[data-action=reset-grans][data-id=k_roe]'); await page.waitForTimeout(300);
const st4 = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).settings.modell.granser);
T(!st4.k_roe, 'gränsvärde återställs');
// Fel riktning avvisas
await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = true); });
await page.fill('input[data-field="modell.grans.k_roe.bra"]', '2'); await page.press('input[data-field="modell.grans.k_roe.bra"]', 'Enter'); await page.waitForTimeout(300);
const st5 = await page.evaluate(() => JSON.parse(localStorage.getItem('aktiekompassen-v2')).settings.modell.granser);
T(!st5.k_roe, 'gräns med fel riktning avvisas');

// Signaler-vyn
await page.goto('http://localhost:8790/#signaler'); await page.waitForTimeout(300);
const sig = await page.innerText('#app');
T(/Beslut just nu/.test(sig) && (await page.$$('.beslut-rad')).length === 10, 'beslutslistan med tio rader');
await page.screenshot({ path: OUT + 'm-signaler.png', fullPage: true });

// Facit
await page.goto('http://localhost:8790/#facit'); await page.waitForTimeout(500);
const fac = await page.innerText('#app');
T(/Köpråd/i.test(fac) && /Säljråd/i.test(fac), 'facit renderar med nya beslut');

// Omladdning: analysen ska komma från lagringen (inga nya /analys-anrop samma dag), kurser hämtas inte igen inom en timme
const n1 = calls.filter(c => c.startsWith('analys')).length;
await page.goto('http://localhost:8790/#portfolj'); await page.waitForTimeout(1200);
const n2 = calls.filter(c => c.startsWith('analys')).length;
T(n1 === 10 && n2 === 10, 'analysen hämtas en gång per dag (' + n1 + '/' + n2 + ')');

// Dator, mörkt läge
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'dark', storageState: await ctx.storageState() });
const p2 = await ctx2.newPage();
await p2.route('https://pxskckkdftnknqcgpbng.supabase.co/**', r => r.fulfill({ status: 404, body: '[]' }));
await p2.goto('http://localhost:8790/#portfolj'); await p2.waitForTimeout(600);
await p2.click('.stock-card:has-text("RR")'); await p2.waitForTimeout(300);
await p2.evaluate(() => { document.querySelectorAll('.dim').forEach(d => d.open = true); });
await p2.screenshot({ path: OUT + 'm-desktop-dark-rr.png', fullPage: true });
const rr = await p2.$$eval('.dim', els => els.map(e => e.querySelector('.dim-name').textContent.trim() + ' ' + e.querySelector('.dim-p').textContent.trim()));
console.log('RR.L dims', rr.join(' | '));

console.log('CALLS', calls.length, [...new Set(calls.map(c => c.split(':')[0]))].join(','));
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'NO ERRORS');
await browser.close(); server.close();
