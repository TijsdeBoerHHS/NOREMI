// AI-koppelingen volgens het keuzeonderzoek: Azure AI Speech (spraak) + D-ID (foto-animatie met lipsync).
// Let op: de aanroepen gaan rechtstreeks vanuit de browser met sleutels die lokaal op de tablet staan.
// Dat is acceptabel voor een prototype zonder backend, niet voor productie.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function explain(status, service) {
  if (status === 401 || status === 403) return `${service}: de sleutel is niet geldig of heeft geen toegang (${status}).`;
  if (status === 402) return `${service}: tegoed of abonnement is op (${status}).`;
  if (status === 429) return `${service}: te veel aanvragen, probeer het zo opnieuw (${status}).`;
  return `${service}: er ging iets mis (${status}).`;
}

async function call(service, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`${service}: geen verbinding. Controleer internet, of de dienst blokkeert de aanvraag (CORS).`);
  }
  if (!res.ok) throw new Error(explain(res.status, service));
  return res;
}

// Azure heeft voor nl-NL drie stemmen.
export const VOICES = [
  { id: 'nl-NL-FennaNeural', label: 'Fenna – vrouw' },
  { id: 'nl-NL-ColetteNeural', label: 'Colette – vrouw' },
  { id: 'nl-NL-MaartenNeural', label: 'Maarten – man' },
];
export const PRESETS = [
  { id: 'fenna', group: 'Vrouw', label: 'Fenna', voice: 'nl-NL-FennaNeural', pitch: '' },
  { id: 'colette', group: 'Vrouw', label: 'Colette', voice: 'nl-NL-ColetteNeural', pitch: '' },
  { id: 'maarten', group: 'Man', label: 'Maarten', voice: 'nl-NL-MaartenNeural', pitch: '' },
];

/** Tekst -> mp3 via Azure AI Speech. Rustig tempo en pauzes tussen zinnen (SSML). opts: { voice, pitch } per persoon. */
export async function azureSpeak(text, s, opts = {}) {
  if (!s.azureKey) throw new Error('Vul eerst de Azure-sleutel in bij Instellingen.');
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) || [text];
  const body = parts.map((p) => esc(p.trim())).filter(Boolean).join('<break time="600ms"/>');
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="nl-NL">` +
    `<voice name="${esc(opts.voice || s.azureVoice)}"><prosody rate="-15%"${opts.pitch ? ` pitch="${esc(opts.pitch)}"` : ''}>${body}</prosody></voice></speak>`;
  const res = await call('Azure Speech', `https://${encodeURIComponent(s.azureRegion)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': s.azureKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: ssml,
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

/** Elke opname (webm/m4a) -> 16-bit mono WAV, zodat D-ID er zeker mee overweg kan. */
export async function toWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let audio;
  try {
    audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }
  const ch = audio.getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + ch.length * 2));
  const w = (o, str) => [...str].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); view.setUint32(4, 36 + ch.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, ch.length * 2, true);
  for (let i = 0; i < ch.length; i++) {
    const v = Math.max(-1, Math.min(1, ch[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

const DID = 'https://api.d-id.com';

async function didUpload(endpoint, field, blob, filename, key) {
  const fd = new FormData();
  fd.append(field, blob, filename);
  const res = await call('D-ID', `${DID}/${endpoint}`, { method: 'POST', headers: { Authorization: `Basic ${key}` }, body: fd });
  const json = await res.json();
  if (!json.url) throw new Error('D-ID gaf geen bestandsadres terug bij het uploaden.');
  return json.url;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Foto + audio -> pratende video (mp4) via D-ID.
 * Geeft { blob } terug, of { url } als de browser het eindbestand niet mag downloaden (de url verloopt dan).
 */
export async function didTalk(photo, audio, s, onStatus = () => {}) {
  if (!s.didKey) throw new Error('Vul eerst de D-ID-sleutel in bij Instellingen.');
  const key = s.didKey;
  onStatus('Foto uploaden…');
  const imageUrl = await didUpload('images', 'image', photo, 'foto.jpg', key);
  onStatus('Stem uploaden…');
  const ext = audio.type.includes('wav') ? 'wav' : 'mp3';
  const audioUrl = await didUpload('audios', 'audio', audio, `stem.${ext}`, key);
  onStatus('Video wordt gemaakt… dit duurt ongeveer een minuut.');
  const created = await call('D-ID', `${DID}/talks`, {
    method: 'POST',
    headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_url: imageUrl, script: { type: 'audio', audio_url: audioUrl }, config: { stitch: true } }),
  });
  const { id } = await created.json();
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const r = await call('D-ID', `${DID}/talks/${id}`, { headers: { Authorization: `Basic ${key}` } });
    const t = await r.json();
    if (t.status === 'done' && t.result_url) {
      onStatus('Video ophalen…');
      try {
        const v = await fetch(t.result_url);
        if (!v.ok) throw new Error();
        return { blob: new Blob([await v.arrayBuffer()], { type: 'video/mp4' }) };
      } catch {
        return { url: t.result_url };
      }
    }
    if (t.status === 'error' || t.status === 'rejected') {
      throw new Error('D-ID kon geen video maken: ' + (t.error?.description || t.error?.kind || 'onbekende reden (is er een duidelijk gezicht op de foto?)'));
    }
  }
  throw new Error('D-ID doet er te lang over. Probeer het later opnieuw.');
}
