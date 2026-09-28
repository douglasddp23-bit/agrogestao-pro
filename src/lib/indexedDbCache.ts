/**
 * SERVIÇO DE CACHE LOCAL ROBUSTO COM INDEXEDDB - AgroGestão Pro
 * 
 * Permite armazenamento e consulta offline resiliente de dados do Firestore.
 * Quando o dispositivo está offline ou a conexão Firebase oscila,
 * o sistema lê do banco IndexedDB local do navegador.
 */

const DB_NAME = 'AgroGestaoPro_IndexedDB_Cache';
const DB_VERSION = 1;
const RECORDS_STORE = 'records_cache';
const METADATA_STORE = 'collections_metadata';

export interface CacheMetadata {
  collectionName: string;
  count: number;
  lastUpdated: string;
}

export interface CachedRecord<T = any> {
  id: string; // Composite key `${collectionName}_${docId}`
  collectionName: string;
  docId: string;
  data: T;
  cachedAt: string;
}

// Abre ou inicializa a conexão com o IndexedDB
export function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB não é suportado neste ambiente.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store para os registros de cada coleção
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        const recordsStore = db.createObjectStore(RECORDS_STORE, { keyPath: 'id' });
        recordsStore.createIndex('collectionName', 'collectionName', { unique: false });
        recordsStore.createIndex('cachedAt', 'cachedAt', { unique: false });
      }

      // Store para metadados de coleções
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'collectionName' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[IndexedDB Cache] Erro ao abrir IndexedDB:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Salva ou atualiza uma lista inteira de documentos de uma coleção no IndexedDB
 */
export async function saveCollectionCache<T extends { id: string }>(
  collectionName: string,
  items: T[]
): Promise<void> {
  if (!items || items.length === 0) return;

  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE, METADATA_STORE], 'readwrite');
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const metadataStore = tx.objectStore(METADATA_STORE);

    const now = new Date().toISOString();

    items.forEach((item) => {
      if (!item.id) return;
      const compositeId = `${collectionName}_${item.id}`;
      recordsStore.put({
        id: compositeId,
        collectionName,
        docId: item.id,
        data: JSON.parse(JSON.stringify(item)), // Limpa protótipos/funções
        cachedAt: now
      } as CachedRecord<T>);
    });

    metadataStore.put({
      collectionName,
      count: items.length,
      lastUpdated: now
    } as CacheMetadata);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        console.error(`[IndexedDB Cache] Erro ao salvar coleção "${collectionName}":`, tx.error);
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn(`[IndexedDB Cache Warning] Não foi possível armazenar "${collectionName}":`, err);
  }
}

/**
 * Recupera todos os registros armazenados em cache para uma coleção específica
 */
export async function getCollectionCache<T = any>(collectionName: string): Promise<T[]> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE], 'readonly');
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const index = recordsStore.index('collectionName');

    const request = index.getAll(IDBKeyRange.only(collectionName));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const rawList: CachedRecord<T>[] = request.result || [];
        const items = rawList.map((entry) => entry.data);
        resolve(items);
      };
      request.onerror = () => {
        console.error(`[IndexedDB Cache] Erro ao recuperar coleção "${collectionName}":`, request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn(`[IndexedDB Cache Warning] Falha ao ler cache de "${collectionName}":`, err);
    return [];
  }
}

/**
 * Salva um único documento no cache do IndexedDB
 */
export async function saveDocumentCache<T extends { id: string }>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  if (!docId) return;

  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE], 'readwrite');
    const recordsStore = tx.objectStore(RECORDS_STORE);

    const now = new Date().toISOString();
    const compositeId = `${collectionName}_${docId}`;

    recordsStore.put({
      id: compositeId,
      collectionName,
      docId,
      data: JSON.parse(JSON.stringify(data)),
      cachedAt: now
    } as CachedRecord<T>);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB Cache Warning] Falha ao salvar documento no cache "${docId}":`, err);
  }
}

/**
 * Recupera um único documento do cache do IndexedDB
 */
export async function getDocumentCache<T = any>(
  collectionName: string,
  docId: string
): Promise<T | null> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE], 'readonly');
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const compositeId = `${collectionName}_${docId}`;

    const request = recordsStore.get(compositeId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const record: CachedRecord<T> | undefined = request.result;
        resolve(record ? record.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB Cache Warning] Falha ao ler documento "${docId}":`, err);
    return null;
  }
}

/**
 * Obtém estatísticas do cache para exibir no painel de monitoramento
 */
export async function getCacheSummary(): Promise<{
  totalRecordsCount: number;
  collections: CacheMetadata[];
  lastCacheTime: string | null;
}> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE, METADATA_STORE], 'readonly');
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const metadataStore = tx.objectStore(METADATA_STORE);

    const countReq = recordsStore.count();
    const metadataReq = metadataStore.getAll();

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        const totalRecordsCount = countReq.result || 0;
        const collections: CacheMetadata[] = metadataReq.result || [];

        let lastCacheTime: string | null = null;
        collections.forEach((c) => {
          if (!lastCacheTime || (c.lastUpdated && c.lastUpdated > lastCacheTime)) {
            lastCacheTime = c.lastUpdated;
          }
        });

        resolve({
          totalRecordsCount,
          collections,
          lastCacheTime
        });
      };

      tx.onerror = () => {
        resolve({
          totalRecordsCount: 0,
          collections: [],
          lastCacheTime: null
        });
      };
    });
  } catch {
    return {
      totalRecordsCount: 0,
      collections: [],
      lastCacheTime: null
    };
  }
}

/**
 * Limpa todo o cache IndexedDB
 */
export async function clearAllCache(): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction([RECORDS_STORE, METADATA_STORE], 'readwrite');
    tx.objectStore(RECORDS_STORE).clear();
    tx.objectStore(METADATA_STORE).clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IndexedDB Cache] Erro ao limpar cache:', err);
  }
}
