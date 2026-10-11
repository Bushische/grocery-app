/**
 * Local item-photo cache (T95).
 *
 * Why another cache when HTTP (`max-age=1y, immutable`) and the service
 * worker (CacheFirst, 365 d) already exist: neither is guaranteed — the SW
 * never runs inside some WebViews (e.g. Telegram), and HTTP revalidation
 * still costs a tunnel round-trip on a cold disk cache. This store keeps the
 * photo blobs in IndexedDB (survives restarts) plus an in-memory object-URL
 * map (zero-cost repeat renders within a session).
 *
 * Design is paint-first: callers render the `/static/…` network URL
 * immediately (browser HTTP cache serves it when it can) while `warmImageCache`
 * populates the store in the background. The next render within the TTL
 * serves an object URL and issues no network request at all.
 *
 * Filenames are content-addressed (`<itemId>-<hash>.webp`, T10): a re-upload
 * changes the key, so a stale entry under an old key is never served for the
 * new photo — it simply stops being referenced.
 */

/** Minimum freshness for a cached photo: 7 days (T95). */
export const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const IMAGE_CACHE_DB_NAME = "grocery-image-cache";
export const IMAGE_CACHE_STORE_NAME = "images";
const IMAGE_CACHE_DB_VERSION = 1;

export interface ImageCacheEntry {
  blob: Blob;
  /** `Date.now()` at store time. */
  fetchedAt: number;
}

export interface ImageCacheBackend {
  get(filename: string): Promise<ImageCacheEntry | null>;
  set(filename: string, entry: ImageCacheEntry): Promise<void>;
}

/** Fresh when stored no more than TTL ago (clock skew → treat as stale). */
export function isImageCacheEntryFresh(entry: ImageCacheEntry, now: number = Date.now()): boolean {
  return now - entry.fetchedAt >= 0 && now - entry.fetchedAt <= IMAGE_CACHE_TTL_MS;
}

/** The network URL every photo view renders before the cache resolves. */
export function imageNetworkUrl(filename: string): string {
  return `/static/${filename}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_CACHE_DB_NAME, IMAGE_CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_CACHE_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_CACHE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
  });
}

function runInStore<T>(
  db: Promise<IDBDatabase>,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db.then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(IMAGE_CACHE_STORE_NAME, mode);
        const request = run(tx.objectStore(IMAGE_CACHE_STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

/** Production backend: IndexedDB, or a no-op when IndexedDB is unavailable. */
function indexedDbBackend(): ImageCacheBackend {
  if (typeof indexedDB === "undefined") {
    return {
      get: async () => null,
      set: async () => undefined,
    };
  }
  let db: Promise<IDBDatabase> | null = null;
  const database = () => {
    db ??= openDatabase().catch((error) => {
      // A denied/corrupt database must never break photo rendering —
      // fall back to memory-only for the rest of the session.
      db = null;
      throw error;
    });
    return db;
  };
  return {
    get: (filename) =>
      runInStore(database(), "readonly", (store) => store.get(filename)).catch(() => null),
    set: (filename, entry) =>
      runInStore(database(), "readwrite", (store) => store.put(entry, filename))
        .then(() => undefined)
        .catch(() => undefined),
  };
}

/** In-memory backend factory — used by tests (jsdom has no IndexedDB). */
export function createMemoryImageCacheBackend(
  initial: Record<string, ImageCacheEntry> = {},
): ImageCacheBackend & { entries: Map<string, ImageCacheEntry> } {
  const entries = new Map<string, ImageCacheEntry>(Object.entries(initial));
  return {
    entries,
    get: async (filename) => entries.get(filename) ?? null,
    set: async (filename, entry) => {
      entries.set(filename, entry);
    },
  };
}

let backend: ImageCacheBackend | null = null;

/** Override the store (tests). Call with no args to restore the default. */
export function setImageCacheBackend(next: ImageCacheBackend | null): void {
  backend = next;
}

function activeBackend(): ImageCacheBackend {
  backend ??= indexedDbBackend();
  return backend;
}

/** Session object URLs: filename → blob: URL (avoids re-creating URLs). */
const memoryUrls = new Map<string, string>();

export function getMemoryImageUrl(filename: string): string | null {
  return memoryUrls.get(filename) ?? null;
}

export function clearImageMemoryCache(): void {
  for (const url of memoryUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore — revoking is best-effort cleanup.
    }
  }
  memoryUrls.clear();
}

export interface WarmImageCacheDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  createObjectUrl?: (blob: Blob) => string | null;
}

function defaultCreateObjectUrl(blob: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Resolve `filename` to a same-session object URL, warming the store as a
 * side effect. Returns the object URL on a fresh hit (memory or backend) or
 * after a successful background fetch, else null. Never rejects — callers
 * fall back to {@link imageNetworkUrl}.
 */
export async function warmImageCache(
  filename: string,
  deps: WarmImageCacheDeps = {},
): Promise<string | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const createObjectUrl = deps.createObjectUrl ?? defaultCreateObjectUrl;
  const store = activeBackend();

  const memorized = memoryUrls.get(filename);
  if (memorized) return memorized;

  try {
    const cached = await store.get(filename);
    if (cached && isImageCacheEntryFresh(cached, now())) {
      const url = createObjectUrl(cached.blob);
      if (url) {
        memoryUrls.set(filename, url);
        return url;
      }
    }
  } catch {
    // A failing store degrades to network — photo rendering must not break.
  }

  try {
    const response = await fetchFn(imageNetworkUrl(filename));
    if (!response.ok) return null;
    const blob = await response.blob();
    const stored: ImageCacheEntry = { blob, fetchedAt: now() };
    await store.set(filename, stored);
    const url = createObjectUrl(blob);
    if (url) {
      memoryUrls.set(filename, url);
      return url;
    }
    return null;
  } catch {
    return null;
  }
}
