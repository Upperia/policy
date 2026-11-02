# Aktiekompassen

Webbapp för den egna aktieportföljen: nyckeltal per aktie, köp- och säljregler med vikt, och en kompass som visar beslutsläget. All portföljdata sparas lokalt i mobilen (webbläsarens lagring). Kurser och nyckeltal hämtas automatiskt från Yahoo Finance via en liten serverfunktion.

- App: https://pxskckkdftnknqcgpbng.supabase.co/functions/v1/aktiekompassen/ (lägg till på hemskärmen så blir den en app)
- `public/` – appen (index.html, manifest, service worker, ikoner). Serveras av funktionen direkt från den här mappen på GitHub, så en push hit räcker för att uppdatera appen.
- `function/` – Supabase Edge Function `aktiekompassen` (Deno). `lib.ts` pratar med Yahoo Finance, `index.ts` sköter routing och serverar filerna i `public/`. Deployas med Supabase MCP/CLI; behöver bara deployas om när funktionen ändras, inte när appen ändras.

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
