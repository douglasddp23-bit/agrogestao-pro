import React, { useState, useEffect, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  ShieldCheck, 
  Search, 
  Plus, 
  FileText, 
  Clock, 
  User, 
  CheckCircle2, 
  AlertCircle,
  FileCheck,
  ClipboardList,
  Calendar,
  Save,
  Download,
  Trash2,
  LandPlot,
  History,
  Info,
  Map
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn, formatDate, formatDateTime, handleFirestoreError, OperationType, todayLocalDateString, parseDateInput } from '../lib/utils';
import { Client } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawBrandBanner, drawBrandFooter } from '../lib/pdfBranding';
import ServiceKpiCards, { isThisMonth } from '../components/service/ServiceKpiCards';

import ConfirmationModal from '../components/ConfirmationModal';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { ShieldCheck as PageIcon } from 'lucide-react';
import { useInitialSearch } from '../hooks/useInitialSearch';
import ExportExcelButton from '../components/service/ExportExcelButton';
import { logAudit } from '../lib/audit';

interface DocService {
  id: string;
  clientId: string;
  clientName: string;
  propertyName: string;
  responsible: string;
  scheduledDate: string;
  status: 'Pendente' | 'Em Andamento' | 'Concluido';
  documents: {
    car: boolean;
    ccir: boolean;
    itr: boolean;
    escritura: boolean;
    georreferenciamento: boolean;
    ada: boolean;
  };
  notes: string;
  deadline?: string;
  protocolNumber?: string;   // número dado pelo órgão (digitado)
  internalProtocol?: string; // número interno automático RA-AAAA-NNNN
  organ?: string;
  createdAt: any;
}

// Protocolo interno automático: RA-<ano>-<sequência de 4 dígitos>, reiniciando a
// cada ano. O próprio número é o ID do documento no banco — dois computadores
// nunca conseguem gravar o mesmo número (o segundo é empurrado para o próximo).
const PROTOCOL_PREFIX = 'RA';
const protocolFor = (year: number, seq: number) => `${PROTOCOL_PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
function nextProtocolSeq(services: { internalProtocol?: string }[], year: number) {
  const re = new RegExp(`^${PROTOCOL_PREFIX}-${year}-(\\d+)$`);
  let max = 0;
  for (const s of services) {
    const m = s.internalProtocol?.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const DOCUMENT_TYPES = [
  { id: 'car', label: 'CAR (Cadastro Ambiental Rural)', icon: ShieldCheck },
  { id: 'ccir', label: 'CCIR (INCRA)', icon: FileText },
  { id: 'itr', label: 'ITR (Imposto Territorial Rural)', icon: ClipboardList },
  { id: 'escritura', label: 'Escritura / Matrícula', icon: LandPlot },
  { id: 'georreferenciamento', label: 'Georreferenciamento', icon: Map },
  { id: 'ada', label: 'ADA (Ato de Declaratório Ambiental)', icon: FileCheck },
];

export default function Regularization() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<DocService[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [showPropertySelect, setShowPropertySelect] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(todayLocalDateString());
  const [selectedDocs, setSelectedDocs] = useState<Record<string, boolean>>({
    car: false,
    ccir: false,
    itr: false,
    escritura: false,
    georreferenciamento: false,
    ada: false,
  });
  const [notes, setNotes] = useState('');
  const [deadline, setDeadline] = useState('');
  const [protocolNumber, setProtocolNumber] = useState('');
  const [organ, setOrgan] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);

  useEffect(() => {
    const qClients = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribeClients = onSnapshot(qClients, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    const qServices = query(collection(db, 'regularization_services'), orderBy('createdAt', 'desc'));
    const unsubscribeServices = onSnapshot(qServices, (snapshot) => {
      setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocService)));
      setLoading(false);
    });

    return () => {
      unsubscribeClients();
      unsubscribeServices();
    };
  }, []);


  // Histórico de alterações (Auditoria Global e "Histórico" nos detalhes)
  const audit = (action: string, recordId: string, recordName: string, details: string, extra: Record<string, any> = {}) =>
    logAudit({ userId: user?.uid || 'unknown', userName: user?.displayName || user?.email || 'Usuário', action, collection: 'regularization_services', recordId, recordName, details, ...extra });

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const selectedClient = clients.find(c => c.id === clientId);
    
    if (selectedClient) {
      const properties = selectedClient.properties?.map(p => p.name) || [];
      setAvailableProperties(properties);
      
      if (properties.length === 1) {
        setPropertyName(properties[0]);
        setShowPropertySelect(false);
      } else if (properties.length > 1) {
        setPropertyName('');
        setShowPropertySelect(true);
      } else {
        setPropertyName('');
        setShowPropertySelect(false);
      }
    } else {
      setAvailableProperties([]);
      setShowPropertySelect(false);
      setPropertyName('');
    }
  };

  const handleSave = async () => {
    if (!selectedClientId || !propertyName) {
      toast.error('Por favor, selecione o cliente e informe o nome da propriedade.');
      return;
    }

    setIsSaving(true);
    try {
      const client = clients.find(c => c.id === selectedClientId);
      const year = new Date().getFullYear();
      let seq = nextProtocolSeq(services, year);
      let internalProtocol = '';
      for (let attempt = 0; attempt < 50 && !internalProtocol; attempt++, seq++) {
        const candidate = protocolFor(year, seq);
        const ref = doc(db, 'regularization_services', candidate);
        const created = await runTransaction(db, async (tx) => {
          if ((await tx.get(ref)).exists()) return false; // número já usado (outro PC) — tenta o próximo
          tx.set(ref, {
            clientId: selectedClientId,
            clientName: client?.name || 'Desconhecido',
            propertyName,
            responsible: user?.displayName || 'Técnico',
            scheduledDate,
            deadline: deadline || null,
            protocolNumber: protocolNumber || null,
            internalProtocol: candidate,
            organ: organ || null,
            status: 'Pendente',
            documents: selectedDocs,
            notes,
            createdAt: serverTimestamp(),
            createdBy: user?.uid
          });
          return true;
        });
        if (created) internalProtocol = candidate;
      }
      if (!internalProtocol) throw new Error('Não foi possível gerar o número de protocolo.');
      audit('created', internalProtocol, `${internalProtocol} — ${client?.name || ''}`, `Protocolo ${internalProtocol} aberto${organ ? ' (' + organ + ')' : ''}.`);
      // Automatically integrate with Agenda by creating a notification.
      // Isolado do save principal: se essa notificação falhar, o protocolo já
      // foi criado — não pode aparecer como erro contraditório do mesmo salvamento.
      try {
        if (user) {
          await addDoc(collection(db, 'notifications'), {
            userId: user.uid,
            title: 'Protocolo Ambiental Criado',
            message: `O protocolo ${internalProtocol} de regularização para ${client?.name} foi integrado à agenda para o dia ${scheduledDate.split('-').reverse().join('/')}.`,
            type: 'success',
            read: false,
            createdAt: new Date().toISOString(),
            link: 'scheduling'
          });
        }
      } catch (notifError) {
        console.warn('Falha ao criar notificação de agenda (protocolo já foi salvo normalmente):', notifError);
      }

      toast.success(`Protocolo ${internalProtocol} criado com sucesso!`);
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'regularization_services');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setSelectedClientId('');
    setPropertyName('');
    setScheduledDate(todayLocalDateString());
    setDeadline('');
    setProtocolNumber('');
    setOrgan('');
    setSelectedDocs({
      car: false,
      ccir: false,
      itr: false,
      escritura: false,
      georreferenciamento: false,
      ada: false,
    });
    setNotes('');
  };

  const calculateElapsedDays = (scheduledDate?: string, createdAt?: any) => {
    if (!scheduledDate && !createdAt) return null;
    let start: Date;
    if (scheduledDate) {
      start = new Date(scheduledDate + 'T00:00:00');
    } else if (createdAt?.toDate) {
      start = createdAt.toDate();
    } else {
      start = new Date(createdAt);
    }
    if (isNaN(start.getTime())) return null;
    const now = new Date();
    const diffTime = Math.max(0, now.getTime() - start.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    let businessDays = 0;
    const cur = new Date(start);
    while (cur <= now) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) {
        businessDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { diffDays, businessDays };
  };

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'regularization_services', id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Status atualizado para: ${newStatus}`);
      const s0 = services.find(s => s.id === id);
      audit('status_changed', id, `${s0?.internalProtocol || ''} — ${s0?.clientName || ''}`, `Status alterado para ${newStatus}.`, { previousValues: { status: s0?.status }, newValues: { status: newStatus } });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'regularization_services');
    }
  };

  const handleDeleteService = async (id: string) => {
    try {
      const s1 = services.find(s => s.id === id);
      await deleteDoc(doc(db, 'regularization_services', id));
      audit('deleted', id, `${s1?.internalProtocol || ''} — ${s1?.clientName || ''}`, 'Protocolo excluído.');
      setIsDeleteModalOpen(null);
      toast.success('Protocolo excluído com sucesso.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'regularization_services');
    }
  };

  const generatePDF = (service: DocService) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    drawBrandBanner(doc, { height: 40, subtitle: 'Relatório de Regularização Ambiental e Fundiária' });

    // Body
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const isFinal = service.status === 'Concluido';
    doc.text(isFinal ? 'RELATÓRIO FINAL DE REGULARIZAÇÃO' : 'PROTOCOLO DE ATENDIMENTO DOCUMENTAL', 20, 52);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data de Emissão: ${formatDateTime(new Date())}`, 20, 57);

    doc.setDrawColor(226, 232, 240);
    doc.line(20, 60, pageWidth - 20, 60);

    // Info Table
    autoTable(doc, {
      startY: 66,
      head: [['Campo', 'Informação']],
      body: [
        ['Protocolo Interno', service.internalProtocol || '— (registro anterior à numeração automática)'],
        ...(service.protocolNumber ? [['Processo no Órgão', `${service.protocolNumber}${service.organ ? ` (${service.organ})` : ''}`]] : []),
        ...(service.deadline ? [['Prazo Legal', formatDate(service.deadline)]] : []),
        ['Cliente', service.clientName],
        ['Propriedade', service.propertyName],
        ['Responsável Técnico', service.responsible],
        ['Data Prevista de Execução', formatDate(service.scheduledDate)],
        ['Status Atual', service.status === 'Concluido' ? 'Concluído' : service.status],
      ],
      theme: 'plain',
      headStyles: { fontStyle: 'bold', textColor: [100, 100, 100] },
      margin: { left: 20, right: 20 }
    });

    // Documents Section
    const nextY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFont('helvetica', 'bold');
    doc.text('CHECKLIST DE DOCUMENTAÇÃO RURAL:', 20, nextY);

    const docItems = DOCUMENT_TYPES.map(dt => [
      dt.label,
      (service.documents || ({} as DocService['documents']))[dt.id as keyof DocService['documents']] ? 'SIM (INCLUSO)' : 'Não solicitado / Pendente'
    ]);

    autoTable(doc, {
      startY: nextY + 5,
      head: [['Documento', 'Status no Projeto']],
      body: docItems,
      headStyles: { fillColor: [16, 185, 129] },
      margin: { left: 20, right: 20 }
    });

    let endY = (doc as any).lastAutoTable.finalY + 15;
    if (service.notes || isFinal) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(isFinal ? 'CONCLUSÃO / OBSERVAÇÕES TÉCNICAS:' : 'OBSERVAÇÕES TÉCNICAS:', 20, endY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const text = service.notes || 'Serviço de regularização concluído conforme a documentação listada acima.';
      const splitNotes = doc.splitTextToSize(text, pageWidth - 40);
      doc.text(splitNotes, 20, endY + 7);
      endY += 7 + splitNotes.length * (doc.getFontSize() * doc.getLineHeightFactor() / doc.internal.scaleFactor) + 10;
    }

    if (isFinal) {
      // Assinatura do responsável técnico
      const signY = Math.min(Math.max(endY + 20, 200), doc.internal.pageSize.getHeight() - 45);
      doc.setDrawColor(100, 116, 139);
      doc.line(pageWidth / 2 - 45, signY, pageWidth / 2 + 45, signY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(service.responsible || 'Responsável Técnico', pageWidth / 2, signY + 5, { align: 'center' });
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(isFinal
      ? 'Relatório final do serviço de regularização ambiental e fundiária.'
      : 'Este documento serve como comprovante de solicitação de serviços de regularização.', pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' });
    drawBrandFooter(doc);

    doc.save(`Regularizacao_${service.internalProtocol ? service.internalProtocol + '_' : ''}${(service.clientName || 'Cliente').replace(/\s/g, '_')}.pdf`);
  };

  // ─── Mini painel ───
  const openProtocols = services.filter(s => s.status !== 'Concluido');
  const now = new Date();
  const daysTo = (d?: string) => { const dt = d ? parseDateInput(d) : null; return dt ? Math.ceil((dt.getTime() - now.getTime()) / 864e5) : null; };
  const overdue = openProtocols.filter(s => { const n = daysTo(s.deadline); return n !== null && n < 0; });
  const dueSoon = openProtocols.filter(s => { const n = daysTo(s.deadline); return n !== null && n >= 0 && n <= 30; });
  const doneProtocols = services.filter(s => s.status === 'Concluido');
  const docsPending = openProtocols.reduce((acc, s) => acc + Object.values(s.documents || {}).filter(Boolean).length, 0);
  const kpis = [
    { label: 'Protocolos em Aberto', value: openProtocols.length, hint: `${openProtocols.filter(s => s.status === 'Pendente').length} pendente(s) · ${openProtocols.filter(s => s.status === 'Em Andamento').length} em andamento`, icon: ClipboardList, tone: 'emerald' as const },
    { label: 'Prazos Vencidos', value: overdue.length, hint: overdue.length ? 'Prazo legal já passou' : 'Nenhum prazo vencido', icon: AlertCircle, tone: (overdue.length ? 'rose' : 'slate') as 'rose' | 'slate' },
    { label: 'Vencem em 30 dias', value: dueSoon.length, hint: `${docsPending} documento(s) em regularização`, icon: Clock, tone: 'amber' as const },
    { label: 'Concluídos', value: doneProtocols.length, hint: `${doneProtocols.filter(s => isThisMonth((s as any).updatedAt || s.createdAt)).length} neste mês`, icon: CheckCircle2, tone: 'emerald' as const },
  ];

  const filteredServices = services.filter(s => 
    (s.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.propertyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.internalProtocol || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.protocolNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 h-full overflow-hidden">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Regularização Ambiental" subtitle="Gestão documental rural (CAR, CCIR, ITR, escrituras)" />

        <div className="flex items-center gap-3">
          <ExportExcelButton fileName="Protocolos_Regularizacao" getRows={() => filteredServices.map((s: any) => ({
    'Protocolo': s.internalProtocol || '', 'Processo no Órgão': s.protocolNumber || '', 'Órgão': s.organ || '',
    'Cliente': s.clientName || '', 'Propriedade': s.propertyName || '', 'Status': s.status === 'Concluido' ? 'Concluído' : s.status || '',
    'Prazo Legal': (s.deadline ? String(s.deadline).split('T')[0].split('-').reverse().join('/') : ''), 'Previsto': (s.scheduledDate ? String(s.scheduledDate).split('T')[0].split('-').reverse().join('/') : ''), 'Responsável': s.responsible || '',
    'Documentos': Object.entries(s.documents || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', '),
  }))} />
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar protocolos..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 glass-input text-xs w-64 bg-white/50"
            />
          </div>
          {/* Todos os cargos abrem protocolos (decisão do dono, 28/09/2026) */ true && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
            >
              <Plus className="w-4 h-4" /> Novo Protocolo
            </button>
          )}
        </div>
      </header>

      <ServiceKpiCards items={kpis} />

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {loading ? (
          <div className="h-40 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="bg-white/40 border border-white/60 rounded-3xl p-20 flex flex-col items-center justify-center text-slate-400 gap-4">
             <ClipboardList className="w-16 h-16 opacity-10" />
             <p className="text-sm font-medium">Nenhum serviço de regularização registrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
            {filteredServices.map((service) => (
              <motion.div 
                key={service.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-6 flex flex-col gap-5 hover:border-emerald-500/30 transition-all group"
              >
                <div className="flex justify-between items-start">
                   <div>
                      <h3 className="font-bold text-slate-800 text-sm uppercase tracking-tight">{service.clientName}</h3>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold uppercase mt-1">
                         <LandPlot className="w-3 h-3" />
                         {service.propertyName}
                      </div>
                      {service.internalProtocol && (
                        <div className="text-[10px] font-mono text-emerald-700 font-bold mt-0.5">
                          {service.internalProtocol}
                        </div>
                      )}
                      {service.protocolNumber && (
                        <div className="text-[10px] font-mono text-slate-500 font-semibold mt-0.5">
                          Órgão: {service.protocolNumber} {service.organ ? `(${service.organ})` : ''}
                        </div>
                      )}
                   </div>
                   <div className="flex flex-col items-end gap-1.5">
                     <div className={cn(
                       "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest",
                       service.status === 'Concluido' ? "bg-emerald-100 text-emerald-700" :
                       service.status === 'Em Andamento' ? "bg-slate-100 text-slate-700" :
                       "bg-amber-100 text-amber-700"
                     )}>
                       {service.status}
                     </div>
                     {service.deadline && (() => {
                       // Ancorado em horário local (parseDateInput) pra não marcar "vencido"
                       // horas antes da hora certa por causa do fuso (mesmo bug já corrigido
                       // em outras páginas do sistema).
                       const deadlineDate = parseDateInput(service.deadline);
                       if (!deadlineDate) return null;
                       const now = new Date();
                       const days = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                       if (deadlineDate < now) {
                         return (
                           <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                             PRAZO VENCIDO
                           </span>
                         );
                       }
                       if (days <= 30) {
                         return (
                           <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                             VENCE EM {days} {days === 1 ? 'DIA' : 'DIAS'}
                           </span>
                         );
                       }
                       return null;
                     })()}
                   </div>
                </div>

                <div className="flex flex-wrap gap-2">
                   {Object.entries(service.documents || {}).map(([key, val]) => val && (
                     <div key={key} className="px-2 py-1 bg-white/60 border border-slate-100 rounded-lg flex items-center gap-1.5">
                        {DOCUMENT_TYPES.find(d => d.id === key)?.icon && React.createElement(DOCUMENT_TYPES.find(d => d.id === key)!.icon as any, {className: 'w-3 h-3 text-emerald-500'})}
                        <span className="text-[9px] font-bold text-slate-600">{key.toUpperCase()}</span>
                     </div>
                   ))}
                </div>

                <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                   <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                         <User className="w-3 h-3" />
                         {service.responsible}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold">
                         <Calendar className="w-3 h-3" />
                         Previsto: {service.scheduledDate?.split('-').reverse().join('/')}
                      </div>
                      {(() => {
                        const elapsed = calculateElapsedDays(service.scheduledDate, service.createdAt);
                        if (!elapsed) return null;
                        return (
                          <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-100/70 px-2 py-0.5 rounded-md mt-0.5">
                            <Clock className="w-2.5 h-2.5 text-emerald-600" />
                            <span>{elapsed.businessDays} dias úteis ({elapsed.diffDays} corridos)</span>
                          </div>
                        );
                      })()}
                   </div>
                   <div className="flex gap-2">
                      <button 
                        onClick={() => generatePDF(service)}
                        className="p-2 bg-slate-100 text-slate-400 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 transition-all shadow-sm"
                        title="Baixar Protocolo"
                      >
                         <Download className="w-4 h-4" />
                      </button>
                      {/* Excluir: só Administrador, igual à regra do banco */ (user?.effectiveRole ?? user?.role) === 'admin' && (
                        <button 
                          onClick={() => setIsDeleteModalOpen(service.id)}
                          className="p-2 bg-rose-50 text-rose-400 rounded-xl hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                          title="Excluir Serviço"
                        >
                           <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <select 
                        value={service.status}
                        onChange={(e) => updateStatus(service.id, e.target.value)}
                        disabled={(user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant'}
                        className="text-[10px] font-bold bg-white border border-slate-100 rounded-lg px-2 outline-none disabled:opacity-70"
                      >
                         <option value="Pendente">Pendente</option>
                         <option value="Em Andamento">Progresso</option>
                         <option value="Concluido">Concluído</option>
                      </select>
                   </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => { setIsModalOpen(false); resetForm(); }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="bg-emerald-600 p-6 text-white flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <ShieldCheck className="w-6 h-6" />
                    <h2 className="text-xl font-display font-bold">Novo Protocolo Ambiental</h2>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <AlertCircle className="w-5 h-5 rotate-45" />
                 </button>
              </div>

              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Protocolo interno (automático)</span>
                  <span className="font-mono text-sm font-bold text-emerald-800">
                    {protocolFor(new Date().getFullYear(), nextProtocolSeq(services, new Date().getFullYear()))}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente</label>
                       <select 
                         value={selectedClientId}
                         onChange={(e) => handleClientChange(e.target.value)}
                         className="w-full glass-input"
                       >
                         <option value="">Selecione...</option>
                         {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                       </select>
                    </div>

                    {showPropertySelect && (
                       <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Selecionar Propriedade</label>
                          <select 
                            required
                            value={propertyName}
                            onChange={(e) => setPropertyName(e.target.value)}
                            className="w-full glass-input bg-slate-50/30 border-slate-200"
                          >
                            <option value="">Escolha a propriedade...</option>
                            {availableProperties.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                       </div>
                    )}

                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome da Propriedade</label>
                       <input 
                         type="text" 
                         readOnly={!showPropertySelect && !!propertyName}
                         value={propertyName}
                         onChange={(e) => setPropertyName(e.target.value)}
                         placeholder="Ex: Fazenda Santa Fé"
                         className={cn(
                           "w-full glass-input",
                           !showPropertySelect && !!propertyName && "bg-emerald-50 border-emerald-200 text-emerald-700 font-bold"
                         )}
                       />
                       {!showPropertySelect && !!propertyName && (
                         <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-tight">Propriedade Identificada</span>
                       )}
                    </div>
                </div>

                <div className="space-y-3">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Documentação à Regularizar</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {DOCUMENT_TYPES.map(type => (
                        <button 
                          key={type.id}
                          onClick={() => setSelectedDocs(prev => ({ ...prev, [type.id]: !prev[type.id] }))}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-2xl border transition-all text-left",
                            selectedDocs[type.id] ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/10" : "bg-white border-slate-100 hover:border-emerald-200"
                          )}
                        >
                           <div className={cn(
                             "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                             selectedDocs[type.id] ? "bg-emerald-600 text-white" : "bg-slate-50 text-slate-400"
                           )}>
                              <type.icon className="w-5 h-5" />
                           </div>
                           <span className={cn("text-[11px] font-bold", selectedDocs[type.id] ? "text-emerald-700" : "text-slate-500")}>
                              {type.label}
                           </span>
                        </button>
                      ))}
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data Agendada</label>
                      <input 
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full glass-input bg-slate-50/50 border-slate-200"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Técnico Responsável</label>
                      <input 
                        type="text"
                        readOnly
                        value={user?.displayName || ''}
                        className="w-full glass-input bg-slate-50 text-slate-400 cursor-not-allowed"
                      />
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Prazo Legal / Notificação</label>
                      <input 
                        type="date"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        className="w-full glass-input bg-rose-50/30 border-rose-200 text-rose-700"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nº do Processo no Órgão</label>
                      <input 
                        type="text"
                        placeholder="Opcional — ex: 2026/00492"
                        value={protocolNumber}
                        onChange={(e) => setProtocolNumber(e.target.value)}
                        className="w-full glass-input"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Órgão Competente</label>
                      <select 
                        value={organ}
                        onChange={(e) => setOrgan(e.target.value)}
                        className="w-full glass-input bg-white"
                      >
                         <option value="">Selecione...</option>
                         <option value="IBAMA">IBAMA</option>
                         <option value="IEF-MG">IEF-MG</option>
                         <option value="SEMAD-MG">SEMAD-MG</option>
                         <option value="INCRA">INCRA</option>
                         <option value="EMATER">EMATER</option>
                         <option value="Prefeitura Municipal">Prefeitura Municipal</option>
                         <option value="CREA-MG">CREA-MG</option>
                         <option value="Outro">Outro</option>
                      </select>
                   </div>
                </div>

                <div className="space-y-1.5">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observações Adicionais</label>
                   <textarea 
                     rows={3}
                     value={notes}
                     onChange={(e) => setNotes(e.target.value)}
                     placeholder="Detalhes sobre restrições ambientais, prazos ou pendências externas..."
                     className="w-full glass-input"
                   />
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                 <button 
                   onClick={() => { setIsModalOpen(false); resetForm(); }}
                   className="px-6 py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:bg-slate-200 transition-all font-display"
                 >
                    Descartar
                 </button>
                 <button 
                   onClick={() => runExclusive('Regularization.handleSave', () => handleSave())}
                   disabled={isSaving}
                   className="flex items-center gap-2 px-8 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50"
                 >
                    {isSaving ? 'Salvando...' : <><Save className="w-4 h-4" /> Registrar Protocolo</>}
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteService(isDeleteModalOpen)}
        title="Excluir Protocolo de Regularização?"
        description="Esta ação não pode ser desfeita. O protocolo de regularização e todos os seus registros documentais serão removidos permanentemente."
        confirmLabel="Confirmar Exclusão"
      />
    </div>
  );
}
