// Demo-modus: kjører den ekte apps-script/Code.gs i nettleseren, med Google-tjenestene
// byttet ut med localStorage. Ingen e-post sendes; «e-postene» vises som en boble på siden.
window.createFakeBackend = async function createFakeBackend(onMail) {
  const ls = window.localStorage;
  const P = 'santa.demo.p:';
  const C = 'santa.demo.c:';

  const store = {
    getProperty: (k) => ls.getItem(P + k),
    setProperty: (k, v) => { ls.setItem(P + k, String(v)); return store; },
    deleteProperty: (k) => { ls.removeItem(P + k); return store; },
    getProperties: () => {
      const out = {};
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (key.startsWith(P)) out[key.slice(P.length)] = ls.getItem(key);
      }
      return out;
    },
    deleteAllProperties: () => {
      Object.keys(store.getProperties()).forEach((k) => ls.removeItem(P + k));
      return store;
    },
  };

  const cache = {
    get: (k) => {
      const raw = ls.getItem(C + k);
      if (!raw) return null;
      const e = JSON.parse(raw);
      if (e.exp <= Date.now()) { ls.removeItem(C + k); return null; }
      return e.v;
    },
    put: (k, v, ttl = 600) => ls.setItem(C + k, JSON.stringify({ v: String(v), exp: Date.now() + ttl * 1000 })),
    remove: (k) => ls.removeItem(C + k),
  };

  const uuid = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

  const env = {
    PropertiesService: { getScriptProperties: () => store },
    CacheService: { getScriptCache: () => cache },
    MailApp: { sendEmail: (mail) => onMail(mail), getRemainingDailyQuota: () => 100 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: uuid,
      base64Encode: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))),
      base64Decode: (b64) => b64,
      newBlob: (b64) => ({
        getDataAsString: () => new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))),
      }),
      Charset: { UTF_8: 'UTF-8' },
    },
    ContentService: {
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
    Logger: { log() {} },
  };

  const src = await (await fetch('apps-script/Code.gs', { cache: 'no-store' })).text();
  const backend = new Function(...Object.keys(env),
    src + '\nreturn { handle: handle, nullstillAlt: nullstillAlt };')(...Object.values(env));

  return {
    async call(req) {
      await new Promise((r) => setTimeout(r, 350));
      return JSON.parse(JSON.stringify(backend.handle(req)));
    },
    reset() {
      backend.nullstillAlt();
      Object.keys(ls).filter((k) => k.startsWith(C)).forEach((k) => ls.removeItem(k));
    },
  };
};
