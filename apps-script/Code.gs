/**
 * 🎅 Nissens verksted – backend for familiens Secret Santa.
 *
 * Lim inn hele denne filen i et Google Apps Script-prosjekt og deploy som web-app
 * (Kjør som: meg, Tilgang: alle). Se README.md for steg-for-steg.
 *
 * Hvem som har trukket hvem lagres skjult i skriptets egenskaper.
 * Ikke kikk i «Script properties», da ødelegger du overraskelsen for deg selv!
 */

// ---------- Endre her ----------

const PARTICIPANTS = [
  'Mormor & Morfar', 'Malin', 'Kent', 'Gabriel', 'Dina', 'Anton', 'Elin', 'Moa',
  'Judith', 'Peter', 'Anna', 'Liv', 'Nicke', 'Signe', 'Malte', 'Susanna', 'Elin S',
];

// Valgfritt: lås et navn til én bestemt e-post, så ingen andre kan ta det.
// Navn som ikke står her, kan tas av den første som bekrefter med kode.
// Eksempel: 'Kent': 'kent@gmail.com',
const KNOWN_EMAILS = {
};

// Lenken til GitHub-siden (fylles inn når siden er publisert). Brukes i e-postene.
const SITE_URL = 'https://elin-codes.github.io/secret-santa/';

const SENDER_NAME = 'Nissens verksted';

// ---------- Hjelpefunksjoner du kan kjøre selv i editoren ----------

/** Kjør én gang etter at du har limt inn skriptet, for å gi tillatelse til å sende e-post. */
function sjekkOppsett() {
  const quota = MailApp.getRemainingDailyQuota();
  const drawn = props_().getProperty('pairs') ? 'ja' : 'nei (skjer når første person logger inn)';
  const msg = 'Deltakere: ' + PARTICIPANTS.length + ' | E-poster igjen i dag: ' + quota + ' | Trekning gjort: ' + drawn;
  Logger.log(msg);
  return msg;
}

/** Bytt ut navnet under og kjør denne hvis noen har tatt feil navn. */
function slippEtNavn() {
  slippNavn('SKRIV NAVNET HER');
}

/** Låser opp et navn slik at riktig person kan logge inn. Trekningen beholdes. */
function slippNavn(name) {
  const p = props_();
  p.deleteProperty('claim:' + name);
  p.deleteProperty('mailed:' + name);
  const all = p.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('token:') === 0 && all[key] === name) p.deleteProperty(key);
  });
  Logger.log('Låste opp: ' + name);
}

/**
 * NØDKNAPP: viser hele trekningen (hvem som har hvem, og hvem som har logget inn) i kjøreloggen.
 * Da ser du også hvem DU har fått, så bruk den bare hvis noe har gått galt.
 */
function visTrekningen() {
  const p = props_();
  const pairs = readPairs_(p);
  if (!pairs) {
    Logger.log('Ingen trekning ennå. Den skjer når første person logger inn.');
    return 'Ingen trekning ennå.';
  }
  const text = PARTICIPANTS.map(function (name) {
    const email = p.getProperty('claim:' + name);
    if (!pairs[name]) return name + ' → (ny, kommer med i trekningen når noen logger inn)';
    return name + ' → ' + pairs[name] + (email ? '  (logget inn: ' + email + ')' : '  (ikke logget inn ennå)');
  }).join('\n');
  Logger.log(text);
  return text;
}

/** Sletter ALT: trekningen, alle innlogginger. Bruk bare hvis dere vil starte helt på nytt. */
function nullstillAlt() {
  props_().deleteAllProperties();
  Logger.log('Alt er nullstilt. Ny trekning skjer når første person logger inn.');
}

// ---------- Web-app ----------

const CODE_TTL_SECONDS = 600;
const MAX_TRIES = 5;
const MAX_CODES_PER_HOUR = 5;

function doGet() {
  return json_({ ok: true, status: 'open' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_(fail_('bad_request'));
  }
  if (!req || typeof req !== 'object') return json_(fail_('bad_request'));
  return json_(handle(req));
}

function handle(req) {
  try {
    switch (req.action) {
      case 'names': return listNames_();
      case 'requestCode': return requestCode_(req.name, req.email);
      case 'verify': return verify_(req.name, req.email, req.code);
      case 'me': return me_(req.token);
      default: return fail_('unknown_action');
    }
  } catch (err) {
    console.error(err);
    return fail_('server_error');
  }
}

// ---------- Logikk ----------

/** Stokker navnene og lager én ring: hver person gir til den neste. */
function makeRing(names, rand) {
  const s = names.slice();
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = s[i]; s[i] = s[j]; s[j] = tmp;
  }
  const ring = {};
  for (let i = 0; i < s.length; i++) ring[s[i]] = s[(i + 1) % s.length];
  return ring;
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function listNames_() {
  const p = props_();
  return {
    ok: true,
    names: PARTICIPANTS.map(function (name) {
      return { name: name, taken: !!p.getProperty('claim:' + name) };
    }),
  };
}

function requestCode_(name, email) {
  if (PARTICIPANTS.indexOf(name) === -1) return fail_('unknown_name');
  email = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('bad_email');

  const ownership = checkOwnership_(props_(), name, email);
  if (ownership) return fail_(ownership);

  const cache = CacheService.getScriptCache();
  const sent = Number(cache.get('rate:' + name) || 0);
  if (sent >= MAX_CODES_PER_HOUR) return fail_('too_many_codes');
  cache.put('rate:' + name, String(sent + 1), 3600);

  const code = ('000' + Math.floor(Math.random() * 10000)).slice(-4);
  const entry = { email: email, code: code, tries: 0, exp: Date.now() + CODE_TTL_SECONDS * 1000 };
  cache.put('code:' + name, JSON.stringify(entry), CODE_TTL_SECONDS);
  sendCodeMail_(email, name, code);
  return { ok: true };
}

function verify_(name, email, code) {
  if (PARTICIPANTS.indexOf(name) === -1) return fail_('unknown_name');
  email = normEmail(email);

  const cache = CacheService.getScriptCache();
  const raw = cache.get('code:' + name);
  if (!raw) return fail_('code_expired');
  const entry = JSON.parse(raw);
  const secondsLeft = Math.ceil((entry.exp - Date.now()) / 1000);
  if (entry.email !== email || secondsLeft <= 0) return fail_('code_expired');

  if (String(code || '').trim() !== entry.code) {
    entry.tries += 1;
    if (entry.tries >= MAX_TRIES) {
      cache.remove('code:' + name);
      return fail_('too_many_tries');
    }
    cache.put('code:' + name, JSON.stringify(entry), secondsLeft);
    return fail_('bad_code');
  }
  cache.remove('code:' + name);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = props_();
    const ownership = checkOwnership_(p, name, email);
    if (ownership) return fail_(ownership);

    const receiver = getPairs_(p)[name];
    if (!receiver) return fail_('list_changed');

    p.setProperty('claim:' + name, email);
    const token = Utilities.getUuid();
    p.setProperty('token:' + token, name);

    if (!p.getProperty('mailed:' + name)) {
      try {
        sendResultMail_(email, name, receiver);
        p.setProperty('mailed:' + name, '1');
      } catch (err) {
        console.error(err); // Navnet vises uansett på siden.
      }
    }
    return { ok: true, token: token, giver: name, receiver: receiver };
  } finally {
    lock.releaseLock();
  }
}

function me_(token) {
  const p = props_();
  const name = token ? p.getProperty('token:' + token) : null;
  const pairs = name ? readPairs_(p) : null;
  if (!name || !pairs || !pairs[name]) return fail_('bad_token');
  return { ok: true, giver: name, receiver: pairs[name] };
}

/**
 * Returnerer feilkode hvis navnet tilhører en annen e-post.
 * Samme e-post kan brukes på flere navn (for de som deler e-post i familien).
 */
function checkOwnership_(p, name, email) {
  const known = KNOWN_EMAILS[name];
  if (known && normEmail(known) !== email) return 'wrong_email';
  const owner = p.getProperty('claim:' + name);
  if (owner && owner !== email) return 'name_taken';
  return null;
}

/** Leser trekningen, eller trekker for første gang. Kalles bare med låsen holdt. */
function getPairs_(p) {
  const existing = readPairs_(p);
  if (existing) return addNewcomers_(p, existing);
  const ring = makeRing(PARTICIPANTS, Math.random);
  savePairs_(p, ring);
  return ring;
}

/**
 * Nye navn i PARTICIPANTS etter at trekningen er gjort, flettes inn i ringen:
 * en giver (helst en som ikke har trukket ennå) gir nå til den nye, og den nye
 * gir til giverens gamle mottaker. Ingen andre får nytt navn.
 * Har alle trukket, får giveren som byttes en e-post med det nye navnet.
 */
function addNewcomers_(p, pairs) {
  const missing = PARTICIPANTS.filter(function (name) { return !pairs[name]; });
  if (!missing.length) return pairs;
  missing.forEach(function (newcomer) {
    const givers = Object.keys(pairs).filter(function (name) { return PARTICIPANTS.indexOf(name) !== -1; });
    const fresh = givers.filter(function (name) {
      return !p.getProperty('claim:' + name) && !p.getProperty('mailed:' + name);
    });
    const pool = fresh.length ? fresh : givers;
    const giver = pool[Math.floor(Math.random() * pool.length)];
    pairs[newcomer] = pairs[giver];
    pairs[giver] = newcomer;
    const email = p.getProperty('claim:' + giver);
    if (!fresh.length && email) sendUpdateMail_(email, giver, newcomer);
  });
  savePairs_(p, pairs);
  return pairs;
}

function savePairs_(p, pairs) {
  p.setProperty('pairs', Utilities.base64Encode(JSON.stringify(pairs), Utilities.Charset.UTF_8));
}

function readPairs_(p) {
  const stored = p.getProperty('pairs');
  if (!stored) return null;
  const bytes = Utilities.base64Decode(stored, Utilities.Charset.UTF_8);
  return JSON.parse(Utilities.newBlob(bytes).getDataAsString());
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function fail_(error) {
  return { ok: false, error: error };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- E-post ----------

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mailCard_(inner) {
  return '<div style="background:#7a1020;padding:28px 12px;font-family:Helvetica,Arial,sans-serif">' +
    '<div style="max-width:440px;margin:0 auto;background:#fff8ec;border-radius:18px;padding:28px;' +
    'text-align:center;color:#2b1a12;border:3px solid #e8b04a">' + inner +
    '<p style="margin-top:24px;font-size:13px;color:#8a6f5a">🎄 Hilsen nissene i verkstedet 🎄</p></div></div>';
}

function sendCodeMail_(email, name, code) {
  const html = mailCard_(
    '<div style="font-size:44px">🎅</div>' +
    '<h2 style="margin:8px 0 4px;color:#1d5c3a">Hei ' + esc_(name) + '!</h2>' +
    '<p>Her er nissekoden din:</p>' +
    '<div style="font-size:40px;letter-spacing:10px;font-weight:bold;color:#b3122e;margin:14px 0">' + code + '</div>' +
    '<p>Skriv den inn på siden for å se hvem du skal være Secret Santa for.<br>Koden virker i 10 minutter.</p>' +
    '<p style="font-size:13px;color:#8a6f5a">Ba du ikke om en kode? Da kan du bare se bort fra denne e-posten.</p>'
  );
  MailApp.sendEmail({
    to: email,
    subject: '🎅 Nissekoden din: ' + code,
    htmlBody: html,
    body: 'Hei ' + name + '! Nissekoden din er ' + code + '. Den virker i 10 minutter.',
    name: SENDER_NAME,
  });
}

function sendUpdateMail_(email, giver, receiver) {
  const html = mailCard_(
    '<div style="font-size:44px">🔔</div>' +
    '<h2 style="margin:8px 0 4px;color:#1d5c3a">Hei ' + esc_(giver) + '!</h2>' +
    '<p>Det har kommet en ny person med i Secret Santa, og nissene har måttet bytte om litt.</p>' +
    '<p style="color:#8a6f5a;font-size:14px">Bla ned for å se hvem du skal gi til nå ⬇️</p>' +
    '<div style="height:260px"></div>' +
    '<p>Du er nå Secret Santa for</p>' +
    '<div style="font-size:34px;font-weight:bold;color:#b3122e;margin:14px 0">' + esc_(receiver) + '</div>' +
    '<p>Det gamle navnet gjelder ikke lenger. Hysj! 🤫</p>' +
    '<p style="font-size:13px;color:#8a6f5a">Ikke svar på denne e-posten, da havner hemmeligheten hos nissene sin sjef.</p>'
  );
  MailApp.sendEmail({
    to: email,
    subject: '🔔 Oppdatering fra nissene: nytt Secret Santa-navn til deg',
    htmlBody: html,
    body: 'Hei ' + giver + '! Det har kommet en ny person med, og nissene har byttet om litt.\n\n' +
      new Array(31).join('🎄\n') + '\nDu er nå Secret Santa for ' + receiver + '. Det gamle navnet gjelder ikke lenger.\n\n' +
      'Ikke svar på denne e-posten, da havner hemmeligheten hos nissene sin sjef.',
    name: SENDER_NAME,
  });
}

function sendResultMail_(email, giver, receiver) {
  const link = SITE_URL
    ? '<p><a href="' + esc_(SITE_URL) + '" style="color:#1d5c3a">Se nissene koke igjen</a></p>'
    : '';
  // Navnet holdes unna emnefeltet og de første linjene, så varselet på mobilen ikke avslører det.
  const teaser = 'Navnet står lenger ned. Se nissene trekke det på siden først!';
  const preheader = '<div style="display:none;max-height:0;overflow:hidden">' + teaser +
    new Array(80).join('&nbsp;&zwnj;') + '</div>';
  const html = preheader + mailCard_(
    '<div style="font-size:44px">🎁</div>' +
    '<h2 style="margin:8px 0 4px;color:#1d5c3a">Hei ' + esc_(giver) + '!</h2>' +
    '<p>Nissene har kokt ferdig julegrøten, og navnet har dukket opp.</p>' +
    '<p style="color:#8a6f5a;font-size:14px">Bla ned for å se hvem du har trukket ⬇️</p>' +
    '<div style="height:260px"></div>' +
    '<p>Du er Secret Santa for</p>' +
    '<div style="font-size:34px;font-weight:bold;color:#b3122e;margin:14px 0">' + esc_(receiver) + '</div>' +
    '<p>Hysj! Ikke si det til noen 🤫</p>' + link +
    '<p style="font-size:13px;color:#8a6f5a">Ikke svar på denne e-posten, da havner hemmeligheten hos nissene sin sjef.</p>'
  );
  MailApp.sendEmail({
    to: email,
    subject: '🎁 Secret Santa: nissene har trukket et navn til deg!',
    htmlBody: html,
    body: 'Hei ' + giver + '! ' + teaser + '\n\n' + new Array(31).join('🎄\n') + '\n' +
      'Du er Secret Santa for ' + receiver + '. Hysj! Ikke si det til noen.\n\n' +
      'Ikke svar på denne e-posten, da havner hemmeligheten hos nissene sin sjef.',
    name: SENDER_NAME,
  });
}
