import { generateIdentity, type Identity } from "./index";

/**
 * Browser-only identity storage. The X25519 secret key lives in IndexedDB and
 * NEVER leaves the device. Clearing browser data means losing message history —
 * documented, acceptable for MVP; multi-device sync is a later phase.
 */

const DB_NAME = "0c-keys";
const STORE = "identity";
const KEY = "self";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Load the device identity, creating + persisting one on first use. */
export async function loadOrCreateIdentity(): Promise<Identity> {
  const existing = await tx<Identity | undefined>("readonly", (s) => s.get(KEY));
  if (existing?.publicKey && existing?.secretKey) return existing;
  const id = generateIdentity();
  await tx("readwrite", (s) => s.put(id, KEY));
  return id;
}

export async function getIdentity(): Promise<Identity | null> {
  const existing = await tx<Identity | undefined>("readonly", (s) => s.get(KEY));
  return existing ?? null;
}
