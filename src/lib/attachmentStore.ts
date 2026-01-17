/**
 * IndexedDB-based attachment storage for chat messages.
 * Stores actual blob data so images persist across page reloads.
 */

const DB_NAME = "echo-attachments";
const DB_VERSION = 1;
const STORE_NAME = "files";

export interface StoredAttachment {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  size: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Failed to open IndexedDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });

  return dbPromise;
}

/**
 * Save an attachment blob to IndexedDB
 */
export async function putAttachment(attachment: StoredAttachment): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(attachment);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Failed to save attachment:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Get an attachment blob from IndexedDB
 */
export async function getAttachment(id: string): Promise<StoredAttachment | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => {
      console.error("Failed to get attachment:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Get just the blob for an attachment
 */
export async function getAttachmentBlob(id: string): Promise<Blob | null> {
  const attachment = await getAttachment(id);
  return attachment?.blob || null;
}

/**
 * Delete an attachment from IndexedDB
 */
export async function deleteAttachment(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Failed to delete attachment:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete multiple attachments
 */
export async function deleteAttachments(ids: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    
    let completed = 0;
    let hasError = false;

    ids.forEach((id) => {
      const request = store.delete(id);
      request.onsuccess = () => {
        completed++;
        if (completed === ids.length && !hasError) {
          resolve();
        }
      };
      request.onerror = () => {
        if (!hasError) {
          hasError = true;
          console.error("Failed to delete attachment:", id, request.error);
          reject(request.error);
        }
      };
    });

    if (ids.length === 0) {
      resolve();
    }
  });
}

/**
 * Clear all attachments from IndexedDB
 */
export async function clearAllAttachments(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Failed to clear attachments:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Check if IndexedDB is available
 */
export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
