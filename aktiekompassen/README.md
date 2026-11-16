# Aktiekompassen

Webbapp för den egna aktieportföljen: varje aktie bedöms i sex dimensioner enligt etablerade analyskriterier (värdering, kvalitet & lönsamhet, tillväxt, finansiell styrka, utdelning, trend & sentiment), vägs ihop efter vald investeringsstil och får ett beslut – Köp mer / Behåll / Minska / Sälj för aktier du äger, Köp / Avvakta / Undvik för bevakade. All portföljdata sparas lokalt i mobilen (webbläsarens lagring). Kurser, nyckeltal och analysunderlag hämtas automatiskt från Yahoo Finance via en liten serverfunktion. Beslutsstöd, inte finansiell rådgivning.

- App: https://upperia.github.io/policy/aktiekompassen/ (GitHub Pages – lägg till på hemskärmen så blir den en app). En push till `main` uppdaterar appen inom någon minut.
- Filerna i den här mappen är appen: `index.html`, `manifest.webmanifest`, `sw.js` (service worker för offline), ikoner.
- `function/` – Supabase Edge Function `aktiekompassen` (projekt Answer-to-question, Deno). `lib.ts` hämtar kurser och grundnyckeltal, `analys.ts` sätter ihop det fördjupade analysunderlaget, `index.ts` sköter API-routing. Deployas med Supabase MCP/CLI (verify_jwt av); behöver bara deployas om när funktionen ändras.
- `test/analys-fixture.json` – riktiga `/api/analys`-svar för tio aktier (hämtade 2026-11-16), används av Playwright-testerna som mockat API.
- API-bas: https://pxskckkdftnknqcgpbng.supabase.co/functions/v1/aktiekompassen/api (CORS öppet, så appen kan ligga var som helst – även öppnas lokalt).

## API
- `GET /api/sok?q=investor` → `[{ symbol, namn, bors, typ }]` (Stockholm först)
- `GET /api/aktie?symbol=INVE-B.ST` → kurs, valuta, växelkurs till SEK och nyckeltal (`vpa, utd, da, pe, pe_forward, ps, pb, tillv, oms_tillv, roe, marginal, vinstmarginal, skuld, skuld_ek, solid, ev_ebitda, utdandel, hogst52, lagst52, riktkurs, borsvarde, beta`). Hämtas varje timme appen är öppen.
- `GET /api/analys?symbol=NVDA` → det fördjupade analysunderlaget (se nedan). Hämtas en gång per dag per aktie och sparas lokalt; cachas 6 h i funktionen och 1 h i webbläsaren.
- `GET /api/historik?symbol=NVDA&range=1y` → dagliga stängningskurser `{ symbol, valuta, priser: [["2026-01-02", 123.4], …] }` (range 3mo/6mo/1y/2y/5y)
- `GET /api/raw/summary|timeseries|peers|quotes|chart` → råa Yahoo-svar, för att verifiera fält innan appen litar på dem.
- `GET /api/status`

Anropen görs med headern `x-region: us-east-1` så att funktionen körs i USA (Yahoo kräver en session som inte går att få från EU-adresser).

## Analysunderlaget (`/api/analys`)
Sju–nio Yahoo-anrop per aktie, sammanställda till ett svar:

| Del | Källa hos Yahoo | Används till |
|---|---|---|
| `profil` (sektor, bransch, land, bolagstyp) | quoteSummary `summaryProfile` | Bolagstyp styr vilka kriterier som gäller: `bank`, `forsakring`, `finans`, `investment` (P/B, ROE, soliditet på banknivå; inget F-score, Z-score eller nettoskuld), `fastighet` (annan utdelningsandel), annars `vanlig`. |
| `varden` | quoteSummary `price, summaryDetail, defaultKeyStatistics, financialData` + fundamentals-timeseries (annual/quarterly/trailing: TotalRevenue, NetIncome, OperatingCashFlow, FreeCashFlow, EBIT, GrossProfit, TotalAssets, StockholdersEquity, CurrentAssets/Liabilities, LongTermDebt, TotalDebt, RetainedEarnings, TotalLiabilities, InterestExpense, DilutedEPS, InvestedCapital, CashDividendsPaid, WorkingCapital, OrdinarySharesNumber) | Alla nyckeltal modellen räknar på (lista nedan). |
| `fscore` | timeseries, två senaste boksluten | Piotroski F-score med alla nio delkriterier i klartext (`delar`). |
| `zscore` | timeseries + börsvärde | Altman Z = 1,2·RK/T + 1,4·BV/T + 3,3·EBIT/T + 0,6·Börsvärde/Skulder + Oms/T. |
| `peHistorik` | chart 10 år månadsvis × årlig VPA | Median, p25, p75, p90 och dagens percentil för P/E senaste fem åren (bara månader med positiv vinst). |
| `utdelning` | chart `events=div` + summaryDetail | Direktavkastning nu och 5-årssnitt, utdelningsandel, täckning av fritt kassaflöde, år i rad utan sänkning (kalenderår; indragen utdelning bryter sviten), 5-års utdelningstillväxt, X-dag, historik per år. |
| `trend` | chart 1 år dagligen + index (OMXSPI för .ST, FTSE för .L, S&P/TSX för .TO, Euro Stoxx 50 för .AS m.fl., annars S&P 500) | MA50, MA200 och MA200:s riktning (2 mån), RSI 14, avkastning och relativ styrka 3/6/12 mån, volatilitet. |
| `analytiker` | `financialData, earningsTrend, recommendationTrend, earningsHistory, calendarEvents` | Antal, snittrekommendation, riktkurs låg/snitt/hög, andel köp nu och för 3 mån sedan, prognoser (kvartal, i år, nästa år), revideringar (upp/ned 30 d, estimatens förändring 90 d), överraskningar, nästa/senaste rapportdatum. |
| `insyn` | `insiderTransactions` (mest USA-bolag) | Köp och sälj senaste 6 mån, nettovärde, insider- och institutionsägande. |
| `jamfor` | v6 recommendationsbysymbol + v7 quote | Upp till fem liknande bolag enligt Yahoo (obs: Yahoos lista bygger delvis på vad andra tittar på, inte strikt bransch) med P/E, forward P/E, P/B, 52-veckorsutveckling; medianer. |
| `bokslut` | timeseries | Fem senaste boksluten: omsättning, vinst, kassaflöde, fritt kassaflöde, VPA, eget kapital, utdelningar, antal aktier. |
| `flaggor`, `opalitlig`, `saknas` | – | Röda flaggor i klartext; `opalitlig: ["vinst"]` när VPA i senaste bokslutet inte går ihop med kursen (P/E < 2 ⇒ engångspost eller datafel – appen hoppar då över vinstbaserade kriterier), `["kurs"]` när kursen är äldre än 7 dagar; `saknas` listar delar som inte gick att hämta. |

Nyckeltal i `varden` och hur de räknas (`null` när underlag saknas – appen gissar aldrig):
- Värdering: `pe` (Yahoo trailing), `pe_forward`, `peg` (Yahoo, annars P/E ÷ prognos nästa år), `ps` = börsvärde ÷ omsättning (båda i redovisningsvalutan), `pb` = kurs ÷ (eget kapital per aktie × växelkurs), `ev_ebitda`, `ev_ebit` (EV = börsvärde + skulder − kassa; tomma när EV ≤ 0), `vinstavkastning` = EBIT/EV (Greenblatt), `fcf_yield` = fritt kassaflöde ÷ börsvärde, `graham` = √(22,5 × VPA × eget kapital/aktie) i kursvalutan, `uppsida` till riktkurs, `pe_median5`, `pe_percentil`, `pe_p90_5`, `pe_jamfor`, `pb_jamfor`.
- Kvalitet: `roe`, `roa`, `roic` = EBIT × 0,78 ÷ investerat kapital (schablonskatt 22 %), `bruttomarginal`, `marginal` (rörelse), `vinstmarginal`, `bruttomarginal_trend` och `marginal_trend` (procentenheter mot föregående bokslut), `vinstkvalitet` = kassaflöde från rörelsen ÷ vinst, `fscore`/`fscore_av`.
- Tillväxt: `oms_tillv`, `tillv` (senaste kvartal å/å), `oms_cagr3`, `vpa_cagr3` (årstakt tre bokslut), `prognos_vinst_i_ar`, `prognos_vinst_nasta_ar`, `prognos_oms_nasta_ar`, `revideringar_netto` (upp − ned 30 d, i år + nästa år), `estimat_90d` (årets VPA-estimat nu mot 90 dagar sedan), `overraskning` (snitt senaste fyra rapporterna).
- Styrka: `skuld` = nettoskuld ÷ EBITDA, `skuld_ek`, `solid`, `rantetackning` = EBIT ÷ räntekostnad, `balanslikviditet`, `kassalikviditet`, `zscore`, `utspadning` (antal aktier mot för ett år sedan), `skuldtrend` (långfristig skuld mot föregående bokslut), `nettokassa` (sant/falskt).
- Utdelning: `da`, `da_5ar`, `utd`, `utdandel`, `utd_tackning` (fritt kassaflöde ÷ utbetald utdelning), `utd_ar_utan_sankning`, `utd_tillvaxt5`.
- Trend & sentiment: `ma50`, `ma200`, `ma200_riktning`, `rsi`, `avk3m/6m/12m`, `rs3m/6m/12m` (procentenheter mot index), `volatilitet`, `hogst52`, `lagst52`, `beta`, `blankning` (% av fria aktier), `insyn_kop6m`, `insyn_salj6m`, `insyn_andel`, `analytiker_antal`, `analytiker_snitt`, `analytiker_andel_kop`, `analytiker_andel_kop_3m`, `riktkurs`, `borsvarde`, `vpa`.

Enheter: belopp per aktie och kurser i kursvalutan (pence för Londonaktier), resultat- och balansposter i redovisningsvalutan (`redovisningsvaluta`), växelkursen räknas in där de möts (börsvärde, P/S, P/B, Graham-tal, P/E-historik).

## Analysmodellen (i appen)
- 55 kriterier fördelade på sex dimensioner, var och en med namn, källa och standardgränser: ett kriterium ger 1 poäng vid "bra"-gränsen eller bättre, 0 vid "dålig"-gränsen eller sämre, linjärt däremellan (RSI bedöms som band: bäst 50–70). Dimensionen är det viktade snittet × 5 och kräver minst två kriterier med data. Gränserna går att ändra under Regler → Analysmodell (riktningen får inte vändas); banker/försäkring/investmentbolag och fastighetsbolag har egna kriterieuppsättningar.
- Ramverk som kriterierna kommer från: Graham (P/E < 15, P/B < 1,5, balanslikviditet > 1,5, Graham-tal), Buffett/Kvalitet (ROE > 15 %, bruttomarginal > 40 %, marginaltrend, kassaflödesvärdering), Greenblatt Magic Formula (EBIT/EV, ROIC), Lynch (PEG < 1, 10–20 % tillväxt), O'Neil/CAN SLIM (kvartals- och årsvinst, relativ styrka), Piotroski F-score, Altman Z-score, Simply Wall St:s fem axlar (värdering mot historik/peers, framtid, historik, hälsa, utdelning), utdelningsinvesterare (andel < 60–70 %, täckning, år utan sänkning, Chowder), Minervini (kurs över MA50/MA200, MA200 stigande, inom 25 % från årshögsta, > 30 % över årslägsta), Wilder (RSI), Zacks-logik (estimatrevideringar).
- Investeringsstilar = vikter per dimension (V, K, T, S, U, M): Balanserad 1/1/1/1/0,5/1 (standard), Värde 2/1/0,5/1/0,75/0,5, Kvalitet/Buffett 1/2/0,75/1,25/0,5/0,25, Tillväxt 0,5/1/2/0,75/0/1, Utdelning 1/1/0,5/1,25/2/0,5, Momentum 0,5/0,5/1/0,5/0/2. Egna vikter ger stilen "Egen". Bolag utan utdelning får 0 i Utdelning bara när dimensionen väger ≥ 1,5, annars lämnas den utanför.
- Poäng 0–100 = viktat snitt av dimensionerna (minst tre måste gå att räkna) ± dina egna regler (+4 per viktsteg för uppfylld köpregel, −4 för säljregel). Köp-dippen-spärren: köpregler på kursnedgång (utveckling mot GAV, avstånd från toppen, kurs under X) släpps bara igenom när Kvalitet och Finansiell styrka båda är ≥ 2,5 av 5.
- Beslut (standardtrösklar, ändringsbara): ≥ 70 Köp mer / Köp, ≥ 50 Behåll / Avvakta, ≥ 35 Minska / Undvik, därunder Sälj / Undvik. Skäl för och emot = de kriterier (och regler) som drar mest, med källa och gräns; röda flaggor kommer från servern.
- Aktier utan Yahoo-symbol bedöms bara med dina regler (50 ± justeringar).

## Facit (beslutslogg)
Varje gång kurser hämtas (och när regler eller innehav ändras) loggar appen en rad per aktie och dag: kurs, beslut och poäng. Raderna ändras aldrig i efterhand. Facit-fliken visar varje tillfälle då beslutet för en aktie ändrades och hur kursen gått sedan dess – hittills samt 1 vecka, 1 månad och 3 månader efteråt (via `/api/historik`). Köpsidan (Köp, Köp mer) räknas som rätt när kursen stigit, säljsidan (Sälj, Minska, Undvik) när den fallit; Behåll/Avvakta/Bevaka visas som jämförelse. Rader före 2026-11-17 kommer från den gamla regelmodellen (poäng −100…+100).

## Datakvalitet från Yahoo
- Londonaktier noteras i pence (GBp) men vinst och utdelning per aktie anges i pund – funktionen räknar om till pence så att P/E och direktavkastning blir rätt.
- Bolag som redovisar i annan valuta än kursen (t.ex. ABB i Stockholm, USD) får felaktiga P/S, P/B och EV/EBITDA hos Yahoo – funktionen räknar egna värden med växelkurs och använder dem när Yahoos avviker mer än 25 %.
- Vissa aktier (t.ex. Plejd) saknar färsk kurs hos Yahoo. Är kursen äldre än 7 dagar markeras aktien "Källan släpar", en kurs du själv skriver in behålls, och kursbaserade mått i analysen räknas om till din kurs.
- Yahoos "liknande bolag" är inte alltid branschkollegor (för NVDA t.ex. Tesla och Amazon); jämförelsen väger därför lätt och bolagen visas så att du kan bedöma den själv.
- Orimlig vinst per aktie i ett bokslut (P/E < 2 mot kursen, t.ex. Xunlei 2025) flaggas och vinstbaserade kriterier hoppas över.
- `dividendYield` hos Yahoo är en andel (0,0061 = 0,61 %) medan `fiveYearAvgDividendYield` redan är i procent.

## Lokal data (localStorage)
- `aktiekompassen-v2` – inställningar, aktier och beslutslogg:
```
logg:     [{ d (datum), id, sym, t (ticker), k (kurs), fx, v (beslut), p (poäng) }]
settings: { metrics: [{ id, namn, enhet, dec, kalla?, grupp? }], rules: [{ id, metric, op, value, signal, vikt, aktiv, namn }], kopTroskel, saljTroskel,
            modell: { stil, vikter: { V, K, T, S, U, M }, troskel: { kop, behall, minska }, spar, sparNiva, granser: { <kriterieId>: { bra, dalig } } } }
stocks:   [{ id, ticker, symbol, namn, lista, valuta, fxSek, antal, gav, kurs, kursDatum, kursTid, forandring, hamtad, fel, varning,
             varden: { <metricId>: number }, las: { <metricId>: true }, regler: [...], anteckning, transaktioner: [...], exempel, updatedAt }]
```
- `aktiekompassen-hist` – kurshistorik per symbol för facit.
- `aktiekompassen-analys` – dagens analysunderlag per symbol (`{ hamtad, data }`), rensas från aktier som tagits bort.

Säkerhetskopia (JSON) går att ta och läsa in under Regler → Data. Vid uppgradering från regelmodellen tas standardregler som modellen täcker (P/E, direktavkastning, soliditet, vinsttillväxt, riktkurs, skuld) bort om de är oförändrade; egna och ändrade regler behålls.

## Läs in innehav via länk
`https://upperia.github.io/policy/aktiekompassen/?innehav=SYMBOL:ANTAL:GAV,SYMBOL:ANTAL:GAV,…` öppnar appen med en bekräftelseruta och lägger till (eller uppdaterar) aktierna. GAV anges i samma enhet som Yahoo använder för symbolen (Londonaktier i pence, t.ex. `RR.L:20:1200`). Inget sparas i länken – den används bara i den enhet där den öppnas.

## Tester
Playwright-tester mot mockat API (fixturen ovan) finns i arbetsmappen (`modelltest.mjs`, `facittest.mjs`, `uitest.mjs`); funktionens logik testas i Node med mockad `fetch` (`node --experimental-strip-types analystest.mts`). Live-verifiering görs i webbläsaren mot de riktiga innehaven.
