# Rapporter på igred.org: oppsett og første innlogging

Rapportene skrives i Decap CMS på igred.org/admin og lagres som Markdown i
`www/content/reports/`. Netlify bygger sidene og PDF-ene når en rapport publiseres.
Utkast ligger som grener (`cms/...`) og bygger aldri produksjonssiden.

## For Erlend: GitHub OAuth-appen (én gang, etter 14. oktober)

1. **Lag OAuth-appen.** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Application name: `Varde redaksjon`
   - Homepage URL: `https://igred.org`
   - Authorization callback URL: `https://api.netlify.com/auth/done`
   Trykk Register application.
2. **Hent nøklene.** Kopier Client ID. Trykk Generate a new client secret og kopier den med en
   gang; GitHub viser den bare én gang.
3. **Koble appen til Netlify.** Netlify → igred.org-siden → Site configuration → Access &
   security → OAuth → Install provider → GitHub. Lim inn Client ID og Client secret → Install.
4. **Gi Viktor skrivetilgang.** GitHub → `bridgeerlend/igred-warmap` → Settings →
   Collaborators → Add people → Viktors GitHub-brukernavn, rolle Write. Editoren lager grener og
   pull requests i hans navn, så han trenger skrivetilgang.
5. **Slå av forhåndsvisninger i Netlify også** (netlify.toml gjør det allerede, dette er
   ekstra sikring): Site configuration → Build & deploy → Continuous deployment →
   Deploy Previews: *Don't deploy pull requests*; Branch deploys: *Deploy only the production branch*.
6. **Slå sammen grenen.** `reports` ligger klar lokalt. Etter 14. oktober:
   `git checkout main && git merge reports && git push`. Det første bygget installerer
   Chromium for PDF-ene og tar et par minutter lenger enn vanlig.
7. **Test** at igred.org/reports og igred.org/admin svarer, og logg inn selv først.

## For Viktor: første innlogging

1. Du trenger en GitHub-konto. Godta invitasjonen til `bridgeerlend/igred-warmap` som kommer
   på e-post (eller på github.com/notifications).
2. Gå til **igred.org/admin** og trykk **Logg inn med GitHub**. Godkjenn appen
   «Varde redaksjon» første gang.
3. Velg **Analyser** eller **Halvårsrapporter** til venstre, og trykk **+ Analyse**
   (eller **+ Halvårsrapport**).
4. Skriv i feltene. Du kan lime inn fra Word og Google Docs; overskrifter, fet, kursiv,
   lenker og lister blir med.
5. **Byggeklosser** settes inn med **+** i verktøylinjen over teksten: Nøkkeltall, Graf,
   Tabell, Risikoscore, Lite kart, Sitat, Fotnote og Kildeliste. Graf og kart velger du krise
   eller land og periode for; tallene hentes fra kartet når rapporten publiseres og står
   fast etterpå. En tabell kan limes rett inn fra Excel eller Sheets.
6. **Fotnoter:** skriv `[^1]` i teksten der tallet skal stå, og sett inn en Fotnote-kloss med
   merket `1` og teksten. Nummereringen i rapporten ordnes av seg selv.
7. **Lagre** gjør teksten til et utkast. Ingenting blir publisert av å lagre.
8. **Arbeidsflyt** (øverst) viser utkastene. Flytt kortet fra utkast til gjennomgang og
   til klar. Den andre av oss leser før **Publiser**.
9. **Publiser** legger rapporten ut. Etter to til tre minutter ligger den på
   igred.org/reports med egen side og PDF.
10. **Retter du en publisert rapport:** øk versjonen (1.0 → 1.1) og skriv i teksten hva som
    er rettet.

Hver publisering er ett Netlify-bygg. Utkast og lagring koster ingenting.
