import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  Unsubscribe 
} from 'firebase/firestore';
import { useEffect, useState, useCallback, useRef } from 'react';
import { db } from './firebase';
import { JudicialExpertise, RuralPropertyValuation, ClientDocument } from '../types';

export type SyncBadgeState = 'synced' | 'syncing' | 'recent' | 'unlinked' | 'pending';

export interface ServiceSyncInfo {
  serviceId: string;
  serviceType: 'judicial_expertise' | 'rural_valuation' | 'contract' | 'analysis' | 'field_visit' | 'general' | string;
  serviceName: string;
  clientId: string;
  status: SyncBadgeState;
  statusLabel: string;
  documentsCount: number;
  lastSyncedAt?: string;
  isRecent?: boolean;
  hasOfficialPdf?: boolean;
  metadata?: Record<string, any>;
}

export interface EnsureServiceFolderOptions {
  clientId: string;
  serviceId: string;
  serviceName: string;
  serviceType: 'judicial_expertise' | 'rural_valuation' | string;
  category: string;
  metadata?: Record<string, any>;
  initialFile?: {
    name: string;
    url: string;
    storagePath?: string;
    size?: string | number;
    type?: string;
  };
}

/**
 * Verifies if a folder/document entry exists in 'documents' collection for a given serviceId.
 * If none exists, creates the initial dossier folder entry to ensure immediate real-time sync.
 */
export async function ensureServiceDocumentFolder({
  clientId,
  serviceId,
  serviceName,
  serviceType,
  category,
  metadata = {},
  initialFile
}: EnsureServiceFolderOptions): Promise<{
  folderExists: boolean;
  documentsCount: number;
  docId?: string;
}> {
  if (!clientId || !serviceId) {
    console.warn('[documentSync] Cannot ensure folder without valid clientId and serviceId.');
    return { folderExists: false, documentsCount: 0 };
  }

  try {
    const qDocs = query(
      collection(db, 'documents'),
      where('serviceId', '==', serviceId)
    );
    const snap = await getDocs(qDocs);
    const count = snap.size;

    if (count > 0) {
      // Folder already exists with at least one document
      const firstDoc = snap.docs[0];
      const data = firstDoc.data();
      if (data.clientId !== clientId) {
        await updateDoc(doc(db, 'documents', firstDoc.id), {
          clientId,
          updatedAt: new Date().toISOString()
        });
      }
      return { folderExists: true, documentsCount: count, docId: firstDoc.id };
    }

    // No documents found for this service: Create initial dossier entry in 'documents'
    const defaultDocName = initialFile?.name || (
      serviceType === 'judicial_expertise'
        ? `Dossiê Pericial — ${serviceName}`
        : serviceType === 'rural_valuation'
        ? `Dossiê Avaliação NBR — ${serviceName}`
        : `Dossiê do Serviço — ${serviceName}`
    );

    const docPayload: any = {
      clientId,
      serviceId,
      serviceName,
      name: defaultDocName,
      category,
      type: initialFile?.type || 'application/pdf',
      url: initialFile?.url || '',
      storagePath: initialFile?.storagePath || '',
      size: initialFile?.size || '0 KB',
      isGeneratedReport: true,
      folderType: serviceType,
      uploadedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
      ...metadata
    };

    const newDocRef = await addDoc(collection(db, 'documents'), docPayload);
    return { folderExists: false, documentsCount: 1, docId: newDocRef.id };
  } catch (error) {
    console.error('[documentSync] Error in ensureServiceDocumentFolder:', error);
    throw error;
  }
}

/**
 * Ensures document folder for a Judicial Expertise record
 */
export async function syncJudicialExpertiseDossier(
  exp: JudicialExpertise,
  initialFile?: EnsureServiceFolderOptions['initialFile']
) {
  if (!exp.id || !exp.clientId) return null;
  return ensureServiceDocumentFolder({
    clientId: exp.clientId,
    serviceId: exp.id,
    serviceName: `Perícia Judicial: Proc. ${exp.processNumber || exp.id}`,
    serviceType: 'judicial_expertise',
    category: 'Perícia',
    metadata: {
      processNumber: exp.processNumber,
      comarca: exp.comarca,
      vara: exp.vara,
      requerente: exp.requerente,
      requerido: exp.requerido,
      propertyName: exp.propertyName,
      propertyCity: exp.propertyCity
    },
    initialFile
  });
}

/**
 * Ensures document folder for a Rural Property Valuation record
 */
export async function syncRuralValuationDossier(
  val: RuralPropertyValuation,
  initialFile?: EnsureServiceFolderOptions['initialFile']
) {
  if (!val.id || !val.clientId) return null;
  return ensureServiceDocumentFolder({
    clientId: val.clientId,
    serviceId: val.id,
    serviceName: `Avaliação NBR 14.653: ${val.propertyName || val.id}`,
    serviceType: 'rural_valuation',
    category: 'Avaliação Rural',
    metadata: {
      propertyName: val.propertyName,
      propertyCity: val.propertyCity,
      totalArea: val.totalArea,
      totalValue: val.totalValue,
      registrationNumber: val.registrationNumber,
      car: val.car,
      ccir: val.ccir
    },
    initialFile
  });
}

type SyncCallback = (statusMap: Record<string, ServiceSyncInfo>, recentEvent?: ServiceSyncInfo) => void;

/**
 * Singleton Real-Time Manager for Document Dossier Synchronization.
 * Monitors 'judicial_expertises', 'rural_valuations', and 'documents' collections.
 */
class DocumentSyncManager {
  private static instance: DocumentSyncManager;
  private listeners: Set<SyncCallback> = new Set();
  private statusMap: Map<string, ServiceSyncInfo> = new Map();
  private unsubs: Unsubscribe[] = [];
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): DocumentSyncManager {
    if (!DocumentSyncManager.instance) {
      DocumentSyncManager.instance = new DocumentSyncManager();
    }
    return DocumentSyncManager.instance;
  }

  public initListeners() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      // 1. Listen to judicial_expertises
      const unsubJudicial = onSnapshot(collection(db, 'judicial_expertises'), async (snap) => {
        for (const change of snap.docChanges()) {
          const data = change.doc.data() as JudicialExpertise;
          const serviceId = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            if (data.clientId) {
              const docCount = await this.countDocuments(serviceId);
              const info: ServiceSyncInfo = {
                serviceId,
                serviceType: 'judicial_expertise',
                serviceName: `Perícia Judicial: Proc. ${data.processNumber || serviceId}`,
                clientId: data.clientId,
                status: docCount > 0 ? (change.type === 'added' ? 'recent' : 'synced') : 'syncing',
                statusLabel: docCount > 0 ? (change.type === 'added' ? 'Novo Dossiê Sincronizado' : 'Dossiê Ativo') : 'Sincronizando...',
                documentsCount: docCount,
                lastSyncedAt: new Date().toISOString(),
                isRecent: change.type === 'added',
                hasOfficialPdf: docCount > 0,
                metadata: {
                  processNumber: data.processNumber,
                  comarca: data.comarca,
                  vara: data.vara
                }
              };

              this.statusMap.set(serviceId, info);
              this.notify(info);

              // If new expertise has 0 files in documents collection, auto-create folder entry
              if (docCount === 0 && change.type === 'added') {
                syncJudicialExpertiseDossier({ id: serviceId, ...data } as any).catch(err => {
                  console.warn('[DocumentSyncManager] Auto-sync judicial error:', err);
                });
              }
            }
          } else if (change.type === 'removed') {
            this.statusMap.delete(serviceId);
            this.notify();
          }
        }
      }, (err) => console.warn('[DocumentSyncManager] Judicial listener error:', err));

      // 2. Listen to rural_valuations
      const unsubValuations = onSnapshot(collection(db, 'rural_valuations'), async (snap) => {
        for (const change of snap.docChanges()) {
          const data = change.doc.data() as RuralPropertyValuation;
          const serviceId = change.doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            if (data.clientId) {
              const docCount = await this.countDocuments(serviceId);
              const info: ServiceSyncInfo = {
                serviceId,
                serviceType: 'rural_valuation',
                serviceName: `Avaliação NBR 14.653: ${data.propertyName || serviceId}`,
                clientId: data.clientId,
                status: docCount > 0 ? (change.type === 'added' ? 'recent' : 'synced') : 'syncing',
                statusLabel: docCount > 0 ? (change.type === 'added' ? 'Nova Avaliação Sincronizada' : 'Laudo NBR Sincronizado') : 'Sincronizando...',
                documentsCount: docCount,
                lastSyncedAt: new Date().toISOString(),
                isRecent: change.type === 'added',
                hasOfficialPdf: docCount > 0,
                metadata: {
                  propertyName: data.propertyName,
                  totalArea: data.totalArea,
                  totalValue: data.totalValue
                }
              };

              this.statusMap.set(serviceId, info);
              this.notify(info);

              if (docCount === 0 && change.type === 'added') {
                syncRuralValuationDossier({ id: serviceId, ...data } as any).catch(err => {
                  console.warn('[DocumentSyncManager] Auto-sync valuation error:', err);
                });
              }
            }
          } else if (change.type === 'removed') {
            this.statusMap.delete(serviceId);
            this.notify();
          }
        }
      }, (err) => console.warn('[DocumentSyncManager] Valuation listener error:', err));

      // 3. Listen to documents to keep counts reactive
      const unsubDocuments = onSnapshot(collection(db, 'documents'), (snap) => {
        const counts = new Map<string, number>();
        snap.docs.forEach((d) => {
          const sId = d.data().serviceId;
          if (sId) {
            counts.set(sId, (counts.get(sId) || 0) + 1);
          }
        });

        let changed = false;
        this.statusMap.forEach((info, serviceId) => {
          const currentCount = counts.get(serviceId) || 0;
          if (info.documentsCount !== currentCount) {
            info.documentsCount = currentCount;
            info.status = currentCount > 0 ? 'synced' : 'pending';
            info.hasOfficialPdf = currentCount > 0;
            changed = true;
          }
        });

        if (changed) {
          this.notify();
        }
      }, (err) => console.warn('[DocumentSyncManager] Documents listener error:', err));

      this.unsubs.push(unsubJudicial, unsubValuations, unsubDocuments);
    } catch (e) {
      console.error('[DocumentSyncManager] Initialization error:', e);
    }
  }

  private async countDocuments(serviceId: string): Promise<number> {
    try {
      const q = query(collection(db, 'documents'), where('serviceId', '==', serviceId));
      const snap = await getDocs(q);
      return snap.size;
    } catch {
      return 0;
    }
  }

  public subscribe(listener: SyncCallback): () => void {
    this.listeners.add(listener);
    const mapObj = Object.fromEntries(this.statusMap.entries());
    listener(mapObj);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(recent?: ServiceSyncInfo) {
    const mapObj = Object.fromEntries(this.statusMap.entries());
    this.listeners.forEach((listener) => {
      try {
        listener(mapObj, recent);
      } catch (err) {
        console.error('[DocumentSyncManager] Callback error:', err);
      }
    });
  }

  public getServiceStatus(serviceId: string): ServiceSyncInfo | undefined {
    return this.statusMap.get(serviceId);
  }
}

export const documentSyncManager = DocumentSyncManager.getInstance();

// Auto-boot in browser environment
if (typeof window !== 'undefined') {
  documentSyncManager.initListeners();
}

/**
 * Custom React Hook that provides real-time synchronization state for documents & service dossiers.
 */
export function useDocumentSync(clientId?: string) {
  const [syncStatusMap, setSyncStatusMap] = useState<Record<string, ServiceSyncInfo>>({});
  const [recentSyncEvent, setRecentSyncEvent] = useState<ServiceSyncInfo | null>(null);

  useEffect(() => {
    documentSyncManager.initListeners();

    const unsubscribe = documentSyncManager.subscribe((map, recent) => {
      if (clientId) {
        const filtered: Record<string, ServiceSyncInfo> = {};
        Object.entries(map).forEach(([sId, info]) => {
          if (info.clientId === clientId) {
            filtered[sId] = info;
          }
        });
        setSyncStatusMap(filtered);
      } else {
        setSyncStatusMap(map);
      }

      if (recent && (!clientId || recent.clientId === clientId)) {
        setRecentSyncEvent(recent);
      }
    });

    return unsubscribe;
  }, [clientId]);

  const getServiceSyncInfo = useCallback((serviceId: string): ServiceSyncInfo => {
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

  const isServiceSynced = useCallback((serviceId: string): boolean => {
    const info = syncStatusMap[serviceId];
    return !!info && info.documentsCount > 0;
  }, [syncStatusMap]);

  return {
    syncStatusMap,
    recentSyncEvent,
    getServiceSyncInfo,
    isServiceSynced
  };
}
