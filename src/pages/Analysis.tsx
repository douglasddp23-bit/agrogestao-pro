import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  ClipboardCheck, 
  Map, 
  Droplet, 
  FileText, 
  Plus, 
  Search, 
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Wallet,
  X,
  Trash2,
  Save,
  Ban,
  Download,
  Terminal,
  Settings,
  CloudRain,
  ChevronRight,
  ChevronLeft,
  Waves,
  Sprout,
  Leaf,
  Printer,
  LandPlot,
  Sparkles,
  TrendingUp,
  Edit3,
  FlaskConical
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, where, getDocs, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ServiceAnalysis, AnalysisType, Client, UserRole } from '../types';
import { PERMISSIONS } from '../lib/permissions';
import { logAudit } from '../lib/audit';
import { motion, AnimatePresence } from 'motion/react';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { ClipboardCheck as PageIcon } from 'lucide-react';
import { handleFirestoreError, OperationType, formatDateTime, cn, formatDate, getStatusConfig, todayLocalDateString, parseDateInput } from '../lib/utils';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import ConfirmationModal from '../components/ConfirmationModal';
import EfficiencyReport from '../components/EfficiencyReport';
import ServiceKpiCards from '../components/service/ServiceKpiCards';
import AuditTrail from '../components/AuditTrail';
import { toast } from 'sonner';
import { getPdfBranding } from '../lib/pdfBranding';
import { useInitialSearch } from '../hooks/useInitialSearch';

interface AnalysisProps {
  typeFilter?: AnalysisType;
}

const SOIL_ELEMENTS = [
  // Acidez e pH
  { id: 'ph', label: 'pH (CaCl₂)', unit: '-' },
  { id: 'ph_h2o', label: 'pH (H₂O)', unit: '-' },
  { id: 'al', label: 'Alumínio (Al³⁺)', unit: 'cmolc/dm³' },
  { id: 'hal', label: 'Acidez Potencial (H+Al)', unit: 'cmolc/dm³' },

  // Macronutrientes
  { id: 'n', label: 'Nitrogênio (N)', unit: 'g/kg' },
  { id: 'p', label: 'Fósforo (P)', unit: 'mg/dm³' },
  { id: 'k', label: 'Potássio (K)', unit: 'cmolc/dm³' },
  { id: 'ca', label: 'Cálcio (Ca)', unit: 'cmolc/dm³' },
  { id: 'mg', label: 'Magnésio (Mg)', unit: 'cmolc/dm³' },
  { id: 's', label: 'Enxofre (S)', unit: 'mg/dm³' },

  // Índices calculados de fertilidade
  { id: 'sb', label: 'Soma de Bases (SB)', unit: 'cmolc/dm³' },
  { id: 'ctc_efetiva', label: 'CTC Efetiva (t)', unit: 'cmolc/dm³' },
  { id: 'ctc_ph7', label: 'CTC a pH 7,0 (T)', unit: 'cmolc/dm³' },
  { id: 'v_percent', label: 'Saturação por Bases (V%)', unit: '%' },
  { id: 'm_percent', label: 'Saturação por Alumínio (m%)', unit: '%' },
  { id: 'p_rem', label: 'Fósforo Remanescente (P-rem)', unit: 'mg/L' },

  // Matéria orgânica
  { id: 'mo', label: 'Matéria Orgânica (M.O.)', unit: 'g/dm³' },

  // Micronutrientes
  { id: 'b', label: 'Boro (B)', unit: 'mg/dm³' },
  { id: 'cu', label: 'Cobre (Cu)', unit: 'mg/dm³' },
  { id: 'fe', label: 'Ferro (Fe)', unit: 'mg/dm³' },
  { id: 'mn', label: 'Manganês (Mn)', unit: 'mg/dm³' },
  { id: 'zn', label: 'Zinco (Zn)', unit: 'mg/dm³' },

  // Análise física (granulometria)
  { id: 'argila', label: 'Argila', unit: '%' },
  { id: 'silte', label: 'Silte', unit: '%' },
  { id: 'areia', label: 'Areia', unit: '%' },
];

const WATER_ELEMENTS = [
  { id: 'ph', label: 'pH', unit: '-' },
  { id: 'ce', label: 'Condutividade Elétrica (CE)', unit: 'dS/m' },
  { id: 'sdt', label: 'Sólidos Dissolvidos Totais (SDT)', unit: 'mg/L' },
  { id: 'dureza_total', label: 'Dureza Total', unit: 'mg/L CaCO₃' },

  // Cátions
  { id: 'ca', label: 'Cálcio (Ca²⁺)', unit: 'mmolc/L' },
  { id: 'mg', label: 'Magnésio (Mg²⁺)', unit: 'mmolc/L' },
  { id: 'na', label: 'Sódio (Na⁺)', unit: 'mmolc/L' },
  { id: 'k', label: 'Potássio (K⁺)', unit: 'mmolc/L' },

  // Ânions
  { id: 'hco3', label: 'Bicarbonato (HCO₃⁻)', unit: 'mmolc/L' },
  { id: 'co3', label: 'Carbonato (CO₃²⁻)', unit: 'mmolc/L' },
  { id: 'cl', label: 'Cloreto (Cl⁻)', unit: 'mmolc/L' },
  { id: 'so4', label: 'Sulfato (SO₄²⁻)', unit: 'mmolc/L' },

  // Índices de classificação (calculados ou inseridos)
  { id: 'ras', label: 'Razão de Adsorção de Sódio (RAS)', unit: '(mmol/L)^0.5' },
  { id: 'classe_salinidade', label: 'Classe de Salinidade (C1-C4)', unit: '-' },
  { id: 'classe_sodicidade', label: 'Classe de Sodicidade (S1-S4)', unit: '-' },

  // Elementos de risco
  { id: 'boro', label: 'Boro (B)', unit: 'mg/L' },
  { id: 'ferro', label: 'Ferro Total (Fe)', unit: 'mg/L' },
];

const FOLIAR_ELEMENTS = [
  // Macronutrientes (g/kg)
  { id: 'n', label: 'Nitrogênio (N)', unit: 'g/kg' },
  { id: 'p', label: 'Fósforo (P)', unit: 'g/kg' },
  { id: 'k', label: 'Potássio (K)', unit: 'g/kg' },
  { id: 'ca', label: 'Cálcio (Ca)', unit: 'g/kg' },
  { id: 'mg', label: 'Magnésio (Mg)', unit: 'g/kg' },
  { id: 's', label: 'Enxofre (S)', unit: 'g/kg' },

  // Micronutrientes (mg/kg)
  { id: 'b', label: 'Boro (B)', unit: 'mg/kg' },
  { id: 'cu', label: 'Cobre (Cu)', unit: 'mg/kg' },
  { id: 'fe', label: 'Ferro (Fe)', unit: 'mg/kg' },
  { id: 'mn', label: 'Manganês (Mn)', unit: 'mg/kg' },
  { id: 'mo', label: 'Molibdênio (Mo)', unit: 'mg/kg' },
  { id: 'zn', label: 'Zinco (Zn)', unit: 'mg/kg' },
  { id: 'co', label: 'Cobalto (Co)', unit: 'mg/kg' },
];

export default function Analysis({ typeFilter }: AnalysisProps) {
  const { user } = useAuth();
  const [analyses, setAnalyses] = useState<ServiceAnalysis[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ServiceAnalysis | null>(null);
  const [viewingAnalysis, setViewingAnalysis] = useState<ServiceAnalysis | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  
  const [newAnalysis, setNewAnalysis] = useState({
    clientId: '',
    clientName: '',
    propertyName: '',
    type: (typeFilter || 'soil') as AnalysisType,
    description: '',
    collectionDate: todayLocalDateString(),
    scheduledDate: todayLocalDateString(),
    responsibleTechnician: user?.displayName || '',
    status: 'Pendente',
    value: 0,
    cost: 0
  });

  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [showPropertySelect, setShowPropertySelect] = useState(false);
  const [showEfficiencyReport, setShowEfficiencyReport] = useState(false);

  const handleClientChange = (clientId: string) => {
    const selectedClient = clients.find(c => c.id === clientId);
    if (selectedClient) {
      const properties = selectedClient.properties?.map(p => p.name) || [];
      setAvailableProperties(properties);
      
      if (properties.length === 1) {
        setNewAnalysis(prev => ({ 
          ...prev, 
          clientId, 
          clientName: selectedClient.name,
          propertyName: properties[0] 
        }));
        setShowPropertySelect(false);
      } else if (properties.length > 1) {
        setNewAnalysis(prev => ({ 
          ...prev, 
          clientId, 
          clientName: selectedClient.name,
          propertyName: '' 
        }));
        setShowPropertySelect(true);
      } else {
        setNewAnalysis(prev => ({ 
          ...prev, 
          clientId, 
          clientName: selectedClient.name,
          propertyName: '' 
        }));
        setShowPropertySelect(false);
      }
    } else {
      setNewAnalysis(prev => ({ ...prev, clientId: '', clientName: '', propertyName: '' }));
      setAvailableProperties([]);
      setShowPropertySelect(false);
    }
  };

  const [resultsForm, setResultsForm] = useState<Record<string, string>>({});
  const [waivedFields, setWaivedFields] = useState<string[]>([]);
  const [editDetails, setEditDetails] = useState({
    responsibleTechnician: '',
    description: '',
    scheduledDate: '',
    value: 0,
    cost: 0
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Agronomic Soil Calculation Engine State
  const [targetCropV2, setTargetCropV2] = useState<number>(70); // 70% default for Soja/Milho
  const [prntValue, setPrntValue] = useState<number>(85); // 85% PRNT default

  // Calculate live agronomic parameters
  const calculateAgronomicParameters = () => {
    const ca = parseFloat(resultsForm['ca'] || '0') || 0;
    const mg = parseFloat(resultsForm['mg'] || '0') || 0;
    const k_val = parseFloat(resultsForm['k'] || '0') || 0;
    const al = parseFloat(resultsForm['al'] || '0') || 0;
    const hal = parseFloat(resultsForm['hal'] || '0') || 0;
    const argila = parseFloat(resultsForm['argila'] || '0') || 0;

    // SB = Ca + Mg + K
    const sb = ca + mg + k_val;
    // t (CTC efetiva) = SB + Al
    const ctc_t = sb + al;
    // T (CTC pH 7.0) = SB + (H+Al)
    const ctc_T = sb + hal;
    // V1% = (SB / T) * 100
    const v1 = ctc_T > 0 ? (sb / ctc_T) * 100 : 0;
    // m% = (Al / ctc_t) * 100
    const m_sat = ctc_t > 0 ? (al / ctc_t) * 100 : 0;

    // NC (t/ha) = (V2 - V1) * T / PRNT
    let nc = 0;
    if (v1 < targetCropV2 && ctc_T > 0 && prntValue > 0) {
      nc = ((targetCropV2 - v1) * ctc_T) / prntValue;
    }

    // NG (kg/ha) = 50 * Argila% ou 0.3 * CTC
    let ngKg = 0;
    if (argila > 0) {
      ngKg = 50 * argila;
    } else if (ctc_T > 0) {
      ngKg = 0.3 * ctc_T * 1000;
    }

    return {
      sb: Number(sb.toFixed(2)),
      ctc_t: Number(ctc_t.toFixed(2)),
      ctc_T: Number(ctc_T.toFixed(2)),
      v1: Number(v1.toFixed(1)),
      m_sat: Number(m_sat.toFixed(1)),
      nc: Number(Math.max(0, nc).toFixed(2)),
      ngTon: Number((ngKg / 1000).toFixed(2)),
      ngKg: Math.round(ngKg)
    };
  };

  const handleApplyCalculatedRecommendations = () => {
    const calc = calculateAgronomicParameters();
    const text = `[RECOMENDAÇÃO AGRONÔMICA AUTOMÁTICA]
• Soma de Bases (SB): ${calc.sb} cmolc/dm³ | CTC (T): ${calc.ctc_T} cmolc/dm³
• Saturação por Bases Atual (V₁): ${calc.v1}% | Saturação Alvo (V₂): ${targetCropV2}%
• Necessidade de Calagem (NC): ${calc.nc > 0 ? `${calc.nc} t/ha de calcário dolomítico (PRNT ${prntValue}%)` : 'Não necessária (V₁ adequado)'}
• Necessidade de Gessagem (NG): ${calc.ngKg > 0 ? `${calc.ngTon} t/ha (${calc.ngKg} kg/ha) de gesso agrícola para subsuperfície` : 'Opcional / Não prioritário'}`;

    setEditDetails(prev => ({
      ...prev,
      description: prev.description ? `${prev.description}\n\n${text}` : text
    }));
    toast.success('Parâmetros de calagem e gessagem inseridos no parecer!');
  };

  const handleAnalyzeSoil = async () => {
    if (!selectedAnalysis) return;
    
    // Check if we have any results filled
    const hasValues = Object.values(resultsForm).some(v => v && String(v).trim() !== '');
    if (!hasValues) {
      toast.error('Preencha os resultados da análise antes de gerar as sugestões de calagem e adubação.');
      return;
    }

    setIsAnalyzing(true);
    try {
      let token = '';
      try {
        const currentUser = auth.currentUser;
        if (currentUser) {
          token = await currentUser.getIdToken();
        } else {
          const cachedSession = localStorage.getItem('virtual_user_session');
          if (cachedSession) {
            const parsed = JSON.parse(cachedSession);
            token = '';
          }
        }
      } catch (e) {
        console.warn('Could not grab real ID token for soil analysis fetch, using bypass:', e);
      }

      const response = await fetch('/api/ai/analyze-soil', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          results: resultsForm,
          type: selectedAnalysis.type
        })
      });

      if (!response.ok) {
        throw new Error('Falha ao processar análise do solo com Inteligência Artificial.');
      }

      const data = await response.json();
      if (data.text) {
        setEditDetails(prev => ({
          ...prev,
          description: data.text
        }));
        toast.success('Parecer técnico com recomendação de calagem e adubação gerado com sucesso pelo Gemini!');
      } else {
        throw new Error('Sem resposta válida do assistente agronômico.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro inesperado ao gerar a análise.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (typeFilter) {
      setNewAnalysis(prev => ({ ...prev, type: typeFilter }));
    }
  }, [typeFilter]);

  useEffect(() => {
    if (user && !newAnalysis.responsibleTechnician) {
      setNewAnalysis(prev => ({ ...prev, responsibleTechnician: user.displayName || '' }));
    }
  }, [user]);

  useEffect(() => {
    const qA = query(collection(db, 'analyses'), orderBy('createdAt', 'desc'));
    const unsubscribeA = onSnapshot(qA, (snapshot) => {
      setAnalyses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceAnalysis)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'analyses');
    });

    const qC = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribeC = onSnapshot(qC, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });

    return () => { unsubscribeA(); unsubscribeC(); };
  }, []);

  useEffect(() => {
    if (selectedAnalysis) {
      setResultsForm(selectedAnalysis.results || {});
      setWaivedFields(selectedAnalysis.waivedFields || []);
      setEditDetails({
        responsibleTechnician: selectedAnalysis.responsibleTechnician || user?.displayName || '',
        description: selectedAnalysis.description || '',
        scheduledDate: selectedAnalysis.scheduledDate || '',
        value: selectedAnalysis.value || 0,
        cost: selectedAnalysis.cost || 0
      });
    }
  }, [selectedAnalysis, user]);

  const toggleWaiveField = (fieldId: string) => {
    setWaivedFields(prev => 
      prev.includes(fieldId) ? prev.filter(id => id !== fieldId) : [...prev, fieldId]
    );
  };

  const handleAddAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const docRef = await addDoc(collection(db, 'analyses'), {
        ...newAnalysis,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Usuário',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        assignedTo: user.uid,
        results: {},
        waivedFields: []
      });

      await logAudit({
        userId: user.uid,
        userName: user.displayName || user.email || 'Usuário',
        action: 'created',
        collection: 'analyses',
        recordId: docRef.id,
        recordName: `${(newAnalysis.type || '').toUpperCase()} - ${newAnalysis.clientName}`,
        details: `Criada nova análise de ${newAnalysis.type}`,
        newValues: newAnalysis
      });

      // Automatically integrate with Agenda by creating a notification.
      // Isolado do try principal: se essa notificação falhar, a análise já
      // foi salva — não pode aparecer como erro e fazer o técnico duplicar o cadastro.
      try {
        if (user) {
          await addDoc(collection(db, 'notifications'), {
            userId: user.uid,
            title: 'Nova Análise Agendada',
            message: `O serviço de ${(newAnalysis.type || '').toUpperCase()} para ${newAnalysis.clientName} foi integrado à agenda para o dia ${newAnalysis.scheduledDate.split('-').reverse().join('/')}.`,
            type: 'success',
            read: false,
            createdAt: new Date().toISOString(),
            link: 'scheduling'
          });
        }
      } catch (notifError) {
        console.warn('Falha ao criar notificação de agenda (análise já foi salva normalmente):', notifError);
      }

      setIsModalOpen(false);
      setNewAnalysis({
        clientId: '', clientName: '', propertyName: '',
        type: (typeFilter || 'soil') as AnalysisType, description: '',
        collectionDate: todayLocalDateString(), scheduledDate: todayLocalDateString(),
        responsibleTechnician: user?.displayName || '', status: 'Pendente', value: 0, cost: 0
      });
      toast.success(`Análise de ${newAnalysis.type === 'soil' ? 'Solo' : 'Água'} agendada com sucesso!`, {
        description: `Cliente: ${newAnalysis.clientName} | Data: ${newAnalysis.scheduledDate.split('-').reverse().join('/')}`,
        duration: 4000,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'analyses');
    }
  };

  const generateReport = (analysis: ServiceAnalysis) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFillColor(16, 185, 129); // emerald-600
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(getPdfBranding().companyName.toUpperCase(), 20, 25);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('Consultoria e Gestão Agrícola Integrada', 20, 32);

    // Report Info Header
    doc.setTextColor(30, 41, 59); // slate-800
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RELATÓRIO TÉCNICO DE ANÁLISE', 20, 55);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Protocolo: ${analysis.id.slice(0, 8).toUpperCase()}`, 20, 62);
    doc.text(`Data da Emissão: ${formatDate(new Date())}`, pageWidth - 20, 62, { align: 'right' });

    // Client and Tech Info
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.line(20, 68, pageWidth - 20, 68);
    
    doc.setFont('helvetica', 'bold');
    doc.text('CLIENTE:', 20, 78);
    doc.setFont('helvetica', 'normal');
    doc.text(analysis.clientName, 45, 78);

    doc.setFont('helvetica', 'bold');
    doc.text('TÉCNICO:', 20, 84);
    doc.setFont('helvetica', 'normal');
    doc.text(analysis.responsibleTechnician || 'N/A', 45, 84);

    doc.setFont('helvetica', 'bold');
    doc.text('COLETA:', 20, 90);
    doc.setFont('helvetica', 'normal');
    doc.text(analysis.collectionDate ? analysis.collectionDate.split('-').reverse().join('/') : 'N/A', 45, 90);

    doc.setFont('helvetica', 'bold');
    doc.text('TIPO:', 20, 96);
    doc.setFont('helvetica', 'normal');
    doc.text((analysis.type || '').toUpperCase(), 45, 96);

    if (analysis.type === 'foliar') {
      doc.setFont('helvetica', 'bold');
      doc.text('CULTURA:', pageWidth - 100, 78);
      doc.setFont('helvetica', 'normal');
      doc.text(analysis.results?.['cultura'] || 'N/A', pageWidth - 70, 78);

      doc.setFont('helvetica', 'bold');
      doc.text('ESTÁDIO:', pageWidth - 100, 84);
      doc.setFont('helvetica', 'normal');
      doc.text(analysis.results?.['estadio_coleta'] || 'N/A', pageWidth - 70, 84);
    }

    // Results Table
    const tableElements = 
      ((analysis.type as string) === 'soil' || (analysis.type as string) === 'fertility') ? SOIL_ELEMENTS :
      analysis.type === 'water' ? WATER_ELEMENTS :
      analysis.type === 'foliar' ? FOLIAR_ELEMENTS : [];

    if (tableElements.length > 0) {
      const tableData = tableElements.map(el => [
        el.label,
        analysis.results?.[el.id] || (analysis.waivedFields?.includes(el.id) ? 'Dispensado' : '-'),
        el.unit
      ]);

      autoTable(doc, {
        startY: 105,
        head: [['Parâmetro', 'Resultado', 'Unidade']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
        styles: { fontSize: 9, cellPadding: 3 },
        margin: { left: 20, right: 20 }
      });
    }

    // Observations
    const finalY = (doc as any).lastAutoTable?.finalY || 105;
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVAÇÕES E PARECER TÉCNICO:', 20, finalY + 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    
    const splitText = doc.splitTextToSize(analysis.description || 'Nenhuma observação técnica adicional registrada.', pageWidth - 40);
    doc.text(splitText, 20, finalY + 22);

    // Footer & Signature
    const bottomY = doc.internal.pageSize.getHeight() - 30;
    
    doc.setDrawColor(200, 200, 200);
    doc.line(60, bottomY - 10, pageWidth - 60, bottomY - 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(analysis.responsibleTechnician || 'TÉCNICO RESPONSÁVEL', pageWidth / 2, bottomY - 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('CREA / Registro Profissional', pageWidth / 2, bottomY, { align: 'center' });

    doc.setTextColor(150, 150, 150);
    doc.text(`Emitido por ${getPdfBranding().companyName} em ${formatDateTime(new Date())}`, pageWidth / 2, bottomY + 15, { align: 'center' });

    doc.save(`Relatorio_${analysis.clientName.replace(/\s+/g, '_')}_${analysis.type}.pdf`);
  };

  const handleSaveResults = async () => {
    if (!selectedAnalysis) return;

    // Check if all non-waived elements/fields are filled for auto-conclude
    let elementsFilled = true;
    const elementsToValidate = 
      (selectedAnalysis.type === 'soil' || selectedAnalysis.type === 'fertility') ? SOIL_ELEMENTS :
      selectedAnalysis.type === 'water' ? WATER_ELEMENTS :
      selectedAnalysis.type === 'foliar' ? FOLIAR_ELEMENTS : 
      null;

    if (elementsToValidate) {
      elementsFilled = elementsToValidate.every(el => 
        waivedFields.includes(el.id) || (resultsForm[el.id] != null && String(resultsForm[el.id]).trim() !== '')
      );
    } else {
      // For general types like Documentation, Credit, etc., check description
      elementsFilled = (editDetails.description || '').trim().length > 10;
    }

    const technicianFilled = (editDetails.responsibleTechnician || '').trim().length > 3;
    const isReadyToConclude = elementsFilled && technicianFilled;

    const isConsultant = (user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff';
    const updatedData = {
      results: resultsForm,
      waivedFields,
      responsibleTechnician: isConsultant ? (selectedAnalysis.responsibleTechnician || '') : editDetails.responsibleTechnician,
      description: editDetails.description,
      scheduledDate: isConsultant ? (selectedAnalysis.scheduledDate || '') : editDetails.scheduledDate,
      value: isConsultant ? Number(selectedAnalysis.value || 0) : Number(editDetails.value),
      cost: isConsultant ? Number(selectedAnalysis.cost || 0) : Number(editDetails.cost),
      status: isReadyToConclude ? 'Concluído' : 'Em Andamento',
      updatedAt: serverTimestamp()
    };

    try {
      const previousValues = {
        results: selectedAnalysis.results || {},
        status: selectedAnalysis.status,
        responsibleTechnician: selectedAnalysis.responsibleTechnician,
        description: selectedAnalysis.description,
        value: selectedAnalysis.value,
        cost: selectedAnalysis.cost
      };

      await updateDoc(doc(db, 'analyses', selectedAnalysis.id), updatedData);
      
      await logAudit({
        userId: user?.uid || 'anonymous',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'updated',
        collection: 'analyses',
        recordId: selectedAnalysis.id,
        recordName: `${(selectedAnalysis.type || '').toUpperCase()} - ${selectedAnalysis.clientName}`,
        details: 'Resultados e parecer da análise técnica atualizados',
        previousValues,
        newValues: updatedData
      });

      // Criar lançamento financeiro se for concluído agora
      if (isReadyToConclude && selectedAnalysis.status !== 'Concluído') {
        const financialRecord = {
          clientId: selectedAnalysis.clientId,
          clientName: selectedAnalysis.clientName || 'Cliente',
          category: 'analysis',
          description: `Análise concluída: ${selectedAnalysis.type} - ID: ${selectedAnalysis.id}`,
          value: Number(editDetails.value) || 0,
          dueDate: new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0], // 7 dias pra pagar
          paymentDate: null,
          paymentMethod: null,
          status: 'pending',
          notes: 'Gerado automaticamente via Análise Técnica',
          linkedServiceId: selectedAnalysis.id,
          createdBy: user?.uid || 'system',
          createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, 'financials'), financialRecord);
        toast.success(`Análise de ${selectedAnalysis.type === 'soil' ? 'Solo' : 'Água'} concluída com sucesso!`, {
          description: `Lançamento financeiro de R$ ${Number(editDetails.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} gerado para ${selectedAnalysis.clientName || 'Cliente'}.`,
          duration: 5000,
        });
      } else {
        toast.success(`Análise de ${selectedAnalysis.type === 'soil' ? 'Solo' : 'Água'} atualizada!`, {
          description: `Alterações salvas com sucesso para ${selectedAnalysis.clientName || 'Cliente'}.`,
          duration: 4000,
        });
      }
      setSelectedAnalysis(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'analyses');
    }
  };

  const handleDeleteAnalysis = async (id: string) => {
    const itemToDelete = analyses.find(a => a.id === id);
    // Remove da tela imediatamente, sem esperar o listener do Firestore.
    setAnalyses(prev => prev.filter(a => a.id !== id));
    try {
      await deleteDoc(doc(db, 'analyses', id));

      // Remove também qualquer lançamento financeiro vinculado a este serviço,
      // pra não deixar cobrança órfã apontando pra uma análise que não existe mais.
      try {
        const linkedFinancials = await getDocs(query(collection(db, 'financials'), where('linkedServiceId', '==', id)));
        await Promise.all(linkedFinancials.docs.map(d => deleteDoc(doc(db, 'financials', d.id))));
      } catch (finErr) {
        console.warn('Erro ao remover lançamento financeiro vinculado à análise:', finErr);
      }

      if (itemToDelete) {
        await logAudit({
          userId: user?.uid || 'anonymous',
          userName: user?.displayName || user?.email || 'Usuário',
          action: 'deleted',
          collection: 'analyses',
          recordId: id,
          recordName: `${(itemToDelete.type || '').toUpperCase()} - ${itemToDelete.clientName}`,
          details: `Análise técnica excluída`,
          previousValues: itemToDelete
        });
      }

      toast.success('Serviço excluído com sucesso.');
      setIsDeleteModalOpen(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'analyses');
      // Reverte a remoção otimista se o servidor recusou.
      if (itemToDelete) {
        setAnalyses(prev => prev.some(a => a.id === itemToDelete.id) ? prev : [...prev, itemToDelete]);
      }
    }
  };

  const role = (user?.effectiveRole ?? user?.role) as UserRole;
  const canEdit = PERMISSIONS.canEdit(role);      // manager+
  const canDelete = PERMISSIONS.canDelete(role);  // admin only

  const openEditModal = (analysis: ServiceAnalysis) => {
    setSelectedAnalysis(analysis);
    setEditDetails({
      responsibleTechnician: analysis.responsibleTechnician || '',
      description: analysis.description || '',
      scheduledDate: analysis.scheduledDate || '',
      value: analysis.value || 0,
      cost: analysis.cost || 0
    });
    setResultsForm(analysis.results || {});
    setWaivedFields(analysis.waivedFields || []);
  };

  const openAddResultModal = (analysis: ServiceAnalysis) => {
    setSelectedAnalysis(analysis);
    setEditDetails({
      responsibleTechnician: analysis.responsibleTechnician || '',
      description: analysis.description || '',
      scheduledDate: analysis.scheduledDate || '',
      value: analysis.value || 0,
      cost: analysis.cost || 0
    });
    setResultsForm(analysis.results || {});
    setWaivedFields(analysis.waivedFields || []);
  };

  const handleDelete = (id: string) => {
    setIsDeleteModalOpen(id);
  };

  const getIcon = (type: AnalysisType) => {
    switch (type) {
      case 'soil': return ClipboardCheck;
      case 'water': return Waves;
      case 'foliar': return Leaf;
      case 'topography': return Map;
      case 'irrigation': return Droplet;
      case 'documentation': return FileText;
      case 'credit': return Wallet;
      default: return ClipboardCheck;
    }
  };

  const getStatusColor = (status: string) => {
    const config = getStatusConfig(status);
    return `${config.color} ${config.bg}`;
  };

  const getTitle = () => {
    if (!typeFilter) return "Análises Técnicas";
    switch (typeFilter) {
      case 'soil': 
      case 'water': 
      case 'foliar': return "Análises Técnicas";
      case 'irrigation': return "Projetos de Irrigação";
      case 'environmental_xray': return "Raio-X de Propriedade";
      default: return "Serviços";
    }
  };

  const technicians = Array.from(new Set(analyses.map(a => a.responsibleTechnician).filter(Boolean)));

  const filteredAnalyses = (typeFilter 
    ? analyses.filter(a => a.type === typeFilter)
    : analyses.filter(a => !['credit', 'irrigation', 'topography', 'documentation'].includes(a.type))
  ).filter(a => {
      const matchesSearch = (a.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                           (a.responsibleTechnician || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (a.description || '').toLowerCase().includes(searchTerm.toLowerCase());
                           
      const matchesTech = technicianFilter === 'all' || a.responsibleTechnician === technicianFilter;
      const matchesType = selectedTypeFilter === 'all' || a.type === selectedTypeFilter;
      const matchesStatus = statusFilter === 'all' || (a.status || '').toLowerCase() === statusFilter.toLowerCase();
      
      return matchesSearch && matchesTech && matchesType && matchesStatus;
    });

  // ─── Mini painel (mesma ideia do da Perícia Judicial) ───
  // Conta sobre a lista da página (sem os filtros de busca), para mostrar a situação geral.
  const kpi = (() => {
    const base = typeFilter
      ? analyses.filter(a => a.type === typeFilter)
      : analyses.filter(a => !['credit', 'irrigation', 'topography', 'documentation'].includes(a.type));
    const isDone = (a: ServiceAnalysis) => (a.status || '').toLowerCase().startsWith('conclu');
    const isCancelled = (a: ServiceAnalysis) => (a.status || '').toLowerCase().startsWith('cancel');
    const toDate = (v: any): Date | null =>
      v?.toDate ? v.toDate() : typeof v?.seconds === 'number' ? new Date(v.seconds * 1000) : parseDateInput(v);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const open = base.filter(a => !isDone(a) && !isCancelled(a));
    const byType = (list: ServiceAnalysis[], t: string) => list.filter(a => a.type === t).length;
    const late = open.filter(a => { const d = parseDateInput(a.scheduledDate); return !!d && d < today; });
    const done = base.filter(isDone);
    const doneMonth = done.filter(a => { const d = toDate(a.updatedAt); return !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    const doneYear = done.filter(a => { const d = toDate(a.updatedAt); return !!d && d.getFullYear() === now.getFullYear(); });
    // Prazo médio do laudo: da coleta (ou agendamento) até a conclusão, últimos 90 dias
    const days = done.map(a => {
      const end = toDate(a.updatedAt);
      const start = parseDateInput(a.collectionDate) || parseDateInput(a.scheduledDate) || toDate(a.createdAt);
      if (!end || !start || now.getTime() - end.getTime() > 90 * 864e5) return null;
      return Math.max(0, (end.getTime() - start.getTime()) / 864e5);
    }).filter((d): d is number => d !== null);
    const avgDays = days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null;
    return {
      open: open.length,
      openDetail: `Solo ${byType(open, 'soil')} · Água ${byType(open, 'water')} · Foliar ${byType(open, 'foliar')}`,
      late: late.length,
      doneMonth: doneMonth.length,
      doneYear: doneYear.length,
      avgDays,
      avgBase: days.length,
    };
  })();

  const getButtonLabel = () => {
    if (!typeFilter) return "Novo Serviço";
    switch (typeFilter) {
      case 'soil': return "Nova Análise";
      case 'water': return "Nova Análise de Água";
      case 'foliar': return "Nova Análise Foliar";
      case 'irrigation': return "Novo Projeto";
      default: return "Novo Serviço";
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title={getTitle()} subtitle="Análises de solo, água e foliar, com laudos e resultados" />
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-48">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 glass-input pl-10 text-xs"
            />
          </div>
          {!typeFilter && (
            <select 
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="h-9 glass-input text-[10px] font-bold uppercase tracking-widest px-3 bg-white/50 border-white/60 min-w-[150px] cursor-pointer text-slate-800"
            >
              <option value="all">Serviço: Todos os Tipos</option>
              <option value="soil">Solo (Análise Solo)</option>
              <option value="water">Água (Análise Água)</option>
              <option value="foliar">Foliar (Foliar/Folha)</option>
            </select>
          )}
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 glass-input text-[10px] font-bold uppercase tracking-widest px-3 bg-white/50 border-white/60 min-w-[130px] cursor-pointer text-slate-800"
          >
            <option value="all">Status: Todos</option>
            <option value="Pendente">Status: Pendente</option>
            <option value="Em Andamento">Status: Em Processo</option>
            <option value="Concluído">Status: Concluído</option>
          </select>
          <select 
            value={technicianFilter}
            onChange={(e) => setTechnicianFilter(e.target.value)}
            className="h-9 glass-input text-[10px] font-bold uppercase tracking-widest px-3 bg-white/50 border-white/60 min-w-[140px] cursor-pointer text-slate-800"
          >
            <option value="all">Filtro: Técnicos</option>
            {technicians.map(tech => (
              <option key={tech} value={tech}>{tech}</option>
            ))}
          </select>
          <button 
            onClick={() => setShowEfficiencyReport(prev => !prev)}
            className={`px-3 py-2 h-9 rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm uppercase tracking-wider cursor-pointer ${
              showEfficiencyReport
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
            }`}
            title="Ver Relatório de Eficiência Agronômica (Solo x Produtividade)"
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            {showEfficiencyReport ? "Lista de Análises" : "Relatório de Eficiência"}
          </button>
          {!((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-600 text-white px-4 py-2 h-9 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 uppercase tracking-widest cursor-pointer"
            >
              <Plus className="w-4 h-4" /> {getButtonLabel()}
            </button>
          )}
        </div>
      </header>

      {/* MINI PAINEL DE ANÁLISES */}
      <ServiceKpiCards items={[
        { label: 'Análises em Aberto', value: kpi.open, hint: typeFilter ? 'Aguardando laudo/resultado' : kpi.openDetail, icon: FlaskConical, tone: 'emerald' },
        { label: 'Atrasadas', value: kpi.late, hint: 'Data agendada já passou', icon: AlertCircle, tone: kpi.late > 0 ? 'rose' : 'slate' },
        { label: 'Concluídas no Mês', value: kpi.doneMonth, hint: `${kpi.doneYear} no ano`, icon: CheckCircle2, tone: 'slate' },
        { label: 'Prazo Médio do Laudo', value: kpi.avgDays === null ? '—' : `${kpi.avgDays} ${kpi.avgDays === 1 ? 'dia' : 'dias'}`, hint: kpi.avgBase ? `Da coleta à conclusão (${kpi.avgBase} nos últimos 90 dias)` : 'Sem conclusões nos últimos 90 dias', icon: Clock, tone: 'amber' },
      ]} />
      {showEfficiencyReport ? (
        <EfficiencyReport analyses={analyses} clients={clients} />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pr-2 pb-6">
        {filteredAnalyses.map((analysis) => {
          const Icon = getIcon(analysis.type);
          return (
            <motion.div 
              layout
              key={analysis.id}
              className="glass-card p-5 group hover:border-emerald-300 transition-all flex flex-col gap-3"
            >
              <div className="flex justify-between items-start">
                <div className="p-3 bg-white/50 rounded-2xl border border-white/60 text-emerald-600 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getStatusColor(analysis.status))}>
                    {analysis.status}
                  </span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {analysis.status === 'Concluído' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        generateReport(analysis);
                      }}
                      className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                      title="Imprimir Relatório"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  )}
                  {canEdit && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(analysis);
                      }}
                      className="p-1.5 bg-slate-50 text-slate-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-1 text-[10px] font-bold"
                      title="Editar Análise"
                    >
                      <Edit3 size={14} /> Editar
                    </button>
                  )}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      openAddResultModal(analysis);
                    }}
                    className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-1 text-[10px] font-bold"
                    title="Adicionar Resultados"
                  >
                    <Plus size={14} /> Resultados
                  </button>
                  {canDelete && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(analysis.id);
                      }}
                      className="p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                      title="Excluir Serviço"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-tight">
                  {analysis.type === 'soil' ? 'Análise de Solo' : 
                   analysis.type === 'water' ? 'Análise de Água' :
                   analysis.type === 'foliar' ? 'Análise Foliar' :
                   analysis.type === 'irrigation' ? 'Irrigação' : 
                   analysis.type === 'credit' ? 'Crédito Rural' :
                   'Outros'}
                </h4>
                <div className="text-base font-display font-bold text-emerald-700 mt-1">{analysis.clientName}</div>
              </div>

                <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                  {analysis.propertyName ? `Propriedade: ${analysis.propertyName}` : (analysis.description || 'Sem observações')}
                </p>

              <div className="flex flex-wrap gap-2 mt-2">
                {analysis.collectionDate && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-500 uppercase">
                    Coleta: {analysis.collectionDate.split('-').reverse().join('/')}
                  </div>
                )}
                {analysis.scheduledDate && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 rounded text-[9px] font-bold text-slate-600 uppercase border border-slate-100">
                    Agendado: {analysis.scheduledDate.split('-').reverse().join('/')}
                  </div>
                )}
                {analysis.responsibleTechnician && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 rounded text-[9px] font-bold text-emerald-600 uppercase border border-emerald-100">
                    Técnico: {analysis.responsibleTechnician}
                  </div>
                )}
              </div>

              <div className="mt-auto pt-3 border-t border-white/20 flex justify-between items-center text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(analysis.createdAt)}
                </div>
                <div className="flex gap-2.5">
                  {analysis.status === 'Concluído' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        generateReport(analysis);
                      }}
                      className="text-emerald-700 font-bold hover:text-emerald-800 flex items-center gap-1 border border-emerald-200/60 bg-emerald-50/50 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                    >
                      <Printer className="w-3 h-3" />
                      Gerar Laudo
                    </button>
                  )}
                  <button 
                    onClick={() => setViewingAnalysis(analysis)}
                    className="text-emerald-600 font-bold hover:underline flex items-center gap-1"
                  >
                    Detalhes <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
        {filteredAnalyses.length === 0 && (
          <div className="col-span-1 md:col-span-2 xl:col-span-3 flex flex-col items-center justify-center p-12 bg-white/20 rounded-2xl border border-dashed border-slate-300 text-slate-500">
            <ClipboardCheck className="w-12 h-12 text-slate-300 mb-2.5 animate-pulse" />
            <p className="text-sm font-bold uppercase tracking-widest text-slate-600">Nenhum serviço encontrado</p>
            <p className="text-xs text-slate-400 mt-1">Experimente alterar os filtros de busca ou tipo acima.</p>
          </div>
        )}
      </div>
      )}

      {/* Analysis Viewing Drawer */}
      <AnimatePresence>
        {viewingAnalysis && (
          <div className="fixed inset-0 z-[100] flex items-center justify-end p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="glass-card w-full max-w-xl h-full p-0 flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="bg-emerald-600 p-8 text-white relative">
                <button 
                  onClick={() => setViewingAnalysis(null)}
                  className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
                    {React.createElement(getIcon(viewingAnalysis.type), { className: "w-8 h-8" })}
                  </div>
                  <div>
                    <h3 className="text-2xl font-display font-bold">Relatório de Análise</h3>
                    <p className="text-emerald-100 font-medium text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4" /> {viewingAnalysis.status}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Header Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Cliente</p>
                    <p className="text-sm font-bold text-slate-800">{viewingAnalysis.clientName}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Propriedade</p>
                    <p className="text-sm font-bold text-slate-800">{viewingAnalysis.propertyName || 'N/A'}</p>
                  </div>
                </div>

                {/* Results Table if Concluded or has results */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-emerald-600" /> Resultados da Amostra
                  </h4>
                  
                  {['soil', 'water', 'foliar', 'fertility'].includes(viewingAnalysis.type) ? (
                    <div className="space-y-4">
                      {viewingAnalysis.type === 'foliar' && (
                        <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-2 animate-fade-in">
                          <div>
                            <p className="text-[10px] font-black uppercase text-emerald-800 mb-0.5">Cultura</p>
                            <p className="text-sm font-bold text-emerald-950">{viewingAnalysis.results?.['cultura'] || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase text-emerald-800 mb-0.5">Estádio de Coleta</p>
                            <p className="text-sm font-bold text-emerald-950">{viewingAnalysis.results?.['estadio_coleta'] || '-'}</p>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                      {((viewingAnalysis.type === 'soil' || viewingAnalysis.type === 'fertility') ? SOIL_ELEMENTS : 
                        viewingAnalysis.type === 'water' ? WATER_ELEMENTS : FOLIAR_ELEMENTS).map(el => (
                        <div key={el.id} className="p-3 bg-white border border-slate-100 rounded-xl flex justify-between items-center shadow-sm">
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase">{el.label}</p>
                            <p className="text-xs font-bold text-slate-700">{viewingAnalysis.results?.[el.id] || '-'}</p>
                          </div>
                          <span className="text-[8px] font-black text-slate-300 uppercase">{el.unit}</span>
                        </div>
                      ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center italic text-slate-400 text-sm">
                      Detalhes técnicos disponíveis apenas no modo de edição.
                    </div>
                  )}
                </div>

                {/* Technical Notes */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600" /> Parecer Técnico
                  </h4>
                  <div className="p-4 bg-emerald-50/30 rounded-2xl border border-emerald-100/50 text-sm text-slate-600 leading-relaxed italic">
                    {viewingAnalysis.description || 'Nenhum parecer técnico registrado para esta análise.'}
                  </div>
                </div>

                {/* Dates and Staff */}
                <div className="grid grid-cols-2 gap-4 pt-4">
                   <div>
                     <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Técnico Responsável</p>
                     <p className="text-xs font-bold text-slate-700">{viewingAnalysis.responsibleTechnician || 'Não informado'}</p>
                   </div>
                   <div>
                     <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Data da Coleta</p>
                     <p className="text-xs font-bold text-slate-700">{viewingAnalysis.collectionDate ? viewingAnalysis.collectionDate.split('-').reverse().join('/') : '-'}</p>
                   </div>
                </div>
                {/* Audit Trail for Admin */}
                {(user?.effectiveRole ?? user?.role) === 'admin' && (
                  <div className="pt-4 border-t border-slate-100">
                    <AuditTrail collectionName="analyses" recordId={viewingAnalysis.id} />
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-3">
                {canEdit && (
                  <button 
                    onClick={() => {
                      openEditModal(viewingAnalysis);
                      setViewingAnalysis(null);
                    }}
                    className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 flex items-center justify-center gap-2 transition-all active:scale-95 hover:bg-slate-50"
                  >
                    <Edit3 className="w-4 h-4 text-slate-600" /> Editar Análise
                  </button>
                )}
                <button 
                  onClick={() => {
                    openAddResultModal(viewingAnalysis);
                    setViewingAnalysis(null);
                  }}
                  className="flex-1 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 hover:bg-emerald-100"
                >
                  <Plus className="w-4 h-4 text-emerald-600" /> Adicionar Resultados
                </button>
                {viewingAnalysis.status === 'Concluído' && (
                  <button 
                    onClick={() => generateReport(viewingAnalysis)}
                    className="py-3 px-4 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 transition-all active:scale-95"
                  >
                    <Download className="w-4 h-4" /> Laudo
                  </button>
                )}
                {canDelete && (
                  <button 
                    onClick={() => {
                      handleDelete(viewingAnalysis.id);
                      setViewingAnalysis(null);
                    }}
                    className="py-3 px-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 hover:bg-rose-100"
                  >
                    <Trash2 className="w-4 h-4" /> Excluir
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Analysis Details Modal */}
      <AnimatePresence>
        {selectedAnalysis && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-4xl p-8 shadow-2xl flex flex-col max-h-[90vh]"
            >
               <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-display font-bold">Gerenciar Resultados</h3>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <span className="text-xs text-slate-400 font-medium">{selectedAnalysis.clientName}</span>
                      <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                        {selectedAnalysis.type === 'soil' ? 'Solo' : 
                         selectedAnalysis.type === 'water' ? 'Água' :
                         selectedAnalysis.type === 'foliar' ? 'Foliar' : 
                         selectedAnalysis.type}
                      </span>
                      {selectedAnalysis.collectionDate && (
                         <>
                           <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                           <span className="text-[10px] font-bold text-slate-400 uppercase">Coleta: {selectedAnalysis.collectionDate.split('-').reverse().join('/')}</span>
                         </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedAnalysis.status === 'Concluído' && (
                      <button 
                        onClick={() => generateReport(selectedAnalysis)}
                        className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-emerald-600 hover:text-white transition-all uppercase tracking-widest mr-4"
                      >
                        <Printer className="w-4 h-4" /> Relatório PDF
                      </button>
                    )}
                    <button onClick={() => setSelectedAnalysis(null)} className="p-2 hover:bg-slate-100 rounded-full">
                       <X className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                  {['soil', 'water', 'foliar', 'fertility'].includes(selectedAnalysis.type) && (
                    <div className="space-y-6">
                      {selectedAnalysis.type === 'foliar' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 mb-4 animate-fade-in">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest block">Cultura</label>
                            <select
                              value={resultsForm['cultura'] || ''}
                              onChange={(e) => setResultsForm({ ...resultsForm, cultura: e.target.value })}
                              className="w-full glass-input bg-white/60 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            >
                              <option value="">Selecione a Cultura...</option>
                              <option value="Soja">Soja</option>
                              <option value="Milho">Milho</option>
                              <option value="Café">Café</option>
                              <option value="Algodão">Algodão</option>
                              <option value="Cana-de-açúcar">Cana-de-açúcar</option>
                              <option value="Citros">Citros</option>
                              <option value="Pastagem">Pastagem</option>
                              <option value="Outros">Outros</option>
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest block">Estádio de Coleta</label>
                            <select
                              value={resultsForm['estadio_coleta'] || ''}
                              onChange={(e) => setResultsForm({ ...resultsForm, estadio_coleta: e.target.value })}
                              className="w-full glass-input bg-white/60 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            >
                              <option value="">Selecione o Estádio...</option>
                              <option value="Vegetativo">Vegetativo</option>
                              <option value="Florescimento">Florescimento</option>
                              <option value="Frutificação">Frutificação</option>
                              <option value="Maturação">Maturação</option>
                              <option value="Outro">Outro</option>
                            </select>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {((selectedAnalysis.type === 'soil' || selectedAnalysis.type === 'fertility') ? SOIL_ELEMENTS : 
                          selectedAnalysis.type === 'water' ? WATER_ELEMENTS : FOLIAR_ELEMENTS).map(el => (
                            <div key={el.id} className={cn(
                              "p-4 rounded-2xl border transition-all flex flex-col gap-2",
                              waivedFields.includes(el.id) 
                                ? "bg-slate-100/50 grayscale border-slate-200" 
                                : "bg-white/40 border-white/60 focus-within:border-emerald-500/50"
                            )}>
                               <div className="flex justify-between items-center">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">{el.label}</label>
                                  <button 
                                    onClick={() => toggleWaiveField(el.id)}
                                    className={cn(
                                      "p-1 rounded-lg transition-colors",
                                      waivedFields.includes(el.id) ? "text-emerald-600 bg-emerald-50" : "text-slate-300 hover:text-amber-500"
                                    )}
                                    title={waivedFields.includes(el.id) ? "Reativar campo" : "Dispensar análise"}
                                  >
                                     <Ban className="w-3.5 h-3.5" />
                                  </button>
                               </div>
                               <div className="relative">
                                  <input 
                                    disabled={waivedFields.includes(el.id)}
                                    type="text" 
                                    value={resultsForm[el.id] || ''}
                                    onChange={(e) => setResultsForm({...resultsForm, [el.id]: e.target.value})}
                                    placeholder={waivedFields.includes(el.id) ? "Dispensado" : "0.00"}
                                    className="w-full glass-input pr-12 text-sm font-mono font-bold"
                                  />
                                  <span className="absolute right-3 top-2 text-[10px] font-bold text-slate-400">{el.unit}</span>
                               </div>
                            </div>
                        ))}
                      </div>

                      {/* Live Agronomic Liming & Gypsuming Calculator Engine for Soil Analyses */}
                      {(selectedAnalysis.type === 'soil' || selectedAnalysis.type === 'fertility') && (() => {
                        const calc = calculateAgronomicParameters();
                        return (
                          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 space-y-4 shadow-sm animate-fade-in">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/15 pb-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                                  <Sparkles className="w-4 h-4" />
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-300 uppercase tracking-wider">
                                    Cálculo Automático de Calagem (V%) e Gessagem
                                  </h4>
                                  <p className="text-[11px] text-slate-500">
                                    Método da Elevação da Saturação por Bases e Neutralização de Alumínio
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleApplyCalculatedRecommendations}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold uppercase transition-all shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
                              >
                                <span>Inserir no Parecer</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-emerald-500/10">
                                <span className="text-[10px] font-bold text-slate-400 uppercase block">Soma de Bases (SB)</span>
                                <span className="text-base font-mono font-bold text-slate-800 dark:text-slate-200">{calc.sb}</span>
                                <span className="text-[9px] text-slate-400 block">cmolc/dm³</span>
                              </div>

                              <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-emerald-500/10">
                                <span className="text-[10px] font-bold text-slate-400 uppercase block">CTC pH 7.0 (T)</span>
                                <span className="text-base font-mono font-bold text-slate-800 dark:text-slate-200">{calc.ctc_T}</span>
                                <span className="text-[9px] text-slate-400 block">cmolc/dm³</span>
                              </div>

                              <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-emerald-500/10">
                                <span className="text-[10px] font-bold text-slate-400 uppercase block">Saturação Atual (V₁)</span>
                                <span className={`text-base font-mono font-bold ${calc.v1 < 50 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  {calc.v1}%
                                </span>
                                <span className="text-[9px] text-slate-400 block">{calc.v1 < targetCropV2 ? 'Abaixo do alvo' : 'Adequado'}</span>
                              </div>

                              <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-emerald-500/10">
                                <span className="text-[10px] font-bold text-slate-400 uppercase block">Sat. Alumínio (m%)</span>
                                <span className={`text-base font-mono font-bold ${calc.m_sat > 15 ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>
                                  {calc.m_sat}%
                                </span>
                                <span className="text-[9px] text-slate-400 block">{calc.m_sat > 15 ? 'Tóxico (>15%)' : 'Baixo'}</span>
                              </div>
                            </div>

                            {/* Settings & Recommendation Outputs */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-500/10">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">Cultura / Saturação Alvo (V₂):</label>
                                  <select
                                    value={targetCropV2}
                                    onChange={(e) => setTargetCropV2(Number(e.target.value))}
                                    className="text-xs font-bold glass-input py-1 px-2.5 rounded-lg text-emerald-800"
                                  >
                                    <option value={70}>Soja / Milho / Trigo (V₂ = 70%)</option>
                                    <option value={60}>Café / Cana-de-açúcar (V₂ = 60%)</option>
                                    <option value={80}>Hortaliças / Citros (V₂ = 80%)</option>
                                    <option value={50}>Pastagens / Eucalipto (V₂ = 50%)</option>
                                  </select>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase">PRNT do Calcário (%):</label>
                                  <input
                                    type="number"
                                    value={prntValue}
                                    onChange={(e) => setPrntValue(Number(e.target.value) || 85)}
                                    className="text-xs font-bold glass-input py-1 px-2.5 w-20 text-center rounded-lg"
                                  />
                                </div>
                              </div>

                              <div className="p-3.5 bg-emerald-600 text-white rounded-xl space-y-1 shadow-xs">
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-[10px] uppercase font-bold text-emerald-100">Calagem Recomendada:</span>
                                  <span className="font-mono font-bold text-sm">{calc.nc > 0 ? `${calc.nc} t/ha` : '0 t/ha (V₁ ok)'}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-[10px] uppercase font-bold text-emerald-100">Gessagem Recomendada:</span>
                                  <span className="font-mono font-bold text-sm">{calc.ngKg > 0 ? `${calc.ngTon} t/ha (${calc.ngKg} kg/ha)` : '0 kg/ha'}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-white/20">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável Técnico</label>
                          <input 
                            type="text" 
                            disabled={(user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff'}
                            value={editDetails.responsibleTechnician}
                            onChange={(e) => setEditDetails({...editDetails, responsibleTechnician: e.target.value})}
                            placeholder="Nome do Técnico / CREA"
                            className={cn("w-full glass-input bg-white/50", ((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') && "opacity-60 cursor-not-allowed")}
                          />
                        </div>
                        <div className="space-y-1.5 flex flex-col gap-1.5">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observações da Análise</label>
                            <button
                              type="button"
                              onClick={handleAnalyzeSoil}
                              disabled={isAnalyzing}
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md self-start sm:self-auto",
                                isAnalyzing 
                                  ? "bg-emerald-50 text-emerald-600 animate-pulse cursor-wait"
                                  : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 cursor-pointer"
                              )}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {isAnalyzing ? "Analisando..." : "Sugerir com Gemini AI"}
                            </button>
                          </div>
                          <textarea 
                            rows={6}
                            value={editDetails.description}
                            onChange={(e) => setEditDetails({...editDetails, description: e.target.value})}
                            placeholder="Notas técnicas sobre esta amostra ou recomendações preliminares de calagem e adubação..."
                            className="w-full glass-input bg-white/50 min-h-[140px]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {!['soil', 'water', 'foliar'].includes(selectedAnalysis.type) && (
                    <div className="space-y-6">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável Técnico</label>
                            <input 
                              type="text" 
                              disabled={(user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff'}
                              value={editDetails.responsibleTechnician}
                              onChange={(e) => setEditDetails({...editDetails, responsibleTechnician: e.target.value})}
                              placeholder="Nome do Técnico / CREA"
                              className={cn("w-full glass-input bg-white/50", ((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') && "opacity-60 cursor-not-allowed")}
                            />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data Agendada</label>
                             <input 
                               type="date" 
                               disabled={(user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff'}
                               value={editDetails.scheduledDate}
                               onChange={(e) => setEditDetails({...editDetails, scheduledDate: e.target.value})}
                               className={cn("w-full glass-input bg-slate-50/50 border-slate-200", ((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') && "opacity-60 cursor-not-allowed")}
                             />
                          </div>
                       </div>
                       
                       <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Resumo / Observações Detalhadas</label>
                          <textarea 
                            rows={8}
                            value={editDetails.description}
                            onChange={(e) => setEditDetails({...editDetails, description: e.target.value})}
                            placeholder="Descreva aqui o parecer técnico, recomendações ou observações finais..."
                            className="w-full glass-input bg-white/50 min-h-[150px]"
                          />
                       </div>
                    </div>
                  )}
               </div>

               {!((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-white/20">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Valor do Projeto (R$)</label>
                      <input 
                        type="number" 
                        value={editDetails.value}
                        onChange={(e) => setEditDetails({...editDetails, value: Number(e.target.value)})}
                        className="w-full glass-input bg-emerald-50/30 border-emerald-200"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Custo Interno Estimado (R$)</label>
                      <input 
                        type="number" 
                        value={editDetails.cost}
                        onChange={(e) => setEditDetails({...editDetails, cost: Number(e.target.value)})}
                        className="w-full glass-input bg-rose-50/30 border-rose-200"
                      />
                    </div>
                 </div>
               )}

               <div className="pt-6 border-t border-white/20 flex gap-3 mt-6">
                  <button 
                    onClick={() => setSelectedAnalysis(null)}
                    className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => runExclusive('Analysis.handleSaveResults', () => handleSaveResults())}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Save className="w-5 h-5" /> Salvar Resultados
                  </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative glass-card w-full max-w-lg p-8 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <h3 className="text-xl font-display font-bold mb-6">
                Cadastrar Nova Análise
              </h3>
              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Analysis.handleAddAnalysis', () => handleAddAnalysis(e)); }} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Cliente / Propriedade</label>
                  <select 
                    required
                    value={newAnalysis.clientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                    className="w-full glass-input bg-white/50"
                  >
                    <option value="">Selecione um cliente...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {showPropertySelect && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Selecionar Propriedade</label>
                    <select 
                      required
                      value={newAnalysis.propertyName}
                      onChange={(e) => setNewAnalysis({...newAnalysis, propertyName: e.target.value})}
                      className="w-full glass-input bg-slate-50/30 border-slate-200"
                    >
                      <option value="">Escolha a propriedade...</option>
                      {availableProperties.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}

                {newAnalysis.propertyName && !showPropertySelect && (
                  <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LandPlot className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold text-emerald-700">{newAnalysis.propertyName}</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase">Auto-selecionado</span>
                  </div>
                )}

                <div className="space-y-1.5">
                   <label className="text-xs font-bold text-slate-500 uppercase">Tipo de Serviço</label>
                   <div className="grid grid-cols-2 gap-2">
                     {[
                       { id: 'soil', label: 'Análise de Solo', icon: ClipboardCheck },
                       { id: 'water', label: 'Análise de Água', icon: Waves },

                       { id: 'foliar', label: 'Foliar', icon: Leaf }
                     ].map(item => (
                       <button
                         key={item.id}
                         type="button"
                         onClick={() => setNewAnalysis({...newAnalysis, type: item.id as AnalysisType})}
                         className={cn(
                           "flex items-center gap-2 p-2 rounded-xl border text-[10px] font-bold uppercase transition-all",
                           newAnalysis.type === item.id 
                             ? "bg-emerald-100 text-emerald-700 border-emerald-500" 
                             : "bg-white/40 border-white/60 text-slate-500 hover:bg-white/60"
                         )}
                       >
                         <item.icon className="w-3.5 h-3.5" />
                         {item.label}
                       </button>
                     ))}
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Data da Coleta/Serviço</label>
                    <input 
                      type="date"
                      value={newAnalysis.collectionDate}
                      onChange={(e) => setNewAnalysis({...newAnalysis, collectionDate: e.target.value})}
                      className="w-full glass-input bg-white/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Agendamento de Execução</label>
                    <input 
                      type="date"
                      value={newAnalysis.scheduledDate}
                      onChange={(e) => setNewAnalysis({...newAnalysis, scheduledDate: e.target.value})}
                      className="w-full glass-input bg-slate-50/50 border-slate-200"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Responsável Técnico</label>
                  <input 
                    type="text"
                    readOnly
                    value={newAnalysis.responsibleTechnician}
                    className="w-full glass-input bg-slate-100 text-slate-500 cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Observações Iniciais</label>
                  <textarea 
                    rows={3}
                    value={newAnalysis.description}
                    onChange={(e) => setNewAnalysis({...newAnalysis, description: e.target.value})}
                    placeholder="Informações adicionais..." 
                    className="w-full glass-input bg-white/50"
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setNewAnalysis({
                        clientId: '', clientName: '', propertyName: '',
                        type: (typeFilter || 'soil') as AnalysisType, description: '',
                        collectionDate: todayLocalDateString(), scheduledDate: todayLocalDateString(),
                        responsibleTechnician: user?.displayName || '', status: 'Pendente', value: 0, cost: 0
                      });
                    }}
                    className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
                  >
                    Iniciar Serviço
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteAnalysis(isDeleteModalOpen)}
        title="Excluir Serviço?"
        description="Esta ação não pode ser desfeita. Todas as informações vinculadas a este serviço serão removidas permanentemente."
        confirmLabel="Excluir Agora"
      />
    </div>
  );
}
