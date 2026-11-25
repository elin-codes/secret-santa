(() => {
  'use strict';

  const cfg = window.SANTA_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = !cfg.BACKEND_URL || params.has('demo');
  const TOKEN_KEY = DEMO ? 'santa.demo.token' : 'santa.token';
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const stage = $('#stage');
  const overlay = $('#overlay');
  const state = { name: '', email: '', result: null, names: [] };

  const ERRORS = {
    unknown_name: 'Nissene finner ikke det navnet på lista.',
    bad_email: 'Det ser ikke ut som en e-postadresse. Sjekk at den er riktig skrevet.',
    name_taken: 'Dette navnet er allerede tatt med en annen e-post. Si fra til Elin, så fikser hun det.',
    email_used: 'Den e-posten er allerede brukt av noen andre på lista. Bruk din egen e-post.',
    too_many_codes: 'Nissene har sendt mange koder nå. Vent en stund og prøv igjen.',
    code_expired: 'Koden har gått ut. Trykk «send en ny kode» under.',
    bad_code: 'Feil kode. Sjekk e-posten og prøv igjen.',
    too_many_tries: 'For mange feil forsøk. Trykk «send en ny kode» under.',
    list_changed: 'Deltakerlista er endret etter trekningen. Si fra til Elin.',
    server_error: 'Noe gikk galt hos nissene. Prøv igjen om litt.',
    network: 'Får ikke kontakt med nissens verksted. Sjekk nettet og prøv igjen.',
  };
  const errorText = (code) => ERRORS[code] || ERRORS.server_error;

  // ---------- Kontakt med nissens verksted ----------

  let fakeBackend = null;
  async function api(req) {
    try {
      if (DEMO) {
        fakeBackend = fakeBackend || window.createFakeBackend(showDemoMail);
        return await (await fakeBackend).call(req);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(cfg.BACKEND_URL, { method: 'POST', body: JSON.stringify(req), signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json();
      return data && typeof data.ok === 'boolean' ? data : { ok: false, error: 'network' };
    } catch (err) {
      return { ok: false, error: 'network' };
    }
  }

  // ---------- Skjermer ----------

  function show(name) {
    $$('[data-screen]').forEach((el) => { el.hidden = el.dataset.screen !== name; });
    $$('.error').forEach((el) => { el.textContent = ''; });
    const input = $(`[data-screen="${name}"] input`);
    if (input) setTimeout(() => input.focus(), 60);
    // På mobil: hold nissene i bildet mens de koker, og vis navnelista uten at man må lete.
    const behavior = REDUCED ? 'auto' : 'smooth';
    if (name === 'cooking' || name === 'reveal') stage.scrollIntoView({ behavior, block: 'start' });
    if (name === 'name') $('.card').scrollIntoView({ behavior, block: 'start' });
  }

  function showError(screen, code) {
    $(`[data-screen="${screen}"] .error`).textContent = errorText(code);
  }

  async function busy(button, text, work) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = text;
    try { return await work(); } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function fillNames(giver) {
    $$('[data-name]').forEach((el) => { el.textContent = giver; });
  }

  function maskEmail(email) {
    const [user, domain] = email.split('@');
    const shown = user.length <= 2 ? user[0] + '•' : user[0] + '•••' + user.slice(-1);
    return shown + '@' + domain;
  }

  async function openNames() {
    show('name');
    const list = $('#names');
    list.innerHTML = '<p class="muted">Henter lista …</p>';
    $('#progress').textContent = '';
    const res = await api({ action: 'names' });
    list.innerHTML = '';
    if (!res.ok) {
      showError('name', res.error);
      const retry = document.createElement('button');
      retry.className = 'btn';
      retry.style.gridColumn = '1 / -1';
      retry.style.justifySelf = 'center';
      retry.textContent = 'Prøv igjen';
      retry.addEventListener('click', openNames);
      list.appendChild(retry);
      return;
    }
    state.names = res.names.map((n) => n.name);
    const done = res.names.filter((n) => n.taken).length;
    $('#progress').textContent = `${done} av ${res.names.length} har trukket`;
    res.names.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'name-btn' + (n.taken ? ' taken' : '');
      b.textContent = n.name;
      b.addEventListener('click', () => {
        state.name = n.name;
        fillNames(n.name);
        $('#email').value = state.email;
        show('email');
      });
      list.appendChild(b);
    });
  }

  $('#join').addEventListener('click', openNames);
  $('#not-me').addEventListener('click', openNames);

  $('#email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const res = await busy($('#email-form .btn'), 'Nissene skriver brev …',
      () => api({ action: 'requestCode', name: state.name, email }));
    if (!res.ok) return showError('email', res.error);
    state.email = email;
    $('[data-email]').textContent = maskEmail(email);
    $('#code').value = '';
    show('code');
  });

  $('#code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) $('#code-form').requestSubmit();
  });

  let verifying = false;
  $('#code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#code').value;
    if (verifying) return;
    if (code.length !== 4) return showError('code', 'bad_code');
    verifying = true;
    const res = await busy($('#code-form .btn'), 'Sjekker koden …',
      () => api({ action: 'verify', name: state.name, email: state.email, code }));
    verifying = false;
    if (!res.ok) {
      $('#code').value = '';
      return showError('code', res.error);
    }
    localStorage.setItem(TOKEN_KEY, res.token);
    state.result = res;
    await playCooking();
    showReveal(false);
  });

  $('#resend').addEventListener('click', async () => {
    const res = await api({ action: 'requestCode', name: state.name, email: state.email });
    $('#code').value = '';
    if (!res.ok) return showError('code', res.error);
    $('[data-screen="code"] .error').textContent = '';
    toast('📬 Ny kode er sendt', 'Sjekk innboksen igjen.');
  });

  $('#replay').addEventListener('click', async () => {
    if (!state.names.length) {
      const res = await api({ action: 'names' });
      if (res.ok) state.names = res.names.map((n) => n.name);
    }
    await playCooking();
    showReveal(false);
  });

  $('#logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    state.result = null;
    state.email = '';
    overlay.innerHTML = '';
    show('welcome');
  });

  $('#retry').addEventListener('click', init);

  // ---------- Grøtkokingen ----------

  async function playCooking() {
    overlay.innerHTML = '';
    show('cooking');
    stage.classList.add('cooking');
    const total = REDUCED ? 1500 : 8800;
    const fill = $('#candy-fill');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = `width ${total}ms linear`;
    fill.style.width = '100%';

    const lines = REDUCED
      ? [[0, 'Nissene rører i grøten …']]
      : [[0, 'Alle navnene havner i gryta …'], [2300, 'Nissene rører i grøten …'],
        [3800, 'Litt mer kanel …'], [5200, 'Smaker til …'], [6600, 'Noe dukker opp! ✨']];
    lines.forEach(([at, text]) => setTimeout(() => { $('#status').textContent = text; }, at));

    if (!REDUCED) {
      dropSlips(state.names.length ? state.names : Array(12).fill('🎁'));
      setTimeout(() => stage.classList.add('wobble'), 6200);
      setTimeout(() => { stage.classList.remove('wobble'); riseSlip(state.result.receiver); }, 7000);
    }
    await sleep(total);
    stage.classList.remove('cooking', 'wobble');
  }

  function potPoint() {
    const r = overlay.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.width * 0.5, y: r.height * (127 / 250) };
  }

  function dropSlips(names) {
    const p = potPoint();
    names.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'slip';
      el.textContent = name;
      overlay.appendChild(el);
      const sx = p.w * (0.1 + Math.random() * 0.8);
      const sy = p.h * (0.06 + Math.random() * 0.12);
      const mx = (sx + p.x) / 2;
      const my = sy - p.h * 0.04;
      const rot = Math.random() * 50 - 25;
      const at = (x, y, deg, s) => `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${deg}deg) scale(${s})`;
      el.animate([
        { transform: at(sx, sy, rot, 1), opacity: 0 },
        { transform: at(mx, my, rot * 2, 0.9), opacity: 1, offset: 0.35 },
        { transform: at(p.x, p.y - 6, rot * 4, 0.5), opacity: 1, offset: 0.85 },
        { transform: at(p.x, p.y + 2, rot * 5, 0.15), opacity: 0 },
      ], { duration: 1300, delay: i * 90, easing: 'ease-in', fill: 'both' })
        .onfinish = () => el.remove();
    });
  }

  function riseSlip(receiver) {
    const p = potPoint();
    const el = document.createElement('div');
    el.className = 'drawn';
    el.textContent = receiver;
    overlay.appendChild(el);
    const dy = p.y - el.offsetTop;
    el.animate([
      { transform: `translate(-50%, calc(-50% + ${dy}px)) scale(0.15, 0.05) rotate(-8deg)`, opacity: 0 },
      { transform: `translate(-50%, calc(-50% + ${dy * 0.4}px)) scale(0.6, 0.6) rotate(6deg)`, opacity: 1, offset: 0.45 },
      { transform: 'translate(-50%, calc(-50% - 10px)) scale(1.15) rotate(-3deg)', offset: 0.8 },
      { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)' },
    ], { duration: 1700, easing: 'cubic-bezier(.2,.8,.3,1)' })
      .onfinish = () => el.classList.add('hold');
  }

  function holdSlip(receiver) {
    let el = $('.drawn', overlay);
    if (!el) {
      el = document.createElement('div');
      el.className = 'drawn hold';
      overlay.appendChild(el);
    }
    el.textContent = receiver;
  }

  function showReveal(returning) {
    const r = state.result;
    state.name = r.giver;
    fillNames(r.giver);
    $('#receiver').textContent = r.receiver;
    $('#welcome-back').hidden = !returning;
    holdSlip(r.receiver);
    show('reveal');
    // Start «pop»-animasjonen på nytt hver gang navnet vises.
    const scroll = $('#receiver');
    scroll.style.animation = 'none';
    void scroll.offsetWidth;
    scroll.style.animation = '';
    if (!returning) confetti();
  }

  // ---------- Pynt ----------

  function confetti() {
    if (REDUCED) return;
    const colors = ['#c8102e', '#1d5c3a', '#e8b04a', '#ffffff', '#7cc4e8'];
    const layer = document.createElement('div');
    layer.className = 'confetti';
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement('i');
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--t', 2.2 + Math.random() * 2 + 's');
      piece.style.setProperty('--x', Math.random() * 160 - 80 + 'px');
      piece.style.setProperty('--r', Math.random() * 900 - 450 + 'deg');
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 5500);
  }

  function buildNisser() {
    const art = $('#nisse-art');
    ['#nisse-left', '#nisse-right'].forEach((sel) => {
      const copy = art.cloneNode(true);
      copy.removeAttribute('id');
      $(sel).appendChild(copy);
    });
  }

  function buildLights() {
    const colors = ['#ff4d5e', '#ffd34d', '#4dd28a', '#5ab8ff', '#ff9a3d'];
    const host = $('#lights');
    host.innerHTML = '<svg viewBox="0 0 100 40" preserveAspectRatio="none">'
      + '<path d="M-2,4 Q50,34 102,4" fill="none" stroke="#22343e" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
    const count = 13;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const bulb = document.createElement('i');
      bulb.style.left = t * 100 + '%';
      bulb.style.top = 4 + 60 * t * (1 - t) + 'px';
      bulb.style.setProperty('--c', colors[i % colors.length]);
      bulb.style.setProperty('--d', (i % 3) * -0.45 + 's');
      host.appendChild(bulb);
    }
  }

  function startSnow() {
    const canvas = $('#snow');
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let flakes = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = REDUCED ? 30 : Math.round(Math.min(160, w / 5));
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2.6,
        v: 0.3 + Math.random() * 0.9, phase: Math.random() * Math.PI * 2,
      }));
    }
    function frame(time) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      flakes.forEach((f) => {
        if (!REDUCED) {
          f.y += f.v;
          f.x += Math.sin(time / 1500 + f.phase) * 0.35;
          if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      });
      if (!REDUCED) requestAnimationFrame(frame);
    }
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  }

  function toast(title, text) {
    const el = document.createElement('div');
    el.className = 'toast';
    const b = document.createElement('b');
    b.textContent = title;
    const span = document.createElement('span');
    span.textContent = text;
    el.append(b, span);
    el.addEventListener('click', () => el.remove());
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }

  function showDemoMail(mail) {
    toast('📬 Demo-e-post til ' + mail.to, mail.subject);
  }

  // ---------- Start ----------

  async function init() {
    $('#retry').hidden = true;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return show('welcome');
    show('loading');
    const res = await api({ action: 'me', token });
    if (res.ok) {
      state.result = res;
      return showReveal(true);
    }
    if (res.error === 'bad_token') {
      localStorage.removeItem(TOKEN_KEY);
      return show('welcome');
    }
    showError('loading', res.error);
    $('#retry').hidden = false;
  }

  if (DEMO) {
    $('#demo-banner').hidden = false;
    $('#demo-reset').addEventListener('click', async () => {
      fakeBackend = fakeBackend || window.createFakeBackend(showDemoMail);
      (await fakeBackend).reset();
      localStorage.removeItem(TOKEN_KEY);
      location.reload();
    });
  }

  buildNisser();
  buildLights();
  startSnow();
  init();
})();
