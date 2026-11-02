# Aktiekompassen

Webbapp för den egna aktieportföljen: nyckeltal per aktie, köp- och säljregler med vikt, och en kompass som visar beslutsläget. All portföljdata sparas lokalt i mobilen (webbläsarens lagring). Kurser och nyckeltal hämtas automatiskt från Yahoo Finance via en liten serverfunktion.

- App: https://upperia.github.io/policy/aktiekompassen/ (GitHub Pages – lägg till på hemskärmen så blir den en app). En push till `main` uppdaterar appen inom någon minut.
- Filerna i den här mappen är appen: `index.html`, `manifest.webmanifest`, `sw.js` (service worker för offline), ikoner.
- `function/` – Supabase Edge Function `aktiekompassen` (projekt Answer-to-question, Deno). `lib.ts` pratar med Yahoo Finance, `index.ts` sköter API-routing. Deployas med Supabase MCP/CLI; behöver bara deployas om när funktionen ändras.
- API-bas: https://pxskckkdftnknqcgpbng.supabase.co/functions/v1/aktiekompassen/api (CORS öppet, så appen kan ligga var som helst – även öppnas lokalt).

## API
- `GET /api/sok?q=investor` → `[{ symbol, namn, bors, typ }]` (Stockholm först)
- `GET /api/aktie?symbol=INVE-B.ST` → kurs, valuta, växelkurs till SEK och nyckeltal (`vpa, utd, da, pe, pe_forward, ps, pb, tillv, oms_tillv, roe, marginal, vinstmarginal, skuld, skuld_ek, solid, ev_ebitda, utdandel, hogst52, lagst52, riktkurs, borsvarde, beta`)
- `GET /api/status`

Anropen görs med headern `x-region: us-east-1` så att funktionen körs i USA (Yahoo kräver en session som inte går att få från EU-adresser).

## Beräkningsmodell
Regel = nyckeltal + villkor (<, <=, >, >=) + gränsvärde + Köp/Sälj + vikt 1–3. Köpandel = uppfylld köpvikt / all köpvikt som går att räkna på, säljandel på samma sätt. Poäng = köpandel − säljandel. Köp ≥ köptröskel, Sälj ≤ −säljtröskel, Bevaka om någon regel slår utan att nå tröskeln, annars Behåll.

## Lokal data (localStorage, nyckel `aktiekompassen-v2`)
```
settings: { metrics: [{ id, namn, enhet, dec, kalla?, grupp? }], rules: [{ id, metric, op, value, signal, vikt, aktiv, namn }], kopTroskel, saljTroskel }
stocks:   [{ id, ticker, symbol, namn, lista, valuta, fxSek, antal, gav, kurs, kursDatum, kursTid, forandring, hamtad, fel, varning,
             varden: { <metricId>: number }, las: { <metricId>: true }, regler: [...], anteckning, transaktioner: [...], exempel, updatedAt }]
```
Säkerhetskopia (JSON) går att ta och läsa in under Regler → Data.

## Läs in innehav via länk
`https://upperia.github.io/policy/aktiekompassen/?innehav=SYMBOL:ANTAL:GAV,SYMBOL:ANTAL:GAV,…` öppnar appen med en bekräftelseruta och lägger till (eller uppdaterar) aktierna. GAV anges i samma enhet som Yahoo använder för symbolen (Londonaktier i pence, t.ex. `RR.L:7:1199`). Inget sparas i länken – den används bara i den enhet där den öppnas.
