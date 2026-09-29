import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';

export interface AuditLogPayload {
  recordId: string;
  collection: string;
  userId: string;
  userName: string;
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'approved' | 'rejected' | 'read' | 'delegation_created' | 'delegation_revoked' | string;
  changedFields?: string[];
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  recordName?: string;
  details?: string;
}

export async function logAudit(payload: AuditLogPayload) {
  try {
    const timestamp = new Date().toISOString();
    await addDoc(collection(db, 'logs'), {
      ...payload,
      recordName: payload.recordName || payload.recordId,
      timestamp
    });
  } catch (error) {
    console.error('Error recording audit log:', error);
  }
}
