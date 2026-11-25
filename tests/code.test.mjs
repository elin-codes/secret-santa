// Tests for apps-script/Code.gs. The script is loaded into a vm context with
// small in-memory stand-ins for the Google services it uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';

const SRC = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

const NAMES = ['Mormor & Morfar', 'Malin', 'Kent', 'Gabriel', 'Dina', 'Anton', 'Elin', 'Moa',
  'Judith', 'Peter', 'Anna', 'Liv', 'Nicke', 'Signe', 'Malte', 'Susanna'];

function makeEnv() {
  const props = new Map();
  const cache = new Map();
  const clock = { now: 0 };
  const mails = [];
  const store = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return store; },
    deleteProperty: (k) => { props.delete(k); return store; },
    getProperties: () => Object.fromEntries(props),
    getKeys: () => [...props.keys()],
    deleteAllProperties: () => { props.clear(); return store; },
  };
  const scriptCache = {
    get: (k) => {
      const e = cache.get(k);
      if (!e) return null;
      if (e.expires <= clock.now) { cache.delete(k); return null; }
      return e.value;
    },
    put: (k, v, ttl = 600) => { cache.set(k, { value: String(v), expires: clock.now + ttl * 1000 }); },
    remove: (k) => { cache.delete(k); },
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => store },
    CacheService: { getScriptCache: () => scriptCache },
    MailApp: { sendEmail: (opts) => { mails.push(opts); }, getRemainingDailyQuota: () => 100 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
      base64Decode: (b) => [...Buffer.from(String(b), 'base64')].map((x) => (x > 127 ? x - 256 : x)),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((x) => x & 255)).toString('utf8') }),
      Charset: { UTF_8: 'UTF-8' },
    },
    ContentService: {
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
    Logger: { log() {} },
    console: { log() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // Objects made inside the sandbox have their own prototypes; hand plain copies to the asserts.
  const sandboxHandle = ctx.handle;
  ctx.handle = (req) => JSON.parse(JSON.stringify(sandboxHandle(req)));
  return { ctx, props, mails, clock };
}

const lastCode = (mails) => mails[mails.length - 1].subject.match(/\b(\d{4})\b/)[1];

function login(env, name, email) {
  assert.deepEqual(env.ctx.handle({ action: 'requestCode', name, email }), { ok: true });
  return env.ctx.handle({ action: 'verify', name, email, code: lastCode(env.mails) });
}

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('makeRing: everyone gives once, receives once, never self, never mutual', () => {
  const { ctx } = makeEnv();
  for (let s = 1; s <= 200; s++) {
    const ring = ctx.makeRing(NAMES, seeded(s));
    assert.deepEqual(Object.keys(ring).sort(), [...NAMES].sort());
    assert.deepEqual(Object.values(ring).sort(), [...NAMES].sort());
    for (const [giver, receiver] of Object.entries(ring)) {
      assert.notEqual(giver, receiver);
      assert.notEqual(ring[receiver], giver);
    }
  }
});

test('names: lists all 16 participants, none taken', () => {
  const { ctx } = makeEnv();
  const res = ctx.handle({ action: 'names' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.names.map((n) => n.name), NAMES);
  assert.ok(res.names.every((n) => n.taken === false));
});

test('full flow: code by mail, verify reveals a receiver, result mailed once, me() repeats it', () => {
  const env = makeEnv();
  env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' });
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'kent@example.com');
  const res = env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code: lastCode(env.mails) });
  assert.equal(res.ok, true);
  assert.equal(res.giver, 'Kent');
  assert.ok(NAMES.includes(res.receiver));
  assert.notEqual(res.receiver, 'Kent');
  assert.equal(env.mails.length, 2);
  assert.equal(env.mails[1].to, 'kent@example.com');
  assert.ok(env.mails[1].body.includes(res.receiver)); // htmlBody has '&' escaped
});

test('result mail subject does not spoil the name in a phone notification', () => {
  const env = makeEnv();
  const res = login(env, 'Kent', 'kent@example.com');
  const resultMail = env.mails[env.mails.length - 1];
  assert.ok(resultMail.subject.includes('Secret Santa'));
  assert.ok(!resultMail.subject.includes(res.receiver));
  assert.ok(!resultMail.body.slice(0, 160).includes(res.receiver));
  assert.ok(resultMail.body.includes(res.receiver));
  assert.deepEqual(env.ctx.handle({ action: 'me', token: res.token }), { ok: true, giver: 'Kent', receiver: res.receiver });
});

test('names: shows a name as taken once it is claimed', () => {
  const env = makeEnv();
  login(env, 'Kent', 'kent@example.com');
  const kent = env.ctx.handle({ action: 'names' }).names.find((n) => n.name === 'Kent');
  assert.equal(kent.taken, true);
});

test('email is matched regardless of case and spaces', () => {
  const env = makeEnv();
  const first = login(env, 'Kent', 'kent@gmail.com');
  const again = login(env, 'Kent', '  KENT@Gmail.com ');
  assert.equal(again.ok, true);
  assert.equal(again.receiver, first.receiver);
});

test('requesting a new code replaces the old one', () => {
  const env = makeEnv();
  env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' });
  const oldCode = lastCode(env.mails);
  env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' });
  const newCode = lastCode(env.mails);
  if (oldCode !== newCode) {
    const bad = env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code: oldCode });
    assert.equal(bad.ok, false);
  }
  const good = env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code: newCode });
  assert.equal(good.ok, true);
});

test('pairs are drawn once and never change', () => {
  const env = makeEnv();
  const kent = login(env, 'Kent', 'kent@example.com');
  const stored = env.props.get('pairs');
  login(env, 'Malin', 'malin@example.com');
  login(env, 'Anton', 'anton@example.com');
  assert.equal(env.props.get('pairs'), stored);
  assert.equal(env.ctx.handle({ action: 'me', token: kent.token }).receiver, kent.receiver);
});

test('pairs are not stored as readable names', () => {
  const env = makeEnv();
  login(env, 'Kent', 'kent@example.com');
  assert.ok(!env.props.get('pairs').includes('Kent'));
});

test('after nullstillAlt an old token is rejected', () => {
  const env = makeEnv();
  const kent = login(env, 'Kent', 'kent@example.com');
  env.ctx.nullstillAlt();
  assert.deepEqual(env.ctx.handle({ action: 'me', token: kent.token }), { ok: false, error: 'bad_token' });
});

test('me with a missing or unknown token is rejected', () => {
  const { ctx } = makeEnv();
  assert.equal(ctx.handle({ action: 'me' }).error, 'bad_token');
  assert.equal(ctx.handle({ action: 'me', token: 'nope' }).error, 'bad_token');
});

test('a claimed name cannot be requested with another email', () => {
  const env = makeEnv();
  login(env, 'Kent', 'kent@example.com');
  assert.deepEqual(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'sneaky@example.com' }),
    { ok: false, error: 'name_taken' });
});

test('one email cannot claim a second name', () => {
  const env = makeEnv();
  login(env, 'Kent', 'kent@example.com');
  assert.deepEqual(env.ctx.handle({ action: 'requestCode', name: 'Malin', email: 'kent@example.com' }),
    { ok: false, error: 'email_used' });
});

test('unknown name and bad email are rejected without sending mail', () => {
  const env = makeEnv();
  assert.equal(env.ctx.handle({ action: 'requestCode', name: 'Rudolf', email: 'r@example.com' }).error, 'unknown_name');
  assert.equal(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'not-an-email' }).error, 'bad_email');
  assert.equal(env.mails.length, 0);
});

test('five wrong codes kill the code, even the right one fails after', () => {
  const env = makeEnv();
  env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' });
  const code = lastCode(env.mails);
  const wrong = code === '0000' ? '1111' : '0000';
  const errors = [];
  for (let i = 0; i < 5; i++) {
    errors.push(env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code: wrong }).error);
  }
  assert.deepEqual(errors, ['bad_code', 'bad_code', 'bad_code', 'bad_code', 'too_many_tries']);
  assert.equal(env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code }).error, 'code_expired');
});

test('the sixth code request within an hour is refused', () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    assert.equal(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' }).ok, true);
  }
  assert.equal(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' }).error, 'too_many_codes');
  assert.equal(env.mails.length, 5);
});

test('a code expires after 10 minutes', () => {
  const env = makeEnv();
  env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' });
  env.clock.now += 601 * 1000;
  assert.equal(env.ctx.handle({ action: 'verify', name: 'Kent', email: 'kent@example.com', code: lastCode(env.mails) }).error,
    'code_expired');
});

test('logging in again on a new device does not send a second result mail', () => {
  const env = makeEnv();
  const first = login(env, 'Kent', 'kent@example.com');
  const second = login(env, 'Kent', 'kent@example.com');
  assert.equal(second.receiver, first.receiver);
  assert.notEqual(second.token, first.token);
  const resultMails = env.mails.filter((m) => m.subject.includes('Secret Santa'));
  assert.equal(resultMails.length, 1);
});

test('slippNavn frees the name, kills its tokens and lets the real owner in', () => {
  const env = makeEnv();
  const wrong = login(env, 'Kent', 'sneaky@example.com');
  env.ctx.slippNavn('Kent');
  assert.equal(env.ctx.handle({ action: 'me', token: wrong.token }).error, 'bad_token');
  const real = login(env, 'Kent', 'kent@example.com');
  assert.equal(real.ok, true);
  assert.equal(real.receiver, wrong.receiver);
  assert.equal(env.mails[env.mails.length - 1].to, 'kent@example.com');
  assert.ok(env.mails[env.mails.length - 1].subject.includes('Secret Santa'));
});

test('a participant missing from the stored draw gets list_changed', () => {
  const env = makeEnv();
  const partial = Object.fromEntries(NAMES.filter((n) => n !== 'Kent').map((n, i, arr) => [n, arr[(i + 1) % arr.length]]));
  env.props.set('pairs', Buffer.from(JSON.stringify(partial), 'utf8').toString('base64'));
  assert.equal(login(env, 'Kent', 'kent@example.com').error, 'list_changed');
});

test('result mail asks people not to reply (a reply would land in the owner\'s inbox)', () => {
  const env = makeEnv();
  login(env, 'Kent', 'kent@example.com');
  const resultMail = env.mails[env.mails.length - 1];
  assert.match(resultMail.htmlBody, /Ikke svar på denne e-posten/);
  assert.match(resultMail.body, /Ikke svar på denne e-posten/);
});

test('a name with a known email can only be claimed with that email', () => {
  const env = makeEnv();
  vm.runInContext("KNOWN_EMAILS['Kent'] = 'kent@example.com';", env.ctx);
  assert.deepEqual(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'cousin@example.com' }),
    { ok: false, error: 'wrong_email' });
  assert.equal(env.mails.length, 0);
  assert.equal(login(env, 'Kent', ' KENT@example.com ').ok, true);
  assert.equal(login(env, 'Malin', 'malin@example.com').ok, true);
});

test('visTrekningen lists every pair and who has logged in', () => {
  const env = makeEnv();
  assert.match(env.ctx.visTrekningen(), /Ingen trekning ennå/);
  const kent = login(env, 'Kent', 'kent@example.com');
  const list = env.ctx.visTrekningen();
  assert.ok(list.includes('Kent → ' + kent.receiver + '  (logget inn: kent@example.com)'));
  assert.ok(list.includes('Malin → '));
  assert.match(list, /Malin → .*\(ikke logget inn ennå\)/);
  assert.equal(list.trim().split('\n').length, NAMES.length);
});

test('unknown action is rejected', () => {
  const { ctx } = makeEnv();
  assert.deepEqual(ctx.handle({ action: 'hack' }), { ok: false, error: 'unknown_action' });
});

test('doPost parses the body and answers JSON; garbage gives bad_request', () => {
  const { ctx } = makeEnv();
  const ok = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'names' }) } }).content);
  assert.equal(ok.ok, true);
  const bad = JSON.parse(ctx.doPost({ postData: { contents: '{nope' } }).content);
  assert.deepEqual(bad, { ok: false, error: 'bad_request' });
});

test('a failing mail service gives server_error instead of crashing', () => {
  const env = makeEnv();
  env.ctx.MailApp.sendEmail = () => { throw new Error('quota'); };
  assert.deepEqual(env.ctx.handle({ action: 'requestCode', name: 'Kent', email: 'kent@example.com' }),
    { ok: false, error: 'server_error' });
});
