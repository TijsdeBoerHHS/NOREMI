import * as db from './db.js';
import * as ai from './ai.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const DEFAULTS = {
  patientName: '', mode: 'demo', pin: '1234',
  azureKey: '', azureRegion: 'westeurope', azureVoice: 'nl-NL-FennaNeural', didKey: '', systemVoice: '',
};
const AI_LABEL = 'Gemaakt met AI – geen echte opname';

const state = { persons: [], s: { ...DEFAULTS }, unlocked: false, editing: null, fails: 0, lockUntil: 0 };
let urls = [];
let playback = null;
let renderToken = 0;
let idleTimer = null;
let lastHash = location.hash;

/* ---------- hulpjes ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'hidden'].includes(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<path d="M7 11V8a5 5 0 0110 0v3h1v9H6v-9zm2 0h6V8a3 3 0 00-6 0z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  mic: '<path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zm-5 8h2a3 3 0 006 0h2a5 5 0 01-4 4.9V19h-2v-3.1A5 5 0 017 11z"/>',
  trash: '<path d="M9 4h6l1 2h4v2H4V6h4zm-3 6h12l-1 10H7z"/>',
  up: '<path d="M12 6l7 8H5z"/>', down: '<path d="M12 18l-7-8h14z"/>',
  edit: '<path d="M4 17.3V20h2.7L17.8 8.9l-2.7-2.7zM19.7 7l-2.7-2.7 1.4-1.4a1 1 0 011.4 0l1.3 1.3a1 1 0 010 1.4z"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name]; // vaste, eigen tekenreeksen (geen gebruikersinvoer)
  return s;
}
function objUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
// Foto's als data-URL (geen blob-URL): die kunnen niet 'ongeldig' worden bij hertekenen op iPad/Safari.
const photoCache = new WeakMap();
const toDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(blob); });
async function preparePhotos(list) {
  await Promise.all(list.map(async (p) => { if (p.photo && !photoCache.has(p.photo)) photoCache.set(p.photo, await toDataUrl(p.photo)); }));
}
const photoSrc = (blob) => (blob && photoCache.get(blob)) || (blob ? objUrl(blob) : '');
function revokeUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }
let toastTimer;
function toast(msg) {
  $toast.textContent = msg; $toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove('show'), 4000);
}
const go = (path) => { location.hash = '#/' + path; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

async function hash(pin) {
  const data = new TextEncoder().encode('noremi:' + pin);
  if (crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let x = 5381; for (const b of data) x = ((x << 5) + x + b) | 0; return 'x' + x;
}

/* ---------- dialogen ---------- */
function modal(content) {
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, content));
  document.body.append(overlay);
  return { close: () => overlay.remove() };
}
function confirmDialog(message, okLabel = 'Ja', danger = false) {
  return new Promise((resolve) => {
    const done = (v) => { m.close(); resolve(v); };
    const m = modal([
      h('p', {}, message),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => done(false) }, 'Annuleren'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => done(true) }, okLabel)),
    ]);
  });
}

/* ---------- pincode-toetsenbord ---------- */
function pinPad({ title, hint, onDone, onCancel }) {
  let digits = '';
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => h('span', { class: 'dot' })));
  const msg = h('p', { class: 'notice', role: 'alert' }, hint || '');
  const wrap = h('div', { class: 'pin-wrap' }, h('h2', {}, title), dots, msg);
  const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < digits.length));
  const press = async (d) => {
    if (digits.length >= 4) return;
    digits += d; paint();
    if (digits.length === 4) {
      const entered = digits; digits = '';
      const ok = await onDone(entered, msg);
      if (ok === false) { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); }
      paint();
    }
  };
  const key = (d) => h('button', { class: 'btn', onclick: () => press(d), 'aria-label': String(d) }, String(d));
  wrap.append(h('div', { class: 'keys' },
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(key),
    h('button', { class: 'btn', onclick: onCancel }, 'Terug'),
    key(0),
    h('button', { class: 'btn', onclick: () => { digits = digits.slice(0, -1); paint(); } }, 'Wis')));
  return wrap;
}
function askNewPin() {
  return new Promise((resolve) => {
    let first = null;
    const mount = () => {
      const pad = pinPad({
        title: first ? 'Herhaal de nieuwe pincode' : 'Kies een nieuwe pincode van 4 cijfers',
        onCancel: () => { m.close(); resolve(null); },
        onDone: async (pin, msg) => {
          if (!first) { first = pin; body.replaceChildren(mount()); return true; }
          if (pin !== first) { first = null; body.replaceChildren(mount()); toast('De pincodes waren niet gelijk. Probeer opnieuw.'); return false; }
          m.close(); resolve(pin); return true;
        },
      });
      return pad;
    };
    const body = h('div', {});
    const m = modal(body);
    body.replaceChildren(mount());
  });
}

/* ---------- systeemstem (alleen Demo) ---------- */
const shortName = (n) => n.replace(/^Microsoft\s+/i, '').replace(/\s*[-–]\s*Dutch.*$/i, '').replace(/\s*\((Natural|Enhanced|Premium|Compact)\)/gi, '').replace(/\s+Online$/i, '').trim();
const normLang = (l) => String(l || '').replace('_', '-');
const hasSpeech = () => 'speechSynthesis' in window;
// systemVoice bewaart nu alleen de taal (bijv. 'nl-NL'); oude waarden (een stem-id) vallen terug op nl-NL.
const systemLang = () => (/^[a-z]{2,3}-[A-Za-z]{2,4}$/.test(state.s.systemVoice || '') ? state.s.systemVoice : 'nl-NL');
const voicesForLang = (lang) => {
  if (!hasSpeech()) return [];
  const base = normLang(lang).split('-')[0].toLowerCase();
  const all = speechSynthesis.getVoices().filter((v) => normLang(v.lang).toLowerCase().startsWith(base));
  const exact = all.filter((v) => normLang(v.lang).toLowerCase() === normLang(lang).toLowerCase());
  return exact.length ? exact : all;
};
const langName = (l) => { try { return new Intl.DisplayNames(['nl'], { type: 'language', languageDisplay: 'dialect' }).of(l) || l; } catch { return l; } };
function makeUtterance(text, voiceURI) {
  const u = new SpeechSynthesisUtterance(text);
  const lang = systemLang();
  u.lang = lang; u.rate = 0.85;
  const vs = voicesForLang(lang);
  const v = vs.find((x) => x.voiceURI === voiceURI) || vs[0];
  if (v) { u.voice = v; u.lang = v.lang; }
  return u;
}

/* ---------- afspelen ---------- */
function stopPlayback() {
  playback?.stop(); playback = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });

/* ---------- schermen ---------- */
function startView() {
  const grid = state.persons.length
    ? h('div', { class: 'grid' }, state.persons.map((p) =>
        h('button', { class: 'card', onclick: () => go('persoon/' + p.id) },
          h('img', { src: photoSrc(p.photo), alt: '' }),
          h('span', { class: 'card-label' }, p.label))))
    : h('div', { class: 'empty' }, h('p', {}, 'Er zijn nog geen personen toegevoegd.'), h('p', {}, 'Een begeleider kan ze toevoegen via Beheer.'));
  return h('div', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', { class: 'logo' }, 'NO-RE-MI'), h('div', { class: 'patient' }, state.s.patientName)),
    h('main', {}, grid),
    h('footer', { class: 'foot' }, h('span', {}, 'ICT Praktijk Academie'),
      h('button', { class: 'btn btn-quiet', onclick: () => go('beheer') }, icon('lock'), 'Beheer')));
}

function personView(id) {
  const p = state.persons.find((x) => x.id === id);
  if (!p) { go(''); return h('div'); }
  const demo = state.s.mode === 'demo';
  const own = !!p.ownVideo; // eigen opname van een echt persoon: geen AI
  const videoSrc = own ? objUrl(p.ownVideo) : p.video ? objUrl(p.video) : p.videoUrl || null;
  const ready = own || demo || !!videoSrc;

  const photo = h('img', { src: photoSrc(p.photo), alt: p.label, draggable: 'false' });
  const video = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' });
  video.setAttribute('playsinline', '');
  const stage = h('button', { class: 'stage', 'aria-label': 'Bericht van ' + p.label + ' afspelen', onclick: toggle },
    photo, video, own ? null : h('span', { class: 'ai-badge' }, AI_LABEL));
  const notice = h('p', { class: 'notice' }, ready ? '' : 'Dit bericht is nog niet klaar.');
  const btn = h('button', { class: 'btn btn-primary btn-xl', onclick: toggle, disabled: !ready });
  let playing = false; let played = false; let audioEl = null;

  function ui() {
    btn.replaceChildren(icon(playing ? 'stop' : 'play'), playing ? 'Stoppen' : played ? 'Nog een keer' : 'Afspelen');
    stage.classList.toggle('video-on', playing && (own || !demo));
    photo.classList.toggle('moving', playing && demo && !own);
  }
  function end() {
    if (!playing) return;
    playing = false; played = true;
    video.pause(); audioEl?.pause(); audioEl = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    ui();
  }
  async function toggle() {
    if (!ready) return;
    if (playing) { end(); return; }
    stopPlayback();
    playing = true; playback = { stop: end }; notice.textContent = ''; ui();
    try {
      if (own || !demo) {
        video.src = videoSrc; video.currentTime = 0; video.onended = end;
        await video.play();
      } else if (p.audio || p.speech || state.s.azureKey) {
        let blob = p.audio || p.speech;
        if (!blob) {
          notice.textContent = 'Stem wordt klaargemaakt…';
          blob = await ai.azureSpeak(p.text, state.s, { voice: p.voice, pitch: p.pitch });
          p.speech = blob; db.putPerson(p).catch(() => {}); notice.textContent = '';
          if (!playing) return;
        }
        audioEl = new Audio(objUrl(blob)); audioEl.onended = end; await audioEl.play();
      } else if ('speechSynthesis' in window) {
        const u = makeUtterance(p.text, p.sysVoice); u.onend = end; u.onerror = () => { end(); notice.textContent = 'Het afspelen lukt niet. Vraag een begeleider om hulp.'; };
        speechSynthesis.speak(u);
      } else { throw new Error('Geen spraak beschikbaar op dit apparaat.'); }
    } catch (e) {
      end(); notice.textContent = 'Het afspelen lukt niet. Vraag een begeleider om hulp.';
    }
  }
  ui();

  return h('div', { class: 'screen' },
    h('div', { class: 'person-top' },
      h('button', { class: 'btn', onclick: () => go('') }, icon('back'), 'Terug'),
      h('h1', {}, p.label)),
    h('main', { class: 'person' }, stage, notice, btn));
}

/* ----- beheer: pincode ----- */
function gateView() {
  const locked = () => Date.now() < state.lockUntil;
  const pad = pinPad({
    title: 'Beheer – vul de pincode in',
    hint: locked() ? 'Wacht even en probeer het straks opnieuw.' : '',
    onCancel: () => go(''),
    onDone: async (pin, msg) => {
      if (locked()) { msg.textContent = 'Wacht even en probeer het straks opnieuw.'; return false; }
      if ((await hash(pin)) === state.s.pinHash) {
        state.unlocked = true; state.fails = 0; render(); return true;
      }
      state.fails++;
      if (state.fails >= 5) { state.lockUntil = Date.now() + 30000; state.fails = 0; msg.textContent = 'Te vaak fout. Wacht 30 seconden.'; }
      else msg.textContent = 'De pincode klopt niet.';
      return false;
    },
  });
  return h('div', { class: 'screen' }, h('main', {}, pad));
}

/* ----- beheer: overzicht ----- */
function beheerView() {
  return h('div', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', { class: 'logo' }, 'Beheer'),
      h('button', { class: 'btn btn-primary', onclick: () => go('') }, 'Sluiten en vergrendelen')),
    h('main', {}, state.editing ? editorView() : [listPanel(), settingsPanel()]));
}

function listPanel() {
  const aiMode = state.s.mode === 'ai';
  const rows = state.persons.map((p, i) => {
    const klaar = p.ownVideo ? true : aiMode ? !!(p.video || p.videoUrl) : true;
    return h('div', { class: 'person-row' },
      h('img', { src: photoSrc(p.photo), alt: '' }),
      h('div', { class: 'info' }, h('div', {}, h('strong', {}, p.label)),
        h('span', { class: 'chip' + (klaar ? '' : ' warn') }, p.ownVideo ? 'Eigen video' : aiMode ? (klaar ? 'Video klaar' : 'Video nog niet gemaakt') : 'Klaar (demo)')),
      h('button', { class: 'btn', 'aria-label': 'Omhoog', disabled: i === 0, onclick: () => move(i, -1) }, icon('up')),
      h('button', { class: 'btn', 'aria-label': 'Omlaag', disabled: i === state.persons.length - 1, onclick: () => move(i, 1) }, icon('down')),
      h('button', { class: 'btn', onclick: () => { state.editing = { ...p, original: p }; render(); } }, icon('edit'), 'Bewerken'),
      h('button', { class: 'btn', 'aria-label': 'Verwijderen ' + p.label, onclick: () => remove(p) }, icon('trash'), 'Verwijder'));
  });
  return h('section', { class: 'panel' },
    h('h2', {}, 'Personen'),
    state.persons.length ? rows : h('p', { class: 'hint' }, 'Nog geen personen. Voeg er een toe, of laad voorbeeldpersonen onder Instellingen.'),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: newPerson }, icon('plus'), 'Persoon toevoegen')));
}
let moveQueue = Promise.resolve();
function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.persons.length) return;
  // Direct in het geheugen herordenen (foto's blijven dezelfde), daarna alleen de lijst met id's opslaan.
  const [p] = state.persons.splice(i, 1);
  state.persons.splice(j, 0, p);
  const ids = state.persons.map((x) => x.id);
  render(true);
  moveQueue = moveQueue.then(() => db.setSetting('personOrder', ids)).catch((e) => { toast('Opslaan van de volgorde is mislukt: ' + (e && e.message ? e.message : e)); });
}
async function remove(p) {
  if (!(await confirmDialog(`Weet je zeker dat je “${p.label}” wilt verwijderen? Foto, tekst en video worden van deze tablet gewist. Dit kan niet ongedaan worden gemaakt.`, 'Ja, verwijderen', true))) return;
  await db.deletePerson(p.id); toast('Verwijderd.'); render();
}
function newPerson() {
  const order = state.persons.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  state.editing = { id: uid(), isNew: true, label: '', text: '', photo: null, audio: null, video: null, videoUrl: null, consent: false, voice: '', pitch: '', sysVoice: '', ownVideo: null, order, original: {} };
  render();
}

/* ----- beheer: instellingen ----- */
function settingsPanel() {
  const s = state.s;
  const f = {
    name: h('input', { type: 'text', value: s.patientName, autocomplete: 'off' }),
    mode: h('select', {}, h('option', { value: 'demo' }, 'Demo – alleen om te testen (bewegende foto, geen D-ID-video)'),
      h('option', { value: 'ai' }, 'AI – Azure-stem en D-ID-video')),
    azureKey: h('input', { type: 'password', value: s.azureKey, autocomplete: 'off' }),
    azureRegion: h('input', { type: 'text', value: s.azureRegion, autocomplete: 'off' }),
    azureVoice: h('select', {}, ['Vrouw', 'Man'].map((g) => h('optgroup', { label: g }, ai.PRESETS.filter((p) => p.group === g).map((p) => h('option', { value: p.voice }, p.label))))),
    didKey: h('input', { type: 'password', value: s.didKey, autocomplete: 'off' }),
    voice: h('select', {}),
  };
  const voiceInfo = h('p', { class: 'hint' });
  const fillVoices = () => {
    const cur = systemLang();
    const langs = new Set(['nl-NL', 'nl-BE', cur]);
    if (hasSpeech()) speechSynthesis.getVoices().forEach((v) => langs.add(normLang(v.lang)));
    f.voice.replaceChildren(...[...langs].sort().map((l) => h('option', { value: l }, langName(l))));
    f.voice.value = cur;
    const n = voicesForLang(f.voice.value).length;
    voiceInfo.textContent = n
      ? `${n} ${n === 1 ? 'stem' : 'stemmen'} gevonden voor deze taal op dit apparaat. De stem zelf kiest u per persoon.`
      : 'Geen stem gevonden voor deze taal op dit apparaat. Installeer er een in de taal- of spraakinstellingen van de tablet, of gebruik de AI-modus.';
  };
  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
  const tryVoice = () => {
    if (!('speechSynthesis' in window)) { toast('Dit apparaat heeft geen spraak.'); return; }
    state.s.systemVoice = f.voice.value; speechSynthesis.cancel(); fillVoices();
    speechSynthesis.speak(makeUtterance('Hallo, dit is de stem van deze tablet. Ik wens je een fijne dag.'));
  };
  f.mode.value = s.mode;
  f.azureVoice.value = ai.VOICES.some((v) => v.id === s.azureVoice) ? s.azureVoice : DEFAULTS.azureVoice;
  const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
  const save = async () => {
    Object.assign(state.s, {
      patientName: f.name.value.trim(), mode: f.mode.value, azureKey: f.azureKey.value.trim(),
      azureRegion: f.azureRegion.value.trim() || DEFAULTS.azureRegion, azureVoice: f.azureVoice.value.trim() || DEFAULTS.azureVoice,
      didKey: f.didKey.value.trim(), systemVoice: f.voice.value,
    });
    for (const k of ['patientName', 'mode', 'azureKey', 'azureRegion', 'azureVoice', 'didKey', 'systemVoice']) await db.setSetting(k, state.s[k]);
    toast('Instellingen opgeslagen.'); render();
  };
  return h('section', { class: 'panel' },
    h('h2', {}, 'Instellingen'),
    field('Naam van de bewoner (staat rechtsboven)', f.name),
    field('Werkwijze', f.mode),
    h('p', { class: 'hint' }, 'In AI-modus speelt de app alleen berichten af waarvan de video is gemaakt. Is die er niet, dan gebeurt er niets (zoals vastgelegd in het keuzeonderzoek). Demo gebruikt een bewegende foto zonder lipsync en geen D-ID-video. De stem komt van Azure als hieronder een sleutel is ingevuld (dan gaat de tekst ook in Demo naar Microsoft), anders van de tablet. Het keuzeonderzoek wees de bewegende foto en de systeemstem af, dus Demo is alleen een testfunctie en niet de gekozen aanpak.'),
    field('Taal van de systeemstem (alleen voor Demo zonder Azure-sleutel)', f.voice),
    voiceInfo,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: tryVoice }, icon('play'), 'Taal beluisteren')),
    field('Azure Speech – sleutel', f.azureKey),
    field('Azure – regio', f.azureRegion),
    field('Azure – standaardstem (per persoon aan te passen)', f.azureVoice),
    field('D-ID – API-sleutel', f.didKey),
    h('p', { class: 'hint' }, 'Let op: in AI-modus worden foto en tekst naar Microsoft en D-ID gestuurd. Gebruik in dit prototype alleen verzonnen gegevens. De sleutels staan op deze tablet.'),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: save }, 'Instellingen opslaan')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: changePin }, icon('lock'), 'Pincode wijzigen'),
      h('button', { class: 'btn', onclick: loadSample }, 'Voorbeeldpersonen laden'),
      h('button', { class: 'btn btn-danger', onclick: wipe }, 'Alles wissen')));
}
async function changePin() {
  const pin = await askNewPin(); if (!pin) return;
  state.s.pinHash = await hash(pin); await db.setSetting('pinHash', state.s.pinHash); toast('Nieuwe pincode opgeslagen.');
}
async function wipe() {
  if (!(await confirmDialog('Alle personen, foto’s, video’s en instellingen op deze tablet wissen? Dit kan niet ongedaan worden gemaakt.', 'Ja, alles wissen', true))) return;
  await db.clearAll(); await loadSettings(); toast('Alles is gewist. De pincode is weer 1234.'); render();
}

/* ----- beheer: persoon bewerken ----- */
function editorView() {
  const d = state.editing;
  const demo = state.s.mode === 'demo';
  const label = h('input', { type: 'text', value: d.label, autocomplete: 'off', placeholder: 'Bijvoorbeeld: Erica, vrouw van Erik', oninput: (e) => { d.label = e.target.value; } });
  const text = h('textarea', { oninput: (e) => { d.text = e.target.value; count.textContent = `${d.text.length} van 400 tekens`; }, maxlength: '400', placeholder: 'Hallo Erik, ik ben jouw vrouw Erica. …' });
  text.value = d.text;
  const count = h('p', { class: 'hint' }, `${d.text.length} van 400 tekens`);
  const status = h('div', { class: 'status', hidden: true });
  const say = (msg, err) => { status.hidden = !msg; status.textContent = msg || ''; status.classList.toggle('error', !!err); };

  const preview = h('img', { class: 'preview', alt: '' });
  const paintPhoto = () => { if (d.photo) preview.src = photoSrc(d.photo); preview.hidden = !d.photo; };
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { d.photo = await squareJpeg(f); paintPhoto(); } catch { say('Deze foto kan niet worden gelezen.', true); }
  } });

  // eigen opname
  const audioBox = h('div', {});
  let rec = null;
  const paintAudio = () => {
    audioBox.replaceChildren(...[
      rec ? h('button', { class: 'btn btn-danger', onclick: () => rec.stop() }, icon('stop'), 'Stop opname')
          : h('button', { class: 'btn', onclick: startRec }, icon('mic'), d.audio ? 'Opnieuw opnemen' : 'Stem opnemen'),
      d.audio && !rec ? h('audio', { controls: '', src: objUrl(d.audio), style: 'width:100%;margin-top:.6rem' }) : null,
      d.audio && !rec ? h('button', { class: 'btn', style: 'margin-top:.6rem', onclick: () => { d.audio = null; paintAudio(); } }, icon('trash'), 'Opname verwijderen') : null,
    ].filter(Boolean));
  };
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      const chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearTimeout(cut); d.audio = new Blob(chunks, { type: mr.mimeType }); rec = null; paintAudio(); };
      const cut = setTimeout(() => mr.state === 'recording' && mr.stop(), 45000);
      rec = mr; mr.start(); paintAudio();
    } catch { say('De microfoon is niet beschikbaar. Geef toestemming in de instellingen van de browser.', true); }
  }
  paintAudio(); paintPhoto();

  // eigen video-opname (beeld en geluid): vervangt de AI-video
  const ownBox = h('div', {});
  let vrec = null;
  const liveVideo = h('video', { class: 'preview', playsinline: '', autoplay: '' });
  liveVideo.muted = true;
  const stopVideoRec = () => { if (vrec && vrec.state === 'recording') vrec.stop(); };
  const paintOwn = () => {
    ownBox.replaceChildren(...[
      vrec ? liveVideo : null,
      vrec ? h('button', { class: 'btn btn-danger', onclick: stopVideoRec }, icon('stop'), 'Stop video-opname') : null,
      !vrec ? h('button', { class: 'btn', onclick: startVideoRec }, icon('mic'), d.ownVideo ? 'Video opnieuw opnemen' : 'Video opnemen') : null,
      d.ownVideo && !vrec ? h('video', { class: 'preview', controls: '', playsinline: '', src: objUrl(d.ownVideo), style: 'display:block;margin-top:.6rem' }) : null,
      d.ownVideo && !vrec ? h('button', { class: 'btn', style: 'margin-top:.6rem', onclick: () => { d.ownVideo = null; paintOwn(); } }, icon('trash'), 'Video verwijderen') : null,
    ].filter(Boolean));
  };
  async function startVideoRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      const mime = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); clearTimeout(cut); liveVideo.srcObject = null;
        if (chunks.length) d.ownVideo = new Blob(chunks, { type: mr.mimeType || mime || 'video/mp4' });
        vrec = null; paintOwn();
      };
      const cut = setTimeout(() => mr.state === 'recording' && mr.stop(), 60000);
      vrec = mr; liveVideo.srcObject = stream; mr.start(); paintOwn(); liveVideo.play().catch(() => {});
    } catch { say('De camera of microfoon is niet beschikbaar. Geef toestemming in de instellingen van de browser.', true); }
  }
  paintOwn();

  const current = ai.PRESETS.find((p) => p.voice === (d.voice || state.s.azureVoice) && p.pitch === (d.pitch || '')) || ai.PRESETS[0];
  const group = (g) => h('optgroup', { label: g }, ai.PRESETS.filter((p) => p.group === g).map((p) => h('option', { value: p.id }, p.label)));
  const useSys = demo && !state.s.azureKey;
  const sysSel = h('select', { onchange: (e) => { d.sysVoice = e.target.value; } });
  const fillSys = () => {
    const vs = voicesForLang(systemLang());
    sysSel.replaceChildren(h('option', { value: '' }, 'Automatisch'), ...vs.map((v) => h('option', { value: v.voiceURI }, shortName(v.name))));
    sysSel.value = vs.some((v) => v.voiceURI === d.sysVoice) ? d.sysVoice : '';
  };
  fillSys();
  if (useSys && hasSpeech()) speechSynthesis.onvoiceschanged = fillSys;
  const voiceSel = h('select', { onchange: (e) => { const p = ai.PRESETS.find((x) => x.id === e.target.value); d.voice = p.voice; d.pitch = p.pitch; } }, group('Vrouw'), group('Man'));
  voiceSel.value = current.id;
  const consent = h('input', { type: 'checkbox', checked: d.consent, onchange: (e) => { d.consent = e.target.checked; } });

  function validate() {
    if (!d.label.trim()) return 'Vul een bijschrift in.';
    if (!d.photo) return d.ownVideo ? 'Er kon geen foto uit de video worden gehaald. Kies een foto.' : 'Kies een foto.';
    if (!d.ownVideo && !d.text.trim() && !d.audio) return 'Vul een tekst in, neem een stem op of neem een video op.';
    if (!d.consent) return 'Bevestig eerst dat deze foto en tekst gebruikt mogen worden.';
    return null;
  }
  async function persist() {
    const o = d.original || {};
    const changed = d.photo !== o.photo || d.text !== o.text || d.audio !== o.audio || (d.voice || '') !== (o.voice || '') || (d.pitch || '') !== (o.pitch || '');
    const speechChanged = d.text !== o.text || (d.voice || '') !== (o.voice || '') || (d.pitch || '') !== (o.pitch || '');
    const rec = { id: d.id, label: d.label.trim(), text: d.text.trim(), photo: d.photo, audio: d.audio || null,
      video: changed ? null : d.video || null, videoUrl: changed ? null : d.videoUrl || null, consent: true, order: d.order,
      voice: d.voice || '', pitch: d.pitch || '', sysVoice: d.sysVoice || '', ownVideo: d.ownVideo || null, speech: speechChanged ? null : d.speech || null };
    await db.putPerson(rec); Object.assign(d, rec, { isNew: false, original: rec });
    return rec;
  }
  async function listen() {
    try {
      if (d.audio) { new Audio(objUrl(d.audio)).play(); return; }
      if (!d.text.trim()) { say('Vul eerst een tekst in.', true); return; }
      if (demo && !state.s.azureKey) { speechSynthesis.cancel(); speechSynthesis.speak(makeUtterance(d.text, d.sysVoice)); return; }
      say('Stem wordt gemaakt…'); const a = await ai.azureSpeak(d.text, state.s, { voice: d.voice, pitch: d.pitch }); say(''); new Audio(objUrl(a)).play();
    } catch (e) { say(e.message, true); }
  }
  async function saveOnly(makeVideo) {
    if (!d.photo && d.ownVideo) {
      try { d.photo = await frameFromVideo(d.ownVideo); paintPhoto(); } catch { /* dan volgt de melding hieronder */ }
    }
    const err = validate(); if (err) { say(err, true); return; }
    const rec = await persist();
    if (!makeVideo) {
      if (demo && state.s.azureKey && !rec.ownVideo && !rec.audio && !rec.speech) {
        try {
          say('Stem wordt gemaakt…');
          rec.speech = await ai.azureSpeak(rec.text, state.s, { voice: rec.voice, pitch: rec.pitch });
          await db.putPerson(rec); Object.assign(d, rec, { original: rec });
        } catch (e) { say('Opgeslagen, maar de stem maken lukte niet: ' + e.message, true); return; }
      }
      state.editing = null; toast('Opgeslagen.'); render(); return;
    }
    try {
      const audio = rec.audio ? await ai.toWav(rec.audio) : await (say('Stem wordt gemaakt…'), ai.azureSpeak(rec.text, state.s, { voice: rec.voice, pitch: rec.pitch }));
      const res = await ai.didTalk(rec.photo, audio, state.s, (m) => say(m));
      rec.video = res.blob || null; rec.videoUrl = res.url || null;
      await db.putPerson(rec); Object.assign(d, rec, { original: rec });
      say(res.url ? 'Klaar, maar de video kon niet op de tablet worden bewaard en blijft maar kort beschikbaar.' : 'Klaar. Bekijk de video hieronder en sla op als het goed is.');
      paintVideo();
    } catch (e) { say(e.message, true); }
  }
  const videoBox = h('div', {});
  function paintVideo() {
    const src = d.video ? objUrl(d.video) : d.videoUrl;
    videoBox.replaceChildren(...(src ? [h('div', {}, h('p', { class: 'hint' }, 'Gemaakte video:'), h('video', { class: 'preview', controls: '', playsinline: '', src }))] : []));
  }
  paintVideo();

  return h('section', { class: 'panel' },
    h('h2', {}, d.isNew ? 'Persoon toevoegen' : 'Persoon bewerken'),
    h('label', { class: 'field' }, h('span', {}, 'Bijschrift (wat de bewoner leest)'), label),
    h('div', { class: 'field' }, h('span', {}, 'Foto'), preview,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => file.click() }, d.photo ? 'Andere foto kiezen' : 'Foto kiezen'), file),
      h('p', { class: 'hint' }, 'De foto wordt vierkant bijgesneden, met nadruk op het bovenste deel (gezicht). Kies een foto waarop het gezicht duidelijk en recht in beeld is.')),
    h('div', { class: 'field' }, h('span', {}, 'Eigen video-opname (niet verplicht)'), ownBox,
      h('p', { class: 'hint' }, 'Neem een video met geluid op van de persoon zelf (maximaal 1 minuut). Is er een eigen video, dan wordt die afgespeeld in plaats van de AI-versie, zonder de melding “Gemaakt met AI”. Een foto, tekst en stem zijn dan niet nodig: als u geen foto kiest, wordt automatisch een beeld uit de video gebruikt.')),
    h('label', { class: 'field' }, h('span', {}, 'Bericht (circa 300 tekens, 15–30 seconden)'), text, count),
    h('div', { class: 'field' }, h('span', {}, 'Eigen stem (niet verplicht)'), audioBox,
      h('p', { class: 'hint' }, 'Alleen voor een stem die iemand zelf inspreekt, bijvoorbeeld een familielid dat nog leeft. De stem van overleden personen wordt niet nagemaakt.')),
    h('div', { class: 'field' }, h('span', {}, 'Stem van deze persoon'), useSys ? sysSel : voiceSel,
      h('p', { class: 'hint' }, useSys ? 'Kies een stem van deze tablet (bijvoorbeeld Ellen of Xander). De taal stelt u in bij Instellingen. De keuze telt niet als er een eigen opname is.' : 'Kies een vrouwen- of mannenstem. De keuze telt niet als er een eigen opname is.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: listen }, icon('play'), 'Beluister')),
    videoBox,
    h('label', { class: 'check' }, consent, h('span', {}, 'Ik mag deze foto en tekst gebruiken, en dit zijn geen echte persoonsgegevens (prototype).')),
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { stopVideoRec(); state.editing = null; render(); } }, 'Annuleren'),
      h('button', { class: 'btn' + (demo ? ' btn-primary' : ''), onclick: () => saveOnly(false) }, 'Opslaan'),
      demo ? null : h('button', { class: 'btn btn-primary', onclick: () => saveOnly(true) }, 'Opslaan en video maken')));
}

/** Eerste beeld van een video -> vierkant JPEG (als er geen aparte foto is gekozen). */
async function frameFromVideo(blob, max = 1024) {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; v.load(); });
    await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(0.5, (v.duration || 1) / 2); setTimeout(res, 1500); });
    const w = v.videoWidth, hgt = v.videoHeight; if (!w || !hgt) throw new Error('geen beeld');
    const side = Math.min(w, hgt), sx = (w - side) / 2, sy = hgt > w ? (hgt - side) * 0.25 : 0;
    const size = Math.min(side, max);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(v, sx, sy, side, side, 0, 0, size, size);
    const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    if (!out) throw new Error('geen beeld');
    return out;
  } finally { URL.revokeObjectURL(url); }
}

/** Foto -> vierkant JPEG (max 1024 px), bijgesneden met nadruk op het bovenste deel. */
async function squareJpeg(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth, hgt = img.naturalHeight, side = Math.min(w, hgt);
    const sx = (w - side) / 2, sy = hgt > w ? (hgt - side) * 0.25 : 0;
    const size = Math.min(side, max);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}

/* ----- voorbeeldpersonen (verzonnen; geen echte gegevens) ----- */
function placeholderPortrait(initial, bg) {
  const c = document.createElement('canvas'); c.width = c.height = 640;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 640, 640);
  x.fillStyle = 'rgba(255,255,255,.6)';
  x.beginPath(); x.ellipse(320, 690, 270, 240, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(320, 270, 135, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(31,42,55,.75)'; x.font = 'bold 150px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(initial, 320, 275);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
}
async function loadSample() {
  const people = [
    ['Arie, vader van Erik', 'A', '#6d8fb3', 'Hallo Erik, ik ben je vader Arie. Ik ben trots op je. Je bent nooit alleen. Ik wens je een fijne dag.'],
    ['Lies, moeder van Erik', 'L', '#b07f9e', 'Dag lieve Erik, met mama. Ik denk veel aan je. Je was altijd mijn lieve jongen. Ik wens je een fijne dag.'],
    ['Erica, vrouw van Erik', 'E', '#c98b5a', 'Hallo Erik, ik ben jouw vrouw Erica. We zijn al ruim dertig jaar getrouwd, en we hebben samen drie kinderen. Ik hoop dat er goed voor je wordt gezorgd. Ik kom binnenkort graag bij je langs. Veel liefs, ik wens je een fijne dag.'],
    ['Caroline, oudste zus van Erik', 'C', '#7aa37a', 'Hoi Erik, je grote zus Caroline hier. Weet je nog dat we samen gingen fietsen? Dat was fijn. Ik denk aan je.'],
    ['Tom, broer van Erik', 'T', '#5f9ea0', 'Hé Erik, met je broer Tom. We hebben vroeger veel lol gehad. Ik hoop dat het goed met je gaat. Tot snel!'],
    ['Monica, dochter van Erik', 'M', '#c0786a', 'Hoi pap, met Monica. Ik hou van je. Ik kom snel op bezoek. Een dikke knuffel van mij.'],
    ['Susan, kleindochter van Erik', 'S', '#9a86b8', 'Hoi opa, met Susan. Ik heb een tekening voor je gemaakt. Tot snel, opa!'],
    ['Peter, vriend van Erik', 'P', '#b0a05a', 'Dag Erik, met Peter, je oude vriend. Wat hebben wij veel gelachen. Ik wens je een mooie dag.'],
  ];
  let order = state.persons.reduce((m, p) => Math.max(m, p.order), 0);
  for (const [label, ini, bg, text] of people) {
    await db.putPerson({ id: uid(), label, text, photo: await placeholderPortrait(ini, bg), audio: null, video: null, videoUrl: null, consent: true, order: ++order });
  }
  if (!state.s.patientName) { state.s.patientName = 'Erik Jansen'; await db.setSetting('patientName', 'Erik Jansen'); }
  toast('Voorbeeldpersonen toegevoegd.'); render();
}

/* ---------- start en routering ---------- */
async function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) if (k !== 'pin') state.s[k] = await db.getSetting(k, DEFAULTS[k]);
  state.s.pinHash = await db.getSetting('pinHash', null);
  if (!state.s.pinHash) { state.s.pinHash = await hash(DEFAULTS.pin); await db.setSetting('pinHash', state.s.pinHash); }
}
function armIdle() {
  clearTimeout(idleTimer);
  if (state.unlocked) idleTimer = setTimeout(() => go(''), 5 * 60 * 1000);
}
document.addEventListener('pointerdown', armIdle);

async function render(keepPersons) {
  if (keepPersons !== true) keepPersons = false;
  const token = ++renderToken;
  stopPlayback();
  const hashChanged = location.hash !== lastHash;
  if (hashChanged) { $toast.classList.remove('show'); lastHash = location.hash; }
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (!keepPersons) {
    const persons = await db.getAllPersons();
    try {
      const ids = (await db.getSetting('personOrder', [])) || [];
      const pos = new Map(ids.map((id, i) => [id, i]));
      persons.sort((x, y) => {
        const px = pos.has(x.id), py = pos.has(y.id);
        if (px && py) return pos.get(x.id) - pos.get(y.id);
        if (px !== py) return px ? -1 : 1;
        return x.order - y.order;
      });
    } catch { /* terugvallen op order */ }
    if (token !== renderToken) return;
    await preparePhotos(persons);
    if (token !== renderToken) return;
    state.persons = persons;
  }
  const oldUrls = urls; urls = [];
  if (name !== 'beheer') { state.unlocked = false; state.editing = null; }
  armIdle();
  let view;
  if (name === 'persoon') view = personView(arg);
  else if (name === 'beheer') view = state.unlocked ? beheerView() : gateView();
  else view = startView();
  $app.replaceChildren(view);
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 2000);
  if (!state.editing && hashChanged) window.scrollTo(0, 0);
}

// Voorkom per ongeluk kopiëren/delen door lang indrukken, behalve in invoervelden.
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
window.addEventListener('hashchange', render);

(async () => {
  try { await navigator.storage?.persist?.(); } catch { /* niet erg */ }
  await loadSettings();
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
