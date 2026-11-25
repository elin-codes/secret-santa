# Secret Santa-hjul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Christmassy one-link Secret Santa page on GitHub Pages where each family member logs in with an emailed code, watches nisser cook, and sees (and gets emailed) who they drew.

**Architecture:** Static page at repo root (`index.html`, `style.css`, `app.js`, `config.js`, `fake-backend.js`) talks to a Google Apps Script web app (`apps-script/Code.gs`) via `fetch` POST with a text/plain JSON body. All draw/claim/code logic lives in `Code.gs`. Demo mode loads the very same `Code.gs` in the browser with stubbed Google services, so the page can be tried without setup.

**Tech Stack:** Plain HTML/CSS/JS (no build), inline SVG + CSS animations, Google Apps Script (PropertiesService, CacheService, MailApp, LockService, Utilities), Node 18+ `node:test` + `node:vm` for backend tests.

**Spec:** `docs/2026-11-25-secret-santa-design.md`

## Global Constraints

- Participants (16, exact strings): `Mormor & Morfar`, `Malin`, `Kent`, `Gabriel`, `Dina`, `Anton`, `Elin`, `Moa`, `Judith`, `Peter`, `Anna`, `Liv`, `Nicke`, `Signe`, `Malte`, `Susanna`.
- All user-facing copy in Norwegian; "Secret Santa" stays in English; figures are nisser.
- Code: 4 digits, valid 10 min, max 5 wrong tries per code, max 5 codes per name per hour.
- One email ↔ one name. Draw is one ring, created once, stored base64 in script property `pairs`.
- No secrets in the static site. No build step, no npm dependencies.
- Repo root is served by GitHub Pages as-is.
- No git until Task 4 (fresh repo created for publishing).

## Review Focus

1. Email typed differently on a later visit (`Kent@Gmail.com ` vs `kent@gmail.com`) → same person. Test in Task 1.
2. Visitor requests a code, leaves, requests again → newest code works, old one does not. Test in Task 1.
3. Pairs requested by many verifies → created exactly once and never change. Test in Task 1.
4. Backend URL wrong / Apps Script returns HTML (wrong "who has access") → page shows a friendly Norwegian error, never hangs in the animation. Browser check in Task 2.
5. Device holds an old token after `nullstillAlt()` → `me` returns `bad_token`, page forgets the token and shows the welcome screen. Test in Task 1 + browser check in Task 2.

---

### Task 1: Backend (`Code.gs`) with tests

**Files:**
- Create: `apps-script/Code.gs`
- Test: `tests/code.test.mjs` (loads `Code.gs` into a `vm` context with in-memory stubs for PropertiesService, CacheService, MailApp, LockService, Utilities, ContentService; captured mails expose the code)

**Interfaces:**
- Produces (globals in `Code.gs`, all function declarations so `vm`/indirect-eval exposes them):
  - `PARTICIPANTS: string[]`, `SITE_URL: string` (''), `SENDER_NAME = 'Nissens verksted'`
  - `makeRing(names: string[], rand: () => number): Record<string,string>` — Fisher–Yates shuffle, then `s[i] → s[(i+1) % n]`
  - `normEmail(email: string): string` — trim + lowercase
  - `handle(req: object): object` — returns `{ok:true,...}` or `{ok:false, error}`; errors: `unknown_name`, `bad_email`, `name_taken`, `email_used`, `too_many_codes`, `code_expired`, `bad_code`, `too_many_tries`, `bad_token`, `unknown_action`
    - `{action:'names'}` → `{ok, names:[{name, taken}]}`
    - `{action:'requestCode', name, email}` → `{ok}`; mails code (subject contains the 4 digits)
    - `{action:'verify', name, email, code}` → `{ok, token, giver, receiver}`; first success per name mails result
    - `{action:'me', token}` → `{ok, giver, receiver}`
  - `doPost(e)`, `doGet(e)` → JSON via ContentService
  - Elin's helpers: `sjekkOppsett()`, `slippNavn(name)` (removes claim + that name's tokens), `nullstillAlt()`
- Storage keys: properties `claim:<name>`=email, `email:<email>`=name, `token:<uuid>`=name, `mailed:<name>`='1', `pairs`; cache `code:<name>`=JSON `{email, code, tries}` (600 s), `rate:<name>` (3600 s).

- [ ] **Step 1: Write failing tests**
  - `makeRing`: for 16 names and 200 seeds → every name gives once and receives once, nobody self, no mutual pair.
  - `names` lists 16, all `taken:false`.
  - full flow: `requestCode` → read code from captured mail → `verify` → `receiver` ∈ PARTICIPANTS, ≠ giver; one result mail sent; `me(token)` returns same pair.
  - Review Focus 1: verify with `' KENT@Gmail.com '` after claiming with `kent@gmail.com` succeeds.
  - Review Focus 2: two `requestCode` in a row → first code gives `code_expired`/`bad_code`, second works.
  - Review Focus 3: verifying 3 different people → `me` for the first still returns the same receiver; `pairs` property unchanged after first creation.
  - Review Focus 5: after `nullstillAlt()`, `me(oldToken)` → `bad_token`.
  - `name_taken` (other email on claimed name), `email_used` (same email, second name), `unknown_name`, `bad_email`, `too_many_tries` after 5 wrong codes, `too_many_codes` on 6th request within the hour, second verify does not send a second result mail, `slippNavn` frees the name and kills its token.
- [ ] **Step 2: Run** `node --test tests/` → FAIL (file missing)
- [ ] **Step 3: Implement `apps-script/Code.gs`.** Wrap claim + pair creation in `LockService.getScriptLock().waitLock(10000)`. Code via `Math.floor(Math.random()*10000)` padded to 4. Emails as small HTML (red/green, 🎅), `name: SENDER_NAME`; result mail links `SITE_URL` when set.
- [ ] **Step 4: Run** `node --test tests/` → all PASS

### Task 2: Page flow + demo backend

**Files:**
- Create: `index.html`, `config.js`, `fake-backend.js`, `app.js`, `style.css` (layout only here)

**Interfaces:**
- Consumes: `handle(req)` contract from Task 1.
- Produces: `window.SANTA_CONFIG = { BACKEND_URL: '' }`; `window.createFakeBackend(onMail: (mail)=>void): Promise<{call(req): Promise<object>}>` (fetches `apps-script/Code.gs`, indirect-evals it after installing localStorage-backed stubs under prefix `santa.demo.`); `app.js` `api(req): Promise<object>` (demo when `BACKEND_URL` empty or `?demo` in URL; else `fetch(BACKEND_URL, {method:'POST', body: JSON.stringify(req)})`, non-JSON/network failure → `{ok:false, error:'network'}`).
- Screens (sections, one visible): `welcome` → `name` (button grid; taken names dimmed) → `email` → `code` → `cooking` → `reveal`. localStorage `santa.token` (demo: `santa.demo.token`). Load with token → `me` → `reveal` directly with «Se nissene koke igjen»; `bad_token` → clear → `welcome`.
- Demo shows mails as a toast: «📬 Demo-e-post til …: …».

- [ ] **Step 1:** Build files; every error code maps to one Norwegian sentence (e.g. `name_taken`: «Dette navnet er allerede tatt. Si fra til Elin, så fikser hun det.»).
- [ ] **Step 2: Verify in browser (demo):** full flow Kent → code from toast → reveal; reload → same name without animation; pick Kent from a second "device" (clear `santa.demo.token` only) with another email → `name_taken` message.
- [ ] **Step 3: Verify Review Focus 4:** set `BACKEND_URL` to `https://example.com/nope` → friendly error, back to the form, no spinner stuck.

### Task 3: Christmas look and nisse animation

**Files:**
- Modify: `index.html` (inline SVG scene: two nisser with ladles around a grøtgryte over a fire, steam, name slips), `style.css`, `app.js` (`playCooking(): Promise<void>`)

**Interfaces:**
- Consumes: screen switching from Task 2. `playCooking()` resolves after ~9 s (≈1.5 s when `prefers-reduced-motion`).
- Timeline: slips with all names fall into the pot (≈2 s) → nisser stir fast, pot bubbles, status text rotates «Nissene rører i grøten…», «Litt mer kanel…», «Smaker til…», «Noe dukker opp!» (≈5 s) → pot wobbles, one slip rises (≈2 s) → `reveal`: scroll unrolls «Du er Secret Santa for» + big name, snow/confetti burst, «Vi har også sendt navnet til e-posten din. Hysj! 🤫».
- Look: deep red/green night with falling snow, cream cards, gold accents, rounded friendly font (Google Fonts `Fredoka` + `Mountains of Christmas` for headings, system fallback). Must fit 375 px wide.

- [ ] **Step 1:** Draw SVG + CSS keyframes; wire `playCooking()` between verify and reveal.
- [ ] **Step 2: Verify in browser:** full demo run looks right on desktop and at 375×812; screenshot each phase.

### Task 4: Setup guide and publish prep

**Files:**
- Create: `README.md` (Norwegian, step by step: Apps Script — new project, paste `Code.gs`, run `sjekkOppsett` and allow, Deploy → Web app, Execute as Me, Anyone, copy URL → `config.js`; GitHub — new public repo, upload, Settings → Pages → main / root; then put the Pages URL in `SITE_URL` and redeploy; how to `slippNavn`/`nullstillAlt`; "ikke kikk i Script properties"), `.gitignore`
- [ ] **Step 1:** Write README.
- [ ] **Step 2:** `git init -b main`, commit everything.
- [ ] **Step 3:** Run `node --test tests/` and a final demo run in the browser.
