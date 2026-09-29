import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { useConfirm } from '../hooks/useConfirm';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc, deleteDoc, where, getDocs, serverTimestamp 
} from 'firebase/firestore';
import { saveFile, handleFileLinkClick } from '../lib/fileStore';
import { db, ensureDocumentFolder } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { isManagementRole, canEditOwnRecord } from '../lib/permissions';
import { useNavigate } from 'react-router-dom';
import { RuralPropertyValuation, Client } from '../types';
import { 
  formatDate, formatCurrency, numberToWordsBRL, cn, handleFirestoreError, OperationType, todayLocalDateString } from '../lib/utils';
import { 
  MapPin, Plus, Search, DollarSign, FileText, 
  CheckCircle2, Clock, Trash2, Edit3, X, Download, 
  Building, Tractor, Home, ShieldCheck, 
  Calculator, Sparkles, UserCheck, Compass,
  FolderOpen, FolderSync, RefreshCw, ExternalLink, Loader2,
  AlertTriangle, Check
} from 'lucide-react';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawBrandBanner } from '../lib/pdfBranding';
import ProcessStatusTimeline from '../components/ProcessStatusTimeline';
import AuditTrail from '../components/AuditTrail';
import { logAudit } from '../lib/audit';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Landmark as PageIcon } from 'lucide-react';
import { useInitialSearch } from '../hooks/useInitialSearch';
import ExportExcelButton from '../components/service/ExportExcelButton';

const PURPOSE_LABELS: Record<string, string> = {
  compra_venda: 'Compra e Venda',
  garantia_bancaria: 'Garantia Bancária / Hipoteca',
  partilha_heranca: 'Partilha e Herança',
  judicial: 'Perícia / Fins Judiciais',
  seguro_rural: 'Seguro Rural',
  desapropriacao: 'Desapropriação / Servidão',
  permuta: 'Permuta de Imóveis',
  outro: 'Outro'
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  em_elaboracao: { label: 'Em Elaboração', bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  concluido: { label: 'Laudo Concluído', bg: 'bg-slate-50 dark:bg-emerald-900/30', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  entregue: { label: 'Entregue ao Cliente', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  arquivado: { label: 'Arquivado', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-400' },
};

const FUNDAMENTATION_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  'I': { label: 'Grau I (Expedito)', color: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300', desc: 'Mínimo de dados por inferência ou tratamento simplificado' },
  'II': { label: 'Grau II (Normal)', color: 'bg-slate-100 dark:bg-emerald-950/40 text-slate-800 dark:text-slate-300 border-slate-300', desc: 'Metodologia comparativa com fatores de homogeneização' },
  'III': { label: 'Grau III (Rigoroso)', color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300', desc: 'Tratamento científico rigoroso por regressão multivariada' },
};

const SOIL_CLASSES = [
  'Latossolo Vermelho (LV)',
  'Latossolo Vermelho-Amarelo (LVA)',
  'Latossolo Amarelo (LA)',
  'Argissolo Vermelho-Amarelo (PVA)',
  'Argissolo Vermelho (PV)',
  'Neossolo Quartzarênico (RQ)',
  'Neossolo Litólico (RL)',
  'Cambissolo Háplico (CX)',
  'Gleissolo Háplico (GX)',
  'Planossolo Háplico (SX)',
  'Outro / Aluvial'
];

export default function RuralPropertyValuationPage() {
  const { user } = useAuth();
  // Editar: gestão ou quem cadastrou; excluir: só o Administrador.
  const activeRole = (user?.effectiveRole ?? user?.role) as string;
  const canDeleteRecord = activeRole === 'admin';
  const canEditRecord = (rec: { createdBy?: string }) => canEditOwnRecord(activeRole, user?.uid, rec);
  const [confirmAction, confirmModal] = useConfirm();
  const navigate = useNavigate();
  const [valuations, setValuations] = useState<RuralPropertyValuation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  useInitialSearch(setSearchQuery); // termo vindo da Busca Global
  
  // Filters
  const [purposeFilter, setPurposeFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  // Modals & Drawer
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedValuation, setSelectedValuation] = useState<RuralPropertyValuation | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedDocuments, setSyncedDocuments] = useState<any[]>([]);

  // Form State
  const initialFormState = {
    clientId: '',
    clientName: '',
    purpose: 'compra_venda' as RuralPropertyValuation['purpose'],
    propertyName: '',
    propertyCity: '',
    propertyState: 'MG',
    totalArea: '' as unknown as number,
    agriculturalArea: '' as unknown as number,
    pastureArea: '' as unknown as number,
    forestArea: '' as unknown as number,
    appArea: '' as unknown as number,
    registrationNumber: '',
    car: '',
    ccir: '',
    itr: '',
    distanceToCity: '' as unknown as number,
    roadType: 'misto' as RuralPropertyValuation['roadType'],
    mainActivity: 'Pecuária de Corte e Leite',
    soilClass: 'Latossolo Vermelho-Amarelo (LVA)',
    irrigation: false,
    irrigationSystem: '',
    electricPower: true,
    waterSource: 'Nascentes perenes e córrego',
    improvements: {
      houses: 1,
      workers: 0,
      silos: false,
      barn: true,
      corral: true,
      others: ''
    },
    comparativeData: {
      reference1: { description: '', area: '' as unknown as number, value: '' as unknown as number, source: '' },
      reference2: { description: '', area: '' as unknown as number, value: '' as unknown as number, source: '' },
      reference3: { description: '', area: '' as unknown as number, value: '' as unknown as number, source: '' }
    },
    landValuePerHa: '' as unknown as number,
    improvementsValue: '' as unknown as number,
    totalValue: '' as unknown as number,
    fundamentationDegree: 'II' as RuralPropertyValuation['fundamentationDegree'],
    status: 'em_elaboracao' as RuralPropertyValuation['status'],
    visitaDate: '',
    reportDate: todayLocalDateString(),
    laudoNotes: ''
  };

  const [formData, setFormData] = useState(initialFormState);

  // Firestore Subscriptions
  useEffect(() => {
    const qValuations = query(collection(db, 'rural_valuations'), orderBy('createdAt', 'desc'));
    const unsubValuations = onSnapshot(qValuations, (snapshot) => {
      const docs: RuralPropertyValuation[] = [];
      snapshot.forEach((d) => {
        docs.push({ id: d.id, ...d.data() } as RuralPropertyValuation);
      });
      setValuations(docs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rural_valuations');
      setLoading(false);
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const cList: Client[] = [];
      snapshot.forEach((d) => cList.push({ id: d.id, ...d.data() } as Client));
      setClients(cList);
    });

    return () => {
      unsubValuations();
      unsubClients();
    };
  }, []);

  // Listen to synced documents for selected valuation in drawer
  useEffect(() => {
    if (!selectedValuation?.id) {
      setSyncedDocuments([]);
      return;
    }
    const qDocs = query(
      collection(db, 'documents'),
      where('serviceId', '==', selectedValuation.id)
    );
    const unsub = onSnapshot(qDocs, (snapshot) => {
      const docsList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setSyncedDocuments(docsList);
    }, (err) => {
      console.error('Error loading documents for valuation:', err);
    });
    return () => unsub();
  }, [selectedValuation?.id]);

  // Automatic Calculation of Total Value
  useEffect(() => {
    const ha = Number(formData.totalArea) || 0;
    const valPerHa = Number(formData.landValuePerHa) || 0;
    const impVal = Number(formData.improvementsValue) || 0;

    if (ha > 0 && valPerHa > 0) {
      const calculated = (ha * valPerHa) + impVal;
      setFormData((prev) => ({ ...prev, totalValue: calculated }));
    }
  }, [formData.totalArea, formData.landValuePerHa, formData.improvementsValue]);

  const handleOpenCreateModal = () => {
    setFormData(initialFormState);
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (val: RuralPropertyValuation) => {
    setEditingId(val.id);
    setFormData({
      clientId: val.clientId || '',
      clientName: val.clientName || '',
      purpose: val.purpose || 'compra_venda',
      propertyName: val.propertyName || '',
      propertyCity: val.propertyCity || '',
      propertyState: val.propertyState || 'MG',
      totalArea: val.totalArea ?? ('' as unknown as number),
      agriculturalArea: val.agriculturalArea ?? ('' as unknown as number),
      pastureArea: val.pastureArea ?? ('' as unknown as number),
      forestArea: val.forestArea ?? ('' as unknown as number),
      appArea: val.appArea ?? ('' as unknown as number),
      registrationNumber: val.registrationNumber || '',
      car: val.car || '',
      ccir: val.ccir || '',
      itr: val.itr || '',
      distanceToCity: val.distanceToCity ?? ('' as unknown as number),
      roadType: val.roadType || 'misto',
      mainActivity: val.mainActivity || 'Pecuária',
      soilClass: val.soilClass || 'Latossolo Vermelho-Amarelo (LVA)',
      irrigation: !!val.irrigation,
      irrigationSystem: val.irrigationSystem || '',
      electricPower: val.electricPower !== false,
      waterSource: val.waterSource || '',
      improvements: {
        houses: val.improvements?.houses ?? 1,
        workers: val.improvements?.workers ?? 0,
        silos: !!val.improvements?.silos,
        barn: !!val.improvements?.barn,
        corral: !!val.improvements?.corral,
        others: val.improvements?.others || ''
      },
      comparativeData: {
        reference1: val.comparativeData?.reference1 || { description: '', area: '' as any, value: '' as any, source: '' },
        reference2: val.comparativeData?.reference2 || { description: '', area: '' as any, value: '' as any, source: '' },
        reference3: val.comparativeData?.reference3 || { description: '', area: '' as any, value: '' as any, source: '' },
      },
      landValuePerHa: val.landValuePerHa ?? ('' as unknown as number),
      improvementsValue: val.improvementsValue ?? ('' as unknown as number),
      totalValue: val.totalValue ?? ('' as unknown as number),
      fundamentationDegree: val.fundamentationDegree || 'II',
      status: val.status || 'em_elaboracao',
      visitaDate: val.visitaDate || '',
      reportDate: val.reportDate || todayLocalDateString(),
      laudoNotes: val.laudoNotes || ''
    });
    setIsModalOpen(true);
  };

  const handleSelectClient = (clientId: string) => {
    const cl = clients.find(c => c.id === clientId);
    if (cl) {
      const prop = cl.properties?.[0];
      setFormData(prev => ({
        ...prev,
        clientId: cl.id,
        clientName: cl.name,
        propertyName: prop?.name || prev.propertyName,
        propertyCity: prop?.city || prev.propertyCity,
        propertyState: prop?.state || prev.propertyState,
        totalArea: prop?.areaHectares ? prop.areaHectares : prev.totalArea
      }));
    }
  };

  // Helper to build jsPDF document for Rural Property Valuation
  const buildRuralValuationPDF = (val: RuralPropertyValuation) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const todayStr = formatDate(val.reportDate || new Date());
    const expertName = user?.displayName || 'Engenheiro Agrônomo / Avaliador Rural';
    const creaNumber = user?.professionalCertification || 'CREA-MG 000.000/D';
    const purposeLabel = PURPOSE_LABELS[val.purpose] || val.purpose;
    const totalVal = val.totalValue || ((val.landValuePerHa || 0) * val.totalArea + (val.improvementsValue || 0));
    const valorExtenso = numberToWordsBRL(totalVal);

    // Header Banner
    // Logo + nome da empresa (Configurar Marca)
    drawBrandBanner(doc, { height: 20, subtitle: 'AVALIAÇÃO DE IMÓVEIS RURAIS — CONFORME NORMA ABNT NBR 14.653-3' });

    // Document Title
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('LAUDO TÉCNICO DE AVALIAÇÃO MERCADOLÓGICA', 105, 30, { align: 'center' });

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Imóvel: ${val.propertyName} — Município: ${val.propertyCity}/${val.propertyState}`, 105, 36, { align: 'center' });

    // Table 1: Identificação
    autoTable(doc, {
      startY: 42,
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 2, textColor: [30, 41, 59] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 }, 1: { cellWidth: 140 } },
      body: [
        ['Proprietário / Solicitante:', val.clientName],
        ['Finalidade da Avaliação:', purposeLabel],
        ['Área Total Medida / Escriturada:', `${val.totalArea} ha`],
        ['Matrícula / Registro de Imóveis:', val.registrationNumber || 'Não informada'],
        ['Código CAR / CCIR / ITR:', `CAR: ${val.car || 'N/A'} | CCIR: ${val.ccir || 'N/A'} | ITR: ${val.itr || 'N/A'}`],
        ['Grau de Fundamentação NBR:', `Grau ${val.fundamentationDegree || 'II'} — ${FUNDAMENTATION_CONFIG[val.fundamentationDegree || 'II']?.desc || ''}`],
        ['Data de Referência da Avaliação:', todayStr]
      ]
    });

    let currentY = (doc as any).lastAutoTable.finalY + 6;

    // Table 2: Caracterização de Áreas e Aptidão
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(16, 120, 80);
    doc.text('1. CARACTERIZAÇÃO DE ÁREAS E COBERTURA VEGETAL', 14, currentY);
    currentY += 3;

    autoTable(doc, {
      startY: currentY,
      theme: 'grid',
      headStyles: { fillColor: [240, 253, 244], textColor: [16, 120, 80], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      head: [['Discriminação da Área', 'Área (ha)', 'Participação (%)', 'Aptidão Agrícola / Uso']],
      body: [
        ['Área Agrícola (Lavouras)', `${val.agriculturalArea || 0} ha`, `${((Number(val.agriculturalArea || 0) / val.totalArea) * 100).toFixed(1)}%`, 'Lavoura Intensiva / Grãos / Café'],
        ['Área de Pastagens Formadas', `${val.pastureArea || 0} ha`, `${((Number(val.pastureArea || 0) / val.totalArea) * 100).toFixed(1)}%`, 'Pecuária / Pastoreio'],
        ['Reserva Legal (Mata Nativa)', `${val.forestArea || 0} ha`, `${((Number(val.forestArea || 0) / val.totalArea) * 100).toFixed(1)}%`, 'Preservação / Conservação'],
        ['Áreas de Preservação Permanente (APP)', `${val.appArea || 0} ha`, `${((Number(val.appArea || 0) / val.totalArea) * 100).toFixed(1)}%`, 'Proteção de Mananciais / Encostas'],
        ['ÁREA TOTAL DO IMÓVEL', `${val.totalArea} ha`, '100,0%', 'Uso Consolidado e Preservação']
      ]
    });

    currentY = (doc as any).lastAutoTable.finalY + 6;

    // Table 3: Localização, Acesso e Recursos
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(16, 120, 80);
    doc.text('2. LOCALIZAÇÃO, ACESSO E RECURSOS HÍDRICOS', 14, currentY);
    currentY += 3;

    autoTable(doc, {
      startY: currentY,
      theme: 'grid',
      headStyles: { fillColor: [240, 253, 244], textColor: [16, 120, 80], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      body: [
        ['Distância até o Centro Municipal:', `${val.distanceToCity || 0} km`],
        ['Tipo de Rodovia / Condições de Tráfego:', val.roadType === 'asfalto' ? 'Asfalto em boas condições' : val.roadType === 'terra' ? 'Estrada vicinal de terra transitável o ano todo' : 'Misto (asfalto e trecho de terra)'],
        ['Energia Elétrica:', val.electricPower ? 'Rede trifásica / monofásica instalada' : 'Não possui rede elétrica instalada'],
        ['Recursos Hídricos e Irrigação:', `${val.waterSource || 'Nascentes e açude'} | Irrigação: ${val.irrigation ? `Sim (${val.irrigationSystem || 'Pivô/Gotejo'})` : 'Não'}`],
        ['Classe Predominante de Solo:', val.soilClass || 'Latossolo Vermelho-Amarelo']
      ]
    });

    currentY = (doc as any).lastAutoTable.finalY + 6;

    // Table 4: Benfeitorias
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(16, 120, 80);
    doc.text('3. BENFEITORIAS REPRODUTIVAS E NÃO REPRODUTIVAS', 14, currentY);
    currentY += 3;

    const benfeitoriasList: string[] = [];
    if (val.improvements?.houses) benfeitoriasList.push(`${val.improvements.houses} Casa(s) Sede`);
    if (val.improvements?.workers) benfeitoriasList.push(`${val.improvements.workers} Casa(s) de Colono/Trabalhador`);
    if (val.improvements?.barn) benfeitoriasList.push('Galpão de máquinas/insumos');
    if (val.improvements?.corral) benfeitoriasList.push('Curral completo com brete e balança');
    if (val.improvements?.silos) benfeitoriasList.push('Silo para armazenamento');
    if (val.improvements?.others) benfeitoriasList.push(val.improvements.others);

    autoTable(doc, {
      startY: currentY,
      theme: 'grid',
      headStyles: { fillColor: [240, 253, 244], textColor: [16, 120, 80], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      body: [
        ['Benfeitorias Cadastradas:', benfeitoriasList.join(' • ') || 'Sem benfeitorias de grande porte'],
        ['Valor Estimado das Benfeitorias (Custo de Reprodução):', formatCurrency(val.improvementsValue || 0)]
      ]
    });

    currentY = (doc as any).lastAutoTable.finalY + 6;

    // BOX DE RESULTADO FINAL
    if (currentY > 210) {
      doc.addPage();
      currentY = 25;
    }

    // O valor total pode ser digitado à mão; se não bater com VTN + benfeitorias,
    // o laudo mostra a diferença como ajuste do avaliador (antes a conta não fechava).
    const somaComponentes = (val.landValuePerHa || 0) * val.totalArea + (val.improvementsValue || 0);
    const ajuste = totalVal - somaComponentes;
    const temAjuste = Math.abs(ajuste) >= 1;
    const extra = temAjuste ? 5 : 0;
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(14, currentY, 182, 38 + extra, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 120, 80);
    doc.text('4. CONCLUSÃO AVALIATÓRIA E VALOR DE MERCADO', 20, currentY + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(`Valor da Terra Nua (VTN Unitário): ${formatCurrency(val.landValuePerHa || 0)} / hectare`, 20, currentY + 14);
    doc.text(`Valor Total da Terra Nua (${val.totalArea} ha): ${formatCurrency((val.landValuePerHa || 0) * val.totalArea)}`, 20, currentY + 19);
    doc.text(`Valor das Benfeitorias Avaliadas: ${formatCurrency(val.improvementsValue || 0)}`, 20, currentY + 24);
    if (temAjuste) {
      doc.text(`Ajuste adotado pelo avaliador (arredondamento / fatores de mercado): ${ajuste > 0 ? '+' : '-'} ${formatCurrency(Math.abs(ajuste))}`, 20, currentY + 29);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`VALOR TOTAL DO IMÓVEL: ${formatCurrency(totalVal)}`, 20, currentY + 31 + extra);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    doc.text(`(${valorExtenso})`, 20, currentY + 35 + extra);

    currentY += 46 + extra;

    // Observações e Assinatura
    if (val.laudoNotes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(16, 120, 80);
      doc.text('5. NOTAS E RESSALVAS TÉCNICAS', 14, currentY);
      currentY += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const splitNotes = doc.splitTextToSize(val.laudoNotes, 182);
      doc.text(splitNotes, 14, currentY);
      currentY += splitNotes.length * 4 + 8;
    }

    if (currentY > 245) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`${val.propertyCity || 'Almenara'} / MG, ${todayStr}.`, 105, currentY, { align: 'center' });
    currentY += 16;

    doc.setDrawColor(148, 163, 184);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(55, currentY, 155, currentY);
    currentY += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
    doc.text(expertName, 105, currentY, { align: 'center' });
    currentY += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Engenheiro Agrônomo — Perito / Avaliador Rural`, 105, currentY, { align: 'center' });
    currentY += 3.5;
    doc.text(creaNumber, 105, currentY, { align: 'center' });

    return doc;
  };

  // Automatic synchronization function with the 'documents' collection and client dossier
  const syncValuationToDossier = async (val: RuralPropertyValuation, targetClientId?: string, showToast = true) => {
    setIsSyncing(true);
    try {
      let clientId = targetClientId || val.clientId;
      if (!clientId) {
        const match = clients.find(c => 
          (c.name || '').trim().toLowerCase() === (val.clientName || '').trim().toLowerCase() ||
          (c.propertyName && val.propertyName && (c.propertyName || '').trim().toLowerCase() === (val.propertyName || '').trim().toLowerCase())
        );
        if (match) {
          clientId = match.id;
        }
      }

      // (Removido: sem cliente identificado, o laudo ia para o dossiê do PRIMEIRO
      // cliente da lista — um produtor sem relação com a avaliação.)

      if (!clientId) {
        if (showToast) {
          toast.info('Cadastre ao menos um produtor/cliente para sincronizar este laudo com o dossiê.');
        }
        return;
      }

      // Generate PDF Blob
      const pdfDoc = buildRuralValuationPDF(val);
      const pdfBlob = pdfDoc.output('blob');
      const sanitizedProperty = (val.propertyName || 'imovel').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Laudo_Avaliacao_${sanitizedProperty}_${Date.now()}.pdf`;
      let storagePath = `documents/${clientId}/${fileName}`;

      // Upload to Firebase Storage
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

      // Ensure document folder exists in 'documents' collection linking valuation to client dossier
      await ensureDocumentFolder({
        clientId: clientId,
        serviceId: val.id,
        serviceName: `Avaliação NBR 14.653: ${val.propertyName}`,
        category: 'Avaliação Rural',
        folderType: 'rural_valuation',
        metadata: {
          propertyName: val.propertyName,
          propertyCity: val.propertyCity,
          totalArea: val.totalArea,
          totalValue: val.totalValue,
          registrationNumber: val.registrationNumber,
          car: val.car,
          ccir: val.ccir
        },
        initialFile: {
          name: `Laudo de Avaliação Rural — ${val.propertyName}`,
          url: downloadUrl,
          storagePath: storagePath,
          size: `${(pdfBlob.size / 1024).toFixed(1)} KB`,
          type: 'application/pdf'
        }
      });

      // Check if document already exists for this serviceId
      const qExisting = query(
        collection(db, 'documents'),
        where('serviceId', '==', val.id)
      );
      const existingSnap = await getDocs(qExisting);

      const docPayload = {
        clientId: clientId,
        name: `Laudo de Avaliação Rural — ${val.propertyName}`,
        category: 'Avaliação Rural',
        size: `${(pdfBlob.size / 1024).toFixed(1)} KB`,
        type: 'application/pdf',
        url: downloadUrl,
        storagePath: storagePath,
        serviceId: val.id,
        serviceName: `Avaliação NBR 14.653: ${val.propertyName}`,
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

      // Update rural valuation record with the clientId if not set
      if (!val.clientId || val.clientId !== clientId) {
        await updateDoc(doc(db, 'rural_valuations', val.id), {
          clientId: clientId,
          updatedAt: new Date().toISOString()
        });
      }

      if (showToast) {
        toast.success('Laudo de avaliação sincronizado com sucesso no dossiê do cliente!');
      }
    } catch (error) {
      console.error('Erro na sincronização da avaliação:', error);
      if (showToast) {
        toast.error('Não foi possível sincronizar o laudo com o dossiê.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveValuation = async () => {
    if (!(formData.propertyName || '').trim()) {
      toast.error('Informe o nome da propriedade.');
      return;
    }
    if (!(formData.clientName || '').trim()) {
      toast.error('Informe o nome do cliente / solicitante.');
      return;
    }
    if (!formData.totalArea || Number(formData.totalArea) <= 0) {
      toast.error('Informe a área total válida do imóvel.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<RuralPropertyValuation, 'id'> = {
        clientId: formData.clientId || undefined,
        clientName: (formData.clientName || '').trim(),
        purpose: formData.purpose,
        propertyName: (formData.propertyName || '').trim(),
        propertyCity: (formData.propertyCity || '').trim(),
        propertyState: (formData.propertyState || '').trim().toUpperCase() || 'MG',
        totalArea: Number(formData.totalArea) || 0,
        agriculturalArea: formData.agriculturalArea ? Number(formData.agriculturalArea) : undefined,
        pastureArea: formData.pastureArea ? Number(formData.pastureArea) : undefined,
        forestArea: formData.forestArea ? Number(formData.forestArea) : undefined,
        appArea: formData.appArea ? Number(formData.appArea) : undefined,
        registrationNumber: (formData.registrationNumber || '').trim() || undefined,
        car: (formData.car || '').trim() || undefined,
        ccir: (formData.ccir || '').trim() || undefined,
        itr: (formData.itr || '').trim() || undefined,
        distanceToCity: Number(formData.distanceToCity) || 0,
        roadType: formData.roadType,
        mainActivity: (formData.mainActivity || '').trim(),
        soilClass: (formData.soilClass || '').trim() || undefined,
        irrigation: formData.irrigation,
        irrigationSystem: (formData.irrigationSystem || '').trim() || undefined,
        electricPower: formData.electricPower,
        waterSource: (formData.waterSource || '').trim() || undefined,
        improvements: {
          houses: Number(formData.improvements.houses) || 0,
          workers: Number(formData.improvements.workers) || 0,
          silos: !!formData.improvements.silos,
          barn: !!formData.improvements.barn,
          corral: !!formData.improvements.corral,
          others: formData.improvements.others?.trim() || undefined
        },
        comparativeData: {
          reference1: formData.comparativeData.reference1.description ? {
            description: formData.comparativeData.reference1.description.trim(),
            area: Number(formData.comparativeData.reference1.area) || 0,
            value: Number(formData.comparativeData.reference1.value) || 0,
            source: formData.comparativeData.reference1.source?.trim() || ''
          } : undefined,
          reference2: formData.comparativeData.reference2.description ? {
            description: formData.comparativeData.reference2.description.trim(),
            area: Number(formData.comparativeData.reference2.area) || 0,
            value: Number(formData.comparativeData.reference2.value) || 0,
            source: formData.comparativeData.reference2.source?.trim() || ''
          } : undefined,
          reference3: formData.comparativeData.reference3.description ? {
            description: formData.comparativeData.reference3.description.trim(),
            area: Number(formData.comparativeData.reference3.area) || 0,
            value: Number(formData.comparativeData.reference3.value) || 0,
            source: formData.comparativeData.reference3.source?.trim() || ''
          } : undefined,
        },
        landValuePerHa: formData.landValuePerHa ? Number(formData.landValuePerHa) : undefined,
        improvementsValue: formData.improvementsValue ? Number(formData.improvementsValue) : undefined,
        totalValue: formData.totalValue ? Number(formData.totalValue) : undefined,
        fundamentationDegree: formData.fundamentationDegree,
        status: formData.status,
        visitaDate: formData.visitaDate || undefined,
        reportDate: formData.reportDate || undefined,
        laudoNotes: (formData.laudoNotes || '').trim() || undefined,
        createdBy: user?.uid || 'anonymous',
        createdAt: editingId ? (valuations.find(v => v.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let savedId = editingId;
      if (editingId) {
        await updateDoc(doc(db, 'rural_valuations', editingId), payload as any);
        if (selectedValuation?.id === editingId) {
          setSelectedValuation({ id: editingId, ...payload } as RuralPropertyValuation);
        }
      } else {
        const docRef = await addDoc(collection(db, 'rural_valuations'), payload);
        savedId = docRef.id;
      }

      // Automatically sync with client dossier
      const fullVal: RuralPropertyValuation = { id: savedId!, ...payload };
      await syncValuationToDossier(fullVal, formData.clientId, false);

      if (user) {
        await logAudit({
          recordId: savedId!,
          collection: 'rural_valuations',
          userId: user.uid,
          userName: user.displayName || user.email || 'Usuário',
          action: editingId ? 'update' : 'create',
          recordName: `Avaliação: ${payload.propertyName} (${payload.clientName})`,
          details: editingId
            ? `Atualizou a avaliação do imóvel rural "${payload.propertyName}" (${payload.totalArea} ha).`
            : `Cadastrou nova avaliação de imóvel rural para "${payload.propertyName}" (${payload.totalArea} ha).`
        });
      }

      toast.success(editingId ? 'Avaliação atualizada e sincronizada com o dossiê!' : 'Avaliação cadastrada e pasta sincronizada no dossiê!');
      setIsModalOpen(false);
      setEditingId(null);
    } catch (error) {
      console.error('Erro ao salvar avaliação:', error);
      toast.error('Falha ao salvar a avaliação de imóvel rural.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteValuation = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!(await confirmAction({
      title: 'Excluir avaliação?',
      description: 'Tem certeza que deseja excluir esta avaliação de imóvel rural? Esta ação é irreversível.',
      confirmLabel: 'Excluir',
    }))) {
      return;
    }
    try {
      const valToDelete = valuations.find(v => v.id === id);
      await deleteDoc(doc(db, 'rural_valuations', id));

      if (user) {
        await logAudit({
          recordId: id,
          collection: 'rural_valuations',
          userId: user.uid,
          userName: user.displayName || user.email || 'Usuário',
          action: 'delete',
          recordName: valToDelete?.propertyName ? `Avaliação: ${valToDelete.propertyName}` : 'Avaliação Rural',
          details: `Excluiu a avaliação de imóvel rural com ID ${id}.`
        });
      }

      toast.success('Avaliação excluída com sucesso.');
      if (selectedValuation?.id === id) {
        setIsDrawerOpen(false);
        setSelectedValuation(null);
      }
    } catch (error) {
      console.error('Erro ao excluir:', error);
      toast.error('Erro ao excluir avaliação.');
    }
  };

  // PDF Generation Function
  const handleGeneratePDF = async (val: RuralPropertyValuation, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    try {
      const doc = buildRuralValuationPDF(val);
      const sanitizedName = (val.propertyName || 'imovel').replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(`Laudo_Avaliacao_${sanitizedName}.pdf`);
      toast.success('Laudo de avaliação gerado em PDF com sucesso!');

      // Also trigger dossier sync
      syncValuationToDossier(val, val.clientId, false);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      toast.error('Erro ao gerar o laudo de avaliação em PDF.');
    }
  };

  // Filtered List
  const filteredValuations = valuations.filter((v) => {
    const q = searchQuery.toLowerCase();
    const matchesQuery = 
      !q ||
      v.propertyName?.toLowerCase().includes(q) ||
      v.clientName?.toLowerCase().includes(q) ||
      v.propertyCity?.toLowerCase().includes(q) ||
      v.registrationNumber?.toLowerCase().includes(q);

    const matchesPurpose = purposeFilter === 'todos' || v.purpose === purposeFilter;
    const matchesStatus = statusFilter === 'todos' || v.status === statusFilter;

    return matchesQuery && matchesPurpose && matchesStatus;
  });

  // KPIs
  const totalAvaliacoes = valuations.length;
  const totalValorAvaliado = valuations.reduce((acc, v) => acc + (v.totalValue || 0), 0);
  const totalEmElaboracao = valuations.filter(v => v.status === 'em_elaboracao').length;
  const totalConcluidas = valuations.filter(v => v.status === 'concluido' || v.status === 'entregue').length;

  return (
    <div className="flex flex-col gap-6 pb-16">
      {confirmModal}
      {/* HEADER */}
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Avaliação de Imóveis" subtitle="Laudos e pareceres técnicos de avaliação (ABNT NBR 14.653-3)" />

        <div className="flex items-center gap-3">
          <ExportExcelButton fileName="Avaliacoes_Imoveis" getRows={() => filteredValuations.map((v: any) => ({
    'Cliente': v.clientName || '', 'Imóvel': v.propertyName || '', 'Município': [v.propertyCity, v.propertyState].filter(Boolean).join('/'),
    'Finalidade': v.purpose || '', 'Área (ha)': Number(v.totalArea) || 0, 'VTN (R$/ha)': (typeof v.landValuePerHa === 'number' ? v.landValuePerHa : Number(v.landValuePerHa) || 0),
    'Benfeitorias (R$)': (typeof v.improvementsValue === 'number' ? v.improvementsValue : Number(v.improvementsValue) || 0), 'Valor Total (R$)': (typeof v.totalValue === 'number' ? v.totalValue : Number(v.totalValue) || 0), 'Status': v.status || '', 'Data do Laudo': (v.reportDate ? String(v.reportDate).split('T')[0].split('-').reverse().join('/') : ''),
  }))} />
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova Avaliação
          </button>
        </div>
      </header>

      {/* 4 SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Avaliações</p>
            <h3 className="text-2xl font-display font-extrabold text-slate-800 dark:text-slate-100 mt-1">
              {totalAvaliacoes}
            </h3>
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5 block">
              Laudos no sistema
            </span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center">
            <Compass className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Patrimônio Avaliado</p>
            <h3 className="text-2xl font-display font-extrabold text-slate-800 dark:text-slate-100 mt-1">
              {formatCurrency(totalValorAvaliado)}
            </h3>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 block">
              Soma global dos laudos
            </span>
          </div>
          <div className="w-12 h-12 bg-slate-50 dark:bg-emerald-950/40 text-slate-600 dark:text-slate-400 rounded-2xl flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Em Elaboração</p>
            <h3 className="text-2xl font-display font-extrabold text-amber-600 dark:text-amber-400 mt-1">
              {totalEmElaboracao}
            </h3>
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5 block">
              Pesquisa / Vistoria
            </span>
          </div>
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4 */}
        <div className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Concluídas / Entregues</p>
            <h3 className="text-2xl font-display font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
              {totalConcluidas}
            </h3>
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5 block">
              Laudos finalizados
            </span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* FILTROS E BUSCA */}
      <div className="glass-card p-4 rounded-3xl border border-white/40 dark:border-slate-800 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar imóvel, cliente, cidade, matrícula..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full glass-input pl-10 pr-4 py-2 text-xs rounded-2xl"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {/* Purpose Filter */}
          <select
            value={purposeFilter}
            onChange={(e) => setPurposeFilter(e.target.value)}
            className="glass-input px-3 py-2 text-xs rounded-2xl bg-white dark:bg-slate-900 cursor-pointer"
          >
            <option value="todos">Finalidade: Todas</option>
            {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-input px-3 py-2 text-xs rounded-2xl bg-white dark:bg-slate-900 cursor-pointer"
          >
            <option value="todos">Status: Todos</option>
            <option value="em_elaboracao">Em Elaboração</option>
            <option value="concluido">Concluído</option>
            <option value="entregue">Entregue</option>
            <option value="arquivado">Arquivado</option>
          </select>
        </div>
      </div>

      {/* LISTAGEM DE AVALIAÇÕES */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="glass-card p-6 rounded-3xl h-64 animate-pulse bg-slate-100/50 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filteredValuations.length === 0 ? (
        <div className="glass-card p-12 text-center rounded-3xl border border-white/40 dark:border-slate-800 flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-slate-400">
            <MapPin className="w-8 h-8" />
          </div>
          <h3 className="text-base font-display font-bold text-slate-700 dark:text-slate-200">
            Nenhuma avaliação encontrada
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Cadastre uma nova avaliação mercadológica ou ajuste seus filtros de busca para visualizar os laudos.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Avaliação
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredValuations.map((val) => {
            const statusCfg = STATUS_CONFIG[val.status] || STATUS_CONFIG.em_elaboracao;
            const fundCfg = FUNDAMENTATION_CONFIG[val.fundamentationDegree || 'II'];
            const totalVal = val.totalValue || ((val.landValuePerHa || 0) * val.totalArea + (val.improvementsValue || 0));

            return (
              <motion.div
                key={val.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => {
                  setSelectedValuation(val);
                  setIsDrawerOpen(true);
                }}
                className="glass-card p-5 rounded-3xl border border-white/50 dark:border-slate-800/80 hover:border-emerald-500/50 dark:hover:border-emerald-500/40 transition-all shadow-sm hover:shadow-xl group cursor-pointer relative flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Property Name & City */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 transition-colors truncate">
                        {val.propertyName}
                      </h3>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        {val.propertyCity}/{val.propertyState}
                      </p>
                    </div>

                    <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-md border shrink-0", fundCfg.color)}>
                      Grau {val.fundamentationDegree || 'II'}
                    </span>
                  </div>

                  {/* Solicitante & Finalidade */}
                  <div className="bg-slate-50/80 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60 mb-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Solicitante:</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200 truncate max-w-[170px]">{val.clientName}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/50 dark:border-slate-800">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Finalidade:</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">{PURPOSE_LABELS[val.purpose] || val.purpose}</span>
                    </div>
                  </div>

                  {/* Áreas Repartidas */}
                  <div className="grid grid-cols-3 gap-2 text-center bg-emerald-50/40 dark:bg-emerald-950/20 p-2.5 rounded-2xl mb-3 border border-emerald-100/60 dark:border-emerald-900/30">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Área Total</span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{val.totalArea} ha</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Agrícola</span>
                      <span className="text-xs font-bold text-emerald-600">{val.agriculturalArea || 0} ha</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Pastagem</span>
                      <span className="text-xs font-bold text-amber-600">{val.pastureArea || 0} ha</span>
                    </div>
                  </div>
                </div>

                {/* Footer Info & Valor Total */}
                <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Valor Total Avaliado</span>
                      <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(totalVal)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">VTN Unitário</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {val.landValuePerHa ? `${formatCurrency(val.landValuePerHa)}/ha` : 'A calcular'}
                      </span>
                    </div>
                  </div>

                  {/* Status & Dates */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border", statusCfg.bg, statusCfg.text, statusCfg.border)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", statusCfg.dot)} />
                      {statusCfg.label}
                    </span>

                    <span>Laudo: {formatDate(val.reportDate || val.createdAt)}</span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100/60 dark:border-slate-800/40">
                    <button
                      onClick={(e) => handleGeneratePDF(val, e)}
                      title="Gerar Laudo de Avaliação em PDF"
                      className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-300 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <Download className="w-3 h-3" />
                      Laudo PDF
                    </button>
                    {canEditRecord(val) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditModal(val);
                      }}
                      title="Editar Avaliação"
                      className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-emerald-950/40 hover:text-slate-700 text-slate-500 rounded-xl transition-all"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    )}
                    {canDeleteRecord && (
                    <button
                      onClick={(e) => handleDeleteValuation(val.id, e)}
                      title="Excluir Avaliação"
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

      {/* DRAWER LATERAL DE DETALHES */}
      <AnimatePresence>
        {isDrawerOpen && selectedValuation && (
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
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-slate-800 dark:text-slate-100">
                        {selectedValuation.propertyName}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {selectedValuation.propertyCity}/{selectedValuation.propertyState} — {selectedValuation.totalArea} ha
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsDrawerOpen(false)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Status Timeline Visual: Acompanhamento ABNT NBR 14.653 */}
                <ProcessStatusTimeline 
                  mode="rural_valuation" 
                  record={selectedValuation} 
                  onRefresh={() => {
                    const updated = valuations.find(v => v.id === selectedValuation.id);
                    if (updated) setSelectedValuation(updated);
                  }}
                />

                {/* Section 1: Conclusão do Valor */}
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-50 dark:from-emerald-950/30 dark:to-emerald-950/20 p-5 rounded-3xl border border-emerald-200/60 dark:border-emerald-800/40 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    Resultado da Avaliação NBR 14.653-3
                  </span>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-2xl font-display font-extrabold text-emerald-800 dark:text-emerald-200">
                      {formatCurrency(selectedValuation.totalValue || ((selectedValuation.landValuePerHa || 0) * selectedValuation.totalArea + (selectedValuation.improvementsValue || 0)))}
                    </h3>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 text-emerald-700">
                      Grau {selectedValuation.fundamentationDegree || 'II'}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-700/80 italic">
                    {numberToWordsBRL(selectedValuation.totalValue || ((selectedValuation.landValuePerHa || 0) * selectedValuation.totalArea + (selectedValuation.improvementsValue || 0)))}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/50 text-xs">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Terra Nua (VTN)</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {formatCurrency(selectedValuation.landValuePerHa)}/ha
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Benfeitorias</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {formatCurrency(selectedValuation.improvementsValue || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Identificação do Imóvel & Solicitante */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Identificação</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Cliente / Solicitante</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedValuation.clientName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Finalidade</span>
                      <span className="font-bold text-emerald-600">{PURPOSE_LABELS[selectedValuation.purpose] || selectedValuation.purpose}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Matrícula</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">{selectedValuation.registrationNumber || 'Não informada'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">CAR</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300 truncate block">{selectedValuation.car || 'Não informado'}</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Uso do Solo e Áreas */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Distribuição de Áreas</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-[9px] text-slate-400 block">Total</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedValuation.totalArea} ha</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-[9px] text-emerald-600 block">Lavoura</span>
                      <span className="font-bold text-emerald-600">{selectedValuation.agriculturalArea || 0} ha</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-[9px] text-amber-600 block">Pastagem</span>
                      <span className="font-bold text-amber-600">{selectedValuation.pastureArea || 0} ha</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-[9px] text-slate-600 block">Reserva/APP</span>
                      <span className="font-bold text-slate-600">{(selectedValuation.forestArea || 0) + (selectedValuation.appArea || 0)} ha</span>
                    </div>
                  </div>
                </div>

                {/* Section 4: Localização e Benfeitorias */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60 text-xs">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Infraestrutura & Recursos</h4>
                  <div className="space-y-1 text-slate-700 dark:text-slate-300">
                    <p>• <strong>Acesso:</strong> {selectedValuation.distanceToCity || 0} km da sede ({selectedValuation.roadType})</p>
                    <p>• <strong>Energia Elétrica:</strong> {selectedValuation.electricPower ? 'Instalada' : 'Não possui'}</p>
                    <p>• <strong>Recursos Hídricos:</strong> {selectedValuation.waterSource || 'Nascentes e cursos d’água'}</p>
                    <p>• <strong>Solo Predominante:</strong> {selectedValuation.soilClass || 'Latossolo'}</p>
                    <p>• <strong>Benfeitorias:</strong> {selectedValuation.improvements?.houses || 0} Casa(s) Sede, {selectedValuation.improvements?.workers || 0} Trabalhador, {selectedValuation.improvements?.barn ? 'Galpão, ' : ''}{selectedValuation.improvements?.corral ? 'Curral, ' : ''}{selectedValuation.improvements?.silos ? 'Silos, ' : ''}{selectedValuation.improvements?.others || ''}</p>
                  </div>
                </div>

                {/* Section 5: Observações */}
                {selectedValuation.laudoNotes && (
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2 border border-slate-100 dark:border-slate-700/60">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Observações Técnicas</h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{selectedValuation.laudoNotes}</p>
                  </div>
                )}

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
                    const linkedClient = clients.find(c => c.id === selectedValuation.clientId) || 
                      clients.find(c => 
                        (c.name || '').toLowerCase() === (selectedValuation.clientName || '').toLowerCase() ||
                        (c.propertyName && selectedValuation.propertyName && (c.propertyName || '').toLowerCase() === (selectedValuation.propertyName || '').toLowerCase())
                      );

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Produtor / Cliente</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {linkedClient ? linkedClient.name : selectedValuation.clientName || 'Vínculo Automático'}
                            </span>
                          </div>
                          {linkedClient && (
                            <button
                              onClick={() => {
                                navigate('/documents', { state: { clientId: linkedClient.id, serviceId: selectedValuation.id } });
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
                              Nenhum arquivo anexado ainda. Clique em "Atualizar Laudo no Dossiê" para gerar e enviar o PDF oficial ao dossiê.
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
                            onClick={() => syncValuationToDossier(selectedValuation, selectedValuation.clientId, true)}
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
                  <AuditTrail collectionName="rural_valuations" recordId={selectedValuation.id} />
                </div>
              </div>

              {/* Drawer Bottom Actions */}
              <div className="pt-6 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
                <button
                  onClick={(e) => handleGeneratePDF(selectedValuation, e)}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Gerar Laudo PDF
                </button>

                <button
                  onClick={() => {
                    handleOpenEditModal(selectedValuation);
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

      {/* MODAL CRIAR / EDITAR AVALIAÇÃO */}
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
                    <MapPin className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800 dark:text-slate-100">
                      {editingId ? 'Editar Avaliação de Imóvel Rural' : 'Nova Avaliação de Imóvel Rural'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Metodologia da ABNT NBR 14.653-3 para determinação de valor mercadológico
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
                {/* SEÇÃO 1: CLIENTE E FINALIDADE */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <UserCheck className="w-4 h-4" />
                    1. Identificação do Solicitante & Finalidade
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Seleção de Cliente existente */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Vincular Cliente Cadastrado (Opcional)
                      </label>
                      <select
                        value={formData.clientId}
                        onChange={(e) => handleSelectClient(e.target.value)}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        <option value="">-- Selecionar da base de clientes --</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.cpf})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Nome do Proprietário / Solicitante *
                      </label>
                      <input
                        type="text"
                        placeholder="Nome completo ou Razão Social"
                        value={formData.clientName}
                        onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Finalidade da Avaliação *
                      </label>
                      <select
                        value={formData.purpose}
                        onChange={(e) => setFormData({ ...formData, purpose: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 2: DADOS DO IMÓVEL & ÁREAS */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Building className="w-4 h-4" />
                    2. Dados do Imóvel e Repartição de Áreas
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Nome da Propriedade / Fazenda *
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Fazenda Bom Jardim"
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
                        placeholder="ex: 200.00"
                        value={formData.totalArea}
                        onChange={(e) => setFormData({ ...formData, totalArea: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-bold text-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Município
                      </label>
                      <input
                        type="text"
                        placeholder="Almenara"
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
                        placeholder="ex: 8.921 CRI"
                        value={formData.registrationNumber}
                        onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    {/* Repartição das Áreas */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Área Agrícola (ha)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.agriculturalArea}
                        onChange={(e) => setFormData({ ...formData, agriculturalArea: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Área de Pastagem (ha)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.pastureArea}
                        onChange={(e) => setFormData({ ...formData, pastureArea: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Reserva Legal + APP (ha)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.forestArea}
                        onChange={(e) => setFormData({ ...formData, forestArea: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Documentos Rurais (CAR / CCIR / ITR)
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          placeholder="Código CAR"
                          value={formData.car}
                          onChange={(e) => setFormData({ ...formData, car: e.target.value })}
                          className="glass-input px-3 py-2 text-xs rounded-xl font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Número CCIR (INCRA)"
                          value={formData.ccir}
                          onChange={(e) => setFormData({ ...formData, ccir: e.target.value })}
                          className="glass-input px-3 py-2 text-xs rounded-xl font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Número NIRF / ITR"
                          value={formData.itr}
                          onChange={(e) => setFormData({ ...formData, itr: e.target.value })}
                          className="glass-input px-3 py-2 text-xs rounded-xl font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 3: LOCALIZAÇÃO & INFRAESTRUTURA */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Tractor className="w-4 h-4" />
                    3. Localização, Acesso e Recursos
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Distância da Sede Municipal (km)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="ex: 18.5"
                        value={formData.distanceToCity}
                        onChange={(e) => setFormData({ ...formData, distanceToCity: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Tipo de Rodovia / Acesso
                      </label>
                      <select
                        value={formData.roadType}
                        onChange={(e) => setFormData({ ...formData, roadType: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        <option value="asfalto">Asfalto</option>
                        <option value="terra">Estrada de Terra</option>
                        <option value="misto">Misto (Asfalto + Terra)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Classe de Solo Predominante
                      </label>
                      <select
                        value={formData.soilClass}
                        onChange={(e) => setFormData({ ...formData, soilClass: e.target.value })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        {SOIL_CLASSES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Fonte de Recursos Hídricos
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Rio Jequitinhonha, 3 nascentes"
                        value={formData.waterSource}
                        onChange={(e) => setFormData({ ...formData, waterSource: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Atividade Econômica Principal
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Pecuária de Corte, Café"
                        value={formData.mainActivity}
                        onChange={(e) => setFormData({ ...formData, mainActivity: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div className="flex items-center gap-4 pt-4">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.electricPower}
                          onChange={(e) => setFormData({ ...formData, electricPower: e.target.checked })}
                          className="w-4 h-4 rounded text-emerald-600"
                        />
                        Energia Elétrica
                      </label>

                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.irrigation}
                          onChange={(e) => setFormData({ ...formData, irrigation: e.target.checked })}
                          className="w-4 h-4 rounded text-emerald-600"
                        />
                        Possui Irrigação
                      </label>
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 4: BENFEITORIAS */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Home className="w-4 h-4" />
                    4. Benfeitorias e Edificações
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Casas Sede (qtd)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.improvements.houses}
                        onChange={(e) => setFormData({
                          ...formData,
                          improvements: { ...formData.improvements, houses: Number(e.target.value) }
                        })}
                        className="w-full glass-input px-3 py-2 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Casas Trabalhador (qtd)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.improvements.workers}
                        onChange={(e) => setFormData({
                          ...formData,
                          improvements: { ...formData.improvements, workers: Number(e.target.value) }
                        })}
                        className="w-full glass-input px-3 py-2 text-xs rounded-xl"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-4">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.improvements.barn}
                          onChange={(e) => setFormData({
                            ...formData,
                            improvements: { ...formData.improvements, barn: e.target.checked }
                          })}
                          className="w-4 h-4 rounded text-emerald-600"
                        />
                        Galpão
                      </label>

                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.improvements.corral}
                          onChange={(e) => setFormData({
                            ...formData,
                            improvements: { ...formData.improvements, corral: e.target.checked }
                          })}
                          className="w-4 h-4 rounded text-emerald-600"
                        />
                        Curral
                      </label>

                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.improvements.silos}
                          onChange={(e) => setFormData({
                            ...formData,
                            improvements: { ...formData.improvements, silos: e.target.checked }
                          })}
                          className="w-4 h-4 rounded text-emerald-600"
                        />
                        Silo
                      </label>
                    </div>

                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Outras Benfeitorias / Detalhamento
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Cercas de arame liso 5 fios, poço artesiano 12.000 L/h, açude escavado"
                        value={formData.improvements.others}
                        onChange={(e) => setFormData({
                          ...formData,
                          improvements: { ...formData.improvements, others: e.target.value }
                        })}
                        className="w-full glass-input px-4 py-2 text-xs rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* SEÇÃO 5: DADOS DE MERCADO (COMPARATIVO) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                    <Calculator className="w-4 h-4" />
                    5. Pesquisa Mercadológica (Amostras Comparativas)
                  </div>

                  <div className="space-y-2">
                    {/* Alerta Normativo ABNT NBR 14.653-3 */}
                    {(() => {
                      const count = [formData.comparativeData.reference1, formData.comparativeData.reference2, formData.comparativeData.reference3]
                        .filter(r => r && (r.description?.trim() || (r.value && Number(r.value) > 0))).length;
                      if (count < 3) {
                        return (
                          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300 mb-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold">Aviso Normativo — ABNT NBR 14.653-3 ({count}/3 amostras preenchidas)</p>
                              <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 mt-0.5">
                                Com menos de 3 dados de mercado contemporâneos a avaliação não atinge nem o <strong>Grau I de Fundamentação</strong>. Preencha ao menos 3 dados amostrais homogeneizados.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 mb-2">
                          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="font-medium text-[11px]">3 amostras preenchidas — mínimo para o Grau I. Os Graus II e III exigem mais dados de mercado e tratamento estatístico (ver tabela de enquadramento da NBR 14.653-3).</span>
                        </div>
                      );
                    })()}

                    {[1, 2, 3].map((num) => {
                      const refKey = `reference${num}` as 'reference1' | 'reference2' | 'reference3';
                      const refData = formData.comparativeData[refKey] || { description: '', area: 0, value: 0, source: '' };

                      return (
                        <div key={num} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                          <div className="sm:col-span-2">
                            <span className="text-[10px] text-slate-400 font-bold block mb-1">Amostra {num} — Descrição</span>
                            <input
                              type="text"
                              placeholder={`Fazenda paradigma na região...`}
                              value={refData.description}
                              onChange={(e) => setFormData({
                                ...formData,
                                comparativeData: {
                                  ...formData.comparativeData,
                                  [refKey]: { ...refData, description: e.target.value }
                                }
                              })}
                              className="w-full glass-input px-3 py-1.5 text-xs rounded-lg"
                            />
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block mb-1">Área (ha)</span>
                            <input
                              type="number"
                              placeholder="ha"
                              value={refData.area || ''}
                              onChange={(e) => setFormData({
                                ...formData,
                                comparativeData: {
                                  ...formData.comparativeData,
                                  [refKey]: { ...refData, area: Number(e.target.value) }
                                }
                              })}
                              className="w-full glass-input px-3 py-1.5 text-xs rounded-lg"
                            />
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block mb-1">Valor Total (R$)</span>
                            <input
                              type="number"
                              placeholder="R$"
                              value={refData.value || ''}
                              onChange={(e) => setFormData({
                                ...formData,
                                comparativeData: {
                                  ...formData.comparativeData,
                                  [refKey]: { ...refData, value: Number(e.target.value) }
                                }
                              })}
                              className="w-full glass-input px-3 py-1.5 text-xs rounded-lg"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SEÇÃO 6: RESULTADO DA AVALIAÇÃO */}
                <div className="space-y-3 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 rounded-3xl border border-emerald-200/60 dark:border-emerald-800/40">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 border-b border-emerald-200/60 dark:border-emerald-800 pb-1.5">
                    <Sparkles className="w-4 h-4" />
                    6. Determinação dos Valores e Grau de Fundamentação
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Valor da Terra Nua (R$/ha) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ex: 15000.00"
                        value={formData.landValuePerHa}
                        onChange={(e) => setFormData({ ...formData, landValuePerHa: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Valor das Benfeitorias (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ex: 350000.00"
                        value={formData.improvementsValue}
                        onChange={(e) => setFormData({ ...formData, improvementsValue: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                        VALOR TOTAL DO IMÓVEL (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Cálculo automático..."
                        value={formData.totalValue}
                        onChange={(e) => setFormData({ ...formData, totalValue: e.target.value as any })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl font-extrabold text-emerald-700 dark:text-emerald-400 bg-emerald-50/50"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Grau de Fundamentação (NBR 14.653-3)
                      </label>
                      <select
                        value={formData.fundamentationDegree}
                        onChange={(e) => setFormData({ ...formData, fundamentationDegree: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        <option value="I">Grau I (Expedito)</option>
                        <option value="II">Grau II (Normal / Fatores)</option>
                        <option value="III">Grau III (Científico / Regressão)</option>
                      </select>
                    </div>

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
                        Status do Laudo
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                        className="w-full glass-input px-3 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 cursor-pointer"
                      >
                        <option value="em_elaboracao">Em Elaboração</option>
                        <option value="concluido">Concluído</option>
                        <option value="entregue">Entregue</option>
                        <option value="arquivado">Arquivado</option>
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Observações Técnicas & Diagnóstico
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Comentários sobre vocação da propriedade, topografia, logística e mercado regional..."
                        value={formData.laudoNotes}
                        onChange={(e) => setFormData({ ...formData, laudoNotes: e.target.value })}
                        className="w-full glass-input px-4 py-2.5 text-xs rounded-xl resize-none"
                      />
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
                  onClick={() => runExclusive('RuralPropertyValuation.handleSaveValuation', () => handleSaveValuation())}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {isSubmitting ? 'Salvando...' : editingId ? 'Atualizar Avaliação' : 'Cadastrar Avaliação'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
