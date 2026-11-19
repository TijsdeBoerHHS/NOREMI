# NO-RE-MI – tablet-webapp (PWA), prototype

Pratende foto's van naasten voor mensen met dementie. Gebouwd volgens het plan van aanpak, het
keuzeonderzoek (Azure Speech + D-ID) en het onderzoeksdocument (AVG, AI-label, geen stem van overledenen).

## Starten

De app heeft geen build-stap. Een PWA (service worker, microfoon, lokale opslag) werkt alleen via **https** of `localhost`.

- Lokaal proberen: `python3 -m http.server 8080` in deze map, open daarna <http://localhost:8080>.
- Op een iPad: zet de map online met https (bijvoorbeeld GitHub Pages of Netlify), open de link in Safari,
  kies *Deel* → *Zet op beginscherm*. De app draait dan schermvullend en werkt daarna ook offline.

## Schermen

| Scherm | Wat het doet |
|---|---|
| **Start** | Raster met foto's en bijschrift (bijv. "Erica, vrouw van Erik"), naam van de bewoner rechtsboven, "ICT Praktijk Academie" onderaan. |
| **Persoon** | Grote foto. Tik op de foto of op *Afspelen*. De foto wordt een pratende video; label "Gemaakt met AI – geen echte opname" staat er altijd op. |
| **Beheer** | Alleen met pincode (standaard **1234**, wijzig die bij Instellingen). Personen toevoegen, bewerken, ordenen, verwijderen (met bevestiging); instellingen; voorbeeldpersonen laden. |

Beheer sluit zichzelf na 5 minuten zonder aanraking en na het verlaten van het scherm. Na 5 foute pincodes
is de pincode 30 seconden geblokkeerd.

## Twee werkwijzen (Instellingen → Werkwijze)

- **AI** (zoals gekozen in het keuzeonderzoek): de begeleider maakt per persoon de video in Beheer
  (*Opslaan en video maken*): Azure maakt de stem, D-ID maakt de pratende video. Die wordt op de tablet bewaard,
  zodat afspelen direct gaat. Is er geen video, dan gebeurt er niets (knop uit, melding "Dit bericht is nog niet klaar").
  Vul daarvoor een Azure Speech-sleutel (+ regio, stem `nl-NL-FennaNeural`) en een D-ID API-sleutel in.
- **Demo** (alleen testfunctie): een rustige beweging van de foto, zonder lipsync en zonder D-ID. De stem komt van Azure zodra een Azure-sleutel is ingevuld (de stem wordt bij opslaan gemaakt en bewaard); zonder sleutel gebruikt Demo de systeemstem van de tablet (te kiezen onder Instellingen → Systeemstem). Het keuzeonderzoek
  wees beide af (onder de ondergrens), dus dit is **niet de gekozen aanpak**. Het is er om de app zonder sleutels te kunnen testen
  en is bewust géén terugval voor de AI-modus. Vermeld dit zo in het verslag.

Per persoon kies je in de editor een Nederlandse stem: Fenna of Colette (vrouw) of Maarten (man). Azure heeft voor nl-NL alleen deze drie.

Een eigen opgenomen stem (van iemand die nog leeft) gaat in plaats van de Azure-stem naar D-ID (omgezet naar WAV).

## Eisen uit het plan van aanpak

- Tekst minimaal 20 pt: basisgrootte 27 px (= 20 pt), niets kleiner.
- Knoppen minimaal 44 pt: minimaal 60 px hoog en breed.
- Patiënt kan niets wijzigen of wissen: alleen Start en Persoon zijn zonder pincode bereikbaar; lang indrukken, zoomen en
  verslepen zijn uitgezet.
- AI-label op elk bericht; toestemmingsvinkje per persoon; waarschuwing dat foto en tekst naar Microsoft en D-ID gaan.
- Lokale opslag (IndexedDB) van personen, foto's, tekst, opgenomen stem en video's. Geen accounts, geen backend.

## Bestanden

`index.html` · `styles.css` · `app.js` (schermen) · `db.js` (opslag) · `ai.js` (Azure + D-ID) · `sw.js` (offline) ·
`manifest.webmanifest` · `icons/`

## Beperkingen

- De koppelingen met Azure en D-ID zijn getest met nagebootste antwoorden, **niet met echte sleutels**. Een echte proefrun
  is nodig. Mogelijke haken: CORS bij D-ID of het ophalen van het eindbestand (dan bewaart de app het adres, dat na een dag verloopt).
- API-sleutels staan in de lokale opslag van de tablet. Voor een echte inzet is een backend nodig.
- De voorbeeldportretten zijn getekende silhouetten; D-ID herkent daarop geen gezicht. Gebruik voor echte tests een foto met een duidelijk gezicht.
- Getest in Chromium; nog niet op een echte iPad met Safari (opnemen en spraak kunnen daar afwijken).
