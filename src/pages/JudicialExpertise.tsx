import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { useConfirm } from '../hooks/useConfirm';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc, deleteDoc, where, getDocs, serverTimestamp 
} from 'firebase/firestore';
import { saveFile, deleteStoredFile, handleFileLinkClick } from '../lib/fileStore';
import { db, storage, ensureDocumentFolder } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { isManagementRole, canEditOwnRecord } from '../lib/permissions';
import { useNavigate } from 'react-router-dom';
import { JudicialExpertise, Client } from '../types';
import {
  formatDate, formatCurrency, cn, handleFirestoreError, OperationType, parseDateInput, safeUrl } from '../lib/utils';
import { 
  Scale, Plus, Search, Filter, Copy, Check, Calendar, MapPin, 
  DollarSign, FileText, CheckCircle2, Clock, AlertTriangle, 
  Trash2, Edit3, X, ChevronRight, Download, Building, Landmark,
  Gavel, ArrowRight, UserCheck, Eye, Sparkles, Folder, FolderOpen,
  FolderSync, RefreshCw, ExternalLink, ShieldCheck, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawBrandBanner } from '../lib/pdfBranding';
import ProcessStatusTimeline from '../components/ProcessStatusTimeline';
import AuditTrail from '../components/AuditTrail';
import { logAudit } from '../lib/audit';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Scale as PageIcon } from 'lucide-react';
import { useInitialSearch } from '../hooks/useInitialSearch';
import ExportExcelButton from '../components/service/ExportExcelButton';

const EXPERTISE_TYPE_LABELS: Record<string, string> = {
  servidao_administrativa: 'Servidão Administrativa',
  reintegracao_posse: 'Reintegração de Posse',
  avaliacao_judicial: 'Avaliação Judicial',
  dano_ambiental: 'Dano Ambiental',
  divisao_partilha: 'Divisão e Partilha',
  usucapiao: 'Usucapião',
  desapropriacao: 'Desapropriação',
  outro: 'Outro'
};

const HONORARIOS_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  aguardando_nomeacao: { label: 'Aguardando Nomeação', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700' },
  nomeado: { label: 'Perito Nomeado', bg: 'bg-slate-50 dark:bg-emerald-900/30', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-emerald-800' },
  proposta_enviada: { label: 'Proposta Enviada', bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' },
  aprovado: { label: 'Honorários Aprovados', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' },
  alvara_emitido: { label: 'Alvará Emitido', bg: 'bg-slate-50 dark:bg-emerald-900/30', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-emerald-800' },
  pago: { label: 'Pago / Liquidado', bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-300 dark:border-emerald-700' },
};

const LAUDO_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  nao_iniciado: { label: 'Não Iniciado', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-400' },
  em_elaboracao: { label: 'Em Elaboração', bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  concluido: { label: 'Laudo Concluído', bg: 'bg-slate-50 dark:bg-emerald-900/30', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  entregue: { label: 'Entregue / Protocolado', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
};

const METODOLOGIAS_PREDEFINIDAS = [
  'Comparativo Direto de Dados de Mercado',
  'Método da Renda',
  'Método Involutivo',
  'Depreciation Philipe Westin (Servidão Administrativa)',
  'Valor de Custo (Benfeitorias)',
  'Método Evolutivo',
  'Outro'
];

export default function JudicialExpertisePage() {
  const { user } = useAuth();
  // Editar: gestão ou quem cadastrou; excluir: só gestão (igual à regra do banco).
  const activeRole = (user?.effectiveRole ?? user?.role) as string;
  const canDeleteRecord = isManagementRole(activeRole);
  const canEditRecord = (rec: { createdBy?: string }) => canEditOwnRecord(activeRole, user?.uid, rec);
  const [confirmAction, confirmModal] = useConfirm();
  const navigate = useNavigate();
  const [expertises, setExpertises] = useState<JudicialExpertise[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  useInitialSearch(setSearchQuery); // termo vindo da Busca Global
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'concluido' | 'arquivado'>('todos');
  const [typeFilter, setTypeFilter] = useState<string>('todos');
  const [laudoFilter, setLaudoFilter] = useState<string>('todos');

  // Modals and Drawer
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedExpertise, setSelectedExpertise] = useState<JudicialExpertise | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedDocuments, setSyncedDocuments] = useState<any[]>([]);

  // Form State
  const initialFormState = {
    processNumber: '',
    comarca: 'Jacinto/MG',
    vara: '1ª Vara Cível',
    juiz: '',
    tribunalLink: '',
    expertiseType: 'servidao_administrativa' as JudicialExpertise['expertiseType'],
    requerente: '',
    requerido: '',
    propertyName: '',
    propertyCity: '',
    propertyState: 'MG',
    propertyArea: '' as unknown as number,
    registrationNumber: '',
    car: '',
    visitaDate: '',
    visitaDateEnd: '',
    honorariosPropostos: '' as unknown as number,
    honorariosAprovados: '' as unknown as number,
    honorariosStatus: 'aguardando_nomeacao' as JudicialExpertise['honorariosStatus'],
    alvaraNumber: '',
    laudoStatus: 'nao_iniciado' as JudicialExpertise['laudoStatus'],
    laudoDeadline: '',
    laudoNotes: '',
    normaAplicada: 'ABNT NBR 14.653-3',
    metodologia: 'Comparativo Direto de Dados de Mercado',
    clientId: '',
    status: 'ativo' as JudicialExpertise['status']
  };

  const [formData, setFormData] = useState(initialFormState);

  // Firestore Subscriptions
  useEffect(() => {
    const qExpertises = query(collection(db, 'judicial_expertises'), orderBy('createdAt', 'desc'));
    const unsubExpertises = onSnapshot(qExpertises, (snapshot) => {
      const docs: JudicialExpertise[] = [];
      snapshot.forEach((d) => {
        docs.push({ id: d.id, ...d.data() } as JudicialExpertise);
      });
      setExpertises(docs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'judicial_expertises');
      setLoading(false);
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const cList: Client[] = [];
      snapshot.forEach((d) => cList.push({ id: d.id, ...d.data() } as Client));
      setClients(cList);
    });

    return () => {
      unsubExpertises();
      unsubClients();
    };
  }, []);

  // Listen to synced documents for selected expertise in drawer
  useEffect(() => {
    if (!selectedExpertise?.id) {
      setSyncedDocuments([]);
      return;
    }
    const qDocs = query(
      collection(db, 'documents'),
      where('serviceId', '==', selectedExpertise.id)
    );
    const unsub = onSnapshot(qDocs, (snapshot) => {
      const docsList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setSyncedDocuments(docsList);
    }, (err) => {
      console.error('Error loading documents for expertise:', err);
    });
    return () => unsub();
  }, [selectedExpertise?.id]);

  const handleOpenCreateModal = () => {
    setFormData(initialFormState);
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (exp: JudicialExpertise) => {
    setEditingId(exp.id);
    setFormData({
      processNumber: exp.processNumber || '',
      comarca: exp.comarca || '',
      vara: exp.vara || '',
      juiz: exp.juiz || '',
      tribunalLink: exp.tribunalLink || '',
      expertiseType: exp.expertiseType || 'servidao_administrativa',
      requerente: exp.requerente || '',
      requerido: exp.requerido || '',
      propertyName: exp.propertyName || '',
      propertyCity: exp.propertyCity || '',
      propertyState: exp.propertyState || 'MG',
      propertyArea: exp.propertyArea ?? ('' as unknown as number),
      registrationNumber: exp.registrationNumber || '',
      car: exp.car || '',
      visitaDate: exp.visitaDate || '',
      visitaDateEnd: exp.visitaDateEnd || '',
      honorariosPropostos: exp.honorariosPropostos ?? ('' as unknown as number),
      honorariosAprovados: exp.honorariosAprovados ?? ('' as unknown as number),
      honorariosStatus: exp.honorariosStatus || 'aguardando_nomeacao',
      alvaraNumber: exp.alvaraNumber || '',
      laudoStatus: exp.laudoStatus || 'nao_iniciado',
      laudoDeadline: exp.laudoDeadline || '',
      laudoNotes: exp.laudoNotes || '',
      normaAplicada: exp.normaAplicada || 'ABNT NBR 14.653-3',
      metodologia: exp.metodologia || 'Comparativo Direto de Dados de Mercado',
      clientId: exp.clientId || '',
      status: exp.status || 'ativo'
    });
    setIsModalOpen(true);
  };

  // Helper to build jsPDF document for Judicial Expertise
  const buildJudicialExpertisePDF = (exp: JudicialExpertise) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const todayStr = formatDate(new Date());
    const expertName = user?.displayName || 'Engenheiro Agrônomo / Perito Judicial';
    const creaNumber = user?.professionalCertification || 'CREA-MG 000.000/D';
    const expertiseTypeLabel = EXPERTISE_TYPE_LABELS[exp.expertiseType] || exp.expertiseType;
    const honorariosStatusLabel = HONORARIOS_STATUS_CONFIG[exp.honorariosStatus]?.label || exp.honorariosStatus;

    // Header Colors
    // Logo + nome da empresa (Configurar Marca); o juízo vai na linha de baixo
    drawBrandBanner(doc, { height: 20, subtitle: `TJMG — COMARCA DE ${(exp.comarca || 'Jacinto/MG').toUpperCase()} — ${(exp.vara || 'Vara Cível').toUpperCase()}` });

    // Title Section
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('LAUDO DE AVALIAÇÃO PERICIAL', 105, 32, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Processo PJe nº: ${exp.processNumber}`, 105, 38, { align: 'center' });

    // Capa Box
    autoTable(doc, {
      startY: 44,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2, textColor: [30, 41, 59] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 }, 1: { cellWidth: 140 } },
      body: [
        ['Requerente (Autor):', exp.requerente || 'Autor do Processo'],
        ['Requerido (Réu):', exp.requerido || 'Réu do Processo'],
        ['Imóvel Objeto:', `${exp.propertyName || 'Imóvel'} — ${exp.propertyCity || 'Município'}/${exp.propertyState || 'MG'}`],
        ['Área do Imóvel:', `${exp.propertyArea || 0} ha`],
        ['Matrícula / CAR:', `${exp.registrationNumber || 'Não informada'} | CAR: ${exp.car || 'Não informado'}`],
        ['Juiz(a) de Direito:', exp.juiz || 'MM. Juiz(a) da Vara Cível'],
        ['Data da Emissão:', todayStr]
      ]
    });

    let currentY = (doc as any).lastAutoTable.finalY + 8;

    // 1. OBJETO DA PERÍCIA
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('1. OBJETO DA PERÍCIA', 14, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const textObjeto = `O presente laudo tem por objeto a avaliação pericial técnica na modalidade de "${expertiseTypeLabel}", referente ao imóvel denominado "${exp.propertyName || 'Propriedade Rural'}", localizado no município de ${exp.propertyCity || 'Jacinto'}/${exp.propertyState || 'MG'}, com área total estimada em ${exp.propertyArea || 0} hectares, registrado sob matrícula nº ${exp.registrationNumber || 'N/A'} e código CAR: ${exp.car || 'N/A'}.`;
    const splitObjeto = doc.splitTextToSize(textObjeto, 182);
    doc.text(splitObjeto, 14, currentY);
    currentY += splitObjeto.length * 4.5 + 4;

    // 2. NORMA TÉCNICA E METODOLOGIA
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('2. NORMA TÉCNICA E METODOLOGIA', 14, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const textNorma = `O presente trabalho foi elaborado em rigorosa conformidade com a ${exp.normaAplicada || 'ABNT NBR 14.653-3'}, utilizando a metodologia do "${exp.metodologia || 'Comparativo Direto de Dados de Mercado'}", fundamentando-se nos critérios analíticos de mercado e parâmetros agronômicos vigentes no Estado de Minas Gerais.`;
    const splitNorma = doc.splitTextToSize(textNorma, 182);
    doc.text(splitNorma, 14, currentY);
    currentY += splitNorma.length * 4.5 + 4;

    // 3. VISTORIA TÉCNICA
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('3. VISTORIA AO IMÓVEL', 14, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const textVistoria = `A vistoria pericial in loco ao imóvel foi realizada no dia ${exp.visitaDate ? formatDate(exp.visitaDate) : 'a agendar'}${exp.visitaDateEnd ? ` com extensão até ${formatDate(exp.visitaDateEnd)}` : ''}, com coleta de coordenadas geográficas, inspeção visual, análise de cobertura vegetal e verificação das benfeitorias existentes.`;
    const splitVistoria = doc.splitTextToSize(textVistoria, 182);
    doc.text(splitVistoria, 14, currentY);
    currentY += splitVistoria.length * 4.5 + 4;

    // 4. HONORÁRIOS PERICIAIS
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('4. HONORÁRIOS PERICIAIS', 14, currentY);
    currentY += 4;

    autoTable(doc, {
      startY: currentY,
      theme: 'grid',
      headStyles: { fillColor: [240, 253, 244], textColor: [16, 120, 80], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3 },
      body: [
        ['Honorários Propostos pelo Perito:', formatCurrency(exp.honorariosPropostos || 0)],
        ['Honorários Fixados / Aprovados pelo Juízo:', exp.honorariosAprovados ? formatCurrency(exp.honorariosAprovados) : 'Aguardando Despacho'],
        ['Status Atual dos Honorários:', honorariosStatusLabel],
        ['Alvará Judicial de Pagamento nº:', exp.alvaraNumber || 'Aguardando Expedição']
      ]
    });

    currentY = (doc as any).lastAutoTable.finalY + 8;

    // 5. OBSERVAÇÕES TÉCNICAS
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('5. OBSERVAÇÕES E NOTAS TÉCNICAS', 14, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const textNotas = exp.laudoNotes || 'Sem observações complementares registradas para este processo pericial.';
    const splitNotas = doc.splitTextToSize(textNotas, 182);
    doc.text(splitNotas, 14, currentY);
    currentY += splitNotas.length * 4.5 + 14;

    // Rodapé e Assinatura
    if (currentY > 240) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${exp.propertyCity || 'Almenara'} / MG, ${todayStr}.`, 105, currentY, { align: 'center' });
    currentY += 16;

    doc.setDrawColor(148, 163, 184);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(55, currentY, 155, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(expertName, 105, currentY, { align: 'center' });
    currentY += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Perito do Juízo — Engenheiro Agrônomo`, 105, currentY, { align: 'center' });
    currentY += 4;
    doc.text(creaNumber, 105, currentY, { align: 'center' });

    return doc;
  };

  // Automatic synchronization function with the 'documents' collection and client dossier
  const syncExpertiseToDossier = async (exp: JudicialExpertise, targetClientId?: string, showToast = true) => {
    setIsSyncing(true);
    try {
      // 1. Resolve Target Client
      let clientId = targetClientId || exp.clientId;
      if (!clientId) {
        // Match by client name with requerido or requerente
        const match = clients.find(c => 
          (c.name || '').trim().toLowerCase() === (exp.requerido || '').trim().toLowerCase() ||
          (c.name || '').trim().toLowerCase() === (exp.requerente || '').trim().toLowerCase() ||
          (c.propertyName && exp.propertyName && (c.propertyName || '').trim().toLowerCase() === (exp.propertyName || '').trim().toLowerCase())
        );
        if (match) {
          clientId = match.id;
        }
      }

      // (Removido: sem cliente identificado, o laudo ia para o dossiê do PRIMEIRO
      // cliente da lista — um produtor sem relação com o processo.)

      if (!clientId) {
        if (showToast) {
          toast.info('Cadastre ao menos um produtor/cliente para sincronizar este laudo com o dossiê.');
        }
        return;
      }

      // 2. Generate PDF Blob
      const pdfDoc = buildJudicialExpertisePDF(exp);
      const pdfBlob = pdfDoc.output('blob');
      const sanitizedProcess = (exp.processNumber || 'processo').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Laudo_Pericial_${sanitizedProcess}_${Date.now()}.pdf`;
      let storagePath = `documents/${clientId}/${fileName}`;

      // 3. Upload to Firebase Storage
      let downloadUrl = '';
      try {
        // Firestore gratuito (até 2 MB) — ver lib/fileStore.ts
        const saved = await saveFile(pdfBlob, fileName, { clientId });
        downloadUrl = saved.url;
        storagePath = saved.storagePath;
      } catch (storageError) {
        console.warn('Storage upload fallback to Data URI:', storageError);
        downloadUrl = pdfDoc.output('datauristring');
      }

      // 4. Ensure document folder exists in 'documents' collection linking process ID to client dossier
      await ensureDocumentFolder({
        clientId: clientId,
        serviceId: exp.id,
        serviceName: `Perícia Judicial: Proc. ${exp.processNumber}`,
        processNumber: exp.processNumber,
        category: 'Perícia',
        folderType: 'judicial_expertise',
        metadata: {
          comarca: exp.comarca,
          vara: exp.vara,
          requerente: exp.requerente,
          requerido: exp.requerido,
          propertyName: exp.propertyName,
          propertyCity: exp.propertyCity,
          propertyArea: exp.propertyArea,
          honorariosStatus: exp.honorariosStatus,
          laudoStatus: exp.laudoStatus,
          alvaraNumber: exp.alvaraNumber
        },
        initialFile: {
          name: `Laudo Pericial Oficial — Proc. ${exp.processNumber}`,
          url: downloadUrl,
          storagePath: storagePath,
          size: `${(pdfBlob.size / 1024).toFixed(1)} KB`,
          type: 'application/pdf'
        }
      });

      // 5. Check if document already exists for this serviceId to update with latest PDF
      const qExisting = query(
        collection(db, 'documents'),
        where('serviceId', '==', exp.id)
      );
      const existingSnap = await getDocs(qExisting);

      const docPayload = {
        clientId: clientId,
        name: `Laudo Pericial Oficial — Proc. ${exp.processNumber}`,
        category: 'Perícia',
        size: `${(pdfBlob.size / 1024).toFixed(1)} KB`,
        type: 'application/pdf',
        url: downloadUrl,
        storagePath: storagePath,
        serviceId: exp.id,
        serviceName: `Perícia Judicial: Proc. ${exp.processNumber}`,
        isGeneratedReport: true,
        uploadedBy: user?.uid || 'sistema', // obrigatório pelas regras do banco
        uploadedAt: new Date().toISOString(),
        createdAt: serverTimestamp()
      };

      if (!existingSnap.empty) {
        const firstDoc = existingSnap.docs[0];
        await updateDoc(doc(db, 'documents', firstDoc.id), {
          ...docPayload,
          updatedAt: new Date().toISOString()
        });
      }

      // 6. Update judicial expertise record with the clientId if not set
      if (!exp.clientId || exp.clientId !== clientId) {
        await updateDoc(doc(db, 'judicial_expertises', exp.id), {
          clientId: clientId,
          updatedAt: new Date().toISOString()
        });
      }

      if (showToast) {
        toast.success('Laudo pericial e pasta do processo sincronizados com sucesso no dossiê!');
      }
    } catch (error) {
      console.error('Erro na sincronização automática com o dossiê:', error);
      if (showToast) {
        toast.error('Não foi possível sincronizar o documento com o dossiê.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveExpertise = async () => {
    if (!(formData.processNumber || '').trim()) {
      toast.error('Informe o número do processo.');
      return;
    }
    if (!(formData.requerente || '').trim() || !(formData.requerido || '').trim()) {
      toast.error('Informe o Requerente e o Requerido.');
      return;
    }
    if (!(formData.propertyName || '').trim()) {
      toast.error('Informe o nome da propriedade.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<JudicialExpertise, 'id'> = {
        processNumber: (formData.processNumber || '').trim(),
        comarca: (formData.comarca || '').trim(),
        vara: (formData.vara || '').trim(),
        juiz: (formData.juiz || '').trim() || undefined,
        tribunalLink: (formData.tribunalLink || '').trim() || undefined,
        expertiseType: formData.expertiseType,
        requerente: (formData.requerente || '').trim(),
        requerido: (formData.requerido || '').trim(),
        propertyName: (formData.propertyName || '').trim(),
        propertyCity: (formData.propertyCity || '').trim(),
        propertyState: (formData.propertyState || '').trim().toUpperCase() || 'MG',
        propertyArea: Number(formData.propertyArea) || 0,
        registrationNumber: (formData.registrationNumber || '').trim() || undefined,
        car: (formData.car || '').trim() || undefined,
        visitaDate: formData.visitaDate || undefined,
        visitaDateEnd: formData.visitaDateEnd || undefined,
        honorariosPropostos: Number(formData.honorariosPropostos) || 0,
        honorariosAprovados: formData.honorariosAprovados ? Number(formData.honorariosAprovados) : undefined,
        honorariosStatus: formData.honorariosStatus,
        alvaraNumber: (formData.alvaraNumber || '').trim() || undefined,
        laudoStatus: formData.laudoStatus,
        laudoDeadline: formData.laudoDeadline || undefined,
        laudoNotes: (formData.laudoNotes || '').trim() || undefined,
        normaAplicada: (formData.normaAplicada || '').trim() || 'ABNT NBR 14.653-3',
        metodologia: (formData.metodologia || '').trim() || 'Comparativo Direto de Dados de Mercado',
        clientId: formData.clientId || undefined,
        status: formData.status,
        createdBy: user?.uid || 'anonymous',
        createdAt: editingId ? (expertises.find(e => e.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let savedId = editingId;
      if (editingId) {
        await updateDoc(doc(db, 'judicial_expertises', editingId), payload as any);
        if (selectedExpertise?.id === editingId) {
          setSelectedExpertise({ id: editingId, ...payload } as JudicialExpertise);
        }
      } else {
        const docRef = await addDoc(collection(db, 'judicial_expertises'), payload);
        savedId = docRef.id;
      }

      // Verify and ensure folder existence in 'documents' collection linked to the client's dossier
      let targetClientId = formData.clientId;
      if (!targetClientId) {
        const match = clients.find(c => 
          (c.name || '').trim().toLowerCase() === (payload.requerido || '').trim().toLowerCase() ||
          (c.name || '').trim().toLowerCase() === (payload.requerente || '').trim().toLowerCase() ||
          (c.propertyName && payload.propertyName && (c.propertyName || '').trim().toLowerCase() === (payload.propertyName || '').trim().toLowerCase())
        );
        if (match) targetClientId = match.id;
      }

      // Dossiê do cliente: se falhar, a perícia já está salva — não pode virar
      // "Falha ao salvar" (antes derrubava o salvamento inteiro).
      let dossierOk = true;
      try {
      if (targetClientId) {
        await ensureDocumentFolder({
          clientId: targetClientId,
          serviceId: savedId!,
          serviceName: `Perícia Judicial: Proc. ${payload.processNumber}`,
          processNumber: payload.processNumber,
          category: 'Perícia',
          folderType: 'judicial_expertise',
          metadata: {
            comarca: payload.comarca,
            vara: payload.vara,
            requerente: payload.requerente,
            requerido: payload.requerido,
            propertyName: payload.propertyName
          }
        });
      }

      // Automatic synchronization with client dossier in 'documents' collection
      const fullExp: JudicialExpertise = { id: savedId!, ...payload, clientId: targetClientId || payload.clientId };
      if (targetClientId) await syncExpertiseToDossier(fullExp, targetClientId, false);
      } catch (dossierErr) {
        dossierOk = false;
        console.warn('Perícia salva, mas o dossiê não foi atualizado:', dossierErr);
      }

      if (user) {
        await logAudit({
          recordId: savedId!,
          collection: 'judicial_expertises',
          userId: user.uid,
          userName: user.displayName || user.email || 'Usuário',
          action: editingId ? 'update' : 'create',
          recordName: `Proc. ${payload.processNumber} (${payload.propertyName || 'Perícia'})`,
          details: editingId
            ? `Atualizou a perícia judicial referente ao processo ${payload.processNumber}.`
            : `Cadastrou nova perícia judicial no processo ${payload.processNumber} (${payload.comarca || 'Comarca'}).`
        });
      }

      const baseMsg = editingId ? 'Perícia judicial atualizada' : 'Perícia judicial cadastrada';
      if (!targetClientId) toast.success(`${baseMsg}! (sem cliente vinculado — o laudo não foi anexado a nenhum dossiê)`);
      else if (!dossierOk) toast.warning(`${baseMsg}, mas não foi possível atualizar o dossiê do cliente agora.`);
      else toast.success(`${baseMsg} e sincronizada com o dossiê!`);
      setIsModalOpen(false);
      setEditingId(null);
    } catch (error) {
      console.error('Erro ao salvar perícia:', error);
      toast.error('Falha ao salvar a perícia judicial.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteExpertise = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!(await confirmAction({
      title: 'Excluir perícia?',
      description: 'Tem certeza que deseja excluir esta perícia judicial? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
    }))) {
      return;
    }
    try {
      const expToDelete = expertises.find(x => x.id === id);
      await deleteDoc(doc(db, 'judicial_expertises', id));

      // Remove também o(s) laudo(s) sincronizados no dossiê do cliente (Firestore + Storage),
      // pra não deixar documento e arquivo órfãos apontando pra uma perícia que não existe mais.
      try {
        const linkedDocs = await getDocs(query(collection(db, 'documents'), where('serviceId', '==', id)));
        await Promise.all(linkedDocs.docs.map(async (docSnap) => {
          const data = docSnap.data() as any;
          if (data.storagePath) {
            await deleteStoredFile(data.storagePath).catch((err) => console.warn('Arquivo do laudo não encontrado:', err));
          }
          await deleteDoc(doc(db, 'documents', docSnap.id));
        }));
      } catch (docErr) {
        console.warn('Erro ao remover laudo(s) do dossiê vinculados à perícia:', docErr);
      }

      if (user) {
        await logAudit({
          recordId: id,
          collection: 'judicial_expertises',
          userId: user.uid,
          userName: user.displayName || user.email || 'Usuário',
          action: 'delete',
          recordName: expToDelete?.processNumber ? `Proc. ${expToDelete.processNumber}` : 'Perícia Judicial',
          details: `Excluiu o registro de perícia judicial com ID ${id}.`
        });
      }

      toast.success('Perícia excluída com sucesso.');
      if (selectedExpertise?.id === id) {
        setIsDrawerOpen(false);
        setSelectedExpertise(null);
      }
    } catch (error) {
      console.error('Erro ao excluir:', error);
      toast.error('Erro ao excluir perícia.');
    }
  };

  const handleCopyProcessNumber = (processNumber: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(processNumber);
    setCopiedId(id);
    toast.success('Número do processo copiado para a área de transferência!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Quick process number auto-formatter (TJMG / CNJ pattern)
  const formatProcessInput = (val: string) => {
    const clean = val.replace(/\D/g, '').substring(0, 20);
    if (clean.length <= 7) return clean;
    if (clean.length <= 9) return `${clean.slice(0, 7)}-${clean.slice(7)}`;
    if (clean.length <= 13) return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9)}`;
    if (clean.length <= 14) return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13)}`;
    if (clean.length <= 16) return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14)}`;
    return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14, 16)}.${clean.slice(16, 20)}`;
  };

  // PDF Generation Function
  const handleGeneratePDF = async (exp: JudicialExpertise, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    try {
      const doc = buildJudicialExpertisePDF(exp);
      const sanitizedName = (exp.processNumber || 'processo').replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(`Minuta_Laudo_Pericial_${sanitizedName}.pdf`);
      toast.success('Minuta do laudo gerada em PDF com sucesso!');

      // Also trigger dossier sync
      syncExpertiseToDossier(exp, exp.clientId, false);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      toast.error('Erro ao gerar a minuta do laudo pericial em PDF.');
    }
  };

  // Filtered List
  const filteredExpertises = expertises.filter((exp) => {
    // Search
    const q = searchQuery.toLowerCase();
    const matchesQuery = 
      !q ||
      exp.processNumber?.toLowerCase().includes(q) ||
      exp.requerente?.toLowerCase().includes(q) ||
      exp.requerido?.toLowerCase().includes(q) ||
      exp.propertyName?.toLowerCase().includes(q) ||
      exp.comarca?.toLowerCase().includes(q) ||
      exp.vara?.toLowerCase().includes(q);

    // Status Filter
    const matchesStatus = statusFilter === 'todos' || exp.status === statusFilter;

    // Type Filter
    const matchesType = typeFilter === 'todos' || exp.expertiseType === typeFilter;

    // Laudo Filter
    const matchesLaudo = laudoFilter === 'todos' || exp.laudoStatus === laudoFilter;

    return matchesQuery && matchesStatus && matchesType && matchesLaudo;
  });

  // KPI Calculations
  const totalAtivos = expertises.filter(e => e.status === 'ativo').length;
  const totalHonorariosAprovados = expertises.reduce((acc, e) => acc + (e.honorariosAprovados || 0), 0);
  const totalLaudosPendentes = expertises.filter(e => e.laudoStatus !== 'entregue' && e.status === 'ativo').length;
  const totalAlvarasAReceber = expertises.filter(e => e.honorariosStatus !== 'pago' && e.status === 'ativo').length;

  const isDeadlineExpired = (deadline?: string) => {
    if (!deadline) return false;
    const now = new Date();
    // parseDateInput ancora "YYYY-MM-DD" em horário local, evitando marcar
    // "vencido" horas antes da hora certa por causa do fuso (UTC vs. Brasil).
    const d = parseDateInput(deadline);
    if (!d) return false;
    return d < now;
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      {confirmModal}
      {/* HEADER */}
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Perícia Judicial" subtitle="Processos periciais, honorários e laudos (TJMG / PJe)" />

        <div className="flex items-center gap-3">
          <ExportExcelButton fileName="Pericias_Judiciais" getRows={() => filteredExpertises.map((e: any) => ({
    'Processo': e.processNumber || '', 'Comarca': e.comarca || '', 'Vara': e.vara || '', 'Requerente': e.requerente || '', 'Requerido': e.requerido || '',
    'Tipo': e.expertiseType || '', 'Status': e.status || '', 'Laudo': e.laudoStatus || '', 'Prazo do Laudo': (e.laudoDeadline ? String(e.laudoDeadline).split('T')[0].split('-').reverse().join('/') : ''),
    'Honorários Propostos (R$)': (typeof e.honorariosPropostos === 'number' ? e.honorariosPropostos : Number(e.honorariosPropostos) || 0), 'Honorários Aprovados (R$)': (typeof e.honorariosAprovados === 'number' ? e.honorariosAprovados : Number(e.honorariosAprovados) || 0), 'Honorários': e.honorariosStatus || '',
  }))} />
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova Perícia
          </button>
        </div>
      </header>

      {/* 4 SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Processos Ativos</p>
            <h3 className="text-2xl font-display font-extrabold text-slate-800 dark:text-slate-100 mt-1">
              {totalAtivos}
            </h3>
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5 block">
              Em tramitação pericial
            </span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center">
            <Gavel className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Honorários Aprovados</p>
            <h3 className="text-2xl font-display font-extrabold text-slate-800 dark:text-slate-100 mt-1">
              {formatCurrency(totalHonorariosAprovados)}
            </h3>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 block">
              Total fixado pelo juízo
            </span>
          </div>
          <div className="w-12 h-12 bg-slate-50 dark:bg-emerald-950/40 text-slate-600 dark:text-slate-400 rounded-2xl flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Laudos Pendentes</p>
            <h3 className="text-2xl font-display font-extrabold text-amber-600 dark:text-amber-400 mt-1">
              {totalLaudosPendentes}
            </h3>
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5 block">
              Aguardando entrega/protocolo
            </span>
          </div>
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Alvarás a Receber</p>
            <h3 className="text-2xl font-display font-extrabold text-slate-600 dark:text-slate-400 mt-1">
              {totalAlvarasAReceber}
            </h3>
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 mt-0.5 block">
              Pendentes de liquidação
            </span>
          </div>
          <div className="w-12 h-12 bg-slate-50 dark:bg-emerald-950/40 text-slate-600 dark:text-slate-400 rounded-2xl flex items-center justify-center">
            <Landmark className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* FILTROS E BUSCA */}
      <div className="glass-card p-4 rounded-3xl border border-white/40 dark:border-slate-800 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar processo, autor, réu, imóvel..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full glass-input pl-10 pr-4 py-2 text-xs rounded-2xl"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="glass-input px-3 py-2 text-xs rounded-2xl bg-white dark:bg-slate-900 cursor-pointer"
          >
            <option value="todos">Status: Todos</option>
            <option value="ativo">Status: Ativo</option>
            <option value="concluido">Status: Concluído</option>
            <option value="arquivado">Status: Arquivado</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="glass-input px-3 py-2 text-xs rounded-2xl bg-white dark:bg-slate-900 cursor-pointer"
          >
            <option value="todos">Tipo: Todos</option>
            {Object.entries(EXPERTISE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {/* Laudo Filter */}
          <select
            value={laudoFilter}
            onChange={(e) => setLaudoFilter(e.target.value)}
            className="glass-input px-3 py-2 text-xs rounded-2xl bg-white dark:bg-slate-900 cursor-pointer"
          >
            <option value="todos">Laudo: Todos</option>
            <option value="nao_iniciado">Não Iniciado</option>
            <option value="em_elaboracao">Em Elaboração</option>
            <option value="concluido">Concluído</option>
            <option value="entregue">Entregue</option>
          </select>
        </div>
      </div>

      {/* LISTAGEM DE PROCESSOS */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="glass-card p-6 rounded-3xl h-64 animate-pulse bg-slate-100/50 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filteredExpertises.length === 0 ? (
        <div className="glass-card p-12 text-center rounded-3xl border border-white/40 dark:border-slate-800 flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-slate-400">
            <Scale className="w-8 h-8" />
          </div>
          <h3 className="text-base font-display font-bold text-slate-700 dark:text-slate-200">
            Nenhuma perícia judicial encontrada
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Tente ajustar os filtros de busca ou cadastre um novo processo pericial para começar a gestão técnica.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Perícia
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredExpertises.map((exp) => {
            const isOverdue = isDeadlineExpired(exp.laudoDeadline) && exp.laudoStatus !== 'entregue';
            const laudoCfg = LAUDO_STATUS_CONFIG[exp.laudoStatus] || LAUDO_STATUS_CONFIG.nao_iniciado;
            const honorariosCfg = HONORARIOS_STATUS_CONFIG[exp.honorariosStatus] || HONORARIOS_STATUS_CONFIG.aguardando_nomeacao;

            return (
              <motion.div
                key={exp.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => {
                  setSelectedExpertise(exp);
                  setIsDrawerOpen(true);
                }}
                className="glass-card p-5 rounded-3xl border border-white/50 dark:border-slate-800/80 hover:border-emerald-500/50 dark:hover:border-emerald-500/40 transition-all shadow-sm hover:shadow-xl group cursor-pointer relative flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Process Number & Copy */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span 
                        title={exp.processNumber}
                        className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-emerald-600 transition-colors"
                      >
                        {exp.processNumber}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {exp.tribunalLink && (
                        <a
                          href={safeUrl(exp.tribunalLink)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Acessar processo no Tribunal (PJe / Projudi / e-SAJ)"
                          className="p-1.5 hover:bg-slate-50 dark:hover:bg-emerald-950/40 rounded-xl text-slate-600 dark:text-slate-400 transition-colors shrink-0 flex items-center gap-1 text-[10px] font-bold"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>PJe</span>
                        </a>
                      )}
                      <button
                        onClick={(e) => handleCopyProcessNumber(exp.processNumber, exp.id, e)}
                        title="Copiar número do processo"
                        className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
                      >
                        {copiedId === exp.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Comarca e Vara */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{exp.comarca}</span>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{exp.vara}</span>
                  </div>

                  {/* Parties (Requerente vs Requerido) */}
                  <div className="bg-slate-50/80 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60 mb-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 font-bold truncate">
                      <span className="text-[10px] uppercase font-bold text-emerald-600">Autor:</span>
                      <span className="truncate">{exp.requerente}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 truncate">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Réu:</span>
                      <span className="truncate">{exp.requerido}</span>
                    </div>
                  </div>

                  {/* Property Details */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 mb-3">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{exp.propertyName}</span>
                    <span className="text-[10px] text-slate-400">({exp.propertyArea || 0} ha)</span>
                  </div>

                  {/* Badges: Expertise Type & Honorários */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {EXPERTISE_TYPE_LABELS[exp.expertiseType] || exp.expertiseType}
                    </span>

                    <span className={cn("text-[10px] font-bold px-2.5 py-1 rounded-xl border", honorariosCfg.bg, honorariosCfg.text, honorariosCfg.border)}>
                      {honorariosCfg.label}
                    </span>
                  </div>
                </div>

                {/* Footer Info */}
                <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Honorários</span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {exp.honorariosAprovados ? formatCurrency(exp.honorariosAprovados) : (
                          <span className="text-slate-400 font-normal">Prop: {formatCurrency(exp.honorariosPropostos)}</span>
                        )}
                      </span>
                    </div>

                    {/* Laudo Status Badge */}
                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Laudo</span>
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border", laudoCfg.bg, laudoCfg.text, laudoCfg.border)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", laudoCfg.dot)} />
                        {laudoCfg.label}
                      </span>
                    </div>
                  </div>

                  {/* Vistoria & Prazo */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      Vistoria: {exp.visitaDate ? formatDate(exp.visitaDate) : 'Não agendada'}
                    </span>

                    {exp.laudoDeadline && (
                      <span className={cn("flex items-center gap-1 font-bold", isOverdue ? "text-rose-600 dark:text-rose-400" : "text-slate-500")}>
                        <Clock className="w-3 h-3" />
                        {isOverdue ? 'Prazo Vencido' : `Prazo: ${formatDate(exp.laudoDeadline)}`}
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100/60 dark:border-slate-800/40">
                    <button
                      onClick={(e) => handleGeneratePDF(exp, e)}
                      title="Gerar Minuta do Laudo em PDF"
                      className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-300 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <Download className="w-3 h-3" />
                      Minuta PDF
                    </button>
                    {canEditRecord(exp) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditModal(exp);
                      }}
                      title="Editar Perícia"
                      className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-emerald-950/40 hover:text-slate-700 text-slate-500 rounded-xl transition-all"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    )}
                    {canDeleteRecord && (
                    <button
                      onClick={(e) => handleDeleteExpertise(exp.id, e)}
                      title="Excluir Perícia"
                      className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 text-slate-500 rounded-xl transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* DRAWER / SIDEBAR LATERAL DE DETALHES */}
      <AnimatePresence>
        {isDrawerOpen && selectedExpertise && (
          <>
            <div
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 transition-opacity"
              onClick={() => setIsDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 280 }}
              className="fixed top-0 right-0 h-full w-full max-w-xl bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-y-auto p-6 flex flex-col justify-between border-l border-slate-200 dark:border-slate-800"
            >
              <div className="space-y-6">
                {/* Header Drawer */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl flex items-center justify-center text-emerald-600">
                      <Scale className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-slate-800 dark:text-slate-100">
                        Processo Pericial
                      </h2>
                      <p className="font-mono text-xs text-slate-500 font-semibold">
                        {selectedExpertise.processNumber}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleCopyProcessNumber(selectedExpertise.processNumber, selectedExpertise.id, e)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500 text-xs font-bold flex items-center gap-1.5"
                    >
                      {copiedId === selectedExpertise.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Status Timeline Visual: Acompanhamento Rito PJe & CPC */}
                <ProcessStatusTimeline 
                  mode="judicial_expertise" 
                  record={selectedExpertise} 
                  onRefresh={() => {
                    // Refresh current record in state if needed
                    const updated = expertises.find(e => e.id === selectedExpertise.id);
                    if (updated) setSelectedExpertise(updated);
                  }}
                />

                {/* Section 1: Processo & Juízo */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Jurisdição & Juízo</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Comarca</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedExpertise.comarca}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Vara Cível</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedExpertise.vara}</span>
                    </div>
                    {selectedExpertise.juiz && (
                      <div className={selectedExpertise.tribunalLink ? 'col-span-1' : 'col-span-2'}>
                        <span className="text-slate-400 block text-[10px]">Magistrado(a)</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{selectedExpertise.juiz}</span>
                      </div>
                    )}
                    {selectedExpertise.tribunalLink && (
                      <div className={selectedExpertise.juiz ? 'col-span-1' : 'col-span-2'}>
                        <span className="text-slate-400 block text-[10px]">Tribunal / PJe</span>
                        <a 
                          href={safeUrl(selectedExpertise.tribunalLink)} 
                          target="_blank" 
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800 dark:text-slate-400 hover:underline mt-0.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir Autos do Processo
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Partes */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Partes do Processo</h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-emerald-600 font-bold block text-[10px] uppercase">Requerente (Autor)</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{selectedExpertise.requerente}</span>
                    </div>
                    <div className="pt-1 border-t border-slate-200/50 dark:border-slate-700/40">
                      <span className="text-slate-400 font-bold block text-[10px] uppercase">Requerido (Réu)</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">{selectedExpertise.requerido}</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Propriedade */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Imóvel Periciado</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="col-span-2">
                      <span className="text-slate-400 block text-[10px]">Nome do Imóvel</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{selectedExpertise.propertyName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Município / UF</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedExpertise.propertyCity}/{selectedExpertise.propertyState}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Área Total</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedExpertise.propertyArea || 0} ha</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Matrícula</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">{selectedExpertise.registrationNumber || 'Não informada'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Código CAR</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300 truncate block">{selectedExpertise.car || 'Não informado'}</span>
                    </div>
                  </div>
                </div>

                {/* Section 4: Honorários e Laudo */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-3 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Honorários & Entrega do Laudo</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Valor Proposto</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(selectedExpertise.honorariosPropostos)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Valor Aprovado</span>
                      <span className="font-bold text-emerald-600 text-sm">
                        {selectedExpertise.honorariosAprovados ? formatCurrency(selectedExpertise.honorariosAprovados) : 'Aguardando Despacho'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Status Honorários</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {HONORARIOS_STATUS_CONFIG[selectedExpertise.honorariosStatus]?.label || selectedExpertise.honorariosStatus}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Alvará Judicial</span>
                      <span className="font-mono text-slate-600 font-bold">{selectedExpertise.alvaraNumber || 'Pendente'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Status do Laudo</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {LAUDO_STATUS_CONFIG[selectedExpertise.laudoStatus]?.label || selectedExpertise.laudoStatus}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Prazo Fatal</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {selectedExpertise.laudoDeadline ? formatDate(selectedExpertise.laudoDeadline) : 'Sem prazo fixado'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 5: Metodologia e Norma */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Norma e Metodologia</h4>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold">{selectedExpertise.normaAplicada}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{selectedExpertise.metodologia}</p>
                  {selectedExpertise.laudoNotes && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 block font-bold uppercase">Observações Técnicas:</span>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{selectedExpertise.laudoNotes}</p>
                    </div>
                  )}
                </div>

                {/* Section 6: Sincronização com Dossiê do Cliente */}
                <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-4 rounded-2xl space-y-3 border border-emerald-200/80 dark:border-emerald-800/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderSync className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        Dossiê Digital Vinculado
                      </h4>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <ShieldCheck className="w-3 h-3" />
                      Sincronizado
                    </span>
                  </div>

                  {/* Client match info */}
                  {(() => {
                    const linkedClient = clients.find(c => c.id === selectedExpertise.clientId) || 
                      clients.find(c => 
                        (c.name || '').toLowerCase() === (selectedExpertise.requerido || '').toLowerCase() ||
                        (c.name || '').toLowerCase() === (selectedExpertise.requerente || '').toLowerCase() ||
                        (c.propertyName && selectedExpertise.propertyName && (c.propertyName || '').toLowerCase() === (selectedExpertise.propertyName || '').toLowerCase())
                      );

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Produtor / Cliente</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {linkedClient ? linkedClient.name : selectedExpertise.requerido || 'Vínculo Automático'}
                            </span>
                          </div>
                          {linkedClient && (
                            <button
                              onClick={() => {
                                navigate('/documents', { state: { clientId: linkedClient.id, serviceId: selectedExpertise.id } });
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                            >
                              <FolderOpen className="w-3 h-3" />
                              Ver Pasta
                            </button>
                          )}
                        </div>

                        {/* List of synced documents */}
                        <div className="space-y-1.5 pt-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block">
                            Documentos na Coleção ({syncedDocuments.length}):
                          </span>
                          {syncedDocuments.length === 0 ? (
                            <p className="text-[11px] text-slate-500 italic bg-white/50 dark:bg-slate-900/50 p-2 rounded-xl border border-dashed border-emerald-200 dark:border-emerald-800">
                              Nenhum arquivo anexado ainda. Clique em "Sincronizar Laudo" para gerar e enviar o PDF oficial ao dossiê.
                            </p>
                          ) : (
                            syncedDocuments.map(docItem => (
                              <div key={docItem.id} className="flex items-center justify-between bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <div className="truncate">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">{docItem.name}</span>
                                    <span className="text-[9px] text-slate-400">{docItem.size || 'PDF'} • {docItem.uploadedAt ? formatDate(docItem.uploadedAt) : 'Hoje'}</span>
                                  </div>
                                </div>
                                {docItem.url && (
                                  <a
                                    href={docItem.url}
                                    onClick={(e) => handleFileLinkClick(e, docItem.url, docItem.name)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                                    title="Visualizar Documento"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </div>
                            ))
                          )}
                        </div>

                        {/* Manual sync trigger */}
                        <div className="pt-2">
                          <button
                            disabled={isSyncing}
                            onClick={() => syncExpertiseToDossier(selectedExpertise, selectedExpertise.clientId, true)}
                            className="w-full py-2 bg-emerald-100/70 hover:bg-emerald-200/70 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {isSyncing ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Sincronizando com Dossiê...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3.5 h-3.5" />
                                Atualizar Laudo no Dossiê
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Audit Trail */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <AuditTrail collectionName="judicial_expertises" recordId={selectedExpertise.id} />
                </div>
              </div>

              {/* Drawer Bottom Actions */}
              <div className="pt-6 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
                <button
                  onClick={(e) => handleGeneratePDF(selectedExpertise, e)}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Gerar Minuta PDF
                </button>

                <button
                  onClick={() => {
                    handleOpenEditModal(selectedExpertise);
                    setIsDrawerOpen(false);
                  }}
                  className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Editar
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* MODAL CRIAR / EDITAR PERÍCIA */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-3xl p-6 sm:p-8 flex flex-col gap-6 shadow-2xl relative border border-slate-100 dark:border-slate-800 max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800 dark:text-slate-100">
                      {editingId ? 'Editar Perícia Judicial' : 'Nova Perícia Judicial'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Gestão de autos do PJe, elaboração de laudos periciais e sincronização com dossiê
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Body without <form> tag */}
              <div className="space-y-6 text-left">
                {/* SEÇÃO 0: VÍNCULO COM O DOSSIÊ DE CLIENTES */}
                <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-emerald-600" />
                      Vincular ao Dossiê do Produtor / Cliente (Documentos)
                    </label>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                      Sincronização Automática
                    </span>
                  </div>
                  <select
                    value={formData.clientId}
                    onChange={(e) => {
                      const selectedCId = e.target.value;
                      const matched = clients.find(c => c.id === selectedCId);
                      setFormData(prev => ({
                        ...prev,
                        clientId: selectedCId,
                        requerido: (!prev.requerido && matched) ? matched.name : prev.requerido,
                        propertyName: (!prev.propertyName && matched?.propertyName) ? matched.propertyName : prev.propertyName,
                        propertyCity: (!prev.propertyCity && matched?.city) ? matched.city : prev.propertyCity,
                        propertyState: (!prev.propertyState && matched?.state) ? matched.state : prev.propertyState
                      }));
                    }}
                    className="w-full glass-input px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                  >
                    <option value="">Vínculo Automático por Nome ou Selecione um Produtor...</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.name} {client.propertyName ? `— ${client.propertyName}` : ''} ({client.city || 'MG'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* SEÇÃO 1: DADOS DO PROCESSO */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Gavel className="w-4 h-4" />
                    1. Dados do Processo
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Número do Processo (PJe) *
                      </label>
                      <input
                        type="text"
                        placeholder="5000630-52.2026.8.13.0347"
                        value={formData.processNumber}
                        onChange={(e) => setFormData({ ...formData, processNumber: formatProcessInput(e.target.value) })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Comarca *
                      </label>
                      <input
                        type="text"
                        placeholder="Jacinto/MG"
                        value={formData.comarca}
                        onChange={(e) => setFormData({ ...formData, comarca: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Vara *
                      </label>
                      <input
                        type="text"
                        placeholder="1ª Vara Cível, Criminal e VEC"
                        value={formData.vara}
                        onChange={(e) => setFormData({ ...formData, vara: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Juiz(a) de Direito (Opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Nome do(a) Magistrado(a)"
                        value={formData.juiz}
                        onChange={(e) => setFormData({ ...formData, juiz: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Link Direto aos Autos no Tribunal (PJe, Projudi, e-SAJ) (Opcional)
                      </label>
                      <input
                        type="url"
                        placeholder="https://pje.tjmg.jus.br/pje/Processo/ConsultaProcesso/..."
                        value={formData.tribunalLink}
                        onChange={(e) => setFormData({ ...formData, tribunalLink: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-mono text-slate-600 dark:text-slate-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Tipo de Perícia *
                      </label>
                      <select
                        value={formData.expertiseType}
                        onChange={(e) => setFormData({ ...formData, expertiseType: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {Object.entries(EXPERTISE_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 2: PARTES */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <UserCheck className="w-4 h-4" />
                    2. Partes do Processo
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Requerente / Autor *
                      </label>
                      <input
                        type="text"
                        placeholder="ex: CEMIG Distribuição S.A."
                        value={formData.requerente}
                        onChange={(e) => setFormData({ ...formData, requerente: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Requerido / Réu *
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Silvio Ferraz Santos"
                        value={formData.requerido}
                        onChange={(e) => setFormData({ ...formData, requerido: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 3: PROPRIEDADE */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Building className="w-4 h-4" />
                    3. Imóvel Periciado
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Nome da Propriedade / Fazenda *
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Fazenda Santa Maria"
                        value={formData.propertyName}
                        onChange={(e) => setFormData({ ...formData, propertyName: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Área Total (ha) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ex: 150.50"
                        value={formData.propertyArea}
                        onChange={(e) => setFormData({ ...formData, propertyArea: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Município
                      </label>
                      <input
                        type="text"
                        placeholder="Jacinto"
                        value={formData.propertyCity}
                        onChange={(e) => setFormData({ ...formData, propertyCity: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        UF
                      </label>
                      <input
                        type="text"
                        maxLength={2}
                        placeholder="MG"
                        value={formData.propertyState}
                        onChange={(e) => setFormData({ ...formData, propertyState: e.target.value.toUpperCase() })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Matrícula do Imóvel
                      </label>
                      <input
                        type="text"
                        placeholder="ex: 12.345 (CRI Almenara)"
                        value={formData.registrationNumber}
                        onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Código CAR (Cadastro Ambiental Rural)
                      </label>
                      <input
                        type="text"
                        placeholder="MG-3134708-..."
                        value={formData.car}
                        onChange={(e) => setFormData({ ...formData, car: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 4: VISTORIA */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Calendar className="w-4 h-4" />
                    4. Vistoria Técnica
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Data da Vistoria
                      </label>
                      <input
                        type="date"
                        value={formData.visitaDate}
                        onChange={(e) => setFormData({ ...formData, visitaDate: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Data Fim (se multi-dias)
                      </label>
                      <input
                        type="date"
                        value={formData.visitaDateEnd}
                        onChange={(e) => setFormData({ ...formData, visitaDateEnd: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 5: HONORÁRIOS */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <DollarSign className="w-4 h-4" />
                    5. Honorários Periciais
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Valor Proposto pelo Perito (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ex: 8500.00"
                        value={formData.honorariosPropostos}
                        onChange={(e) => setFormData({ ...formData, honorariosPropostos: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Valor Aprovado pelo Juiz (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ex: 7500.00"
                        value={formData.honorariosAprovados}
                        onChange={(e) => setFormData({ ...formData, honorariosAprovados: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-bold text-emerald-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Status dos Honorários
                      </label>
                      <select
                        value={formData.honorariosStatus}
                        onChange={(e) => setFormData({ ...formData, honorariosStatus: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {Object.entries(HONORARIOS_STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Número do Alvará de Pagamento
                      </label>
                      <input
                        type="text"
                        placeholder="ex: 2026/0347-ALV"
                        value={formData.alvaraNumber}
                        onChange={(e) => setFormData({ ...formData, alvaraNumber: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 6: LAUDO TÉCNICO */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <FileText className="w-4 h-4" />
                    6. Laudo Técnico Pericial
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Status do Laudo
                      </label>
                      <select
                        value={formData.laudoStatus}
                        onChange={(e) => setFormData({ ...formData, laudoStatus: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {Object.entries(LAUDO_STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Prazo de Entrega do Laudo
                      </label>
                      <input
                        type="date"
                        value={formData.laudoDeadline}
                        onChange={(e) => setFormData({ ...formData, laudoDeadline: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Norma Aplicada
                      </label>
                      <input
                        type="text"
                        value={formData.normaAplicada}
                        onChange={(e) => setFormData({ ...formData, normaAplicada: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Metodologia Adotada
                      </label>
                      <select
                        value={formData.metodologia}
                        onChange={(e) => setFormData({ ...formData, metodologia: e.target.value })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {METODOLOGIAS_PREDEFINIDAS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Observações Técnicas Internas
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Anotações sobre a perícia, assistentes técnicos indicados, quesitos suplementares..."
                        value={formData.laudoNotes}
                        onChange={(e) => setFormData({ ...formData, laudoNotes: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Status Geral do Registro
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        <option value="ativo">Ativo</option>
                        <option value="concluido">Concluído</option>
                        <option value="arquivado">Arquivado</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => runExclusive('JudicialExpertise.handleSaveExpertise', () => handleSaveExpertise())}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {isSubmitting ? 'Salvando...' : editingId ? 'Atualizar Perícia' : 'Cadastrar Perícia'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
