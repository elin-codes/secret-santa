# Secret Santa-hjul for familien – design

## Hvorfor
En søt, julete og litt gimmicky side der familien trekker hvem de skal være Secret Santa for.
Én felles lenke i familiechatten. Det skal være gøy å se på (nisser som koker og rører),
og det skal være umulig å trekke samme navn to ganger eller titte på andres.

## Mål
- Én felles lenke, hostet gratis på GitHub Pages.
- Flyt: åpne lenke → «Bli med i Secret Santa» → velg navnet ditt → skriv e-post →
  få 4-sifret kode på e-post → skriv koden → nisser koker og rører → navnet trekkes.
- Samtidig kommer en e-post: «Du er Secret Santa for X».
- Kommer du tilbake, ser du samme navn.
- Ingen trekker seg selv, ingen blir trukket to ganger.
- Elin (eieren) kan være med uten å se noen av parene.

## Ikke-mål
- Ingen bilder (Elin droppet dem).
- Ingen admin-side; endringer gjøres i skriptet.
- Ingen ønskeliste eller chat.

## Anti-mål (feil selv om det «virker»)
- At to personer kan få samme navn.
- At man kan se hvem andre har trukket bare ved å skrive inn noe.
- At oppsettet blir så knotete at Elin gir opp.

## Begrensninger
- GitHub Pages er statisk og offentlig: ingen hemmeligheter i sidens kode.
- Backend må være gratis og ligge i Elins egen konto: Google Apps Script (MailApp, 100 e-poster/dag).

## Tilnærminger vurdert
1. **Forhåndsberegnede par + personlige lenker** – ingen backend, men krever å sende én lenke per person.
   Forkastet: Elin vil ha én felles lenke og e-post.
2. **Skriv e-post på siden, uten verifisering** – enkelt, men alle kan titte på andres ved å skrive deres e-post,
   og siden kan ikke sende e-post selv. Forkastet.
3. **Valgt: GitHub-side + Google Apps Script («nissens postkontor»)** – skriptet i Elins Google-konto holder parene,
   sender engangskode og resultat-e-post fra Elins Gmail. Elin valgte dette, med kodesteget.

## Deltakere (16)
Mormor & Morfar, Malin, Kent, Gabriel, Dina, Anton, Elin, Moa, Judith, Peter, Anna, Liv, Nicke, Signe, Malte, Susanna

## Hvordan det virker
- **Siden** (`index.html`, `style.css`, `app.js`, `config.js`): ren HTML/CSS/JS, ingen byggesteg.
  Snø, juleplakat, SVG-nisser rundt en grøtgryte. Snakker med skriptet via `fetch` (POST, text/plain → ingen CORS-preflight).
- **Skriptet** (`apps-script/Code.gs`), deployet som web-app («Kjør som: meg», «Tilgang: alle»):
  - `names` → liste over deltakere og om navnet er tatt.
  - `requestCode {name, email}` → lager 4-sifret kode (gyldig 10 min) og sender den på e-post.
  - `verify {name, email, code}` → låser navnet til e-posten, returnerer en innloggingsnøkkel og hvem man har trukket,
    sender resultat-e-posten første gang.
  - `me {token}` → gir samme resultat ved nytt besøk.
- **Trekningen** skjer én gang, første gang noen trenger den, som én stor ring (A→B→C→…→A).
  Da trekker ingen seg selv, ingen trekkes to ganger, og ingen to trekker hverandre.
  Parene lagres i skriptets egenskaper, base64-kodet så Elin ikke ser dem ved et uhell.
- **Nettleseren** husker innloggingsnøkkelen (localStorage), så nytt besøk på samme enhet viser navnet direkte.
- **Demo-modus**: står `BACKEND_URL` tom i `config.js` (eller `?demo` i adressen), kjører siden mot en falsk backend i nettleseren,
  så man kan se animasjonen uten oppsett.

## Mine valg (Elin kan endre)
- **Ingen e-postliste nødvendig:** hver person velger navnet sitt og skriver sin egen e-post første gang.
  Koden beviser at e-posten er deres, og navnet låses til den e-posten. Samme e-post kan brukes på flere navn
  (Elin valgte dette, for familiemedlemmer uten egen e-post); den som eier innboksen ser da alle de trekningene.
  Prøver noen et navn som er tatt, får de beskjed om å si fra til Elin, som kan låse det opp i skriptet.
- **Mormor & Morfar er én deltaker** (de trekker én og får én gave sammen).
- **Ring-trekning** i stedet for helt tilfeldig, for å unngå at to trekker hverandre.
- **Tekst på norsk**, nisser i stedet for alver.
- **Vern:** maks 5 feil kodeforsøk per kode, maks 5 koder per navn per time, og lås (LockService) rundt trekning og låsing.
- **Hjelpefunksjoner i skriptet:** `slippNavn(navn)` låser opp et navn, `nullstillAlt()` sletter trekningen og alle låser.
