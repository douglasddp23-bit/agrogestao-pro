import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, addDoc, onSnapshot, query, orderBy, getDocs, updateDoc, doc, deleteDoc, where
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Appointment, Client, UserProfile } from '../types';
import { logAudit } from '../lib/audit';
import { PERMISSIONS, UserRole, hasRole } from '../lib/permissions';
import ConfirmationModal from '../components/ConfirmationModal';
import {
  formatDate, cn, handleFirestoreError, OperationType, getAuthToken, todayLocalDateString, safeUrl } from '../lib/utils';
import { 
  CalendarDays, UserCheck, CheckCircle2, Trash2, Plus, Search, Calendar, 
  User, Clock, ClipboardList, Check, X, ChevronLeft, ChevronRight, 
  AlertCircle, MessageSquare, Mail, Layers, Eye, RefreshCw, Download,
  MapPin, Navigation, Route, LocateFixed, ArrowUpDown, ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { CalendarDays as PageIcon } from 'lucide-react';

export default function Scheduling() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Agenda ↔ Visitas de Campo: qual visita foi registrada a partir de cada
  // agendamento (a visita guarda linkedAppointmentId). Atualiza em tempo real,
  // inclusive quando a visita é registrada em outro computador.
  const [visitByAppointment, setVisitByAppointment] = useState<Record<string, string>>({});
  useEffect(() => {
    const q = query(collection(db, 'field_visits'), where('linkedAppointmentId', '>', ''));
    return onSnapshot(q, (snap) => {
      const map: Record<string, string> = {};
      snap.forEach(d => { const apId = d.data().linkedAppointmentId; if (apId) map[apId] = d.id; });
      setVisitByAppointment(map);
    }, (err) => console.warn('[Agenda] Não foi possível ler as visitas vinculadas:', err));
  }, []);

  // Route Optimizer Modal State
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [routeDate, setRouteDate] = useState<string>(todayLocalDateString());
  const [isLocating, setIsLocating] = useState<string | null>(null);

  // Filters state
  // options: 'all' | 'today' | 'week' | 'pending'
  const [filter, setFilter] = useState<'all' | 'today' | 'week' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);

  // Calendar view state
  const today = new Date();
  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth()); // 0-based

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [appointmentToDelete, setAppointmentToDelete] = useState<Appointment | null>(null);

  // New Appointment Fields
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');
  const [serviceType, setServiceType] = useState('Consultoria Técnica');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [isVirtual, setIsVirtual] = useState(false);
  const [meetingPlatform, setMeetingPlatform] = useState<'meet' | 'teams'>('meet');
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>([]);

  const resetForm = () => {
    setSelectedClientId('');
    setSelectedTechnicianId('');
    setServiceType('Consultoria Técnica');
    setAppointmentDate('');
    setAppointmentTime('09:00');
    setNotes('');
    setIsVirtual(false);
    setMeetingPlatform('meet');
    setSelectedCollaboratorIds([]);
    setIsModalOpen(false);
    setEditingAppointmentId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenCreateModalWithDate = (dateStr: string) => {
    resetForm();
    setAppointmentDate(dateStr);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (app: Appointment) => {
    setEditingAppointmentId(app.id);
    setSelectedClientId(app.clientId);
    setSelectedTechnicianId(app.technicianId);
    setServiceType(app.serviceType);
    setAppointmentDate(app.date);
    setAppointmentTime(app.time);
    setNotes(app.notes || '');
    setIsVirtual(!!app.isVirtual);
    setMeetingPlatform(app.meetingPlatform || 'meet');
    setSelectedCollaboratorIds(app.participantIds || []);
    setIsModalOpen(true);
  };

  // ─── FIRESTORE SUBSCRIPTIONS ─────────────────────────────────────────
  /*
    ÍNDICES RECOMENDADOS (Coleção 'appointments'):
    appointments: [createdAt desc]
    appointments: [technicianId + date]
    appointments: [clientId + date]
  */
  useEffect(() => {
    // 1. Fetch appointments
    const appointmentsQuery = query(collection(db, 'appointments'), orderBy('createdAt', 'desc'));
    const unsubAppointments = onSnapshot(appointmentsQuery, (snapshot) => {
      const records: Appointment[] = [];
      snapshot.forEach(docSnap => {
        records.push({ id: docSnap.id, ...docSnap.data() } as Appointment);
      });
      setAppointments(records);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'appointments');
      setLoading(false);
    });

    // 2. Fetch clients (mapped for dropdown)
    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const clientsData: Client[] = [];
      snapshot.forEach(docSnap => {
        clientsData.push({ id: docSnap.id, ...docSnap.data() } as Client);
      });
      setClients(clientsData.sort((a,b) => (a.name || '').localeCompare(b.name || '')));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'clients');
    });

    // 3. Fetch users (filtered for technicians / system users)
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData: UserProfile[] = [];
      snapshot.forEach(docSnap => {
        usersData.push({ uid: docSnap.id, ...docSnap.data() } as UserProfile);
      });
      setTechnicians(usersData.sort((a,b) => (a.displayName || '').localeCompare(b.displayName || '')));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    return () => {
      unsubAppointments();
      unsubClients();
      unsubUsers();
    };
  }, []);

  // ─── AUTHENTICATION DETAILS ──────────────────────────────────────────
  const isManagement = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager';

  // ─── ALERT SYNC AUTOMATIONS ──────────────────────────────────────────
  const sendEmailAlert = async (appointment: any, client: Client, techName: string) => {
    try {
      const token = await user?.getIdToken?.() || '';
      const toEmail = client.ownerEmail || 'contato@agrogestao.com.br';
      const subjectText = `Confirmação de Agendamento: ${appointment.serviceType}`;
      
      let meetingDetails = '';
      if (appointment.isVirtual) {
        const platformName = appointment.meetingPlatform === 'meet' ? 'Google Meet' : 'Microsoft Teams';
        meetingDetails = `\n• Formato: Reunião Virtual (${platformName})\n• Link da Reunião: ${appointment.meetingLink}\n`;
      } else {
        meetingDetails = `\n• Formato: Presencial\n`;
      }

      const msgBody = `Prezado(a) ${client.name},\n\n` +
        `Informamos que um agendamento para o serviço de "${appointment.serviceType}" foi registrado em nosso sistema.\n\n` +
        `Detalhes do Atendimento:\n` +
        `• Data: ${formatDate(appointment.date)} às ${appointment.time}\n` +
        `• Especialista Responsável: ${techName}\n` +
        meetingDetails +
        `• Observações: ${appointment.notes || 'Nenhuma'}\n\n` +
        `Agradecemos pela parceria.\n\n` +
        `Atenciosamente,\n` +
        `Equipe AgroGestão Pro`;

      const response = await fetch('/api/alerts/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ to: toEmail, subject: subjectText, body: msgBody })
      });
      return response.ok;
    } catch (err) {
      console.error('Falha no alerta de email:', err);
      return false;
    }
  };

  const sendWhatsappAlert = async (appointment: any, client: Client, techName: string) => {
    try {
      const token = await getAuthToken();
      // O provedor (Evolution API) espera o número completo com código do
      // país (55) na frente — o cadastro do cliente guarda só o número
      // local, então adicionamos aqui antes de enviar.
      const rawPhoneDigits = (client.phone || '').replace(/\D/g, '');
      const destinationPhone = rawPhoneDigits.startsWith('55') ? rawPhoneDigits : `55${rawPhoneDigits}`;
      
      let meetingDetails = '';
      if (appointment.isVirtual) {
        const platformName = appointment.meetingPlatform === 'meet' ? 'Google Meet' : 'Microsoft Teams';
        meetingDetails = `\n💻 Link da Reunião (${platformName}): ${appointment.meetingLink}`;
      }

      const whatsappMsg = `Olá, ${client.name}! Seu agendamento para o serviço de "${appointment.serviceType}" com o técnico ${techName} foi registrado.\n\n` +
        `📅 Data: ${formatDate(appointment.date)}\n` +
        `⏰ Horário: ${appointment.time}` +
        meetingDetails + `\n\n` +
        `Em caso de dúvidas, fale conosco!`;

      const response = await fetch('/api/alerts/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phone: destinationPhone, message: whatsappMsg })
      });
      const waData = await response.json().catch(() => ({}));
      const notifiedWhatsapp = !!(waData.success && !waData.simulated);
      const whatsappSimulated = waData.simulated === true;
      return { success: !!waData.success, notifiedWhatsapp, whatsappSimulated };
    } catch (err) {
      console.error('Falha no alerta WhatsApp:', err);
      return { success: false, notifiedWhatsapp: false, whatsappSimulated: false };
    }
  };

  // ─── FILTER CALCULATIONS ─────────────────────────────────────────────
  const getStartOfWeek = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(d);
    start.setDate(diff);
    start.setHours(0,0,0,0);
    return start;
  };

  const filteredAppointments = appointments.filter(app => {
    // 1. Calendar day filter
    if (selectedCalendarDay) {
      if (app.date !== selectedCalendarDay) return false;
    }

    // 2. Tab filtering logic
    const appDateObj = new Date(app.date + 'T00:00:00');
    const localTodayStr = todayLocalDateString();

    if (filter === 'today') {
      if (app.date !== localTodayStr) return false;
    } else if (filter === 'week') {
      const startOfWeek = getStartOfWeek(new Date());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23,59,59,999);

      if (appDateObj < startOfWeek || appDateObj > endOfWeek) return false;
    } else if (filter === 'pending') {
      if (app.status !== 'scheduled') return false;
    }

    // 3. Search Bar query matching (matches client name or technician name or service type)
    if (searchQuery.trim() !== '') {
      const queryLower = searchQuery.toLowerCase();
      const matchClient = (app.clientName || '').toLowerCase().includes(queryLower);
      const matchTech = (app.technicianName || '').toLowerCase().includes(queryLower);
      const matchType = (app.serviceType || '').toLowerCase().includes(queryLower);
      return matchClient || matchTech || matchType;
    }

    return true;
  });

  // ─── HELPER TRANSLATION / DESIGN FOR STATUS BADGES ──────────────────
  const statusConfig: Record<string, { label: string; parentClass: string }> = {
    scheduled: { label: 'Agendado', parentClass: 'bg-amber-50 text-amber-700 border border-amber-200' },
    confirmed: { label: 'Confirmado', parentClass: 'bg-slate-50 text-slate-700 border border-slate-200' },
    completed: { label: 'Concluído', parentClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    cancelled: { label: 'Cancelado', parentClass: 'bg-rose-50 text-rose-700 border border-rose-200' }
  };

  // ─── CALENDAR RENDERING ENGINE ───────────────────────────────────────
  const monthsBr = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfWeek = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  // ─── HANDLERS ────────────────────────────────────────────────────────
  const handleCreateAppointment = async () => {
    if (!selectedClientId || !selectedTechnicianId || !serviceType || !appointmentDate || !appointmentTime) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    // Past Date Validation
    const selectDateObj = new Date(appointmentDate + 'T00:00:00');
    const todayDateOnly = new Date();
    todayDateOnly.setHours(0,0,0,0);
    if (selectDateObj < todayDateOnly) {
      toast.error('Não é permitido agendamentos em datas passadas!');
      return;
    }

    setModalLoading(true);

    const client = clients.find(c => c.id === selectedClientId);
    const technician = technicians.find(u => u.uid === selectedTechnicianId);

    if (!client || !technician) {
      toast.error('Cliente ou Técnico inválido!');
      setModalLoading(false);
      return;
    }

    // Técnico duplicate conflict check
    const hasConflict = appointments.some(app => 
      app.technicianId === selectedTechnicianId && 
      app.date === appointmentDate && 
      app.time === appointmentTime &&
      app.status !== 'cancelled'
    );

    if (hasConflict) {
      toast.warning('Aviso: Este técnico já possui um compromisso agendado para o mesmo dia e horário!');
    }

    try {
      const clientName = client.name;
      const technicianName = technician.displayName;

      // Generate realistic virtual meeting links if selected
      let meetingLink = '';
      if (isVirtual) {
        if (meetingPlatform === 'meet') {
          const chars = 'abcdefghijklmnopqrstuvwxyz';
          const r = (len: number) => Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
          meetingLink = `https://meet.google.com/${r(3)}-${r(4)}-${r(3)}`;
        } else {
          const randomCode = Math.floor(100000000 + Math.random() * 900000000).toString();
          meetingLink = `https://teams.live.com/meet/${randomCode}`;
        }
      }

      // Map participant names
      const participantNames = selectedCollaboratorIds.map(id => {
        const tObj = technicians.find(t => t.uid === id);
        return tObj?.displayName || 'Colaborador';
      });

      // 1. Initial simulations of notifications to read their dispatch success states
      const emailOk = await sendEmailAlert({ 
        serviceType, 
        date: appointmentDate, 
        time: appointmentTime, 
        notes,
        isVirtual,
        meetingPlatform,
        meetingLink
      }, client, technicianName);

      const waResult = await sendWhatsappAlert({ 
        serviceType, 
        date: appointmentDate, 
        time: appointmentTime,
        isVirtual,
        meetingPlatform,
        meetingLink
      }, client, technicianName);

      // 2. Save appointment in Firestore
      const newAppData = {
        clientId: selectedClientId,
        clientName,
        technicianId: selectedTechnicianId,
        technicianName,
        serviceType,
        date: appointmentDate,
        time: appointmentTime,
        status: 'scheduled',
        notes: notes.trim(),
        createdBy: user?.uid || 'unknown',
        createdByName: user?.displayName || 'Sistema',
        createdAt: new Date().toISOString(),
        notifiedEmail: emailOk,
        notifiedWhatsapp: waResult.notifiedWhatsapp,
        whatsappSimulated: waResult.whatsappSimulated,
        isVirtual,
        meetingPlatform: isVirtual ? meetingPlatform : null,
        meetingLink: isVirtual ? meetingLink : '',
        participantIds: selectedCollaboratorIds,
        participantNames,
      };

      const newAppRef = await addDoc(collection(db, 'appointments'), newAppData);

      // Audit Log
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || 'Usuário',
        action: 'created',
        collection: 'appointments',
        recordId: newAppRef.id,
        recordName: `${serviceType} - ${clientName}`,
        details: `Agendamento criado para ${appointmentDate} às ${appointmentTime} (${technicianName})`,
        newValues: newAppData,
      });

      // 3. Dispatch persistent Firestore notifications for each participant / collaborator
      const allNotificationRecipients = Array.from(new Set([
        selectedTechnicianId,
        ...selectedCollaboratorIds
      ]));

      for (const recipientId of allNotificationRecipients) {
        await addDoc(collection(db, 'notifications'), {
          title: `Nova reunião agendada: ${serviceType}`,
          message: `Você foi escalado para a reunião com o cliente ${clientName} no dia ${appointmentDate.split('-').reverse().join('/')} às ${appointmentTime}.` + 
            (isVirtual ? ` Plataforma: ${meetingPlatform === 'meet' ? 'Google Meet' : 'Microsoft Teams'}. Link: ${meetingLink}` : ''),
          type: 'info',
          isRead: false,
          createdAt: new Date().toISOString(),
          recipientId: recipientId
        });
      }

      // Show toast alerts — reflete de verdade se e-mail/WhatsApp saíram, em vez de
      // sempre dizer "Notificação enviada!" mesmo quando os dois falharam.
      const waSentOk = waResult.notifiedWhatsapp || waResult.whatsappSimulated;
      if (emailOk && waSentOk) {
        toast.success(`Agendamento cadastrado! ${waResult.whatsappSimulated ? 'E-mail ✓ WhatsApp (simulado)' : 'E-mail ✓ WhatsApp ✓'}`);
      } else if (emailOk || waSentOk) {
        const canal = emailOk ? 'E-mail ✓' : (waResult.whatsappSimulated ? 'WhatsApp (simulado)' : 'WhatsApp ✓');
        toast.success(`Agendamento cadastrado! ${canal} — ${emailOk ? 'WhatsApp' : 'E-mail'} não pôde ser enviado.`);
      } else {
        toast.warning('Agendamento cadastrado, mas não foi possível enviar e-mail nem WhatsApp de aviso. Avise o cliente manualmente.');
      }

      resetForm();

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'appointments');
      toast.error('Erro ao salvar o agendamento.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleEditAppointment = async () => {
    if (!editingAppointmentId) return;

    if (!selectedClientId || !selectedTechnicianId || !serviceType || !appointmentDate || !appointmentTime) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    setModalLoading(true);

    const client = clients.find(c => c.id === selectedClientId);
    const technician = technicians.find(u => u.uid === selectedTechnicianId);

    if (!client || !technician) {
      toast.error('Cliente ou Técnico inválido!');
      setModalLoading(false);
      return;
    }

    try {
      const clientName = client.name;
      const technicianName = technician.displayName;

      let meetingLink = '';
      if (isVirtual) {
        const existingApp = appointments.find(a => a.id === editingAppointmentId);
        if (existingApp?.isVirtual && existingApp.meetingPlatform === meetingPlatform && existingApp.meetingLink) {
          meetingLink = existingApp.meetingLink;
        } else {
          if (meetingPlatform === 'meet') {
            const chars = 'abcdefghijklmnopqrstuvwxyz';
            const r = (len: number) => Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            meetingLink = `https://meet.google.com/${r(3)}-${r(4)}-${r(3)}`;
          } else {
            const randomCode = Math.floor(100000000 + Math.random() * 900000000).toString();
            meetingLink = `https://teams.live.com/meet/${randomCode}`;
          }
        }
      }

      const participantNames = selectedCollaboratorIds.map(id => {
        const tObj = technicians.find(t => t.uid === id);
        return tObj?.displayName || 'Colaborador';
      });

      // Reenvia e-mail/WhatsApp de aviso quando data, hora ou técnico mudaram —
      // o cliente/técnico precisa saber do novo horário, não só do original.
      const previousApp = appointments.find(a => a.id === editingAppointmentId);
      const scheduleChanged = !previousApp || previousApp.date !== appointmentDate || previousApp.time !== appointmentTime || previousApp.technicianId !== selectedTechnicianId;

      let emailOk = false;
      let waResult: { notifiedWhatsapp?: boolean; whatsappSimulated?: boolean } = {};
      if (scheduleChanged) {
        emailOk = await sendEmailAlert({
          serviceType, date: appointmentDate, time: appointmentTime, notes,
          isVirtual, meetingPlatform, meetingLink
        }, client, technicianName);
        waResult = await sendWhatsappAlert({
          serviceType, date: appointmentDate, time: appointmentTime,
          isVirtual, meetingPlatform, meetingLink
        }, client, technicianName);
      }

      // 1. Update in Firestore
      const updateData = {
        clientId: selectedClientId,
        clientName,
        technicianId: selectedTechnicianId,
        technicianName,
        serviceType,
        date: appointmentDate,
        time: appointmentTime,
        notes: notes.trim(),
        isVirtual,
        meetingPlatform: isVirtual ? meetingPlatform : null,
        meetingLink: isVirtual ? meetingLink : '',
        participantIds: selectedCollaboratorIds,
        participantNames,
        updatedAt: new Date().toISOString(),
        ...(scheduleChanged ? {
          notifiedEmail: emailOk,
          notifiedWhatsapp: waResult.notifiedWhatsapp,
          whatsappSimulated: waResult.whatsappSimulated,
        } : {}),
      };

      await updateDoc(doc(db, 'appointments', editingAppointmentId), updateData);

      // Audit Log
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || 'Usuário',
        action: 'updated',
        collection: 'appointments',
        recordId: editingAppointmentId,
        recordName: `${serviceType} - ${clientName}`,
        details: `Agendamento editado (${appointmentDate} às ${appointmentTime})`,
        previousValues: previousApp || {},
        newValues: updateData,
      });

      // 2. Dispatch persistent Firestore notifications for each participant / collaborator
      const allNotificationRecipients = Array.from(new Set([
        selectedTechnicianId,
        ...selectedCollaboratorIds
      ]));

      for (const recipientId of allNotificationRecipients) {
        await addDoc(collection(db, 'notifications'), {
          title: `Agendamento alterado: ${serviceType}`,
          message: `O agendamento com o cliente ${clientName} foi alterado para o dia ${appointmentDate.split('-').reverse().join('/')} às ${appointmentTime}.` + 
            (isVirtual ? ` Link: ${meetingLink}` : ''),
          type: 'info',
          isRead: false,
          createdAt: new Date().toISOString(),
          recipientId: recipientId
        });
      }

      if (!scheduleChanged) {
        toast.success('Agendamento atualizado com sucesso!');
      } else {
        const waSentOk = waResult.notifiedWhatsapp || waResult.whatsappSimulated;
        if (emailOk && waSentOk) {
          toast.success(`Agendamento atualizado! ${waResult.whatsappSimulated ? 'E-mail ✓ WhatsApp (simulado)' : 'E-mail ✓ WhatsApp ✓'} avisando da nova data.`);
        } else if (emailOk || waSentOk) {
          toast.success(`Agendamento atualizado! Só foi possível avisar por ${emailOk ? 'e-mail' : 'WhatsApp'} — o outro canal falhou.`);
        } else {
          toast.warning('Agendamento atualizado, mas não foi possível avisar o cliente da nova data por e-mail nem WhatsApp. Avise manualmente.');
        }
      }
      resetForm();

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'appointments');
      toast.error('Erro ao atualizar o agendamento.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleUpdateStatus = async (appId: string, newStatus: 'confirmed' | 'completed' | 'cancelled') => {
    const currentApp = appointments.find(a => a.id === appId);
    const previousStatus = currentApp?.status;
    // Atualiza a tela na hora, sem esperar o listener do Firestore.
    setAppointments(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
    try {
      await updateDoc(doc(db, 'appointments', appId), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || 'Usuário',
        action: 'status_changed',
        collection: 'appointments',
        recordId: appId,
        recordName: currentApp ? `${currentApp.serviceType} - ${currentApp.clientName}` : 'Agendamento',
        details: `Status alterado para "${statusConfig[newStatus]?.label || newStatus}"`,
        previousValues: { status: currentApp?.status },
        newValues: { status: newStatus },
      });

      toast.success(`Agendamento atualizado para "${statusConfig[newStatus].label}" com sucesso!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'appointments');
      toast.error('Erro ao atualizar o status.');
      // Reverte a atualização otimista se o servidor recusou.
      if (previousStatus) {
        setAppointments(prev => prev.map(a => a.id === appId ? { ...a, status: previousStatus } : a));
      }
    }
  };

  const exportAppointmentICS = (app: Appointment) => {
    try {
      const [year, month, day] = (app.date || '').split('-');
      const [hours, minutes] = (app.time || '09:00').split(':');
      if (!year || !month || !day) {
        toast.error('Data inválida para exportação.');
        return;
      }
      const startDate = `${year}${month}${day}T${hours || '09'}${minutes || '00'}00`;
      const endHour = String(Math.min(23, Number(hours || '09') + 1)).padStart(2, '0');
      const endDate = `${year}${month}${day}T${endHour}${minutes || '00'}00`;
      
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AgroGestao Pro//Agendamentos//PT-BR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:agrogestao-${app.id}@agrogestao.com.br`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTSTART:${startDate}`,
        `DTEND:${endDate}`,
        `SUMMARY:${app.serviceType} - ${app.clientName}`,
        `DESCRIPTION:Técnico: ${app.technicianName}\\nCliente: ${app.clientName}\\nServiço: ${app.serviceType}${app.notes ? `\\nNotas: ${app.notes}` : ''}${app.meetingLink ? `\\nLink: ${app.meetingLink}` : ''}`,
        `LOCATION:${app.isVirtual ? (app.meetingLink || 'Reunião Virtual') : 'Presencial no Cliente'}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `agendamento-${(app.clientName || 'cliente').replace(/\s+/g, '_')}-${app.date}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Arquivo de calendário .ICS gerado com sucesso!');
    } catch (e) {
      toast.error('Erro ao gerar arquivo ICS.');
    }
  };

  // ─── GEOREFERENCED CHECK-IN / CHECK-OUT ──────────────────────────────
  const handleGeoCheckIn = async (app: Appointment) => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não suportada no seu navegador.');
      return;
    }
    setIsLocating(app.id + '-checkin');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = parseFloat(pos.coords.latitude.toFixed(6));
          const lng = parseFloat(pos.coords.longitude.toFixed(6));
          const nowStr = new Date().toISOString();

          await updateDoc(doc(db, 'appointments', app.id), {
            checkInLocation: {
              latitude: lat,
              longitude: lng,
              timestamp: nowStr,
              address: `Lat: ${lat}, Lng: ${lng}`
            },
            status: app.status === 'scheduled' ? 'confirmed' : app.status
          });
          toast.success(`📍 Check-in registrado com sucesso! (${lat}, ${lng})`);
        } catch (err) {
          console.error('Erro no check-in:', err);
          toast.error('Erro ao registrar check-in georreferenciado.');
        } finally {
          setIsLocating(null);
        }
      },
      (error) => {
        setIsLocating(null);
        toast.error(`Falha ao obter GPS: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleGeoCheckOut = async (app: Appointment) => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não suportada no seu navegador.');
      return;
    }
    setIsLocating(app.id + '-checkout');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = parseFloat(pos.coords.latitude.toFixed(6));
          const lng = parseFloat(pos.coords.longitude.toFixed(6));
          const nowStr = new Date().toISOString();

          await updateDoc(doc(db, 'appointments', app.id), {
            checkOutLocation: {
              latitude: lat,
              longitude: lng,
              timestamp: nowStr,
              address: `Lat: ${lat}, Lng: ${lng}`
            },
            status: 'completed'
          });
          toast.success(`🏁 Check-out de campo concluído! (${lat}, ${lng})`);
        } catch (err) {
          console.error('Erro no check-out:', err);
          toast.error('Erro ao registrar check-out georreferenciado.');
        } finally {
          setIsLocating(null);
        }
      },
      (error) => {
        setIsLocating(null);
        toast.error(`Falha ao obter GPS: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Helper to format client address for Google Maps
  const getClientDestinationQuery = (clientName: string, clientId?: string) => {
    const client = clients.find(c => c.id === clientId || c.name === clientName);
    if (!client) return encodeURIComponent(clientName);
    
    // Check if client has a property with lat/lng
    const propWithGeo = client.properties?.find(p => p.latitude && p.longitude);
    if (propWithGeo) {
      return `${propWithGeo.latitude},${propWithGeo.longitude}`;
    }

    if (client.address) {
      const parts = [
        client.address.street,
        client.address.number,
        client.address.neighborhood,
        client.address.city,
        client.address.state
      ].filter(Boolean);
      if (parts.length > 0) return encodeURIComponent(parts.join(', '));
    }

    return encodeURIComponent(`${client.name}`);
  };

  // Route appointments for selected date
  const routeDayAppointments = appointments
    .filter(a => a.date === routeDate && a.status !== 'cancelled' && !a.isVirtual)
    .sort((a, b) => (a.routeOrder || 0) - (b.routeOrder || 0) || a.time.localeCompare(b.time));

  const handleOpenGoogleMapsRoute = () => {
    if (routeDayAppointments.length === 0) {
      toast.error('Não há visitas presenciais agendadas para esta data.');
      return;
    }
    const stops = routeDayAppointments.map(a => getClientDestinationQuery(a.clientName, a.clientId));
    const url = `https://www.google.com/maps/dir/${stops.join('/')}`;
    window.open(url, '_blank');
  };

  const handleCancelAppointment = async (app: Appointment) => {
    // Only management can cancel other's appointments, standard user can only cancel their own.
    const isOwnerObj = app.createdBy === user?.uid;
    if (!isManagement && !isOwnerObj) {
      toast.error('Você só possui permissões para cancelar seus próprios agendamentos!');
      return;
    }

    // Atualiza a tela na hora, sem esperar o listener do Firestore.
    setAppointments(prev => prev.map(a => a.id === app.id ? { ...a, status: 'cancelled' } : a));
    try {
      await updateDoc(doc(db, 'appointments', app.id), {
        status: 'cancelled'
      });
      toast.success('Agendamento cancelado com sucesso.');
    } catch (error) {
      // Desfaz a mudança otimista: a gravação falhou, o agendamento continua ativo.
      setAppointments(prev => prev.map(a => a.id === app.id ? { ...a, status: app.status } : a));
      console.error('Erro ao cancelar agendamento:', error);
      toast.error('Erro ao cancelar agendamento. Nada foi alterado.');
      // Reverte a atualização otimista se o servidor recusou.
      setAppointments(prev => prev.map(a => a.id === app.id ? { ...a, status: app.status } : a));
    }
  };

  // Excluir: gestão (Admin/Gerente) ou quem criou o agendamento — igual à regra do banco.
  const canDeleteAppointment = (app: Appointment) =>
    !app.isVirtual && (isManagement || app.createdBy === user?.uid);

  const handleDeleteAppointment = async () => {
    const app = appointmentToDelete;
    if (!app) return;
    setIsDeleteModalOpen(false);
    setAppointmentToDelete(null);
    // Some da tela na hora; volta se o banco recusar.
    setAppointments(prev => prev.filter(a => a.id !== app.id));
    try {
      await deleteDoc(doc(db, 'appointments', app.id));
      toast.success('Agendamento excluído.');
      try {
        await logAudit({
          userId: user?.uid || 'unknown',
          userName: user?.displayName || 'Usuário',
          action: 'deleted',
          collection: 'appointments',
          recordId: app.id,
          recordName: `${app.serviceType} - ${app.clientName}`,
          details: `Agendamento de ${app.date} às ${app.time} (${app.technicianName}) excluído`,
          previousValues: app as any,
        });
      } catch { /* auditoria não pode desfazer a exclusão */ }
    } catch (error) {
      console.error('Erro ao excluir agendamento:', error);
      toast.error('Não foi possível excluir o agendamento. Nada foi alterado.');
      setAppointments(prev => prev.some(a => a.id === app.id) ? prev : [...prev, app]);
    }
  };

  // Grid Days Calculations helper
  const totalDays = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfWeek(currentYear, currentMonth);
  const calendarCells = [];

  // Padding prev month cells
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(null);
  }
  // This month cells
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    calendarCells.push(dayNum);
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto gap-6 pb-12">
      {/* ─── HEADER ROW ─── */}
      <div id="scheduling-header" className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Agendamentos" subtitle="Agenda de visitas e consultorias da equipe" />

        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setIsRouteModalOpen(true)}
            className="px-4 py-3.5 bg-white/80 hover:bg-white text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 shadow-sm font-display"
            title="Otimizar rota diária e abrir no Google Maps"
          >
            <Route className="w-4 h-4 text-emerald-600" /> Roteirizador de Visitas
          </button>

          <button 
            onClick={handleOpenCreateModal}
            className="px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.01] active:scale-[0.99] text-white rounded-2xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 shadow-lg shadow-emerald-600/30 font-display"
          >
            <Plus className="w-4 h-4" /> Novo Agendamento
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ─── MAIN COLUMN ─── */}
        <div id="scheduling-main-panel" className="flex-1 flex flex-col gap-6">
          
          {/* SEARCH & FILTERS CONTROLS */}
          <div className="glass-card p-6 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Field */}
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar por cliente, técnico ou serviço..."
                  className="w-full pl-11 pr-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-medium outline-none transition-all placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View Mode Switcher */}
              <div className="flex bg-slate-100/50 p-1 rounded-2xl border border-slate-200">
                <button 
                  onClick={() => setViewMode('calendar')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer focus:outline-none flex items-center gap-1.5",
                    viewMode === 'calendar'
                      ? "bg-white text-emerald-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <CalendarDays className="w-3.5 h-3.5" /> Calendário
                </button>
                <button 
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer focus:outline-none flex items-center gap-1.5",
                    viewMode === 'list'
                      ? "bg-white text-emerald-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <ClipboardList className="w-3.5 h-3.5" /> Lista
                </button>
              </div>

              {/* Status pills list */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/50 p-1 rounded-2xl border border-slate-200">
                {(['all', 'today', 'week', 'pending'] as const).map((tab) => (
                  <button 
                    key={tab}
                    onClick={() => {
                      setFilter(tab);
                      setSelectedCalendarDay(null); // Clear calendar specific filter when selecting custom tab
                    }}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer focus:outline-none",
                      filter === tab && !selectedCalendarDay
                        ? "bg-white text-emerald-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    {tab === 'all' && 'Todos'}
                    {tab === 'today' && 'Hoje'}
                    {tab === 'week' && 'Esta Semana'}
                    {tab === 'pending' && 'Pendentes'}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar specificity notification indicator */}
            {selectedCalendarDay && (
              <div className="flex items-center justify-between bg-emerald-50/70 border border-emerald-100 text-emerald-800 px-4 py-2 rounded-xl text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  Filtrando eventos de data específica: <strong className="font-bold">{formatDate(selectedCalendarDay)}</strong>
                </span>
                <button 
                  onClick={() => setSelectedCalendarDay(null)}
                  className="p-1 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-800 rounded-lg transition-colors font-bold uppercase text-[9px] tracking-wider"
                >
                  Limpar Filtro
                </button>
              </div>
            )}
          </div>

          {/* CONTENT: LIST OR CALENDAR VIEW */}
          <div className="space-y-4">
            {loading ? (
            <div className="p-16 text-center bg-white/45 backdrop-blur-md rounded-3xl border border-white/60">
              <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-emerald-600" />
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-relaxed">Sincronizando agendamentos...</p>
            </div>
          ) : viewMode === 'calendar' ? (
            /* BEAUTIFUL FULL MONTH INTERACTIVE CALENDAR */
            <div className="bg-white/45 backdrop-blur-md p-6 rounded-[2rem] border border-white/60 shadow-sm flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-slate-150 pb-3 mb-2">
                <div>
                  <h2 className="text-base font-display font-black text-slate-800">Visualização Mensal</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Clique em um dia para agendar ou em um evento para editar</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest bg-slate-100 px-3 py-1.5 rounded-xl">
                    {monthsBr[currentMonth]} {currentYear}
                  </span>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={handlePrevMonth}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={handleNextMonth}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 7 Columns Days Headings */}
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 uppercase py-2 border-b border-slate-100">
                <span>Dom</span>
                <span>Seg</span>
                <span>Ter</span>
                <span>Qua</span>
                <span>Qui</span>
                <span>Sex</span>
                <span>Sáb</span>
              </div>

              {/* Days Grid */}
              <div className="grid grid-cols-7 gap-2 mt-1">
                {calendarCells.map((day, idx) => {
                  if (day === null) {
                    return <div key={`full-empty-${idx}`} className="min-h-[110px] bg-slate-50/20 border border-slate-100/40 rounded-2xl" />;
                  }

                  const dStr = String(day).padStart(2, '0');
                  const mStr = String(currentMonth + 1).padStart(2, '0');
                  const isoDayKey = `${currentYear}-${mStr}-${dStr}`;

                  // Filter appointments for this exact calendar day
                  const dayAppointments = appointments.filter(app => app.date === isoDayKey);
                  const isDayToday = today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear;
                  const isSelected = selectedCalendarDay === isoDayKey;

                  return (
                    <div
                      key={`full-day-${day}`}
                      onClick={() => handleOpenCreateModalWithDate(isoDayKey)}
                      className={cn(
                        "min-h-[110px] p-2 bg-white/60 border border-slate-150 rounded-2xl transition-all cursor-pointer flex flex-col justify-between hover:bg-slate-50/80 group relative",
                        isDayToday && "bg-slate-50/30 border-slate-200",
                        isSelected && "border-emerald-500 bg-emerald-50/10 shadow-sm"
                      )}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className={cn(
                          "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-lg",
                          isDayToday ? "bg-emerald-600 text-white font-black" : "text-slate-700 font-medium"
                        )}>
                          {day}
                        </span>
                        {dayAppointments.length > 0 && (
                          <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded-md">
                            {dayAppointments.length}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col gap-1 overflow-y-auto max-h-[80px] custom-scrollbar">
                        {dayAppointments.slice(0, 3).map(app => (
                          <button
                            key={app.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditModal(app);
                            }}
                            className={cn(
                              "w-full text-left px-1.5 py-1 rounded-lg text-[9px] font-bold truncate transition-all flex items-center gap-1.5",
                              app.status === 'scheduled' && "bg-amber-50 text-amber-800 border border-amber-100 hover:bg-amber-100/85",
                              app.status === 'confirmed' && "bg-slate-50 text-slate-800 border border-slate-100 hover:bg-slate-100/85",
                              app.status === 'completed' && "bg-emerald-50 text-emerald-800 border border-emerald-100 hover:bg-emerald-100/85",
                              app.status === 'cancelled' && "bg-rose-50 text-rose-800 border border-rose-100 line-through opacity-75 hover:bg-rose-100/85"
                            )}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                            <span className="truncate">{app.clientName.split(' ')[0]}: {app.serviceType}</span>
                          </button>
                        ))}
                        {dayAppointments.length > 3 && (
                          <div className="text-[8px] font-bold text-slate-400 text-center uppercase tracking-wider">
                            + {dayAppointments.length - 3} mais
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="p-16 text-center bg-white/45 backdrop-blur-md rounded-3xl border border-white/60 flex flex-col items-center">
              <ClipboardList className="w-12 h-12 text-slate-300 stroke-1 mb-3" />
              <h4 className="text-sm font-bold text-slate-600">Nenhum agendamento encontrado</h4>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1.5">Ajuste as opções de filtros acima</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredAppointments.map((app) => {
                  const matchedConfig = statusConfig[app.status] || { label: app.status, parentClass: 'bg-slate-100 text-slate-600' };
                  const formattedDate = formatDate(app.date);

                  return (
                    <motion.div 
                      layout
                      key={app.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="glass-card hover:shadow-md transition-all flex flex-col p-5 gap-4 border border-white/70 relative group"
                    >
                      {/* Status + Metadata */}
                      <div className="flex justify-between items-start gap-2">
                        <span className={cn("px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider", matchedConfig.parentClass)}>
                          {matchedConfig.label}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {/* Actions shortcuts */}
                          {app.notifiedEmail && (
                            <div title="Notificado por Email" className="p-1 bg-emerald-50 text-emerald-600 rounded">
                              <Mail className="w-3.5 h-3.5" />
                            </div>
                          )}
                          {app.notifiedWhatsapp ? (
                            <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">WhatsApp ✓</span>
                          ) : app.whatsappSimulated ? (
                            <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">WhatsApp (simulado)</span>
                          ) : (
                            <span className="text-[9px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">WhatsApp ✗</span>
                          )}
                        </div>
                      </div>

                      {/* Middle contents */}
                      <div className="space-y-2.5 flex-1 select-none">
                        <div className="flex items-start gap-2.5">
                          <Layers className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider leading-none">Tipo de Ocorrência</p>
                            <h3 className="text-sm font-bold text-slate-800 leading-snug mt-0.5">{app.serviceType}</h3>
                          </div>
                        </div>

                        <div className="flex items-start gap-2.5">
                          <User className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider leading-none">Cliente Solicitante</p>
                            <p className="text-xs font-bold text-slate-700 leading-snug">{app.clientName}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2.5">
                          <UserCheck className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider leading-none">Técnico Responsável</p>
                            <p className="text-xs font-bold text-slate-600 leading-snug">{app.technicianName}</p>
                          </div>
                        </div>

                        {app.isVirtual ? (
                          <div className="flex flex-col gap-1.5 p-2.5 bg-emerald-50/55 border border-emerald-100 rounded-xl mt-1 text-left">
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-800 font-bold uppercase tracking-wider">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                              <span>Atendimento Virtual: {app.meetingPlatform === 'meet' ? 'Google Meet' : 'Microsoft Teams'}</span>
                            </div>
                            <a 
                              href={safeUrl(app.meetingLink)} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-[10px] font-bold text-slate-600 hover:underline break-all"
                            >
                              {app.meetingLink}
                            </a>
                            {app.participantNames && app.participantNames.length > 0 && (
                              <div className="text-[9px] text-slate-500 mt-0.5 font-sans leading-relaxed">
                                <strong>Co-participantes:</strong> {app.participantNames.join(', ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-wider pl-1">
                              <span>📍 Presencial / Campo</span>
                              {app.checkInLocation && (
                                <a
                                  href={`https://www.google.com/maps?q=${app.checkInLocation.latitude},${app.checkInLocation.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-600 hover:underline flex items-center gap-0.5 font-mono"
                                >
                                  <LocateFixed className="w-3 h-3" /> Ver no Maps
                                </a>
                              )}
                            </div>

                            {app.checkInLocation && (
                              <div className="p-2 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-[10px] text-emerald-900 dark:text-emerald-200">
                                <div className="flex items-center justify-between font-mono">
                                  <span className="font-bold flex items-center gap-1">
                                    <LocateFixed className="w-3 h-3 text-emerald-600" />
                                    Check-in: {new Date(app.checkInLocation.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className="text-[9px] opacity-80">{app.checkInLocation.latitude.toFixed(4)}, {app.checkInLocation.longitude.toFixed(4)}</span>
                                </div>
                              </div>
                            )}

                            {app.checkOutLocation && (
                              <div className="p-2 bg-slate-50/80 dark:bg-emerald-950/40 border border-slate-200 dark:border-emerald-800/60 rounded-xl text-[10px] text-slate-900 dark:text-slate-200">
                                <div className="flex items-center justify-between font-mono">
                                  <span className="font-bold flex items-center gap-1">
                                    <Navigation className="w-3 h-3 text-slate-600" />
                                    Check-out: {new Date(app.checkOutLocation.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className="text-[9px] opacity-80">{app.checkOutLocation.latitude.toFixed(4)}, {app.checkOutLocation.longitude.toFixed(4)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Date and hour indicators card */}
                        <div className="grid grid-cols-2 gap-2 bg-slate-50/50 py-2.5 px-3 rounded-xl border border-slate-100 mt-2">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[11px] font-bold">{formattedDate}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-600 border-l border-slate-200 pl-3">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[11px] font-bold">{app.time} HS</span>
                          </div>
                        </div>

                        {app.notes ? (
                          <p className="text-[10px] text-slate-400 italic line-clamp-2 leading-relaxed bg-white/20 p-2 rounded-lg border border-white/50 mt-1">
                            "{app.notes}"
                          </p>
                        ) : null}
                      </div>

                      {/* Footer Controls / Actions */}
                      <div className="flex gap-1.5 pt-3 border-t border-slate-100 flex-wrap">
                        {/* GPS Check-in Action */}
                        {!app.isVirtual && !app.checkInLocation && app.status !== 'cancelled' && app.status !== 'completed' && (
                          <button 
                            onClick={() => handleGeoCheckIn(app)}
                            disabled={isLocating === app.id + '-checkin'}
                            className="py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm font-mono"
                            title="Registrar chegada na fazenda com coordenadas GPS"
                          >
                            <LocateFixed className="w-3.5 h-3.5" />
                            {isLocating === app.id + '-checkin' ? 'GPS...' : 'Check-in'}
                          </button>
                        )}

                        {/* GPS Check-out Action */}
                        {!app.isVirtual && app.checkInLocation && !app.checkOutLocation && app.status !== 'cancelled' && app.status !== 'completed' && (
                          <button 
                            onClick={() => handleGeoCheckOut(app)}
                            disabled={isLocating === app.id + '-checkout'}
                            className="py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm font-mono"
                            title="Registrar saída e concluir visita com coordenadas GPS"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            {isLocating === app.id + '-checkout' ? 'GPS...' : 'Check-out'}
                          </button>
                        )}

                        {/* Agenda → Visita de Campo */}
                        {visitByAppointment[app.id] ? (
                          <button
                            onClick={() => navigate('/field_visits', { state: { openVisitId: visitByAppointment[app.id] } })}
                            className="py-1.5 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 border border-emerald-200"
                            title="Abrir a visita de campo registrada para este agendamento"
                          >
                            <ClipboardList className="w-3.5 h-3.5" /> Ver Visita
                          </button>
                        ) : (!app.isVirtual && app.status !== 'cancelled') && (
                          <button
                            onClick={() => navigate('/field_visits', { state: { fromAppointment: { id: app.id, clientId: app.clientId, date: app.date, serviceType: app.serviceType, notes: app.notes || '' } } })}
                            className="py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                            title="Registrar a visita de campo deste agendamento (já vem preenchida)"
                          >
                            <ClipboardList className="w-3.5 h-3.5" /> Registrar Visita
                          </button>
                        )}

                        <button
                          onClick={() => handleOpenEditModal(app)}
                          className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 border border-slate-200"
                          title="Editar agendamento"
                        >
                          <Calendar className="w-3.5 h-3.5" /> Editar
                        </button>

                        <button 
                          onClick={() => exportAppointmentICS(app)}
                          className="py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 border border-amber-200"
                          title="Baixar arquivo .ICS para sincronizar com Google Agenda ou Outlook"
                        >
                          <Download className="w-3.5 h-3.5" /> ICS
                        </button>

                        {app.status === 'scheduled' && (
                          <button 
                            onClick={() => handleUpdateStatus(app.id, 'confirmed')}
                            className="flex-1 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 min-w-[70px]"
                          >
                            <Check className="w-3.5 h-3.5" /> Confirmar
                          </button>
                        )}

                        {app.status === 'confirmed' && (
                          <button 
                            onClick={() => handleUpdateStatus(app.id, 'completed')}
                            className="flex-1 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 min-w-[70px]"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Concluir
                          </button>
                        )}

                        {app.status !== 'completed' && app.status !== 'cancelled' && (
                          <button 
                            onClick={() => handleCancelAppointment(app)}
                            className="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        )}

                        {canDeleteAppointment(app) && (
                          <button
                            onClick={() => { setAppointmentToDelete(app); setIsDeleteModalOpen(true); }}
                            className="py-1.5 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                            title="Excluir agendamento"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Excluir
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
          </div>
        </div>

        {/* ─── SIDEBAR RIGHT ─── */}
        <div id="scheduling-sidebar" className="w-full lg:w-80 flex flex-col gap-6">
          
          {/* VISUAL MONTH CALENDAR */}
          <div className="glass-card p-5 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-150 pb-3 mb-4">
              <h3 className="font-display font-black text-sm text-slate-800 uppercase tracking-tight">Calendário de Campo</h3>
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={handlePrevMonth}
                  className="p-1 px-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={handleNextMonth}
                  className="p-1 px-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="text-center font-bold text-xs uppercase text-slate-600 select-none pb-2 tracking-widest">
              {monthsBr[currentMonth]} {currentYear}
            </div>

            {/* 7 Columns Days Headings */}
            <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-slate-400 uppercase py-1 border-b border-slate-100">
              <span>Dom</span>
              <span>Seg</span>
              <span>Ter</span>
              <span>Qua</span>
              <span>Qui</span>
              <span>Sex</span>
              <span>Sáb</span>
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1.5 text-center mt-2">
              {calendarCells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} />;
                }

                // Construct ISO day key 'YYYY-MM-DD'
                const dStr = String(day).padStart(2, '0');
                const mStr = String(currentMonth + 1).padStart(2, '0');
                const isoDayKey = `${currentYear}-${mStr}-${dStr}`;

                // Validate if there are appointments on this specific day
                const hasAppointments = appointments.some(app => app.date === isoDayKey && app.status !== 'cancelled');
                
                // Matches exact local today date
                const isDayToday = today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear;
                
                const isSelected = selectedCalendarDay === isoDayKey;

                return (
                  <button
                    key={`day-${day}`}
                    onClick={() => {
                      if (selectedCalendarDay === isoDayKey) {
                        setSelectedCalendarDay(null); // Clear toggle
                      } else {
                        setSelectedCalendarDay(isoDayKey);
                      }
                    }}
                    className={cn(
                      "aspect-square flex flex-col justify-center items-center text-[11px] font-bold rounded-lg transition-all relative cursor-pointer",
                      isDayToday && !isSelected && "bg-emerald-600 text-white",
                      isSelected && "bg-emerald-600 text-white shadow-md shadow-emerald-500/20",
                      !isDayToday && !isSelected && "hover:bg-slate-100 text-slate-700 font-medium"
                    )}
                  >
                    <span>{day}</span>
                    {hasAppointments && (
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full absolute bottom-1",
                        isDayToday || isSelected ? "bg-white" : "bg-emerald-500"
                      )} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TOTAL MINI SUMMARIES */}
          <div className="glass-card p-5 flex flex-col gap-4">
            <h3 className="font-display font-black text-xs text-slate-800 uppercase tracking-widest pb-2 border-b border-slate-100">Painel Operacional</h3>
            
            <div className="space-y-3">
              {/* Today Count */}
              <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-white/50">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Agendados Hoje</span>
                </div>
                <div className="text-lg font-black text-slate-850">
                  {appointments.filter(app => app.date === todayLocalDateString() && app.status !== 'cancelled').length}
                </div>
              </div>

              {/* Confirmed Count */}
              <div className="flex items-center justify-between p-3 bg-slate-50/10 rounded-xl border border-slate-100/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider font-sans">Agendamentos Ativos</span>
                </div>
                <div className="text-lg font-black text-slate-850">
                  {appointments.filter(app => app.status === 'confirmed').length}
                </div>
              </div>

              {/* Pending Count */}
              <div className="flex items-center justify-between p-3 bg-amber-50/10 rounded-xl border border-amber-100/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600">
                    <Clock className="w-4 h-4" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pendentes</span>
                </div>
                <div className="text-lg font-black text-slate-850">
                  {appointments.filter(app => app.status === 'scheduled').length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── MODAL DIALOG ─── */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            {/* Modal Box */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white/80 backdrop-blur-xl border border-white p-6 max-w-md w-full rounded-3xl shadow-xl space-y-4 flex flex-col"
            >
              {/* Box Header */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-display font-black text-base text-slate-800 uppercase tracking-tight">
                    {editingAppointmentId ? 'Editar Agendamento' : 'Novo Agendamento'}
                  </h3>
                </div>
                <button 
                  onClick={resetForm}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Box Form */}
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {/* Client Select */}
                <div className="space-y-1">
                  <label htmlFor="client-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Cliente Solicitante *</label>
                  <select 
                    id="client-select"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-semibold outline-none transition-all"
                  >
                    <option value="">Selecione o cliente...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name} {c.cpf ? `(${c.cpf})` : ''}</option>
                    ))}
                  </select>
                </div>

                {/* Technician Select */}
                <div className="space-y-1">
                  <label htmlFor="technician-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Técnico Responsável *</label>
                  <select 
                    id="technician-select"
                    value={selectedTechnicianId}
                    onChange={(e) => setSelectedTechnicianId(e.target.value)}
                    className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-semibold outline-none transition-all"
                  >
                    <option value="">Selecione o profissional...</option>
                    {technicians.map(t => (
                      <option key={t.uid} value={t.uid}>{t.displayName} ({(t.role || '').toUpperCase()})</option>
                    ))}
                  </select>
                </div>

                {/* Service Type Select */}
                <div className="space-y-1">
                  <label htmlFor="service-type-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Tipo de Serviço *</label>
                  <select 
                    id="service-type-select"
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                    className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-semibold outline-none transition-all"
                  >
                    <option value="Consultoria Técnica">Consultoria Técnica</option>
                    <option value="Análise de Solo">Análise de Solo</option>
                    <option value="Visita de Campo">Visita de Campo</option>
                    <option value="Laudo Fitossanitário">Laudo Fitossanitário</option>
                    <option value="Planejamento de Irrigação">Planejamento de Irrigação</option>
                    <option value="Topografia">Topografia</option>
                    <option value="Regularização Ambiental">Regularização Ambiental</option>
                    <option value="Reunião Virtual / Online">Reunião Virtual / Online</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>

                {/* Formato de Reunião (Virtual vs Presencial) */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Formato do Atendimento</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setIsVirtual(false)}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                        !isVirtual 
                          ? "bg-slate-50 text-slate-700 border-slate-200"
                          : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      Presencial
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsVirtual(true)}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                        isVirtual 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      Virtual / Online
                    </button>
                  </div>
                </div>

                {/* Platform Selector & Co-participants (Collaborators) */}
                {isVirtual && (
                  <div className="space-y-3.5 border-l-2 border-emerald-500 pl-3 py-1 bg-emerald-50/10 rounded-r-xl">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plataforma Virtual *</label>
                      <div className="grid grid-cols-2 gap-2 mt-0.5">
                        <button
                          type="button"
                          onClick={() => setMeetingPlatform('meet')}
                          className={cn(
                            "py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer",
                            meetingPlatform === 'meet'
                              ? "bg-white text-emerald-600 border-emerald-400 shadow-sm"
                              : "bg-slate-50/50 text-slate-400 border-transparent"
                          )}
                        >
                          Google Meet
                        </button>
                        <button
                          type="button"
                          onClick={() => setMeetingPlatform('teams')}
                          className={cn(
                            "py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer",
                            meetingPlatform === 'teams'
                              ? "bg-white text-emerald-600 border-emerald-400 shadow-sm"
                              : "bg-slate-50/50 text-slate-400 border-transparent"
                          )}
                        >
                          Microsoft Teams
                        </button>
                      </div>
                    </div>

                    {/* Collaborator participants selection */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Co-participantes (Colaboradores)</label>
                      <div className="max-h-[120px] overflow-y-auto border border-slate-150 rounded-xl bg-white p-2.5 space-y-1">
                        {technicians
                          .filter(t => t.uid !== selectedTechnicianId) // don't list the main responsbile again
                          .map(t => {
                            const isSelected = selectedCollaboratorIds.includes(t.uid);
                            return (
                              <label key={t.uid} className="flex items-center gap-2 text-xs font-medium text-slate-650 cursor-pointer hover:bg-slate-50 p-1 rounded-lg transition-colors">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    if (isSelected) {
                                      setSelectedCollaboratorIds(prev => prev.filter(id => id !== t.uid));
                                    } else {
                                      setSelectedCollaboratorIds(prev => [...prev, t.uid]);
                                    }
                                  }}
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                />
                                <span>{t.displayName} ({(t.role || '').toUpperCase()})</span>
                              </label>
                            );
                          })}
                        {technicians.filter(t => t.uid !== selectedTechnicianId).length === 0 && (
                          <div className="text-[10px] text-slate-400 text-center py-2">Nenhum outro colaborador cadastrado.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Date & Time fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="appointment-date" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Data *</label>
                    <input 
                      id="appointment-date"
                      type="date" 
                      min={todayLocalDateString()}
                      value={appointmentDate}
                      onChange={(e) => setAppointmentDate(e.target.value)}
                      className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-semibold outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="appointment-time" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Horário *</label>
                    <input 
                      id="appointment-time"
                      type="time" 
                      step="1800" // Suggest 30min increments
                      value={appointmentTime}
                      onChange={(e) => setAppointmentTime(e.target.value)}
                      className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-semibold outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Notes Textarea */}
                <div className="space-y-1">
                  <label htmlFor="notes-textarea" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Observações / Detalhes</label>
                  <textarea 
                    id="notes-textarea"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-3 bg-white/60 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-xl text-xs font-medium outline-none transition-all placeholder:text-slate-350 resize-none"
                    placeholder="Inclua detalhes adicionais..."
                  />
                </div>
              </div>

              {/* Box Actions */}
              <div className="flex gap-2.5 pt-4 border-t border-slate-100">
                <button 
                  onClick={resetForm}
                  disabled={modalLoading}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] border border-slate-250 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-display"
                >
                  Cancelar
                </button>
                <button 
                  onClick={editingAppointmentId ? handleEditAppointment : handleCreateAppointment}
                  disabled={modalLoading}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 shadow-md shadow-emerald-500/10 font-display"
                >
                  {modalLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ─── ROUTE OPTIMIZER MODAL ─── */}
        {isRouteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 flex flex-col gap-5 max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center">
                    <Route className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-black text-lg text-slate-800 dark:text-slate-100">
                      Otimizador de Rotas de Campo
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Sequenciamento e navegação GPS multi-destinos para visitas técnicas
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => setIsRouteModalOpen(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Date selection & stats */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200">Data do Roteiro:</label>
                  <input 
                    type="date"
                    value={routeDate}
                    onChange={(e) => setRouteDate(e.target.value)}
                    className="text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span><strong>{routeDayAppointments.length}</strong> paradas</span>
                  <span><strong>{routeDayAppointments.filter(a => a.status === 'completed').length}</strong> concluídas</span>
                </div>
              </div>

              {/* Stops List */}
              <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[350px] pr-1">
                {routeDayAppointments.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50/50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center">
                    <MapPin className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      Nenhuma visita presencial agendada para {formatDate(routeDate)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Selecione outra data ou crie novos agendamentos presenciais.
                    </p>
                  </div>
                ) : (
                  routeDayAppointments.map((app, index) => {
                    const client = clients.find(c => c.id === app.clientId || c.name === app.clientName);
                    const clientAddr = client?.address ? `${client.address.city} - ${client.address.state}` : 'Endereço não cadastrado';

                    return (
                      <div 
                        key={app.id}
                        className="flex items-center justify-between gap-3 p-3.5 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-2xl hover:shadow-xs transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white font-bold font-mono text-xs flex items-center justify-center shrink-0">
                            {index + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-800 dark:text-slate-100">{app.clientName}</span>
                              <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">
                                {app.time} HS
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              {clientAddr} • {app.serviceType}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {app.checkInLocation && (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
                              ✓ Check-in GPS
                            </span>
                          )}
                          {app.checkOutLocation && (
                            <span className="text-[9px] font-bold text-slate-600 bg-slate-50 dark:bg-emerald-950 px-2 py-1 rounded-md border border-slate-200 dark:border-emerald-800">
                              🏁 Concluído
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer Actions */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setIsRouteModalOpen(false)}
                  className="px-4 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Fechar
                </button>

                <button
                  type="button"
                  onClick={handleOpenGoogleMapsRoute}
                  disabled={routeDayAppointments.length === 0}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 font-display"
                >
                  <Navigation className="w-4 h-4" /> Abrir Rota Otimizada no Google Maps
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setAppointmentToDelete(null); }}
        onConfirm={handleDeleteAppointment}
        title="Excluir agendamento?"
        description={appointmentToDelete
          ? `O agendamento de ${appointmentToDelete.clientName} em ${appointmentToDelete.date.split('-').reverse().join('/')} às ${appointmentToDelete.time} será apagado definitivamente.${visitByAppointment[appointmentToDelete.id] ? ' A visita de campo já registrada continua guardada.' : ''} Se quiser só desmarcar, use "Cancelar".`
          : ''}
        confirmLabel="Excluir"
      />
    </div>
  );
}
