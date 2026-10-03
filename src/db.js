// Saves your game library in the browser (IndexedDB).
// Two stores: 'games' (name, core, size...) and 'roms' (the actual file data).
// This file has no React in it: it just returns results, and App.jsx shows messages.

const DB_NAME = 'EmulatorJSLibraryDB';
const DB_VERSION = 2;
let db = null;

export function initDB() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const dbInstance = e.target.result;
        const oldVersion = e.oldVersion;
        const tx = e.target.transaction;

        const gamesStore = dbInstance.objectStoreNames.contains('games')
          ? tx.objectStore('games')
          : dbInstance.createObjectStore('games', { keyPath: 'id' });
        const romsStore = dbInstance.objectStoreNames.contains('roms')
          ? tx.objectStore('roms')
          : dbInstance.createObjectStore('roms', { keyPath: 'id' });

        // Migration v1 -> v2: move ROM data out of 'games' into 'roms'
        if (oldVersion === 1) {
          const cursorReq = gamesStore.openCursor();
          cursorReq.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const record = cursor.value;
            let romBlob = null;
            if (record.blob instanceof Blob) {
              romBlob = record.blob;
            } else if (record.buffer instanceof ArrayBuffer || ArrayBuffer.isView(record.buffer)) {
              romBlob = new Blob([record.buffer]);
            }
            if (romBlob && record.id) romsStore.put({ id: record.id, blob: romBlob });
            delete record.buffer;
            delete record.blob;
            delete record.rawBuffer;
            cursor.update(record);
            cursor.continue();
          };
        }
      };

      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(true);
      };
      request.onerror = () => resolve(false);
    } catch (err) {
      console.warn('IndexedDB initialization failed:', err);
      resolve(false);
    }
  });
}

// Resolves to 'ok' | 'quota' | 'error' | 'unavailable'
export function saveGame(metadata, romBlob) {
  return new Promise((resolve) => {
    if (!db) return resolve('unavailable');
    try {
      const tx = db.transaction(['games', 'roms'], 'readwrite');
      tx.oncomplete = () => resolve('ok');
      tx.onabort = tx.onerror = () => {
        const err = tx.error;
        const isQuota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
        resolve(isQuota ? 'quota' : 'error');
      };
      tx.objectStore('games').put(metadata);
      tx.objectStore('roms').put({ id: metadata.id, blob: romBlob });
    } catch (err) {
      resolve(err.name === 'QuotaExceededError' ? 'quota' : 'error');
    }
  });
}

export function loadGames() {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      const request = db.transaction('games', 'readonly').objectStore('games').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export function getRomBlob(id) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const request = db.transaction('roms', 'readonly').objectStore('roms').get(id);
      request.onsuccess = () => {
        const r = request.result;
        if (r && r.blob instanceof Blob) resolve(r.blob);
        else if (r && r.buffer) resolve(new Blob([r.buffer]));
        else resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function deleteGame(id) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(['games', 'roms'], 'readwrite');
      tx.objectStore('games').delete(id);
      tx.objectStore('roms').delete(id);
      tx.oncomplete = tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function clearAllGames() {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(['games', 'roms'], 'readwrite');
      tx.objectStore('games').clear();
      tx.objectStore('roms').clear();
      tx.oncomplete = tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
