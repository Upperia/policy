// Test av analys() mot en mockad Yahoo. Körs med: node --experimental-strip-types analystest.mts
import { analys } from '../function/analys.ts';

const res = (body: any, init: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status || 200, headers: init.headers || {} });
const log: string[] = [];

// Bokslutsrader: fem år + fem kvartal + trailing
const years = ['2021-01-31', '2022-01-30', '2023-01-29', '2024-01-28', '2025-01-26'];
const quarters = ['2024-10-27', '2025-01-26', '2025-04-27', '2025-07-27', '2025-10-26'];
const tsRow = (type: string, dates: string[], vals: number[], cur = 'USD') => ({
  meta: { symbol: ['NVDA'], type: [type] },
  timestamp: dates.map((d) => Math.floor(new Date(d).getTime() / 1000)),
  [type]: dates.map((d, i) => ({ dataId: 1, asOfDate: d, periodType: type.startsWith('annual') ? '12M' : type.startsWith('quarterly') ? '3M' : 'TTM', currencyCode: cur, reportedValue: { raw: vals[i], fmt: String(vals[i]) } })),
});
const annual: Record<string, number[]> = {
  TotalRevenue: [16.7e9, 26.9e9, 27.0e9, 60.9e9, 130.5e9],
  NetIncome: [4.3e9, 9.75e9, 4.37e9, 29.8e9, 72.9e9],
  OperatingCashFlow: [5.8e9, 9.1e9, 5.6e9, 28.1e9, 64.1e9],
  FreeCashFlow: [4.7e9, 8.1e9, 3.8e9, 27.0e9, 60.9e9],
  TotalAssets: [28.8e9, 44.2e9, 41.2e9, 65.7e9, 111.6e9],
  LongTermDebt: [6.0e9, 10.9e9, 9.7e9, 8.5e9, 8.5e9],
  TotalDebt: [7.6e9, 11.8e9, 12.0e9, 11.1e9, 10.3e9],
  CurrentAssets: [16.1e9, 28.8e9, 23.1e9, 44.3e9, 80.1e9],
  CurrentLiabilities: [3.9e9, 4.3e9, 6.6e9, 10.6e9, 18.0e9],
  GrossProfit: [10.4e9, 17.5e9, 15.4e9, 44.3e9, 97.9e9],
  EBIT: [4.5e9, 10.0e9, 4.2e9, 33.0e9, 81.5e9],
  OrdinarySharesNumber: [24.8e9, 25.1e9, 24.7e9, 24.6e9, 24.4e9],
  StockholdersEquity: [16.9e9, 26.6e9, 22.1e9, 43.0e9, 79.3e9],
  RetainedEarnings: [18.9e9, 16.2e9, 10.2e9, 29.8e9, 68.0e9],
  TotalLiabilitiesNetMinorityInterest: [11.9e9, 17.6e9, 19.1e9, 22.8e9, 32.3e9],
  InterestExpense: [184e6, 236e6, 262e6, 257e6, 247e6],
  DilutedEPS: [0.17, 0.385, 0.174, 1.19, 2.94],
  InvestedCapital: [23.5e9, 37.5e9, 32.8e9, 51.5e9, 88.8e9],
  CashDividendsPaid: [-395e6, -399e6, -398e6, -395e6, -834e6],
  WorkingCapital: [12.2e9, 24.5e9, 16.5e9, 33.7e9, 62.1e9],
  CapitalExpenditure: [-1.1e9, -1.0e9, -1.8e9, -1.1e9, -3.2e9],
};
const quarterly: Record<string, number[]> = {
  TotalAssets: [96.0e9, 111.6e9, 125.3e9, 140.7e9, 160.2e9],
  StockholdersEquity: [65.9e9, 79.3e9, 83.8e9, 100.1e9, 115.0e9],
  CurrentAssets: [68.1e9, 80.1e9, 89.9e9, 105.3e9, 120.0e9],
  CurrentLiabilities: [16.6e9, 18.0e9, 18.0e9, 21.9e9, 25.0e9],
  LongTermDebt: [8.5e9, 8.5e9, 8.5e9, 8.5e9, 8.5e9],
  TotalDebt: [10.0e9, 10.3e9, 10.3e9, 10.5e9, 10.5e9],
  OrdinarySharesNumber: [24.5e9, 24.4e9, 24.4e9, 24.3e9, 24.3e9],
  RetainedEarnings: [50.0e9, 68.0e9, 72.0e9, 90.0e9, 100.0e9],
  TotalLiabilitiesNetMinorityInterest: [30.1e9, 32.3e9, 41.5e9, 40.6e9, 45.2e9],
  WorkingCapital: [51.5e9, 62.1e9, 71.9e9, 83.4e9, 95.0e9],
  InvestedCapital: [75.9e9, 88.8e9, 93.2e9, 110.0e9, 125.0e9],
  NetIncome: [19.3e9, 22.1e9, 18.8e9, 26.4e9, 30.0e9],
  TotalRevenue: [35.1e9, 39.3e9, 44.1e9, 46.7e9, 55.0e9],
};
const trailing: Record<string, number> = { NetIncome: 97.3e9, OperatingCashFlow: 90.0e9, FreeCashFlow: 85.0e9, EBIT: 110.0e9, TotalRevenue: 185.0e9, GrossProfit: 130.0e9, DilutedEPS: 3.94, InterestExpense: 250e6, CashDividendsPaid: -950e6 };

function timeseriesBody(types: string[]) {
  const rows: any[] = [];
  types.forEach((t) => {
    if (t.startsWith('annual') && annual[t.slice(6)]) rows.push(tsRow(t, years, annual[t.slice(6)]));
    else if (t.startsWith('quarterly') && quarterly[t.slice(9)]) rows.push(tsRow(t, quarters, quarterly[t.slice(9)]));
    else if (t.startsWith('trailing') && trailing[t.slice(8)] != null) rows.push(tsRow(t, ['2025-10-26'], [trailing[t.slice(8)]]));
    else rows.push({ meta: { symbol: ['NVDA'], type: [t] }, timestamp: [] });
  });
  return { timeseries: { result: rows } };
}

function series(n: number, start: number, step: number, from: Date, dayStep: number) {
  const ts: number[] = [], close: number[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(from); d.setDate(d.getDate() + i * dayStep); ts.push(Math.floor(d.getTime() / 1000)); close.push(start + i * step + Math.sin(i / 3) * start * 0.02); }
  return { ts, close };
}

const summary = {
  price: { regularMarketPrice: { raw: 186.6 }, currency: 'USD', regularMarketTime: 1763150400, longName: 'NVIDIA Corporation', marketCap: { raw: 4.54e12 }, sharesOutstanding: { raw: 24.3e9 } },
  summaryDetail: { trailingPE: { raw: 47.4 }, forwardPE: { raw: 27.8 }, dividendYield: { raw: 0.0002 }, dividendRate: { raw: 0.04 }, payoutRatio: { raw: 0.0093 }, fiveYearAvgDividendYield: { raw: 0.05 }, priceToSalesTrailing12Months: { raw: 24.5 }, fiftyDayAverage: { raw: 185.1 }, twoHundredDayAverage: { raw: 150.2 }, fiftyTwoWeekHigh: { raw: 212.19 }, fiftyTwoWeekLow: { raw: 86.62 }, beta: { raw: 2.1 } },
  defaultKeyStatistics: { trailingEps: { raw: 3.94 }, forwardEps: { raw: 6.7 }, priceToBook: { raw: 39.4 }, bookValue: { raw: 4.73 }, pegRatio: { raw: 1.1 }, enterpriseToEbitda: { raw: 40.1 }, sharesOutstanding: { raw: 24.3e9 }, heldPercentInsiders: { raw: 0.0427 }, heldPercentInstitutions: { raw: 0.68 }, shortPercentOfFloat: { raw: 0.0103 }, netIncomeToCommon: { raw: 97.3e9 }, earningsQuarterlyGrowth: { raw: 0.59 } },
  financialData: { financialCurrency: 'USD', currentPrice: { raw: 186.6 }, totalRevenue: { raw: 185.0e9 }, ebitda: { raw: 115.0e9 }, totalDebt: { raw: 10.5e9 }, totalCash: { raw: 60.6e9 }, operatingCashflow: { raw: 90.0e9 }, freeCashflow: { raw: 85.0e9 }, grossMargins: { raw: 0.703 }, operatingMargins: { raw: 0.615 }, profitMargins: { raw: 0.526 }, returnOnEquity: { raw: 1.09 }, returnOnAssets: { raw: 0.53 }, currentRatio: { raw: 4.8 }, quickRatio: { raw: 4.1 }, debtToEquity: { raw: 9.1 }, revenueGrowth: { raw: 0.557 }, earningsGrowth: { raw: 0.61 }, targetMeanPrice: { raw: 245.9 }, targetLowPrice: { raw: 180 }, targetHighPrice: { raw: 352 }, numberOfAnalystOpinions: { raw: 58 }, recommendationMean: { raw: 1.4 }, recommendationKey: 'strong_buy' },
  earningsTrend: { trend: [
    { period: '0q', growth: { raw: 0.53 }, revenueEstimate: { growth: { raw: 0.56 } }, epsRevisions: { upLast30days: { raw: 10 }, downLast30days: { raw: 1 } }, epsTrend: { current: { raw: 1.25 }, '90daysAgo': { raw: 1.19 } } },
    { period: '0y', growth: { raw: 0.49 }, revenueEstimate: { growth: { raw: 0.57 } }, epsRevisions: { upLast30days: { raw: 20 }, downLast30days: { raw: 2 } }, epsTrend: { current: { raw: 4.5 }, '90daysAgo': { raw: 4.2 } } },
    { period: '+1y', growth: { raw: 0.47 }, revenueEstimate: { growth: { raw: 0.46 } }, epsRevisions: { upLast30days: { raw: 22 }, downLast30days: { raw: 3 } }, epsTrend: { current: { raw: 6.7 }, '90daysAgo': { raw: 6.2 } } },
  ] },
  recommendationTrend: { trend: [ { period: '0m', strongBuy: 15, buy: 40, hold: 4, sell: 1, strongSell: 0 }, { period: '-1m', strongBuy: 14, buy: 40, hold: 5, sell: 1, strongSell: 0 }, { period: '-2m', strongBuy: 14, buy: 38, hold: 6, sell: 1, strongSell: 0 }, { period: '-3m', strongBuy: 13, buy: 36, hold: 8, sell: 1, strongSell: 0 } ] },
  calendarEvents: { earnings: { earningsDate: [{ raw: 1763424000, fmt: '2026-11-18' }] }, exDividendDate: { raw: 1765411200, fmt: '2026-12-11' } },
  summaryProfile: { sector: 'Technology', industry: 'Semiconductors', country: 'United States', fullTimeEmployees: 36000 },
  insiderTransactions: { transactions: [
    { startDate: { fmt: '2026-10-20' }, transactionText: 'Sale at price 180.00 - 185.00 per share.', value: { raw: 50e6 } },
    { startDate: { fmt: '2026-09-15' }, transactionText: 'Sale at price 170.00 per share.', value: { raw: 20e6 } },
    { startDate: { fmt: '2026-08-01' }, transactionText: 'Sale at price 175.00 per share.', value: { raw: 10e6 } },
    { startDate: { fmt: '2025-01-01' }, transactionText: 'Purchase at price 100.00 per share.', value: { raw: 1e6 } },
  ] },
  earningsHistory: { history: [ { surprisePercent: { raw: 0.05 } }, { surprisePercent: { raw: 0.03 } }, { surprisePercent: { raw: 0.04 } }, { surprisePercent: { raw: -0.01 } } ] },
};

const mock = async (url: string) => {
  log.push(url.split('?')[0].replace('https://query2.finance.yahoo.com', '') + (url.includes('symbol=') ? '' : ''));
  if (url.startsWith('https://fc.yahoo.com')) { const h = new Headers(); h.append('set-cookie', 'A3=x; Path=/'); return new Response('', { status: 404, headers: h }); }
  if (url.includes('/getcrumb')) return res('crumb1');
  if (url.includes('/v10/finance/quoteSummary/')) return res({ quoteSummary: { result: [summary] } });
  if (url.includes('/fundamentals-timeseries/')) { const types = decodeURIComponent(new URL(url).searchParams.get('type') || '').split(','); return res(timeseriesBody(types)); }
  if (url.includes('/v6/finance/recommendationsbysymbol/')) return res({ finance: { result: [{ recommendedSymbols: [{ symbol: 'AMD' }, { symbol: 'AVGO' }, { symbol: 'TSM' }, { symbol: 'INTC' }, { symbol: 'QCOM' }, { symbol: 'MU' }] }] } });
  if (url.includes('/v7/finance/quote')) return res({ quoteResponse: { result: [
    { symbol: 'AMD', shortName: 'AMD', trailingPE: 110, forwardPE: 35, priceToBook: 6.5, fiftyTwoWeekChangePercent: 60, averageAnalystRating: '1.8 - Buy' },
    { symbol: 'AVGO', shortName: 'Broadcom', trailingPE: 85, forwardPE: 38, priceToBook: 22, fiftyTwoWeekChangePercent: 80, averageAnalystRating: '1.6 - Buy' },
    { symbol: 'TSM', shortName: 'TSMC', trailingPE: 30, forwardPE: 24, priceToBook: 8, fiftyTwoWeekChangePercent: 50, averageAnalystRating: '1.5 - Strong Buy' },
    { symbol: 'INTC', shortName: 'Intel', forwardPE: 50, priceToBook: 1.8, fiftyTwoWeekChangePercent: 70, averageAnalystRating: '2.9 - Hold' },
    { symbol: 'QCOM', shortName: 'Qualcomm', trailingPE: 16, forwardPE: 14, priceToBook: 7, fiftyTwoWeekChangePercent: 5, averageAnalystRating: '2.2 - Buy' },
  ] } });
  if (url.includes('/v8/finance/chart/')) {
    const sym = decodeURIComponent(url.split('/v8/finance/chart/')[1].split('?')[0]);
    const p = new URL(url).searchParams;
    if (p.get('range') === '10y') {
      const from = new Date(); from.setFullYear(from.getFullYear() - 10); from.setDate(1);
      const s = series(120, 10, 1.5, from, 30);
      const dividends: Record<string, any> = {};
      for (let y = 2016; y <= 2026; y++) { for (const m of [2, 5, 8, 11]) { const d = new Date(y, m, 15); if (d > new Date()) continue; dividends[String(Math.floor(d.getTime() / 1000))] = { amount: y >= 2024 ? 0.01 : 0.004, date: Math.floor(d.getTime() / 1000) }; } }
      return res({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: s.ts, indicators: { quote: [{ close: s.close }] }, events: { dividends } }] } });
    }
    if (p.get('range') === '5y') {
      const from = new Date(); from.setDate(from.getDate() - 5 * 365);
      const s = series(1260, 20, 0.13, from, 1.45);
      const dividends: Record<string, any> = {};
      for (let y = 2022; y <= 2026; y++) { for (const m of [2, 5, 8, 11]) { const d = new Date(y, m, 15); if (d > new Date()) continue; dividends[String(Math.floor(d.getTime() / 1000))] = { amount: 0.01, date: Math.floor(d.getTime() / 1000) }; } }
      return res({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: s.ts, indicators: { quote: [{ close: s.close }] }, events: sym.startsWith('^') ? undefined : { dividends } }] } });
    }
    if (p.get('range') === '1y') {
      const from = new Date(); from.setDate(from.getDate() - 365);
      const s = sym.startsWith('^') ? series(252, 5000, 6, from, 1.45) : series(252, 110, 0.3, from, 1.45);
      return res({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: s.ts, indicators: { quote: [{ close: s.close }] } }] } });
    }
    return res({ chart: { result: [{ meta: { currency: 'SEK' }, timestamp: [1763000000], indicators: { quote: [{ close: [9.5] }] } }] } });
  }
  return res({ error: 'nope' }, { status: 404 });
};

const t0 = Date.now();
const a = await analys(mock as any, 'NVDA');
console.log('tid', Date.now() - t0, 'ms, anrop:', log.length);
console.log(log.join('\n'));
const show = (o: any) => JSON.stringify(o, null, 0).slice(0, 2000);
console.log('profil', show(a.profil));
console.log('varden', JSON.stringify(a.varden, null, 1));
console.log('fscore', show(a.fscore));
console.log('peHist', show(a.peHistorik));
console.log('utdelning', show(a.utdelning));
console.log('trend', show(a.trend));
console.log('analytiker', show(a.analytiker));
console.log('insyn', show(a.insyn));
console.log('jamfor', show(a.jamfor));
console.log('bokslut', show(a.bokslut));
console.log('flaggor', show(a.flaggor), 'saknas', show(a.saknas));
// Kontroller
const assert = (c: boolean, m: string) => { if (!c) { console.error('FEL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
assert(a.varden.pe === 47.4, 'pe från Yahoo');
assert(a.fscore && a.fscore.poang >= 6 && a.fscore.av === 9, 'F-score räknas på nio delar (' + (a.fscore && a.fscore.poang) + ')');
assert(a.varden.graham != null && Math.abs(a.varden.graham - Math.sqrt(22.5 * (186.6 / 47.4) * 4.73)) < 0.05, 'Graham-tal');
assert(a.varden.vinstavkastning != null && a.varden.vinstavkastning > 2 && a.varden.vinstavkastning < 3, 'EBIT/EV ~2.4 % (' + a.varden.vinstavkastning + ')');
assert(a.varden.rantetackning != null && a.varden.rantetackning > 400, 'räntetäckning');
assert(a.varden.zscore != null && a.varden.zscore > 20, 'Z-score (' + a.varden.zscore + ')');
assert(a.peHistorik && a.peHistorik.manader >= 50, 'P/E-historik ~60 månader (' + (a.peHistorik && a.peHistorik.manader) + ')');
assert(a.utdelning.arUtanSankning >= 8, 'år utan sänkt utdelning (' + a.utdelning.arUtanSankning + ')');
assert(a.trend.rs12m != null && a.trend.ma200 != null && a.trend.rsi14 != null, 'trend ifylld');
assert(a.analytiker.andelKop === 92 && a.analytiker.revideringar.upp30 === 42, 'analytiker');
assert(a.insyn.salj6m === 3 && a.insyn.kop6m === 0, 'insyn 6 mån');
assert(a.jamfor && a.jamfor.peMedian === 57.5 && a.jamfor.bolag.length === 5, 'jämförbara (median P/E ' + (a.jamfor && a.jamfor.peMedian) + ')');
assert(a.varden.oms_cagr3 != null && Math.abs(a.varden.oms_cagr3 - ((Math.pow(130.5 / 26.9, 1 / 3) - 1) * 100)) < 0.1, 'oms CAGR 3 år');
assert(a.flaggor.some((f: string) => f.startsWith('Bara insynsförsäljningar')), 'insynsflagga');
assert(a.bokslut.length === 5 && a.bokslut[4].vpa === 2.94, 'bokslutsserie');
// Cache: andra anropet gör inga nya fetchar
const n = log.length; await analys(mock as any, 'NVDA'); assert(log.length === n, 'cache');

// Backtest-underlag
import { backtestData } from '../function/analys.ts';
const bt = await backtestData(mock as any, 'NVDA');
assert(bt.priser.length > 200 && bt.vpa.length === 5 && bt.index === '^GSPC' && bt.utd.length > 0, 'backtest-underlag (' + bt.priser.length + ' kurser, ' + bt.vpa.length + ' VPA, ' + bt.utd.length + ' utd)');
const bti = await backtestData(mock as any, '^GSPC');
assert(bti.priser.length > 0 && bti.vpa.length === 0 && bti.index === null, 'backtest-underlag för index');
