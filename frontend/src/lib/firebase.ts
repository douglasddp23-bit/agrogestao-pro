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

// Intercept and mock Google Firebase network calls to prevent "auth/api-key-not-valid" or "auth/unauthorized-domain" crash
if (typeof window !== 'undefined') {
  // Fetch interceptor: APENAS se config inválida
  if (!hasValidConfig) {
    try {
      const originalFetch = window.fetch;
      Object.defineProperty(window, 'fetch', {
        value: async function (input: any, init: any) {
          const url = typeof input === 'string' ? input
            : (input instanceof URL ? input.href : input?.url || '');
          if (
            url.includes('identitytoolkit.googleapis.com') ||
            url.includes('securetoken.googleapis.com') ||
            url.includes('firestore.googleapis.com')
          ) {
            console.warn('[Mock Fetch] Interceptado (config inválida):', url);
            return new Response(JSON.stringify({
              projectId: 'agrogestao-pro',
              authorizedDomains: ['localhost', '127.0.0.1', window.location.hostname],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return originalFetch.apply(this, arguments as any);
        },
        writable: true,
        configurable: true
      });
    } catch (e: any) {
      console.warn('[Firebase] Fetch interceptor falhou:', e.message);
    }
  }

  // XHR interceptor: instalar APENAS se config inválida
  if (!hasValidConfig) {
    const OriginalXHR = window.XMLHttpRequest;
    (window as any).XMLHttpRequest = function () {
      const xhr = new OriginalXHR();
      const originalOpen = xhr.open;
      let isFirebaseUrl = false;
      let isConfigUrl = false;
      let requestedUrl = '';
      xhr.open = function (method, url) {
        if (typeof url === 'string') {
          if (url.includes('identitytoolkit.googleapis.com') && (url.includes('getProjectConfig') || url.includes('/config'))) {
            isConfigUrl = true;
            requestedUrl = url;
            console.warn('[Mock XHR] Interceptado open config:', url);
          } else if (url.includes('identitytoolkit.googleapis.com') || url.includes('securetoken.googleapis.com') || url.includes('firestore.googleapis.com')) {
            isFirebaseUrl = true;
            requestedUrl = url;
            console.warn('[Offline Mock XHR] Interceptado open:', url);
          }
        }
        return originalOpen.apply(this, arguments as any);
      } as any;
      const originalSend = xhr.send;
      xhr.send = function (body) {
        if (isConfigUrl || isFirebaseUrl) {
          console.warn('[Offline Mock XHR] Interceptado send');
          // Spoof state transition
          Object.defineProperty(xhr, 'readyState', { value: 4 });
          Object.defineProperty(xhr, 'status', { value: 200 });
          
          let responseText = '{}';
          const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
          if (requestedUrl.includes('accounts:lookup')) {
            responseText = JSON.stringify({
              users: []
            });
          } else {
            responseText = JSON.stringify({
              projectId: 'agrogestao-pro',
              authorizedDomains: ['localhost', '127.0.0.1', 'agrogestao-pro.firebaseapp.com', currentHost],
              recaptchaKey: 'mock_recaptcha_key',
              recaptchaSiteKey: 'mock_recaptcha_site_key'
            });
          }
          
          Object.defineProperty(xhr, 'responseText', { value: responseText });
          if (xhr.onreadystatechange) {
            xhr.onreadystatechange(new Event('readystatechange') as any);
          }
          if (xhr.onload) {
            xhr.onload(new Event('load') as any);
          }
          return;
        }
        return originalSend.apply(this, arguments as any);
      };
      return xhr;
    } as any;
  }
}

const finalApiKey = hasValidConfig ? rawApiKey : "AIzaSyAsB_CDeFGHIJklMNOpQrSTUVwXyz12345";

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
  if (!clientId || !serviceId) {
    console.warn('[ensureDocumentFolder] clientId and serviceId are required.');
    return { folderExists: false, documentsCount: 0 };
  }

  try {
    const qDocs = query(
      collection(db, 'documents'),
      where('serviceId', '==', serviceId)
    );
    const snap = await getDocs(qDocs);
    const documentsCount = snap.size;
    const folderExists = documentsCount > 0;

    let syncedDocId: string | undefined = undefined;

    if (folderExists) {
      // If folder already has files, ensure they are linked to current client and update if needed
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.clientId !== clientId) {
          await updateDoc(doc(db, 'documents', docSnap.id), {
            clientId,
            updatedAt: new Date().toISOString()
          });
        }
      }
      syncedDocId = snap.docs[0]?.id;
    } else {
      // Create initial folder dossier entry in 'documents'
      const docTitle = initialFile?.name || (processNumber 
        ? `Laudo Pericial Oficial — Proc. ${processNumber}` 
        : `Dossiê do Processo — ${serviceName || 'Perícia Judicial'}`);

      const docPayload: any = {
        clientId,
        serviceId,
        serviceName: serviceName || (processNumber ? `Perícia Judicial: Proc. ${processNumber}` : 'Perícia Judicial'),
        name: docTitle,
        category,
        type: initialFile?.type || 'application/pdf',
        url: initialFile?.url || '',
        storagePath: initialFile?.storagePath || '',
        size: initialFile?.size || '0 KB',
        isGeneratedReport: true,
        folderType,
        // Obrigatório pelas regras do banco (isValidDoc). Sem ele a criação da
        // pasta do laudo era sempre recusada — e derrubava o salvamento da perícia.
        uploadedBy: auth.currentUser?.uid || 'sistema',
        uploadedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
        ...metadata
      };

      const newDocRef = await addDoc(collection(db, 'documents'), docPayload);
      syncedDocId = newDocRef.id;
    }

    return {
      folderExists,
      documentsCount: folderExists ? documentsCount : 1,
      syncedDocId
    };
  } catch (error) {
    console.error('[ensureDocumentFolder] Error verifying or creating document folder:', error);
    throw error;
  }
}

