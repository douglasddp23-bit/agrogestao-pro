import { addDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { getAuthToken } from './utils';

export async function createNotification(userId: string, title: string, message: string, type: 'info' | 'success' | 'alert' | 'update' = 'info', link?: string) {
  try {
    const notificationData: any = {
      userId,
      title,
      message,
      type,
      read: false,
      createdAt: new Date().toISOString()
    };

    if (link !== undefined) {
      notificationData.link = link;
    }

    await addDoc(collection(db, 'notifications'), notificationData);
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// Trigger email notification for new technical appointment/field visit
export async function triggerNewAppointmentNotification(visit: {
  clientId: string;
  clientName: string;
  propertyName: string;
  technicianId: string;
  technicianName: string;
  visitDate: string;
  objective: string;
}) {
  try {
    // 1. Create in-app notification for the technical agent or admin
    await createNotification(
      visit.technicianId || 'all',
      '📅 Novo Agendamento de Visita',
      `Visita agendada para ${visit.clientName} em ${new Date(visit.visitDate).toLocaleDateString('pt-BR')} por ${visit.technicianName}.`,
      'info',
      'field_visits'
    );

    // 2. Dispatch real-time email notification via backend
    const token = await getAuthToken();
    if (!token) return; // sem token válido, não disparar notificação

    const response = await fetch('/api/notifications/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        type: 'new_appointment',
        visit: {
          clientName: visit.clientName,
          propertyName: visit.propertyName,
          technicianName: visit.technicianName,
          visitDate: visit.visitDate,
          objective: visit.objective
        }
      })
    });

    if (!response.ok) {
      console.warn('API de trigger de e-mail de agendamento retornou status não-OK:', response.status);
    }
  } catch (error) {
    console.error('Erro ao acionar notificação de novo agendamento:', error);
  }
}

// Trigger automatic check on expiring contracts to send digest email & build alert notifications
export async function checkExpiringContractsNotification() {
  try {
    const token = await getAuthToken();
    if (!token) return; // sem token válido, não disparar notificação

    const response = await fetch('/api/notifications/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.warn('API de checagem automática de noficação de contratos expirando retornou status não-OK.');
      return;
    }

    const result = await response.json();
    if (result.success && result.expiringContracts) {
      // Create in-app notification for each expiring contract to raise visibility
      for (const contract of result.expiringContracts) {
        // Only trigger in-app notification once to prevent spam
        const recentNotifQuery = query(
          collection(db, 'notifications'),
          where('link', '==', 'contracts'),
          where('title', '==', `⚠️ Contrato Vencendo: ${contract.clientName}`)
        );
        const querySnap = await getDocs(recentNotifQuery);
        
        if (querySnap.empty) {
          await createNotification(
            'all',
            `⚠️ Contrato Vencendo: ${contract.clientName}`,
            `O contrato "${contract.title}" expira em ${contract.daysRemaining} dias (${new Date(contract.endDate).toLocaleDateString('pt-BR')}).`,
            'alert',
            'contracts'
          );
        }
      }
    }
  } catch (error) {
    console.error('Erro ao disparar checagem automática de contratos expirando:', error);
  }
}
