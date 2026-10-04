import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore, getFirestore, disableNetwork, connectFirestoreEmulator,
  memoryLocalCache, memoryLruGarbageCollector,
  collection, addDoc, query, where, getDocs, updateDoc, doc, serverTimestamp
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// Fallback configuration object if firebase-applet-config.json is absent
const firebaseConfigJson: any = {};

const isKeyValid = (key?: string) => {
  if (!key) return false;
  // A valid Google/Firebase API Key has at least 30 characters and starts with AIzaSy
  return key.startsWith('AIzaSy') && key.length >= 30;
};

const rawApiKey = (import.meta as any).env.VITE_FIREBASE_API_KEY || firebaseConfigJson.apiKey;
export const hasValidConfig = isKeyValid(rawApiKey);

// Invalid configuration is diagnosed by the login screen; never fabricate API responses.
const finalApiKey = hasValidConfig ? rawApiKey : 'invalid-configuration';

const firebaseConfig = {
  apiKey: finalApiKey,
  authDomain: (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain || "agrogestao-pro.firebaseapp.com",
  projectId: (import.meta as any).env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId || "agrogestao-pro",
  storageBucket: (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket || "agrogestao-pro.appspot.com",
  messagingSenderId: (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId || "1234567890",
  appId: (import.meta as any).env.VITE_FIREBASE_APP_ID || firebaseConfigJson.appId || "1:1234567890:web:mockappid",
  firestoreDatabaseId: (import.meta as any).env.VITE_FIREBASE_DATABASE_ID || firebaseConfigJson.firestoreDatabaseId || (import.meta as any).env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "(default)",
};

let app: any;
let dbInstance: any;
let authInstance: any;
let storageInstance: any;

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  try {
    dbInstance = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      // Cache SÓ na memória (nada gravado no disco — ver comentário abaixo),
      // mas que guarda os documentos já baixados mesmo depois de sair da aba.
      // O padrão do SDK descartava tudo ao trocar de aba: voltar para
      // Clientes/Contratos baixava a lista inteira de novo e a tela ficava
      // vazia até a internet responder. Agora a lista aparece na hora (do
      // cache) e é atualizada em seguida pelo servidor. O cache some ao
      // fechar o app ou sair da conta (a janela é recarregada no logout).
      localCache: memoryLocalCache({
        garbageCollector: memoryLruGarbageCollector({ cacheSizeBytes: 60 * 1024 * 1024 }),
      }),
    }, firebaseConfig.firestoreDatabaseId);
  } catch (dbErr) {
    dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }

  // Cache offline (IndexedDB) removido: a chamada assíncrona
  // enableIndexedDbPersistence() concorria com a primeira consulta real do
  // app (feita logo em seguida, ao carregar a tela de login) e provocava um
  // erro interno do SDK do Firestore ("INTERNAL ASSERTION FAILED") toda vez
  // que o app abria. Como este app já depende de internet pra sincronizar
  // com o Firebase, não é essencial ter cache offline — só o desativamos.

  if (!hasValidConfig && dbInstance) {
    disableNetwork(dbInstance).catch((err) => {
      console.warn('[Firestore Safe Initialization] Could not disable network:', err);
    });
  }

  authInstance = getAuth(app);

  // Só para testes automáticos: com VITE_USE_EMULATORS=1 o app fala com o
  // banco/login de TESTE rodando neste PC (Firebase Emulator), nunca com os
  // dados reais. Em uso normal essa variável não existe e nada muda.
  if ((import.meta as any).env.VITE_USE_EMULATORS === '1') {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080);
  }

  storageInstance = getStorage(app);
  // Padrão do SDK é tentar por até 10 min antes de desistir: com o Storage indisponível
  // o botão ficava travado em "Armazenando...". Com 30s o usuário recebe o erro a tempo.
  storageInstance.maxUploadRetryTime = 30000;
  storageInstance.maxOperationRetryTime = 30000;
} catch (e: any) {
  console.warn('[Firebase Safe Initialization Warning] Firebase SDK could not be initialized fully:', e.message || e);
}

// Export references. If they failed to initialize, export Proxies to prevent crash.
export const db = dbInstance || new Proxy({} as any, {
  get(target, prop, receiver) {
    console.warn(`[Firestore Safe Fallback] Offline Mode: tried to access Firestore property "${String(prop)}"`);
    return () => {};
  }
});

export const auth = authInstance || new Proxy({} as any, {
  get(target, prop, receiver) {
    if (prop === 'currentUser') return null;
    console.warn(`[Auth Safe Fallback] Offline Mode: tried to access Auth property "${String(prop)}"`);
    return () => {};
  }
});

export const storage = storageInstance || new Proxy({} as any, {
  get(target, prop, receiver) {
    console.warn(`[Storage Safe Fallback] Offline Mode: tried to access Storage property "${String(prop)}"`);
    return () => {};
  }
});

export interface EnsureDocumentFolderParams {
  clientId: string;
  serviceId: string;
  serviceName?: string;
  processNumber?: string;
  category?: string;
  folderType?: string;
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
 * Ensures that a document folder entry exists for a specific process/service
 * within the 'documents' collection, guaranteeing centralized PDF and dossier synchronization.
 */
export async function ensureDocumentFolder({
  clientId,
  serviceId,
  serviceName,
  processNumber,
  category = 'Perícia',
  folderType = 'judicial_expertise',
  metadata = {},
  initialFile
}: EnsureDocumentFolderParams): Promise<{
  folderExists: boolean;
  documentsCount: number;
  syncedDocId?: string;
}> {
  const { ensureServiceDocumentFolder } = await import('./documentSync');
  const result = await ensureServiceDocumentFolder({ clientId, serviceId,
    serviceName: serviceName || processNumber || 'Serviço', serviceType: folderType,
    category, metadata: { ...metadata, ...(processNumber ? { processNumber } : {}) }, initialFile });
  return { folderExists: result.folderExists, documentsCount: result.documentsCount, syncedDocId: result.docId };
}
