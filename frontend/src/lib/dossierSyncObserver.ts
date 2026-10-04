import { onAuthStateChanged } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  getDocs,
  Unsubscribe 
} from 'firebase/firestore';
import { useEffect, useState, useCallback } from 'react';
import { db, auth, ensureDocumentFolder } from './firebase';
import { JudicialExpertise, RuralPropertyValuation } from '../types';

export type SyncBadgeState = 'synced' | 'syncing' | 'recent' | 'unlinked' | 'pending';

export interface SyncStatusInfo {
  serviceId: string;
  serviceType: 'judicial_expertise' | 'rural_valuation' | 'contract' | 'field_visit' | 'general' | string;
  serviceName: string;
  clientId: string;
  status: SyncBadgeState;
  statusLabel: string;
  documentsCount: number;
  lastSyncedAt?: string;
  isRecent?: boolean;
  hasOfficialPdf?: boolean;
}

type SyncListener = (statusMap: Record<string, SyncStatusInfo>, recentEvent?: SyncStatusInfo) => void;

class DossierSyncManager {
  private static instance: DossierSyncManager;
  private listeners: Set<SyncListener> = new Set();
  private syncStatusMap: Map<string, SyncStatusInfo> = new Map();
  private activeSubscriptions: Unsubscribe[] = [];
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): DossierSyncManager {
    if (!DossierSyncManager.instance) {
      DossierSyncManager.instance = new DossierSyncManager();
    }
    return DossierSyncManager.instance;
  }

  public initGlobalObservers() {
    if (this.isInitialized || !auth.currentUser) return;
    this.isInitialized = true;

    try {
      // 1. Observer for judicial_expertises
      const unsubJudicial = onSnapshot(collection(db, 'judicial_expertises'), async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const data = change.doc.data() as JudicialExpertise;
          const serviceId = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            // Check & ensure folder in 'documents'
            if (data.clientId) {
              const count = await this.verifyAndCountDocuments(serviceId);
              const info: SyncStatusInfo = {
                serviceId,
                serviceType: 'judicial_expertise',
                serviceName: `Perícia Judicial: Proc. ${data.processNumber || serviceId}`,
                clientId: data.clientId,
                status: count > 0 ? (change.type === 'added' ? 'recent' : 'synced') : 'syncing',
                statusLabel: count > 0 ? (change.type === 'added' ? 'Novo Dossiê Sincronizado' : 'Dossiê Sincronizado') : 'Sincronizando...',
                documentsCount: count,
                lastSyncedAt: new Date().toISOString(),
                isRecent: change.type === 'added',
                hasOfficialPdf: count > 0
              };

              this.syncStatusMap.set(serviceId, info);
              this.notifyListeners(info);

              // If count is 0 on addition, ensure document folder asynchronously
              if (count === 0 && data.clientId) {
                ensureDocumentFolder({
                  clientId: data.clientId,
                  serviceId,
                  serviceName: `Perícia Judicial: Proc. ${data.processNumber || ''}`,
                  processNumber: data.processNumber,
                  category: 'Perícia',
                  folderType: 'judicial_expertise',
                  metadata: {
                    comarca: data.comarca,
                    vara: data.vara,
                    requerente: data.requerente,
                    requerido: data.requerido
                  }
                }).then(() => {
                  this.verifyAndCountDocuments(serviceId).then((newCount) => {
                    const updatedInfo: SyncStatusInfo = {
                      ...info,
                      status: 'synced',
                      statusLabel: 'Dossiê Sincronizado',
                      documentsCount: newCount,
                      hasOfficialPdf: newCount > 0
                    };
                    this.syncStatusMap.set(serviceId, updatedInfo);
                    this.notifyListeners(updatedInfo);
                  });
                }).catch(err => {
                  console.warn('[DossierSyncManager] Auto-ensure folder error:', err);
                });
              }
            }
          } else if (change.type === 'removed') {
            this.syncStatusMap.delete(serviceId);
            this.notifyListeners();
          }
        }
      }, (err) => console.warn('[DossierSyncManager] Judicial observer error:', err));

      // 2. Observer for rural_valuations
      const unsubValuations = onSnapshot(collection(db, 'rural_valuations'), async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const data = change.doc.data() as RuralPropertyValuation;
          const serviceId = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            if (data.clientId) {
              const count = await this.verifyAndCountDocuments(serviceId);
              const info: SyncStatusInfo = {
                serviceId,
                serviceType: 'rural_valuation',
                serviceName: `Avaliação NBR 14.653: ${data.propertyName || serviceId}`,
                clientId: data.clientId,
                status: count > 0 ? (change.type === 'added' ? 'recent' : 'synced') : 'syncing',
                statusLabel: count > 0 ? (change.type === 'added' ? 'Nova Avaliação Sincronizada' : 'Laudo NBR Sincronizado') : 'Sincronizando...',
                documentsCount: count,
                lastSyncedAt: new Date().toISOString(),
                isRecent: change.type === 'added',
                hasOfficialPdf: count > 0
              };

              this.syncStatusMap.set(serviceId, info);
              this.notifyListeners(info);

              if (count === 0 && data.clientId) {
                ensureDocumentFolder({
                  clientId: data.clientId,
                  serviceId,
                  serviceName: `Avaliação de Imóvel: ${data.propertyName || ''}`,
                  category: 'Avaliação Rural',
                  folderType: 'rural_valuation',
                  metadata: {
                    propertyName: data.propertyName,
                    propertyCity: data.propertyCity,
                    totalArea: data.totalArea,
                    totalValue: data.totalValue
                  }
                }).then(() => {
                  this.verifyAndCountDocuments(serviceId).then((newCount) => {
                    const updatedInfo: SyncStatusInfo = {
                      ...info,
                      status: 'synced',
                      statusLabel: 'Laudo NBR Sincronizado',
                      documentsCount: newCount,
                      hasOfficialPdf: newCount > 0
                    };
                    this.syncStatusMap.set(serviceId, updatedInfo);
                    this.notifyListeners(updatedInfo);
                  });
                }).catch(err => {
                  console.warn('[DossierSyncManager] Auto-ensure valuation folder error:', err);
                });
              }
            }
          } else if (change.type === 'removed') {
            this.syncStatusMap.delete(serviceId);
            this.notifyListeners();
          }
        }
      }, (err) => console.warn('[DossierSyncManager] Valuation observer error:', err));

      // 3. Observer for documents changes to keep document counts real-time
      const unsubDocs = onSnapshot(collection(db, 'documents'), (snapshot) => {
        // Group by serviceId
        const countMap = new Map<string, number>();
        for (const docItem of snapshot.docs) {
          const sId = docItem.data().serviceId;
          if (sId && docItem.data().url) {
            countMap.set(sId, (countMap.get(sId) || 0) + 1);
          }
        }

        // Update active sync status map
        let hasChanges = false;
        this.syncStatusMap.forEach((info, serviceId) => {
          const actualCount = countMap.get(serviceId) || 0;
          if (info.documentsCount !== actualCount) {
            info.documentsCount = actualCount;
            info.status = actualCount > 0 ? 'synced' : 'pending';
            info.hasOfficialPdf = actualCount > 0;
            hasChanges = true;
          }
        });

        if (hasChanges) {
          this.notifyListeners();
        }
      }, (err) => console.warn('[DossierSyncManager] Documents observer error:', err));

      this.activeSubscriptions.push(unsubJudicial, unsubValuations, unsubDocs);
    } catch (e) {
      console.error('[DossierSyncManager] Error starting observers:', e);
    }
  }

  private async verifyAndCountDocuments(serviceId: string): Promise<number> {
    try {
      const q = query(collection(db, 'documents'), where('serviceId', '==', serviceId));
      const snap = await getDocs(q);
      return snap.docs.filter(d => !!d.data().url).length;
    } catch {
      return 0;
    }
  }

  public reset() {
    this.activeSubscriptions.forEach(unsubscribe => unsubscribe());
    this.activeSubscriptions = [];
    this.syncStatusMap.clear();
    this.isInitialized = false;
    this.notifyListeners();
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    // Trigger initial state
    const currentMap = Object.fromEntries(this.syncStatusMap.entries());
    listener(currentMap);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(recentEvent?: SyncStatusInfo) {
    const currentMap = Object.fromEntries(this.syncStatusMap.entries());
    this.listeners.forEach((listener) => {
      try {
        listener(currentMap, recentEvent);
      } catch (err) {
        console.error('[DossierSyncManager] Listener error:', err);
      }
    });
  }

  public getStatus(serviceId: string): SyncStatusInfo | undefined {
    return this.syncStatusMap.get(serviceId);
  }

  public setStatus(serviceId: string, status: SyncStatusInfo) {
    this.syncStatusMap.set(serviceId, status);
    this.notifyListeners(status);
  }
}

export const dossierSyncManager = DossierSyncManager.getInstance();

// Auto-start observers on module load in browser
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, () => {
    dossierSyncManager.reset();
    dossierSyncManager.initGlobalObservers();
  });
}

/**
 * React hook to observe live dossier synchronization statuses across services.
 */
export function useDossierLiveSync(clientId?: string) {
  const [syncStatusMap, setSyncStatusMap] = useState<Record<string, SyncStatusInfo>>({});
  const [recentSyncEvent, setRecentSyncEvent] = useState<SyncStatusInfo | null>(null);

  useEffect(() => {
    dossierSyncManager.initGlobalObservers();

    const unsubscribe = dossierSyncManager.subscribe((statusMap, recentEvent) => {
      if (clientId) {
        // Filter by clientId if provided
        const filtered: Record<string, SyncStatusInfo> = {};
        Object.entries(statusMap).forEach(([id, info]) => {
          if (info.clientId === clientId) {
            filtered[id] = info;
          }
        });
        setSyncStatusMap(filtered);
      } else {
        setSyncStatusMap(statusMap);
      }

      if (recentEvent && (!clientId || recentEvent.clientId === clientId)) {
        setRecentSyncEvent(recentEvent);
      }
    });

    return unsubscribe;
  }, [clientId]);

  const getServiceSyncInfo = useCallback((serviceId: string): SyncStatusInfo => {
    if (syncStatusMap[serviceId]) {
      return syncStatusMap[serviceId];
    }
    return {
      serviceId,
      serviceType: 'service',
      serviceName: 'Serviço',
      clientId: clientId || '',
      status: 'pending',
      statusLabel: 'Dossiê Vinculado',
      documentsCount: 0,
      isRecent: false
    };
  }, [syncStatusMap, clientId]);

  return {
    syncStatusMap,
    recentSyncEvent,
    getServiceSyncInfo
  };
}
