/**
 * Cloud Speak MP3s persist in the browser, keyed by the exact translation.
 * A clip is reused until the text (or the voice that reads it) changes, so
 * Speak and Replay stop re-synthesizing lines the cloud already voiced —
 * before this cache, every press was a fresh provider call against the
 * daily guard, and any failure quietly dropped the card to the browser
 * voice with no file to save.
 *
 * Only clips the provider actually returned are stored: callers pass the
 * blob from a successful /api/speak response, never a fallback. A cache
 * that cannot be read or written (private mode, an old browser) must
 * never block speaking, so every operation fails soft.
 */

export type SpeakCacheClip = {
  blob: Blob;
  contentType: string;
};

const CACHE_DB_NAME = "pigin-speak-cache";
const CACHE_STORE = "clips";
const CACHE_VERSION = 1;

/** Clips are cheap to re-make; keep the store from growing without bound. */
export const SPEAK_CACHE_MAX_ENTRIES = 60;

type StoredClip = SpeakCacheClip & {
  key: string;
  storedAt: number;
};

/**
 * The material the cache key hashes. The exact translation text is in it,
 * so an edited or re-translated line keys a fresh clip; the voice is in
 * it, so a voice change never replays the old reader.
 */
export function speakCacheKeyMaterial(
  language: "naija" | "yoruba",
  voice: string | null | undefined,
  text: string,
): string {
  return ["pigin-speak-v1", language, voice ?? "", text].join("\n");
}

export async function speakCacheKey(
  language: "naija" | "yoruba",
  voice: string | null | undefined,
  text: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(speakCacheKeyMaterial(language, voice, text)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getCachedSpeakClip(
  language: "naija" | "yoruba",
  voice: string | null | undefined,
  text: string,
): Promise<SpeakCacheClip | null> {
  try {
    const db = await openCacheDb();
    if (!db) return null;
    const key = await speakCacheKey(language, voice, text);
    const store = db
      .transaction(CACHE_STORE, "readonly")
      .objectStore(CACHE_STORE);
    const stored = await idbRequest<StoredClip | undefined>(store.get(key));
    if (!stored || stored.blob.size === 0) return null;
    return { blob: stored.blob, contentType: stored.contentType };
  } catch {
    return null;
  }
}

export async function storeSpeakClip(
  language: "naija" | "yoruba",
  voice: string | null | undefined,
  text: string,
  clip: SpeakCacheClip,
): Promise<void> {
  try {
    if (clip.blob.size === 0) return;
    const db = await openCacheDb();
    if (!db) return;
    const record: StoredClip = {
      key: await speakCacheKey(language, voice, text),
      blob: clip.blob,
      contentType: clip.contentType,
      storedAt: Date.now(),
    };
    const store = db
      .transaction(CACHE_STORE, "readwrite")
      .objectStore(CACHE_STORE);
    await idbRequest(store.put(record));
    await evictOldest(db);
  } catch {
    // Losing a cache write only costs a future re-synthesis.
  }
}

async function evictOldest(db: IDBDatabase): Promise<void> {
  const readStore = db
    .transaction(CACHE_STORE, "readonly")
    .objectStore(CACHE_STORE);
  const all = await idbRequest<StoredClip[]>(readStore.getAll());
  if (all.length <= SPEAK_CACHE_MAX_ENTRIES) return;
  const doomed = [...all]
    .sort((a, b) => a.storedAt - b.storedAt)
    .slice(0, all.length - SPEAK_CACHE_MAX_ENTRIES);
  const transaction = db.transaction(CACHE_STORE, "readwrite");
  const writeStore = transaction.objectStore(CACHE_STORE);
  for (const row of doomed) writeStore.delete(row.key);
  await idbTransactionDone(transaction);
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}
