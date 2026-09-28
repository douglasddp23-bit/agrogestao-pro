/**
 * ARQUITETURA DE SINCRONIZAÇÃO OFFLINE — AgroGestão Pro Mobile
 * 
 * Este arquivo documenta como o app React Native + Expo
 * deverá funcionar para sincronizar visitas de campo.
 * 
 * TECNOLOGIAS NECESSÁRIAS NO APP MOBILE:
 * - expo (SDK 51+)
 * - @react-native-firebase/firestore (com persistência offline)
 * - @react-native-firebase/storage
 * - expo-camera (fotos)
 * - expo-location (GPS)
 * - expo-image-picker
 * - @react-native-async-storage/async-storage (fila de upload)
 * - @react-native-community/netinfo (detecção de conexão)
 * 
 * FLUXO OFFLINE → ONLINE:
 * 
 * 1. App abre → ativa persistência offline do Firestore:
 *    firestore().settings({ persistence: true, cacheSizeBytes: CACHE_SIZE_UNLIMITED });
 * 
 * 2. Técnico registra visita sem internet:
 *    - GPS captura coordenadas (expo-location)
 *    - Fotos salvas localmente (expo-camera → FileSystem)
 *    - Documento gravado no Firestore local com syncStatus: 'pending_sync'
 *    - Firestore armazena offline automaticamente (IndexedDB / SQLite interno)
 *    - Fotos enfileiradas em AsyncStorage: [{ visitId, localUri, caption }]
 * 
 * 3. Conexão é detectada (NetInfo.addEventListener):
 *    a. Firestore sincroniza documentos automaticamente → sem código extra
 *    b. App lê fila de AsyncStorage e faz upload de cada foto:
 *       storage().ref(`field_visits/${visitId}/${timestamp}`).putFile(localUri)
 *    c. Após upload: atualiza o documento com a URL real e syncStatus: 'synced'
 *    d. Remove o item da fila do AsyncStorage
 * 
 * ESTRUTURA DA COLEÇÃO field_visits (igual ao web):
 * - Mesma coleção, mesmos campos, mesmo schema TypeScript
 * - Campo createdByDevice: 'mobile' para distinguir origem
 * - O site web lê em tempo real via onSnapshot — dados aparecem automaticamente
 * 
 * COLEÇÕES ADICIONAIS PARA O APP:
 * - field_visits/{id}/photos — subcoleção de metadados de fotos
 * - pending_uploads/{id} — fila de uploads pendentes (alternativa ao AsyncStorage)
 */

import { FieldVisit } from '../types';

export const MOBILE_APP_SCHEMA_VERSION = '1.0.0';

// Campos obrigatórios que o app mobile DEVE enviar ao criar uma visita
export const REQUIRED_VISIT_FIELDS: (keyof FieldVisit)[] = [
  'clientId', 'clientName', 'propertyName', 'technicianId',
  'technicianName', 'visitDate', 'objective', 'generalObservations',
  'recommendations', 'syncStatus', 'createdAt', 'updatedAt', 'createdByDevice'
];
