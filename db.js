// Lokale opslag (IndexedDB): personen met foto/audio/video als Blob, en instellingen.
const DB_NAME = 'noremi';
const DB_VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('persons', { keyPath: 'id' });
        db.createObjectStore('settings');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAllPersons = () =>
  tx('persons', 'readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => x.order - y.order));
export const putPerson = (p) => tx('persons', 'readwrite', (s) => s.put(p));
export const deletePerson = (id) => tx('persons', 'readwrite', (s) => s.delete(id));

export const getSetting = (k, fallback) =>
  tx('settings', 'readonly', (s) => s.get(k)).then((v) => (v === undefined ? fallback : v));
export const setSetting = (k, v) => tx('settings', 'readwrite', (s) => s.put(v, k));

export async function clearAll() {
  await tx('persons', 'readwrite', (s) => s.clear());
  await tx('settings', 'readwrite', (s) => s.clear());
}
