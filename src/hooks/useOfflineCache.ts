import { useState, useEffect, useCallback } from 'react';
import { saveCollectionCache, getCollectionCache } from '../lib/indexedDbCache';

/**
 * Hook para sincronizar automaticamente dados em tempo real com o IndexedDB.
 * Se a conexão estiver offline ou o Firestore falhar/estiver vazio,
 * retorna os registros armazenados no cache local do IndexedDB.
 */
export function useOfflineCache<T extends { id: string }>(
  collectionName: string,
  liveData: T[],
  loading: boolean = false
) {
  const [cachedData, setCachedData] = useState<T[]>([]);
  const [isUsingCache, setIsUsingCache] = useState<boolean>(false);
  const [cacheLoaded, setCacheLoaded] = useState<boolean>(false);

  // Carrega do IndexedDB na inicialização ou quando offline
  const loadOfflineCache = useCallback(async () => {
    try {
      const items = await getCollectionCache<T>(collectionName);
      if (items && items.length > 0) {
        setCachedData(items);
        setIsUsingCache(true);
      }
    } catch (err) {
      console.warn(`[useOfflineCache] Falha ao carregar cache de "${collectionName}":`, err);
    } finally {
      setCacheLoaded(true);
    }
  }, [collectionName]);

  useEffect(() => {
    // Se temos dados vivos do Firestore, grava no IndexedDB e usa live
    if (liveData && liveData.length > 0) {
      setCachedData(liveData);
      setIsUsingCache(false);
      setCacheLoaded(true);
      saveCollectionCache(collectionName, liveData);
    } else if (!loading && (!liveData || liveData.length === 0)) {
      // Se não vieram dados ou a rede falhou, recupera do IndexedDB
      loadOfflineCache();
    }
  }, [collectionName, liveData, loading, loadOfflineCache]);

  // Força recarga manual do cache do IndexedDB
  const refreshCache = useCallback(async () => {
    await loadOfflineCache();
  }, [loadOfflineCache]);

  const effectiveData = (liveData && liveData.length > 0) ? liveData : cachedData;

  return {
    data: effectiveData,
    isUsingCache: isUsingCache && (!liveData || liveData.length === 0),
    cacheCount: cachedData.length,
    cacheLoaded,
    refreshCache
  };
}
