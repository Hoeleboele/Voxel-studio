const DB_NAME = 'voxel-character-studio'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const kvGet = <T>(key: string): Promise<T | undefined> => run('readonly', (s) => s.get(key))
export const kvSet = (key: string, value: unknown): Promise<IDBValidKey> => run('readwrite', (s) => s.put(value, key))
export const kvDel = (key: string): Promise<undefined> => run('readwrite', (s) => s.delete(key))
export const kvKeys = (): Promise<IDBValidKey[]> => run('readonly', (s) => s.getAllKeys())
