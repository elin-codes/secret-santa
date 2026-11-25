# 🎅 Familiens Secret Santa

Én lenke til hele familien. Hver person trykker **Bli med i Secret Santa**, velger navnet sitt,
skriver inn e-posten sin og får en 4-sifret kode. Så koker nissene julegrøt, og navnet du skal
være Secret Santa for dukker opp av gryta. Navnet sendes også på e-post.

- Ingen trekker seg selv, ingen blir trukket to ganger, og ingen to trekker hverandre.
- Kommer man tilbake, ser man samme navn.
- Koden går bare til den som eier e-posten, så ingen kan titte på andres.
- Trekningen ligger skjult i Google-kontoen din, så du kan være med selv.

Siden ligger på GitHub Pages (gratis). «Hjernen» er et lite Google-skript i din egen
Google-konto, som husker trekningen og sender e-postene fra Gmailen din (gratis, 100 e-poster per dag).

## Prøv demoen

Så lenge `BACKEND_URL` i `config.js` er tom, kjører siden i demo-modus: ingen ekte e-post,
og koden vises i en boble nederst på siden. Knappen **Nullstill demo** sletter demo-trekningen.
Legger du `?demo` bak lenken, får du demoen også etter at alt er satt opp.

## Oppsett (ca. 10 minutter)

### 1. Google-skriptet

1. Gå til <https://script.google.com> og logg inn med Google-kontoen e-postene skal sendes fra.
2. Trykk **Nytt prosjekt** (New project) og kall det «Secret Santa».
3. Slett alt i `Code.gs` og lim inn hele innholdet fra [`apps-script/Code.gs`](apps-script/Code.gs).
4. Fyll inn `SITE_URL` øverst med lenken til GitHub-siden når du har den (valgfritt, gir en lenke i e-posten).
5. Lagre (💾). Velg funksjonen **sjekkOppsett** i nedtrekksmenyen øverst og trykk **Kjør** (Run).
   Google ber om tillatelse til å sende e-post:
   **Gjennomgå tillatelser** → velg kontoen din → «Google har ikke bekreftet denne appen» →
   **Avansert** → **Gå til Secret Santa** → **Tillat**. Det er ditt eget skript, så det er trygt.
6. Trykk **Implementer → Ny implementering** (Deploy → New deployment), velg tannhjulet og **Nettapp** (Web app):
   - Kjør som (Execute as): **Meg**
   - Hvem har tilgang (Who has access): **Alle** (Anyone)
7. Trykk **Implementer** og kopier nettapp-lenken. Den slutter på `/exec`.

### 2. Koble siden til skriptet

Lim inn lenken i `config.js`:

```js
window.SANTA_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/.../exec',
};
```

### 3. GitHub Pages

1. Lag et nytt **offentlig** repo på GitHub, for eksempel `secret-santa`, og last opp alle filene.
2. Gå til **Settings → Pages**, velg **Deploy from a branch**, branch **main** og mappe **/ (root)**, og trykk **Save**.
3. Etter et minutt eller to ligger siden på `https://<brukernavnet-ditt>.github.io/secret-santa/`.

> Siden og filene er offentlige, også navnene på deltakerne. Hvem som har trukket hvem ligger bare i Google-kontoen din.

### 4. Test før du deler

Logg inn med ditt eget navn og din egen e-post. Da ser du din egen trekning, og ingen andres.
Kommer koden fram og nissene koker, er alt klart. Del lenken i familiechatten. 🎄

## Når noe går galt

Alle hjelpefunksjonene kjøres fra Google-skriptet: velg funksjonen øverst og trykk **Kjør**.

| Hva skjedde | Gjør dette |
|---|---|
| Noen har tatt feil navn | Skriv navnet inn i `slippEtNavn` (bytt ut `SKRIV NAVNET HER`) og kjør den. Den rette personen kan logge inn igjen, og trekningen er den samme. |
| Noen fikk ikke koden | Be dem sjekke søppelpost. De kan trykke «send en ny kode» (maks 5 i timen). |
| «Deltakerlista er endret» | Du har endret `PARTICIPANTS` etter at trekningen ble gjort. Kjør `nullstillAlt`, så må alle trekke på nytt. |
| Dere vil starte helt på nytt | Kjør `nullstillAlt`. Alle innlogginger og trekningen slettes. |
| Du har endret i `Code.gs` | **Implementer → Administrer implementeringer** → blyanten → Versjon: **Ny versjon** → **Implementer**. Lenken blir den samme. |

**Ikke kikk i «Script properties»** under prosjektinnstillingene. Der ligger trekningen (kodet, men ikke hemmelig).

## Filer

| Fil | Hva |
|---|---|
| `index.html`, `style.css`, `app.js` | Siden med nissene og grøtgryta |
| `config.js` | Lenken til Google-skriptet |
| `apps-script/Code.gs` | Google-skriptet: deltakere, trekning, koder og e-post |
| `fake-backend.js` | Demo-modus: kjører `Code.gs` i nettleseren uten Google |
| `tests/code.test.mjs` | Tester for skriptet: `node --test tests/*.test.mjs` |
