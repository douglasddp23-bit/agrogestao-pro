import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Plus, 
  Search, 
  Download, 
  Edit, 
  Trash2, 
  Eye, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  ChevronRight, 
  Check, 
  X,
  ShieldAlert,
  Settings,
  ArrowRight,
  PenTool,
  History,
  Save,
  BarChart3,
  FileCheck,
  AlertCircle,
  CalendarClock,
  Smartphone,
  MessageSquare} from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { logAudit } from '../lib/audit';
import { toast } from 'sonner';
import { exportToExcel } from '../lib/exportExcel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import SkeletonList from '../components/SkeletonList';
import ConfirmationModal from '../components/ConfirmationModal';
import SignaturePad from '../components/SignaturePad';
import AuditTrail from '../components/AuditTrail';
import { formatDateTime, formatDate, todayLocalDateString, formatCurrency, parseDecimalBR, cn } from '../lib/utils';
import { Contract, ContractPayment, ContractAdendum, ContractRevision, Client, FinancialRecord, ContractTemplate, ContractTemplateVersion } from '../types';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { FilePen as PageIcon } from 'lucide-react';
import { getPdfBranding } from '../lib/pdfBranding';
import { useInitialSearch } from '../hooks/useInitialSearch';

const statusBadge: Record<string, { label: string; color: string }> = {
  active: { label: 'Ativo', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  draft: { label: 'Em Elaboração', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  pending_approval: { label: 'Pendente de Aprovação', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Aprovado (Pronto p/ Assinar)', color: 'bg-slate-100 text-slate-800 border-slate-250' },
  completed: { label: 'Concluído', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  cancelled: { label: 'Cancelado', color: 'bg-rose-100 text-rose-800 border-rose-200' },
  // Portuguese fallbacks for legacy records
  ativo: { label: 'Ativo', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  em_elaboracao: { label: 'Em Elaboração', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  concluido: { label: 'Concluído', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  suspenso: { label: 'Cancelado', color: 'bg-rose-100 text-rose-800 border-rose-200' },
  cancelado: { label: 'Cancelado', color: 'bg-rose-100 text-rose-800 border-rose-250' }
};

export const CONTRACT_TEMPLATES: Record<string, string> = {
  "Análises Agronômicas Avançadas": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE AGRONÔMICA

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: O presente contrato tem como objeto a prestação de serviços técnicos especializados de Análises Agronômicas Avançadas nas propriedades agrícolas do CONTRATANTE, com foco em amostragem, monitoramento de fertilidade de solo, nutrição foliar e acompanhamento fitossanitário preventivo.
2. PRAZO DE VIGÊNCIA: O contrato entra em vigor na data de {DATA_INICIO} e terá validade até {DATA_FIM}.
3. VALOR E CONDIÇÕES DE PAGAMENTO: Pelo objeto deste contrato, o CONTRATANTE pagará o valor consolidado de {VALOR}, estruturado em {PARCELAS} faturamentos sucessivos periódicos, com início imediato conforme cronograma físico-financeiro pactuado no app.
4. RESPONSABILIDADES: O CONTRATADO compromete-se a mobilizar consultores técnicos habilitados para as vistorias, gerando relatórios de campo detalhados a cada intervenção.`,

  "Projetos de Irrigação de Precisão": `CONTRATO DE ELABORAÇÃO DE PROJETO DE IRRIGAÇÃO DE PRECISÃO

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: O presente contrato tem por objeto a elaboração de projeto executivo de Irrigação de Precisão, englobando dimensionamento hidráulico, setorização, layout de tubulações, especificações de motobombas e aspersores/gotejadores, visando máxima eficiência de uso hídrico e energético.
2. PRAZO DE VIGÊNCIA: Vigência pactuada de {DATA_INICIO} a {DATA_FIM}.
3. VALOR DO INVESTIMENTO: O CONTRATANTE pagará o montante global de {VALOR}, dividido em {PARCELAS} parcelas indexadas, conforme evolução e entrega técnica descritas nas medições financeiras.
4. ENTREGA: O projeto finalizado será entregue em formatos digitais acompanhado de memorial descritivo completo e ART (Anotação de Responsabilidade Técnica) devidamente recolhida.`,

  "Regularização Ambiental de Imóveis": `CONTRATO DE CONSULTORIA PARA REGULARIZAÇÃO AMBIENTAL DE IMÓVEIS RURAIS

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: Prestação de serviços de consultoria ambiental destinados à regularização de imóvel rural junto aos órgãos ambientais competentes. O escopo inclui a retificação/elaboração do CAR (Cadastro Ambiental Rural), análise de passivos de Reserva Legal (RL) e de Áreas de Preservação Permanente (APP), além de orientação para adesão ao PRA (Programa de Regularização Ambiental).
2. PERÍODO OPERACIONAL: Atividades previstas para início em {DATA_INICIO} e conclusão das fases técnicas preliminares em {DATA_FIM}.
3. REMUNERAÇÃO: Honorários profissionais globais ajustados em {VALOR}, divididos em {PARCELAS} etapas de faturamento conforme cronograma.
4. COMPROMISSOS: O CONTRATANTE obriga-se a disponibilizar toda a documentação fundiária, certidões e mapas necessários para o andamento célere dos processos nos órgãos públicos.`,

  "Elaboração Consultoria Crédito Rural": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS PARA ELABORAÇÃO DE CRÉDITO RURAL

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: O objeto deste instrumento é a consultoria, planejamento e elaboração de projeto técnico-econômico-financeiro para obtenção de Crédito Rural (custeio agrícola ou investimento) perante instituições financeiras integrantes do Sistema Nacional de Crédito Rural (SNCR).
2. VIGÊNCIA E MARCOS: Período de vigência de {DATA_INICIO} a {DATA_FIM}, contemplando a elaboração, protocolo e acompanhamento do pleito até a liberação dos recursos.
3. PREÇO DOS SERVIÇOS: Valor global de {VALOR}, estruturado em {PARCELAS} parcelas de acompanhamento.
4. COMISSÕES: Fica acordado que as custas administrativas de cartórios, vistorias de instituições de crédito e taxas de seguros obrigatórios correrão integralmente sob responsabilidade do CONTRATANTE.`,

  "Levantamentos e Modelagem de Topografia": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE LEVANTAMENTO TOPOGRÁFICO E MODELAGEM

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: Execução de serviços de Levantamento Topográfico Planialtimétrico Cadastral, com geração de curvas de nível, modelagem digital do terreno (MDT) em 3D, demarcação física de talhões e delimitação precisa das divisas das glebas agrícolas indicadas pelo CONTRATANTE.
2. PRAZO DE EXECUÇÃO: Vigência de {DATA_INICIO} com finalização de entregas físicas planejada para {DATA_FIM}.
3. VALOR DO CONTRATO: Pelo trabalho de campo e modelagem em escritório, pactua-se {VALOR}, faturados em {PARCELAS} parcelas mensais.
4. EQUIPAMENTOS E ACESSO: O CONTRATADO utilizará equipamentos georreferenciados (RTK, Drones) de alta precisão, responsabilizando-se pelo credenciamento técnico correspondente.`,

  "Assistência Técnica e Extensão Rural": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSISTÊNCIA TÉCNICA E EXTENSÃO RURAL

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: Prestação de assistência técnica agronômica às atividades produtivas do CONTRATANTE, com visitas técnicas periódicas, recomendações de manejo e relatórios de acompanhamento.
2. PRAZO DE VIGÊNCIA: De {DATA_INICIO} a {DATA_FIM}.
3. VALOR E PAGAMENTO: O CONTRATANTE pagará {VALOR}, em {PARCELAS} parcela(s), conforme o cronograma deste contrato.
4. RESPONSABILIDADES: O CONTRATADO manterá profissional habilitado, com a devida anotação de responsabilidade técnica (ART/TRT), e registrará cada visita em relatório.`,

  "Perícia Judicial": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE PERÍCIA / ASSISTÊNCIA TÉCNICA JUDICIAL

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: Atuação técnica em processo judicial (perícia ou assistência técnica), incluindo vistoria, análise de documentos, elaboração de laudo ou parecer e resposta aos quesitos.
2. PRAZO DE VIGÊNCIA: De {DATA_INICIO} a {DATA_FIM}, ou até a entrega do laudo/parecer.
3. HONORÁRIOS: O CONTRATANTE pagará {VALOR}, em {PARCELAS} parcela(s).
4. INDEPENDÊNCIA TÉCNICA: O trabalho observará as normas técnicas aplicáveis e a legislação processual vigente.`,

  "Avaliação de Imóveis Rurais": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE AVALIAÇÃO DE IMÓVEL RURAL

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: Elaboração de laudo de avaliação de imóvel rural conforme a ABNT NBR 14.653-3, incluindo vistoria, pesquisa de mercado e tratamento dos dados.
2. PRAZO DE VIGÊNCIA: De {DATA_INICIO} a {DATA_FIM}.
3. VALOR E PAGAMENTO: O CONTRATANTE pagará {VALOR}, em {PARCELAS} parcela(s).
4. RESPONSABILIDADE TÉCNICA: O laudo será assinado por profissional habilitado, com a respectiva ART/TRT.`,

  "Outros Serviços Técnicos": `CONTRATO DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS

CONTRATADA: {EMPRESA}
CONTRATANTE: {PRODUTOR}
IDENTIFICAÇÃO DO INSTRUMENTO: {CONTRATO}

1. OBJETO DO CONTRATO: {OBJETO}.
2. PRAZO DE VIGÊNCIA: De {DATA_INICIO} a {DATA_FIM}.
3. VALOR E PAGAMENTO: O CONTRATANTE pagará {VALOR}, em {PARCELAS} parcela(s).`
};

// Nomes legíveis para tipos gravados como código em versões antigas
const CATEGORY_LABELS: Record<string, string> = {
  assistencia_tecnica: 'Assistência Técnica', analise: 'Análises Agronômicas', irrigacao: 'Projeto de Irrigação',
  topografia: 'Topografia', regularizacao: 'Regularização Ambiental', credito: 'Crédito Rural',
  pericia: 'Perícia Judicial', avaliacao: 'Avaliação de Imóvel', outro: 'Outros Serviços',
};
export const categoryLabel = (c?: string) => (c ? CATEGORY_LABELS[c] || c : '—');

// Contratos antigos têm o nome do sistema gravado como empresa contratada
export const fixContractorName = (text: string, company: string) =>
  (text || '').replace(/AgroGestão Pro Consultoria Agr[íi]cola Ltda\.?/g, company).replace(/\{EMPRESA\}/g, company);

interface DiffLine {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

function computeLineDiff(original: string, modified: string): DiffLine[] {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  
  const m = originalLines.length;
  const n = modifiedLines.length;
  
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1].trim() === modifiedLines[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const diff: DiffLine[] = [];
  let i = m;
  let j = n;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1].trim() === modifiedLines[j - 1].trim()) {
      diff.push({ text: modifiedLines[j - 1], type: 'unchanged' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({ text: modifiedLines[j - 1], type: 'added' });
      j--;
    } else {
      diff.push({ text: originalLines[i - 1], type: 'removed' });
      i--;
    }
  }
  
  return diff.reverse();
}

export default function Contracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Main UI Tabs
  const [activeMainTab, setActiveMainTab] = useState<'dashboard' | 'contracts' | 'templates'>('dashboard');

  // Templates & Versioning States
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [selectedTemplateForHistory, setSelectedTemplateForHistory] = useState<ContractTemplate | null>(null);
  const [isNewVersionModalOpen, setIsNewVersionModalOpen] = useState(false);
  const [selectedTemplateVersion, setSelectedTemplateVersion] = useState('v1.0');

  // New version form states
  const [newVersionTag, setNewVersionTag] = useState('');
  const [newVersionAuthor, setNewVersionAuthor] = useState('');
  const [newVersionChangelog, setNewVersionChangelog] = useState('');
  const [newVersionText, setNewVersionText] = useState('');

  // Approval status state
  const [approvalNotes, setApprovalNotes] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Modals & Details
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  
  // Nested Details Tabs inside modal
  const [detailTab, setDetailTab] = useState<'geral' | 'cronograma' | 'clausulas' | 'revisoes' | 'assinatura'>('geral');
  const [isSigning, setIsSigning] = useState(false);

  // Adendum creation inside modal
  const [newAdendumText, setNewAdendumText] = useState('');
  const [newAdendumValue, setNewAdendumValue] = useState('');

  // Revisions & Text comparison states
  const [isEditingContractText, setIsEditingContractText] = useState(false);
  const [editedContractText, setEditedContractText] = useState('');
  const [editChangeReason, setEditChangeReason] = useState('');
  const [isSavingContractRevision, setIsSavingContractRevision] = useState(false);
  const [comparisonBaseRevisionId, setComparisonBaseRevisionId] = useState<string>('current');
  const [comparisonTargetRevisionId, setComparisonTargetRevisionId] = useState<string>('');

  // Contract Wizard Multi-Step Form Fields
  const [formStep, setFormStep] = useState(1);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formClientId, setFormClientId] = useState('');
  const [formContractNumber, setFormContractNumber] = useState('');
  const [formObject, setFormObject] = useState('Análises Agronômicas Avançadas');
  const [formStartDate, setFormStartDate] = useState(todayLocalDateString());
  const [formEndDate, setFormEndDate] = useState(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().substring(0, 10));
  const [formTotalValue, setFormTotalValue] = useState('');
  const [formInstallmentsCount, setFormInstallmentsCount] = useState(3);
  const [formNotes, setFormNotes] = useState('');
  const [formMainClause, setFormMainClause] = useState('O presente contrato tem como objeto a prestação de serviços de consultoria agronômica especializada, englobando análises de campo, recomendação técnica e faturamento periódico.');

  // AI draft generator variables
  const [aiCustomGuidelines, setAiCustomGuidelines] = useState('');
  const [isGeneratingMinuta, setIsGeneratingMinuta] = useState(false);
  const [aiMinutaError, setAiMinutaError] = useState('');

  const validateStep = (step: number) => {
    const errors: Record<string, string> = {};
    if (step === 1) {
      if (!formClientId) {
        errors.clientId = 'Selecione o Produtor / Cliente.';
      }
      if (!formContractNumber.trim()) {
        errors.contractNumber = 'O número do contrato é obrigatório.';
      }
    } else if (step === 2) {
      if (!formStartDate) {
        errors.startDate = 'Data de início é obrigatória.';
      }
      if (!formEndDate) {
        errors.endDate = 'Data de término é obrigatória.';
      } else if (formStartDate && new Date(formEndDate) < new Date(formStartDate)) {
        errors.endDate = 'A data de término não pode ser anterior à data de início.';
      }
      if (!formMainClause.trim()) {
        errors.mainClause = 'O parágrafo de cláusula principal é obrigatório.';
      }
    } else if (step === 3) {
      const valTotal = parseDecimalBR(formTotalValue);
      if (!formTotalValue || isNaN(valTotal) || valTotal <= 0) {
        errors.totalValue = 'Insira um valor contratual total válido (maior que zero).';
      }
      if (!formInstallmentsCount || formInstallmentsCount < 1 || formInstallmentsCount > 24) {
        errors.installmentsCount = 'O número de parcelas deve ser entre 1 e 24.';
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerateMinuta = async () => {
    if (!formClientId) {
      toast.error('Selecione o Produtor / Cliente no Passo 1 primeiro.');
      return;
    }

    setIsGeneratingMinuta(true);
    setAiMinutaError('');

    try {
      // Find selected client info
      const client = clients.find(c => c.id === formClientId);
      const clientName = client?.name || '';
      const clientCpf = client?.cpf || '';
      const clientPhone = client?.phone || '';
      const clientAddress = client?.address 
        ? `${client.address.street}, ${client.address.number} - ${client.address.city}/${client.address.state}`
        : '';

      const numericValue = formTotalValue ? parseDecimalBR(formTotalValue) : 0;

      // Get Firebase Auth token
      let token = '';
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

      const response = await fetch('/api/ai/generate-minuta', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clientName: clientName,
          clientCpf: clientCpf,
          clientPhone: clientPhone,
          clientAddress: clientAddress,
          value: numericValue,
          companyName: getPdfBranding().companyName,
          startDate: formStartDate,
          endDate: formEndDate,
          category: formObject,
          standardClauses: formMainClause,
          customGuidelines: aiCustomGuidelines
        })
      });

      if (!response.ok) {
        throw new Error('Falha no processador de IA do servidor ao gerar minuta.');
      }

      const resData = await response.json();
      if (resData && resData.text) {
        setFormMainClause(resData.text);
        toast.success('Minuta personalizada gerada com IA aplicada com sucesso!');
      } else {
        throw new Error('Formato de resposta inválido do servidor.');
      }
    } catch (err: any) {
      console.error(err);
      setAiMinutaError(err.message || 'Erro ao gerar minuta.');
      toast.error('Não foi possível gerar a minuta por IA. Tente novamente ou use o modelo padrão.');
    } finally {
      setIsGeneratingMinuta(false);
    }
  };

   const isManagement = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager';

  // --- Real-time Dashboard Analytics Calculations ---
  // 1. Pending approval contracts
  const pendingApprovalContracts = contracts.filter(c => c.status === 'pending_approval');
  const pendingApprovalCount = pendingApprovalContracts.length;

  // 2. Contracts expiring in the next 30 days
  const todayDate = new Date();
  const next30DaysDate = new Date();
  next30DaysDate.setDate(todayDate.getDate() + 30);

  const expiringContracts = contracts.filter(c => {
    if (!c.endDate) return false;
    // Skip cancelled or completed contracts
    if (
      c.status === 'cancelled' || 
      c.status === 'completed' || 
      c.status === 'cancelado' || 
      c.status === 'suspenso' || 
      c.status === 'concluido'
    ) return false;
    const end = new Date(c.endDate);
    return end >= todayDate && end <= next30DaysDate;
  });
  const expiringCount = expiringContracts.length;

  // 3. Total signed contracts
  // Assinado = assinatura eletrônica OU contrato já Ativo/Concluído (assinatura física lançada no sistema)
  const isSigned = (c: Contract) => !!c.signatureBase64 || !!c.signedAt || ['active', 'ativo', 'completed', 'concluido'].includes(c.status as string);
  const signedContracts = contracts.filter(isSigned);
  const signedCount = signedContracts.length;

  // 4. Financial metrics
  const activeContracts = contracts.filter(c => c.status === 'active' || c.status === 'ativo');
  const totalValueActive = activeContracts.reduce((sum, c) => sum + (c.totalValue || 0), 0);

  // 5. Monthly signed contracts data for the BarChart (recharts)
  const monthlyData = (() => {
    const monthsPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const now = new Date();
    const result: { monthKey: string; name: string; contratos: number; valor: number }[] = [];
    
    // Create list of last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({
        monthKey,
        name: `${monthsPt[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`,
        contratos: 0,
        valor: 0
      });
    }

    // Populate counts from Firestore
    contracts.forEach(c => {
      if (isSigned(c)) {
        // Data da assinatura; sem ela, o início da vigência (ou a criação)
        const dateStr = c.signedAt || c.startDate || c.createdAt || '';
        if (dateStr) {
          const yearMonth = dateStr.slice(0, 7); // "YYYY-MM"
          const found = result.find(m => m.monthKey === yearMonth);
          if (found) {
            found.contratos += 1;
            found.valor += Math.round((c.totalValue || 0) / 1000); // in thousands
          }
        }
      }
    });

    return result;
  })();

  // Fetch from Firebase
  useEffect(() => {
    const q = query(collection(db, 'contracts'), orderBy('createdAt', 'desc'));
    const unsubscribeContracts = onSnapshot(q, (snapshot) => {
      // Completa campos ausentes (rascunho antigo, contrato importado...): sem
      // isso, UM contrato sem valor/parcelas derrubava a tela inteira.
      setContracts(snapshot.docs.map(doc => {
        const d: any = doc.data();
        const installments = Array.isArray(d.installments)
          ? d.installments.map((i: any) => ({ ...i, value: Number(i?.value) || 0 }))
          : [];
        return {
          id: doc.id,
          ...d,
          clientName: d.clientName || 'Cliente não informado',
          contractNumber: d.contractNumber || 'S/N',
          category: d.category || 'outro',
          totalValue: Number(d.totalValue ?? d.value) || 0,
          installments,
          installmentsCount: d.installmentsCount ?? installments.length,
          adendums: Array.isArray(d.adendums) ? d.adendums : [],
        } as Contract;
      }));
      setLoading(false);
    }, (error) => {
      console.error(error);
      toast.error('Erro ao carregar contratos.');
      setLoading(false);
    });

    const unsubscribeClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    const unsubscribeTemplates = onSnapshot(collection(db, 'contract_templates'), async (snapshot) => {
      if (snapshot.empty) {
        try {
          const categories = Object.keys(CONTRACT_TEMPLATES);
          for (const cat of categories) {
            const tempPayload = {
              category: cat,
              activeVersion: 'v1.0',
              versions: [
                {
                  id: `v1.0-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  version: 'v1.0',
                  text: CONTRACT_TEMPLATES[cat],
                  authorName: 'AgroGestão Pro System',
                  changeLog: 'Versão de conformidade inicial do sistema.',
                  createdAt: new Date().toISOString()
                }
              ],
              updatedAt: new Date().toISOString()
            };
            await addDoc(collection(db, 'contract_templates'), tempPayload);
          }
        } catch (err) {
          console.error("Error seeding templates: ", err);
        }
      } else {
        setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ContractTemplate)));
      }
    });

    return () => {
      unsubscribeContracts();
      unsubscribeClients();
      unsubscribeTemplates();
    };
  }, []);

  // Reset signing state when contract or tab changes
  useEffect(() => {
    setIsSigning(false);
    if (selectedContract) {
      setApprovalNotes(selectedContract.approvalNotes || '');
    } else {
      setApprovalNotes('');
    }
  }, [selectedContract, detailTab]);

  // Synchronize contract text editor and comparison states on contract selection
  useEffect(() => {
    if (selectedContract) {
      const currentText = typeof selectedContract.clauses === 'string'
        ? selectedContract.clauses
        : Array.isArray(selectedContract.clauses)
          ? selectedContract.clauses.join('\n\n')
          : '';
      setEditedContractText(currentText);
      setIsEditingContractText(false);
      setEditChangeReason('');
      setComparisonBaseRevisionId('current');
      
      if (selectedContract.revisions && selectedContract.revisions.length > 0) {
        // Sort revisions in descending order (newest first) or set target to oldest
        setComparisonTargetRevisionId(selectedContract.revisions[0].id);
      } else {
        setComparisonTargetRevisionId('');
      }
    } else {
      setEditedContractText('');
      setComparisonTargetRevisionId('');
    }
  }, [selectedContract]);

  const handleViewContract = async (contract: Contract) => {
    setSelectedContract(contract);
    setDetailTab('geral');
    if (user) {
      await logAudit({
        recordId: contract.id,
        collection: 'contracts',
        userId: user.uid,
        userName: user.displayName || user.email || 'Usuário',
        action: 'read',
        recordName: `Contrato ${contract.contractNumber || 'S/N'} (${contract.clientName || 'Cliente'})`,
        details: `Visualizou os detalhes do contrato de prestação de serviços nº ${contract.contractNumber || 'S/N'}.`
      });
    }
  };

  // Wizard Contract code generation on opening
  useEffect(() => {
    if (isAddModalOpen && !formContractNumber) {
      // Número sequencial do ano (antes era aleatório de 3 dígitos: podia repetir e saía em outro padrão)
      const year = new Date().getFullYear();
      const re = new RegExp(`^CTR?-${year}-(\\d+)$`);
      const maxSeq = contracts.reduce((m, c) => { const x = (c.contractNumber || '').match(re); return x ? Math.max(m, Number(x[1])) : m; }, 0);
      setFormContractNumber(`CT-${year}-${String(maxSeq + 1).padStart(3, '0')}`);
    }
  }, [isAddModalOpen]);

  // Synchronize chosen template version on category changes
  useEffect(() => {
    const tDoc = templates.find(t => t.category === formObject);
    if (tDoc) {
      setSelectedTemplateVersion(tDoc.activeVersion);
    } else {
      setSelectedTemplateVersion('v1.0');
    }
  }, [formObject, templates, isAddModalOpen]);

  // Save new template version to Firestore
  const handleSaveNewTemplateVersion = async () => {
    if (!selectedTemplateForHistory) return;
    if (!newVersionTag.trim()) {
      toast.error('Informe a tag de versão (ex: v1.1).');
      return;
    }
    if (!newVersionAuthor.trim()) {
      toast.error('Informe o nome do autor da alteração.');
      return;
    }
    if (!newVersionChangelog.trim()) {
      toast.error('Informe a justificativa jurídica ou changelog.');
      return;
    }
    if (!newVersionText.trim()) {
      toast.error('O conteúdo do modelo não pode ser vazio.');
      return;
    }

    // Check if version tag already exists
    const exists = selectedTemplateForHistory.versions.some(v => (v.version || '').toLowerCase() === newVersionTag.trim().toLowerCase());
    if (exists) {
      toast.error(`A versão ${newVersionTag} já existe neste modelo de contrato.`);
      return;
    }

    try {
      const newVer: ContractTemplateVersion = {
        id: `${newVersionTag.trim()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        version: newVersionTag.trim(),
        text: newVersionText,
        authorName: newVersionAuthor.trim(),
        changeLog: newVersionChangelog.trim(),
        createdAt: new Date().toISOString()
      };

      const updatedVersions = [...selectedTemplateForHistory.versions, newVer];
      const docRef = doc(db, 'contract_templates', selectedTemplateForHistory.id);

      await updateDoc(docRef, {
        versions: updatedVersions,
        activeVersion: newVersionTag.trim(),
        updatedAt: new Date().toISOString()
      });

      // Update local state in case onSnapshot takes a moment
      setSelectedTemplateForHistory(prev => prev ? {
        ...prev,
        versions: updatedVersions,
        activeVersion: newVersionTag.trim(),
        updatedAt: new Date().toISOString()
      } : null);

      toast.success(`Nova versão ${newVersionTag} registrada e definida como Ativa!`);
      setIsNewVersionModalOpen(false);
      setNewVersionTag('');
      setNewVersionChangelog('');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar nova revisão de modelo.');
    }
  };

  // Handle Wizard Submit and auto-generate physical-financial milestones
  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
      toast.error('Por favor, verifique os campos obrigatórios nos passos correspondentes.');
      return;
    }
    const valTotal = parseDecimalBR(formTotalValue);
    if (isNaN(valTotal) || valTotal <= 0) {
      toast.error('Insira o valor contratual total válido.');
      return;
    }

    const client = clients.find(c => c.id === formClientId);
    if (!client) return;

    const normalizedNumber = formContractNumber.trim().toLowerCase();
    if (normalizedNumber && contracts.some(c => (c.contractNumber || '').trim().toLowerCase() === normalizedNumber)) {
      toast.error(`Já existe um contrato com o número ${formContractNumber}. Use outro número.`);
      return;
    }

    try {
      // 1. Calculate and auto-generate installments (parcelas)
      const calculatedPayments: ContractPayment[] = [];
      // Trabalha em centavos para a soma das parcelas fechar exatamente com o total
      // (ex.: 1000 em 3x = 333,33 + 333,33 + 333,34).
      const totalCents = Math.round(valTotal * 100);
      const baseCents = Math.floor(totalCents / formInstallmentsCount);
      // Lê a data como data local (new Date('YYYY-MM-DD') é UTC e voltava 1 dia no Brasil).
      const [startY, startM, startD] = formStartDate.split('-').map(Number);

      for (let i = 1; i <= formInstallmentsCount; i++) {
        // Mesmo dia nos meses seguintes; se o mês não tiver esse dia (ex.: 31/02), usa o último dia do mês.
        const monthIndex = startM - 1 + (i - 1);
        const lastDay = new Date(startY, monthIndex + 1, 0).getDate();
        const due = new Date(startY, monthIndex, Math.min(startD, lastDay));
        const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        const cents = i === formInstallmentsCount ? totalCents - baseCents * (formInstallmentsCount - 1) : baseCents;

        calculatedPayments.push({
          id: `PAR-${Date.now()}-${i}`,
          installmentNumber: i,
          dueDate,
          value: cents / 100,
          status: 'open'
        });
      }

      // 2. Build payload
      const contractId = doc(collection(db, 'contracts')).id;
      const contractPayload: Contract = {
        id: contractId,
        clientId: formClientId,
        clientName: client.name,
        contractNumber: formContractNumber,
        category: formObject,
        startDate: formStartDate,
        endDate: formEndDate,
        totalValue: valTotal,
        installmentsCount: formInstallmentsCount,
        status: 'pending_approval',
        installments: calculatedPayments,
        clauses: [formMainClause],
        adendums: [],
        notes: formNotes || '',
        createdBy: user?.uid || 'unknown',
        createdByRole: (user?.effectiveRole ?? user?.role) || 'staff',
        createdByName: user?.displayName || user?.email || 'Usuário',
        // Nome da empresa contratada (a página pública de assinatura não lê as configurações)
        contractorCompany: getPdfBranding().companyName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'contracts'), contractPayload);
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'created',
        collection: 'contracts',
        recordId: docRef.id,
        recordName: `Contrato ${formContractNumber}`,
        details: `Contrato criado para o cliente ${contractPayload.clientName} no valor de R$ ${contractPayload.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        newValues: contractPayload
      });

      toast.success(`Contrato ${formContractNumber} preenchido com sucesso e enviado para aprovação do gestor!`);
      setIsAddModalOpen(false);
      resetForm();
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao registrar o contrato.');
    }
  };

  const resetForm = () => {
    setFormClientId('');
    setFormContractNumber('');
    setFormObject('Análises Agronômicas Avançadas');
    setFormStartDate(todayLocalDateString());
    setFormTotalValue('');
    setFormInstallmentsCount(3);
    setFormNotes('');
    setFormStep(1);
    setFormErrors({});
  };

  const applyContractTemplate = (category: string, versionTag?: string) => {
    const tDoc = templates.find(t => t.category === category);
    let rawText = '';
    
    if (tDoc) {
      const targetTag = versionTag || selectedTemplateVersion || tDoc.activeVersion;
      const verObj = tDoc.versions.find(v => v.version === targetTag);
      if (verObj) {
        rawText = verObj.text;
      } else {
        const activeVerObj = tDoc.versions.find(v => v.version === tDoc.activeVersion);
        if (activeVerObj) rawText = activeVerObj.text;
      }
    }
    
    if (!rawText) {
      rawText = CONTRACT_TEMPLATES[category];
    }
    
    if (!rawText) return;

    const client = clients.find(c => c.id === formClientId);
    const produtorName = client ? client.name : '[Nome do Produtor]';
    const contractNum = formContractNumber || '[CTR-ANO-XXXX]';
    
    // Format total value
    const valTotal = parseDecimalBR(formTotalValue) || 0;
    const formattedVal = valTotal > 0 
      ? valTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '[Valor do Contrato]';

    const formattedStartDate = formStartDate ? formatDate(formStartDate) : '[Data de Início]';
    const formattedEndDate = formEndDate ? formatDate(formEndDate) : '[Data de Término]';

    const textFilled = rawText
      .replace(/{PRODUTOR}/g, produtorName)
      .replace(/{CONTRATO}/g, contractNum)
      .replace(/{VALOR}/g, formattedVal)
      .replace(/{DATA_INICIO}/g, formattedStartDate)
      .replace(/{DATA_FIM}/g, formattedEndDate)
      .replace(/{PARCELAS}/g, String(formInstallmentsCount))
      .replace(/{OBJETO}/g, category)
      .replace(/{EMPRESA}/g, getPdfBranding().companyName)
      .replace(/AgroGestão Pro Consultoria Agr[íi]cola Ltda\.?/g, getPdfBranding().companyName);

    setFormMainClause(textFilled);
    toast.success('Modelo de contrato preenchido e atualizado com dados reais do formulário!');
  };

  // Perform full-delete
  const handleDeleteContract = async (id: string) => {
    const targetContract = contracts.find(c => c.id === id);
    try {
      await deleteDoc(doc(db, 'contracts', id));
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'deleted',
        collection: 'contracts',
        recordId: id,
        recordName: targetContract ? `Contrato ${targetContract.contractNumber}` : `Contrato ${id}`,
        details: targetContract 
          ? `Contrato número ${targetContract.contractNumber} do cliente ${targetContract.clientName} no valor de R$ ${targetContract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} foi excluído permanentemente.`
          : `Contrato ID ${id} foi excluído permanentemente.`,
        previousValues: targetContract || undefined
      });

      toast.success('Contrato excluído permanentemente.');
      setIsDeleteModalOpen(null);
      if (selectedContract?.id === id) {
        setSelectedContract(null);
      }
    } catch (e) {
      console.error(e);
      toast.error('Ocorreu um erro.');
    }
  };

  // Marking an installment as Paid and automatically launching a transaction in Financials!
  const handlePayInstallment = async (contract: Contract, installmentId: string) => {
    if (!isManagement) {
      toast.error('Somente gestores autorizados podem registrar baixas financeiras.');
      return;
    }

    const updatedInstallments = contract.installments.map(inst => {
      if (inst.id === installmentId) {
        return { ...inst, status: 'paid' as const, paymentDate: todayLocalDateString() };
      }
      return inst;
    });

    const targetInstallment = contract.installments.find(i => i.id === installmentId);
    if (!targetInstallment) return;

    try {
      // 1. Update contract installment in database
      await updateDoc(doc(db, 'contracts', contract.id), {
        installments: updatedInstallments,
        updatedAt: new Date().toISOString()
      });

      // 2. Write auto ledger transaction in collection `'financials'`
      const financialPayload: Partial<FinancialRecord> = {
        clientId: contract.clientId,
        clientName: contract.clientName,
        category: 'contract',
        description: `Parcela ${targetInstallment.installmentNumber}/${contract.installmentsCount} do Contrato ${contract.contractNumber}`,
        value: targetInstallment.value,
        dueDate: targetInstallment.dueDate,
        paymentDate: todayLocalDateString(),
        paymentMethod: 'pix',
        status: 'paid',
        serviceId: contract.id,
        notes: `Baixa automática oriunda da tela de Contratos.`,
        createdBy: user?.uid || 'web-portal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'financials'), financialPayload);

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: `Baixa de pagamento registrada para a Parcela ${targetInstallment.installmentNumber}/${contract.installmentsCount} do Contrato ${contract.contractNumber} no valor de R$ ${targetInstallment.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        newValues: { installmentId, status: 'paid' }
      });

      toast.success(`Parcela ${targetInstallment.installmentNumber} baixada! Faturamento lançado nas Finanças.`);
      
      // Update local detailed active modal copy
      setSelectedContract(prev => prev ? { ...prev, installments: updatedInstallments } : null);
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao realizar baixa financeira da parcela.');
    }
  };

  // Generate Adendum / Addendums inside the contract
  const handleAddAdendum = async (contract: Contract) => {
    if (!newAdendumText.trim()) { toast.error('Descreva a cláusula do aditivo antes de anexar.'); return; }
    // Aceita 1.500,00 e desconto com sinal de menos (-500)
    const valueNum = parseDecimalBR(newAdendumValue) || 0;

    const newAdendum: ContractAdendum = {
      id: `ADD-${Date.now()}`,
      contractId: contract.id,
      title: `Aditivo Nº ${contract.adendums.length + 1}`,
      description: newAdendumText,
      valueAdjustment: valueNum,
      createdAt: new Date().toISOString()
    };

    const updatedAdendums = [...contract.adendums, newAdendum];
    const updatedTotalValue = contract.totalValue + valueNum;

    try {
      await updateDoc(doc(db, 'contracts', contract.id), {
        adendums: updatedAdendums,
        totalValue: updatedTotalValue,
        updatedAt: new Date().toISOString()
      });
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'updated',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: `Aditivo registrado: "${newAdendum.title}" (${newAdendum.description}). Reajuste de valor: R$ ${newAdendum.valueAdjustment.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        newValues: { adendums: updatedAdendums, totalValue: updatedTotalValue }
      });

      toast.success('Aditivo contratual registrado e valor total reajustado.');
      setNewAdendumText('');
      setNewAdendumValue('');
      
      // Update local modal state
      setSelectedContract(prev => prev ? { ...prev, adendums: updatedAdendums, totalValue: updatedTotalValue } : null);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao gravar aditivo.');
    }
  };

  // Change overall status
  const handleChangeContractStatus = async (contract: Contract, status: Contract['status']) => {
    try {
      await updateDoc(doc(db, 'contracts', contract.id), { status, updatedAt: new Date().toISOString() });
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: `Status do contrato alterado para ${status.toUpperCase()}.`,
        newValues: { status }
      });

      toast.success(`Status do contrato alterado para ${({ draft: 'Rascunho', pending_approval: 'Aguardando aprovação', approved: 'Aprovado', active: 'Ativo', completed: 'Concluído', cancelled: 'Cancelado' } as Record<string, string>)[status] || status}.`);
      setSelectedContract(prev => prev ? { ...prev, status } : null);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao alterar status.');
    }
  };

  // Approve or Reject a contract (Manager only)
  const handleApproveContract = async (contract: Contract, status: 'approved' | 'draft') => {
    const isCreatedByNonAdmin = contract.createdByRole !== 'admin';
    const isAdmin = (user?.effectiveRole ?? user?.role) === 'admin';
    if (isCreatedByNonAdmin && !isAdmin) {
      toast.error('Apenas administradores podem aprovar contratos criados por funcionários ou gerentes.');
      return;
    }

    try {
      const updatePayload: Partial<Contract> = {
        status,
        approvalNotes: approvalNotes.trim() || '',
        updatedAt: new Date().toISOString()
      };
      
      if (status === 'approved') {
        updatePayload.approvedBy = user?.displayName || user?.email || 'Gestor';
        updatePayload.approvedAt = new Date().toISOString();
      }

      await updateDoc(doc(db, 'contracts', contract.id), updatePayload);
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: status === 'approved' ? 'approved' : 'rejected',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: status === 'approved' 
          ? `Contrato aprovado pelo gestor ${updatePayload.approvedBy}.`
          : `Contrato recusado pelo gestor. Motivo: "${approvalNotes.trim()}".`,
        newValues: updatePayload
      });

      if (status === 'approved') {
        toast.success('Contrato Aprovado com sucesso! Pronto para receber assinatura digital.');
      } else {
        toast.warning('Contrato recusado e retornado para Rascunho para ajustes.');
      }
      
      setSelectedContract(prev => prev ? { ...prev, ...updatePayload } : null);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao registrar decisão de aprovação.');
    }
  };

  // Submit contract for manager approval
  const handleSendToApproval = async (contract: Contract) => {
    try {
      const updatePayload = {
        status: 'pending_approval' as const,
        updatedAt: new Date().toISOString()
      };
      await updateDoc(doc(db, 'contracts', contract.id), updatePayload);

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: 'Contrato enviado para aprovação do gestor.',
        newValues: updatePayload
      });

      toast.success('Contrato enviado com sucesso para aprovação do gestor!');
      setSelectedContract(prev => prev ? { ...prev, ...updatePayload } : null);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao enviar contrato para aprovação.');
    }
  };

  // One-click WhatsApp & SMS/Email reminder for installments
  const handleSendInstallmentReminder = (contract: Contract, inst: ContractPayment) => {
    const client = clients.find(c => c.id === contract.clientId);
    const phone = client?.phone?.replace(/\D/g, '') || '';
    const message = `Olá, ${contract.clientName}!\n\nLembramos que a parcela nº ${inst.installmentNumber} do Contrato *${contract.contractNumber}* (${categoryLabel(contract.category)}) no valor de *R$ ${inst.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* possui vencimento em *${formatDate(inst.dueDate)}*.\n\nQualquer dúvida ou envio de comprovante, estamos à disposição!\n*${contract.contractorCompany || getPdfBranding().companyName}*`;
    
    if (phone) {
      window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(message)}`, '_blank');
      toast.success('Lembrete de cobrança gerado via WhatsApp!');
    } else {
      navigator.clipboard.writeText(message);
      toast.info('Mensagem copiada para transferência (Cliente sem telefone cadastrado).');
    }
  };

  // One-click WhatsApp & SMS reminder for contract expiration / renewal
  const handleSendContractRenewalReminder = (contract: Contract) => {
    const client = clients.find(c => c.id === contract.clientId);
    const phone = client?.phone?.replace(/\D/g, '') || '';
    const message = `Olá, ${contract.clientName}!\n\nInformamos que a vigência do seu Contrato *${contract.contractNumber}* (${categoryLabel(contract.category)}) encerra em *${formatDate(contract.endDate)}*.\n\nGostaríamos de alinhar a renovação dos serviços técnicos agronômicos para a próxima safra.\n\nPodemos agendar uma conversa técnica?\n*${contract.contractorCompany || getPdfBranding().companyName}*`;
    
    if (phone) {
      window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(message)}`, '_blank');
      toast.success('Lembrete de renovação contratual gerado via WhatsApp!');
    } else {
      navigator.clipboard.writeText(message);
      toast.info('Mensagem de renovação copiada para a área de transferência.');
    }
  };

  // Save a new contract text revision with version control and auditing
  const handleSaveContractRevision = async (contract: Contract) => {
    if (!editedContractText.trim()) {
      toast.error('O texto do contrato não pode estar vazio.');
      return;
    }

    setIsSavingContractRevision(true);
    try {
      const currentRevisions = contract.revisions || [];
      const nextVersionNumber = currentRevisions.length + 1;
      
      // Capture the old text before editing to create a baseline if this is the first revision
      const textAtTimeOfEdit = typeof contract.clauses === 'string'
        ? contract.clauses
        : Array.isArray(contract.clauses)
          ? contract.clauses.join('\n\n')
          : '';

      const updatedRevisions: ContractRevision[] = [...currentRevisions];

      // If there are no revisions yet, save the previous state as revision 1 so we can compare it
      if (currentRevisions.length === 0) {
        updatedRevisions.push({
          id: `REV-${Date.now() - 10000}`,
          version: 1,
          text: textAtTimeOfEdit,
          editedBy: contract.createdBy || 'Sistema',
          editedAt: contract.createdAt || new Date().toISOString(),
          changeReason: 'Versão Inicial do Contrato'
        });
      }

      const nextRevNum = updatedRevisions.length + 1;

      const newRevision: ContractRevision = {
        id: `REV-${Date.now()}`,
        version: nextRevNum,
        text: editedContractText,
        editedBy: user?.displayName || user?.email || 'Usuário',
        editedAt: new Date().toISOString(),
        changeReason: editChangeReason.trim() || `Revisão #${nextRevNum} de texto do contrato`
      };

      updatedRevisions.push(newRevision);
      
      const updatePayload = {
        clauses: [editedContractText],
        revisions: updatedRevisions,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'contracts', contract.id), updatePayload);

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'updated',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: `Nova versão de cláusulas salva (Revisão #${nextRevNum}). Motivo: "${newRevision.changeReason}".`,
        newValues: { clauses: [editedContractText], changeReason: newRevision.changeReason }
      });

      toast.success(`Nova versão #${nextRevNum} salva com sucesso!`);
      setIsEditingContractText(false);
      setEditChangeReason('');
      
      setSelectedContract(prev => prev ? { ...prev, ...updatePayload } : null);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar nova revisão de texto.');
    } finally {
      setIsSavingContractRevision(false);
    }
  };

  // Generate beautiful Contract PDF (Simplified Client Services Agreement)
  const handleGenerateContractPDF = (contract: Contract) => {
    const doc = new jsPDF();

    // Primary layout banner
    doc.setFillColor(15, 23, 42); // slate 900
    doc.rect(0, 0, 210, 45, 'F');

    doc.setFillColor(16, 185, 129); // emerald accent
    doc.rect(0, 45, 210, 3, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('Helvetica', 'bold');
    doc.text(getPdfBranding().companyName, 15, 20);
    doc.setFontSize(10);
    doc.setFont('Helvetica', 'normal');
    doc.text('CONTRATO DE PRESTAÇÃO DE SERVIÇOS AGRONÔMICOS', 15, 32);
    doc.text(`NÚMERO DO CONTRATO: ${contract.contractNumber}`, 120, 32);

    // Body Qualified Parts
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(12);
    doc.setFont('Helvetica', 'bold');
    doc.text('CLÁUSULA 1 — QUALIFICAÇÃO DAS PARTES', 15, 65);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9.5);
    const qualText = `De um lado, o PRESTADOR: ${contract.contractorCompany || getPdfBranding().companyName}. De outro lado, o CONTRATANTE: Sr(a). ${contract.clientName}, qualificado no banco de dados e registros adicionais desta plataforma rural.`;
    const splitQual = doc.splitTextToSize(qualText, 180);
    doc.text(splitQual, 15, 71);

    // Purpose / Category
    doc.setFontSize(12);
    doc.setFont('Helvetica', 'bold');
    doc.text('CLÁUSULA 2 — OBJETO DE PRESTAÇÃO', 15, 95);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9.5);
    const objTitle = `Ref: ${contract.category}`;
    doc.text(objTitle, 15, 101);
    const clauseText = fixContractorName(contract.clauses?.[0] || '', contract.contractorCompany || getPdfBranding().companyName) || 'O presente contrato regula os serviços profissionais agronômicos gerais especificados no cronograma.';
    const splitClause = doc.splitTextToSize(clauseText, 180);
    doc.text(splitClause, 15, 107);

    // Values & installments
    doc.setFontSize(12);
    doc.setFont('Helvetica', 'bold');
    doc.text('CLÁUSULA 3 — VALOR CONTRATUAL E FATURAMENTO', 15, 130);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9.5);
    const valText = `O valor global estabelecido para a plena execução do serviço contratado é de R$ ${contract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, dividido em ${contract.installmentsCount} parcela(s) com datas fixadas de acordo com as especificações físicas.`;
    const splitVal = doc.splitTextToSize(valText, 180);
    doc.text(splitVal, 15, 136);

    // Payments Schedule Table
    const paymentsBody = contract.installments.map(inst => [
      `Parcela ${inst.installmentNumber}`,
      formatDate(inst.dueDate),
      `${formatCurrency(inst.value)}`,
      inst.status === 'paid' ? 'Pago' : 'Pendente'
    ]);

    autoTable(doc, {
      startY: 148,
      head: [['Número Parcela', 'Data Faturamento', 'Valor Parcela', 'Status de Cobrança']],
      body: paymentsBody,
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8.5 }
    });

    // Signatures block
    const lastY = (doc as any).lastAutoTable.finalY + 25;
    doc.setDrawColor(148, 163, 184);
    doc.line(30, lastY, 90, lastY);
    doc.line(120, lastY, 180, lastY);

    if (contract.signatureBase64) {
      try {
        doc.addImage(contract.signatureBase64, 'PNG', 130, lastY - 20, 40, 18);
      } catch (err) {
        console.error('Error adding signature to PDF:', err);
      }
    }

    doc.setFontSize(8);
    doc.text(`Representante ${contract.contractorCompany || getPdfBranding().companyName}`, 40, lastY + 5);
    doc.text(contract.signedByName || contract.clientName, 135, lastY + 5);
    doc.text('PRESTADOR', 52, lastY + 9);
    doc.text('CONTRATANTE', 145, lastY + 9);

    if (contract.signatureBase64 && contract.signedAt) {
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Assinado eletronicamente em ${formatDate(contract.signedAt)} às ${new Date(contract.signedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 120, lastY + 14);
      doc.setTextColor(30, 41, 59); // Reset color
    }

    doc.save(`Contrato_${contract.contractNumber}_${contract.clientName.replace(/\s+/g, '_')}.pdf`);
    toast.success('Contrato integral PDF assinado digitalmente!');
  };

  // Export contractual list
  const handleExportXLSX = () => {
    const formatted = contracts.map(c => ({
      Número: c.contractNumber,
      Cliente: c.clientName,
      Objeto: c.category,
      'Valor Contrato (R$)': c.totalValue,
      Vigência: `${formatDate(c.startDate)} a ${formatDate(c.endDate)}`,
      Status: (c.status || '').toUpperCase()
    }));
    exportToExcel(formatted, 'Contratos_AgroGestao');
    toast.success('Lista de contratos exportada.');
  };

  const handleExportPDF = () => {
    if (filteredContracts.length === 0) {
      toast.error('Nenhum contrato para exportar.');
      return;
    }
    const doc = new jsPDF();
    doc.setFillColor(15, 23, 42); // slate 900
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral de Contratos Agronômicos (${filteredContracts.length} registros)`, 15, 27);

    const rows = filteredContracts.map(c => {
      const currentNorm = c.status === 'ativo' ? 'Ativo' :
                          c.status === 'em_elaboracao' ? 'Em Elaboração' :
                          c.status === 'concluido' ? 'Concluído' :
                          c.status === 'cancelado' ? 'Cancelado' :
                          c.status === 'suspenso' ? 'Cancelado' :
                          c.status === 'active' ? 'Ativo' :
                          c.status === 'draft' ? 'Em Elaboração' :
                          c.status === 'completed' ? 'Concluído' :
                          c.status === 'cancelled' ? 'Cancelado' : c.status;

      return [
        c.contractNumber,
        c.clientName,
        c.category,
        `${formatDate(c.startDate)} a ${formatDate(c.endDate)}`,
        `R$ ${c.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        currentNorm
      ];
    });

    autoTable(doc, {
      startY: 45,
      head: [['Número', 'Cliente', 'Objeto de Prestação', 'Vigência Acordada', 'Valor Global', 'Status']],
      body: rows,
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8.5 }
    });

    doc.save("Relatorio_Contratos_AgroGestao.pdf");
    toast.success("PDF de contratos exportado com sucesso!");
  };

  // Filter Search
  const filteredContracts = contracts.filter(c => {
    const matchesSearch = (c.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (c.contractNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (c.category || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    // Support English filters matching both English and legacy Portuguese statuses
    let matchesStatus = statusFilter === '';
    if (!matchesStatus) {
      const currentNorm = c.status === 'ativo' ? 'active' :
                          c.status === 'em_elaboracao' ? 'draft' :
                          c.status === 'concluido' ? 'completed' :
                          c.status === 'cancelado' ? 'cancelled' :
                          c.status === 'suspenso' ? 'cancelled' : c.status;
      matchesStatus = currentNorm === statusFilter;
    }
    const matchesCategory = categoryFilter === '' || (c.category || '').toLowerCase().includes(categoryFilter.toLowerCase());

    return matchesSearch && matchesStatus && matchesCategory;
  });

  return (
    <div className="space-y-6">
      
      {/* Banner Header */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Contratos" subtitle="Vigências, parcelas e aditivos contratuais" />

        <div className="flex flex-wrap gap-2 w-full sm:w-auto p-0.5">
          <button
            onClick={handleExportXLSX}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-600" /> Exportar Planilha
          </button>
          
          <button
            onClick={handleExportPDF}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl cursor-pointer font-sans"
          >
            <FileText className="w-4 h-4 text-emerald-600" /> Exportar PDF (Visão Atual)
          </button>
          
          {isManagement && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold rounded-xl transition-all shadow-md shadow-emerald-100 active:scale-95"
            >
              <Plus className="w-5 h-5" /> Novo Contrato
            </button>
          )}
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-full max-w-sm sm:max-w-lg shadow-xs animate-fadeIn">
        <button
          onClick={() => setActiveMainTab('dashboard')}
          className={`flex-1 py-2 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeMainTab === 'dashboard'
              ? 'bg-white text-slate-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          📊 Dashboard & Métricas
        </button>
        <button
          onClick={() => setActiveMainTab('contracts')}
          className={`flex-1 py-2 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeMainTab === 'contracts'
              ? 'bg-white text-slate-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          📄 Contratos Emitidos
        </button>
        <button
          onClick={() => {
            setActiveMainTab('templates');
            if (templates.length > 0 && !selectedTemplateForHistory) {
              setSelectedTemplateForHistory(templates[0]);
              setNewVersionText(templates[0].versions.find(v => v.version === templates[0].activeVersion)?.text || '');
            }
          }}
          className={`flex-1 py-2 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeMainTab === 'templates'
              ? 'bg-white text-slate-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          ⚖️ Modelos e Histórico
        </button>
      </div>

      {activeMainTab === 'dashboard' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Dashboard Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Pending Approval */}
            <div 
              onClick={() => {
                setActiveMainTab('contracts');
                setStatusFilter('pending_approval');
              }}
              className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group flex items-center justify-between"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pendentes de Aprovação</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-display font-bold text-slate-800">{pendingApprovalCount}</span>
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">Gestão</span>
                </div>
                <span className="text-[10px] text-slate-500 group-hover:text-amber-600 transition-colors flex items-center gap-1">
                  Ver contratos pendentes <ChevronRight className="w-3 h-3" />
                </span>
              </div>
              <div className="p-3 bg-amber-50 rounded-2xl text-amber-600 group-hover:bg-amber-100 transition-all">
                <Clock className="w-6 h-6 animate-pulse" />
              </div>
            </div>

            {/* Card 2: Expiring in 30 Days */}
            <div 
              onClick={() => {
                setActiveMainTab('contracts');
                setStatusFilter('active');
              }}
              className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-rose-300 hover:shadow-md transition-all cursor-pointer group flex items-center justify-between"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Expirando (30 dias)</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-display font-bold text-slate-800">{expiringCount}</span>
                  {expiringCount > 0 && (
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md">Alerta</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 group-hover:text-rose-600 transition-colors flex items-center gap-1">
                  Ver contratos ativos <ChevronRight className="w-3 h-3" />
                </span>
              </div>
              <div className="p-3 bg-rose-50 rounded-2xl text-rose-600 group-hover:bg-rose-100 transition-all">
                <CalendarClock className="w-6 h-6" />
              </div>
            </div>

            {/* Card 3: Total Signed */}
            <div 
              onClick={() => {
                setActiveMainTab('contracts');
                setStatusFilter('active');
              }}
              className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group flex items-center justify-between"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Assinados (Histórico)</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-display font-bold text-slate-800">{signedCount}</span>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">Assinado</span>
                </div>
                <span className="text-[10px] text-slate-500 group-hover:text-emerald-600 transition-colors flex items-center gap-1">
                  Ver contratos ativos <ChevronRight className="w-3 h-3" />
                </span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600 group-hover:bg-emerald-100 transition-all">
                <FileCheck className="w-6 h-6" />
              </div>
            </div>

            {/* Card 4: Total Value Under Management */}
            <div 
              className="bg-white p-5 rounded-2xl border border-slate-200 flex items-center justify-between"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Valor sob Gestão (Ativos)</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-bold text-slate-500">R$</span>
                  <span className="text-xl sm:text-2xl font-display font-bold text-slate-800 font-sans">
                    {totalValueActive.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block font-medium">Soma de contratos vigentes</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl text-slate-600">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Chart Column (Bar Chart of Monthly Signed Contracts) */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[420px]">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-slate-600" /> Evolução de Contratos Assinados Mensalmente
                </h3>
                <p className="text-xs text-slate-400 mt-1">Análise do volume mensal de contratos formalizados e assinados digitalmente</p>
              </div>

              {/* Recharts Bar Chart */}
              <div className="h-72 w-full mt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={monthlyData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                    />
                    <YAxis 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl shadow-lg space-y-1 text-white">
                              <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                                {payload[0].payload.name}
                              </p>
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-white flex justify-between gap-4">
                                  <span>Contratos Assinados:</span>
                                  <span className="text-emerald-400">{payload[0].value}</span>
                                </p>
                                <p className="text-[10px] font-medium text-slate-300 flex justify-between gap-4">
                                  <span>Finanças Estimadas:</span>
                                  <span className="text-slate-300">R$ {payload[0].payload.valor}k</span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar 
                      dataKey="contratos" 
                      fill="#4f46e5" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={45}
                    >
                      {monthlyData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.contratos > 0 ? '#4f46e5' : '#cbd5e1'} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400">
                <span className="font-medium">Atualizado em tempo real</span>
                <span className="font-mono text-slate-300">AgroGestão Pro AI-Analytics</span>
              </div>
            </div>

            {/* Quick Actions & Urgent Alerts Column */}
            <div className="space-y-6">
              
              {/* Box 1: Urgent Approvals */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-500" /> Aguardando Gestor ({pendingApprovalCount})
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Contratos prontos para análise técnica e aprovação</p>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {pendingApprovalContracts.length > 0 ? (
                    pendingApprovalContracts.slice(0, 3).map(c => (
                      <div 
                        key={c.id}
                        className="p-3 rounded-xl border border-amber-100 bg-amber-50/20 hover:bg-amber-50/50 transition-all flex flex-col gap-1.5"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-[11px] font-bold text-slate-800 leading-tight block truncate max-w-[120px]">
                            {c.clientName}
                          </span>
                          <span className="text-[9px] font-mono text-slate-400">
                            #{c.contractNumber}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-500 font-medium truncate max-w-[130px]">{categoryLabel(c.category)}</span>
                          <button
                            onClick={() => {
                              setSelectedContract(c);
                              setDetailTab('geral');
                            }}
                            className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer"
                          >
                            Analisar
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center border-2 border-dashed border-slate-100 rounded-xl flex flex-col items-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 stroke-1 mb-2" />
                      <p className="text-[11px] font-bold text-slate-600">Nenhuma pendência</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Todos os contratos foram revisados e aprovados!</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Box 2: Expiry Alerts */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4 text-rose-500" /> Próximos do Fim ({expiringCount})
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Vigência terminando nos próximos 30 dias</p>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {expiringContracts.length > 0 ? (
                    expiringContracts.slice(0, 3).map(c => (
                      <div 
                        key={c.id}
                        className="p-3 rounded-xl border border-rose-100 bg-rose-50/20 hover:bg-rose-50/50 transition-all flex flex-col gap-1.5"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-[11px] font-bold text-slate-800 leading-tight block truncate max-w-[120px]">
                            {c.clientName}
                          </span>
                          <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1 py-0.5 rounded-md">
                            {c.endDate ? formatDate(c.endDate) : ''}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-500 font-medium truncate max-w-[130px]">{categoryLabel(c.category)}</span>
                          <button
                            onClick={() => {
                              setSelectedContract(c);
                              setDetailTab('geral');
                            }}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer"
                          >
                            Detalhes
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center border-2 border-dashed border-slate-100 rounded-xl flex flex-col items-center">
                      <CalendarClock className="w-8 h-8 text-slate-300 stroke-1 mb-2" />
                      <p className="text-[11px] font-bold text-slate-600">Sem expirações próximas</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Nenhum contrato ativo se encerra este mês.</p>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

      {activeMainTab === 'contracts' && (
        <>
          {/* Filters */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 space-y-1.5 w-full">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Buscar por Contrato/Cliente</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Pesquise por número do contrato, nome do produtor rural ou objeto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full glass-input pl-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 w-full md:w-auto md:min-w-[300px]">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Objeto</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full glass-input text-xs"
            >
              <option value="">Todos</option>
              <option value="Análise">Análise</option>
              <option value="Irrigação">Irrigação</option>
              <option value="Topografia">Topografia</option>
              <option value="Crédito">Crédito</option>
              <option value="Regularização">Regularização</option>
                  <option value="Assistência">Assistência Técnica</option>
                  <option value="Perícia">Perícia</option>
                  <option value="Avaliação">Avaliação</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full glass-input text-xs font-medium"
            >
              <option value="">Todos</option>
              <option value="pending_approval">Pendente de Aprovação</option>
              <option value="approved">Aprovado (Aguardando Assinatura)</option>
              <option value="active">Ativo</option>
              <option value="draft">Em Elaboração (Rascunho)</option>
              <option value="completed">Concluído</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contracts table list */}
      {loading ? (
        <SkeletonList variant="table" count={5} />
      ) : filteredContracts.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-600">Nenhum contrato cadastrado</h4>
          <p className="text-xs text-slate-400 mt-1">Gere contratos para dar conformidade fiscal e física à prestação de serviços rurais.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm relative z-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-3 py-3">Código</th>
                  <th className="px-3 py-3">Produtor / Cliente</th>
                  <th className="px-3 py-3">Objeto Técnica</th>
                  <th className="px-3 py-3">Vigência</th>
                  <th className="px-3 py-3 text-center">Parcelas</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3 text-right">Valor Global</th>
                  <th className="px-3 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredContracts.map((item) => {
                  const status = statusBadge[item.status] || statusBadge.em_elaboracao;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => handleViewContract(item)}>
                      <td className="px-3 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                        {item.contractNumber}
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-slate-800 block max-w-[180px] truncate" title={item.clientName}>{item.clientName}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-slate-700 block truncate max-w-[180px]" title={categoryLabel(item.category)}>{categoryLabel(item.category)}</span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 leading-tight">
                        <span className="block whitespace-nowrap">{formatDate(item.startDate) || '—'}</span><span className="block whitespace-nowrap">até {formatDate(item.endDate) || '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-slate-600 whitespace-nowrap">
                        {item.installmentsCount}x
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg uppercase tracking-wider ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-display font-bold text-slate-800 whitespace-nowrap">
                        R$ {item.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-center items-center gap-1">
                          <button
                            onClick={() => { setSelectedContract(item); setDetailTab('geral'); }}
                            className="p-1.5 text-slate-500 hover:text-slate-600 hover:bg-slate-50 rounded-lg"
                            title="Visualizar cronograma e termos"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          
                          <button
                            onClick={() => handleGenerateContractPDF(item)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg"
                            title="Emitir PDF de Contrato de Prestação"
                          >
                            <FileText className="w-4 h-4" />
                          </button>

                          {(user?.effectiveRole ?? user?.role) === 'admin' && (
                          <button
                            onClick={() => setIsDeleteModalOpen(item.id)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                            title="Excluir Contrato"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}

      {activeMainTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          {/* Left Column: Template List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-md font-display font-bold text-slate-800 flex items-center gap-2 mb-2">
                📂 Modelos de Contrato
              </h2>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Selecione um modelo padrão para visualizar as revisões, ler as cláusulas ativas ou adicionar novas versões jurídicas.
              </p>

              <div className="space-y-2">
                {templates.map(t => {
                  const isSelected = selectedTemplateForHistory?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTemplateForHistory(t);
                        setNewVersionText(t.versions.find(v => v.version === t.activeVersion)?.text || '');
                        setNewVersionTag('');
                        setNewVersionChangelog('');
                        setIsNewVersionModalOpen(false);
                      }}
                      className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'border-emerald-600 bg-slate-50/20 shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-xs font-bold text-slate-800">{t.category}</span>
                      <div className="flex items-center justify-between w-full">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          Versão Ativa: {t.activeVersion}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400">
                          {t.versions.length} revisão(ões)
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Center/Right Column: Revisions & Editor */}
          <div className="lg:col-span-2 space-y-6">
            {selectedTemplateForHistory ? (
              <div className="space-y-6 animate-fadeIn">
                
                {/* Revision History timeline card */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                        Histórico de Revisões - {selectedTemplateForHistory.category}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">Versões salvas e rastreabilidade jurídica do documento</p>
                    </div>
                    {isManagement && !isNewVersionModalOpen && (
                      <button
                        onClick={() => {
                          setIsNewVersionModalOpen(true);
                          const activeVer = selectedTemplateForHistory.activeVersion;
                          try {
                            const num = parseFloat(activeVer.replace('v', ''));
                            if (!isNaN(num)) {
                              setNewVersionTag(`v${(num + 0.1).toFixed(1)}`);
                            } else {
                              setNewVersionTag('v1.1');
                            }
                          } catch {
                            setNewVersionTag('v1.1');
                          }
                          setNewVersionAuthor(user?.displayName || '');
                          setNewVersionChangelog('');
                        }}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md shadow-emerald-100 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" /> Nova Revisão (v+)
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100">
                    {[...selectedTemplateForHistory.versions]
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((v) => {
                        const isActive = selectedTemplateForHistory.activeVersion === v.version;
                        return (
                          <div key={v.id} className="relative pl-8 group">
                            {/* Dot on timeline */}
                            <div className={`absolute left-3 top-1.5 w-3 h-3 rounded-full border-2 transition-all ${
                              isActive ? 'bg-emerald-500 border-emerald-500 ring-4 ring-emerald-50 scale-110' : 'bg-white border-slate-300'
                            }`} />
                            
                            <div className="p-4 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/30 hover:bg-slate-50/75 transition-all">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                                  }`}>
                                    {v.version} {isActive && '• Ativo'}
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-mono">
                                    {formatDateTime(v.createdAt)}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 font-bold uppercase">
                                  Autor: {v.authorName}
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-600 mt-2 italic font-medium bg-white p-2 rounded-lg border border-slate-100 leading-relaxed">
                                📝 Justificativa/Changelog: {v.changeLog}
                              </p>

                              <div className="mt-3">
                                <details className="group/details">
                                  <summary className="text-[10px] font-bold text-slate-600 uppercase tracking-wider cursor-pointer list-none flex items-center gap-1 hover:text-slate-700">
                                    <Eye className="w-3.5 h-3.5" /> Visualizar Texto da Cláusula
                                  </summary>
                                  <div className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] font-mono leading-relaxed whitespace-pre-wrap border border-slate-800 max-h-[250px] overflow-y-auto">
                                    {v.text}
                                  </div>
                                </details>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Inline form or Modal to create a new template revision */}
                {isNewVersionModalOpen && (
                  <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-md space-y-4 animate-slideIn">
                    <div className="flex justify-between items-center border-b pb-3 border-slate-100">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Adicionar Nova Revisão Técnica/Jurídica</h4>
                        <p className="text-[10px] text-slate-400">Gere um novo marco de versão do modelo para conformidade no AgroGestão Pro</p>
                      </div>
                      <button
                        onClick={() => setIsNewVersionModalOpen(false)}
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Tags de Versão (ex: v1.1, v2.0)</label>
                        <input
                          type="text"
                          value={newVersionTag}
                          onChange={(e) => setNewVersionTag(e.target.value)}
                          placeholder="v1.1"
                          className="w-full glass-input text-xs font-bold"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Autor da Alteração</label>
                        <input
                          type="text"
                          value={newVersionAuthor}
                          onChange={(e) => setNewVersionAuthor(e.target.value)}
                          placeholder="Nome do Consultor / Advogado"
                          className="w-full glass-input text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Histórico de Alterações / Justificativa Jurídica</label>
                      <input
                        type="text"
                        value={newVersionChangelog}
                        onChange={(e) => setNewVersionChangelog(e.target.value)}
                        placeholder="Ex: Atualizado termos de compromisso financeiro e adicionado multas contratuais conforme regras 2026."
                        className="w-full glass-input text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Cláusulas e Texto do Modelo</label>
                        <span className="text-[9px] text-slate-400 font-medium">Use tags: {"{PRODUTOR}"}, {"{CONTRATO}"}, {"{VALOR}"}, {"{DATA_INICIO}"}, {"{DATA_FIM}"}, {"{PARCELAS}"}</span>
                      </div>
                      <textarea
                        rows={10}
                        value={newVersionText}
                        onChange={(e) => setNewVersionText(e.target.value)}
                        className="w-full glass-input font-mono text-[10px] leading-relaxed p-3 bg-slate-50 border-slate-200"
                        placeholder="Texto completo do modelo..."
                      />
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-3 border-slate-100">
                      <button
                        type="button"
                        onClick={() => setIsNewVersionModalOpen(false)}
                        className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl font-bold text-xs uppercase cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => runExclusive('Contracts.handleSaveNewTemplateVersion', () => handleSaveNewTemplateVersion())}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase shadow-md shadow-emerald-100 cursor-pointer"
                      >
                        Salvar Nova Revisão Oficial
                      </button>
                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center">
                <Settings className="w-12 h-12 text-slate-300 stroke-1 mb-3 animate-spin-slow" />
                <h4 className="text-sm font-bold text-slate-600">Nenhum modelo selecionado</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Escolha uma das categorias à esquerda para ver a linha do tempo de alterações, auditorias e gerenciar suas revisões contratuais.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contract Detailed Viewer Modal WITH Inner Tabs */}
      <AnimatePresence>
        {selectedContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-3xl p-6 md:p-8 space-y-6 max-h-[90vh] overflow-y-auto relative text-slate-800"
            >
              <button onClick={() => setSelectedContract(null)} className="absolute top-6 right-6 p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                <X className="w-5 h-5" />
              </button>

              {/* Title Header */}
              <div>
                <span className="text-xs font-mono font-bold text-slate-400 block uppercase tracking-wider">Número: {selectedContract.contractNumber}</span>
                <h2 className="text-2xl font-display font-bold leading-none mt-1 text-slate-800">{selectedContract.clientName}</h2>
                <p className="text-xs text-slate-500 mt-1.5 font-medium">Objeto: {selectedContract.category}</p>
              </div>

              {/* Status Change tools — only for directors */}
              {isManagement && (
                <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400 ml-1 block">Alterar Status:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { key: 'draft', label: 'Rascunho' },
                      { key: 'pending_approval', label: 'Pendente de Aprovação' },
                      { key: 'approved', label: 'Aprovado' },
                      { key: 'active', label: 'Ativo' },
                      { key: 'completed', label: 'Concluído' },
                      { key: 'cancelled', label: 'Cancelado' }
                    ].map(st => (
                      <button
                        key={st.key}
                        onClick={() => handleChangeContractStatus(selectedContract, st.key as any)}
                        className={`px-3 py-1 rounded-xl text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                          selectedContract.status === st.key || 
                          (st.key === 'draft' && selectedContract.status === 'em_elaboracao') || 
                          (st.key === 'active' && selectedContract.status === 'ativo') || 
                          (st.key === 'completed' && selectedContract.status === 'concluido') || 
                          (st.key === 'cancelled' && (selectedContract.status === 'cancelado' || selectedContract.status === 'suspenso'))
                            ? 'bg-emerald-600 text-white shadow-xs' 
                            : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub Navigation controls within the Modal */}
              <div className="flex border-b border-slate-100 p-0.5 overflow-x-auto custom-scrollbar">
                {[
                  { id: 'geral', label: 'Dados Gerais' },
                  { id: 'cronograma', label: 'Cronograma' },
                  { id: 'clausulas', label: 'Cláusulas & Aditivos' },
                  { id: 'revisoes', label: 'Timeline de Revisões' },
                  { id: 'assinatura', label: 'Assinatura Digital' },
                  { id: 'auditoria', label: 'Auditoria & Logs' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id as any)}
                    className={`flex-1 min-w-[120px] text-center py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
                      detailTab === tab.id 
                        ? 'border-emerald-600 text-slate-750' 
                        : 'border-transparent text-slate-450 hover:text-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Modal Tabs Content Render view */}
              <div className="py-2">
                {detailTab === 'auditoria' && (
                  <div className="space-y-4 animate-fadeIn">
                    <AuditTrail collectionName="contracts" recordId={selectedContract.id} />
                  </div>
                )}
                
                {/* REGULAR TAB: Geral */}
                {detailTab === 'geral' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-150">
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Vigência Início</span>
                        <span className="text-xs font-bold text-slate-750 block mt-0.5">{formatDate(selectedContract.startDate)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Vigência Fim</span>
                        <span className="text-xs font-bold text-slate-750 block mt-0.5">{formatDate(selectedContract.endDate)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Parcelas Acordadas</span>
                        <span className="text-xs font-bold text-slate-750 block mt-0.5">{selectedContract.installmentsCount} Parcelas</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Investimento Global</span>
                        <span className="text-xs font-bold text-slate-800 block mt-0.5">R$ {selectedContract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase">Notas Administrativas</h4>
                      <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/50 p-4 border rounded-2xl italic">"{selectedContract.notes || 'Sem observações declaradas.'}"</p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Avisos e Notificações</span>
                      <button
                        onClick={() => runExclusive('Contracts.handleSendContractRenewalReminder', () => handleSendContractRenewalReminder(selectedContract))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold uppercase transition-all shadow-sm"
                        title="Enviar lembrete de renovação de contrato para o produtor"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Lembrete de Renovação (WhatsApp)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* REGULAR TAB: Cronograma Físico-Financeiro (With single-click checkout) */}
                {detailTab === 'cronograma' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                      <DollarSign className="w-5 h-5 text-slate-600 shrink-0" />
                      <p className="text-[11px] text-slate-800 leading-relaxed">
                        Dando baixa em uma parcela abaixo, o AgroGestão Pro gera automaticamente um lançamento comercial correspondente na aba <strong>Financeiro</strong> (Receita de Contrato).
                      </p>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {selectedContract.installments.map(inst => (
                        <div key={inst.id} className="p-3.5 border border-slate-200 rounded-2xl bg-white flex items-center justify-between gap-4">
                          <div className="flex h-8 items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-500">
                              {inst.installmentNumber}
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-slate-800">Faturamento Parcela {inst.installmentNumber}</h5>
                              <span className="text-[10px] font-mono text-slate-400">Vence em: {formatDate(inst.dueDate)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 text-xs mr-1">R$ {inst.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            
                            {inst.status === 'paid' ? (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 text-[9px] font-bold uppercase rounded-lg">Pago ✓</span>
                            ) : (
                              <>
                                <button
                                  onClick={() => runExclusive('Contracts.handleSendInstallmentReminder', () => handleSendInstallmentReminder(selectedContract, inst))}
                                  className="p-1.5 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-lg border border-slate-200 hover:border-emerald-200 transition-colors"
                                  title="Enviar Lembrete de Parcela via WhatsApp"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                                </button>
                                <button
                                  onClick={() => runExclusive('Contracts.handlePayInstallment', () => handlePayInstallment(selectedContract, inst.id))}
                                  className="px-3 py-1 hover:bg-emerald-600 hover:text-white transition-all text-emerald-700 bg-emerald-50 text-[10px] uppercase font-bold rounded-lg border border-emerald-150 active:scale-95"
                                >
                                  Dar Baixa / Recebido
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* REGULAR TAB: Clauses & Adendums */}
                {detailTab === 'clausulas' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase">Cláusula Principal de Escopo</h4>
                      <p className="text-xs text-slate-600 leading-relaxed max-h-32 overflow-y-auto border p-3 rounded-xl bg-slate-50">
                        {selectedContract.clauses?.[0]}
                      </p>
                    </div>

                    <div className="space-y-3 pt-3 border-t">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase">Aditivos Contratuais / Reajustes ({selectedContract.adendums?.length || 0})</h4>
                      
                      {selectedContract.adendums && selectedContract.adendums.length > 0 && (
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                          {selectedContract.adendums.map(ad => (
                            <div key={ad.id} className="p-3 border border-slate-150 rounded-xl bg-slate-50/50 flex justify-between gap-4 text-xs">
                              <div>
                                <span className="font-bold text-slate-700 block">{ad.title}</span>
                                <span className="text-slate-500 mt-0.5 block">{ad.description}</span>
                              </div>
                              <span className={cn("font-bold shrink-0 whitespace-nowrap", ad.valueAdjustment < 0 ? "text-rose-600" : "text-emerald-700")}>
                                {ad.valueAdjustment < 0 ? '− ' : '+ '}{formatCurrency(Math.abs(ad.valueAdjustment))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Tool to write new contract addendum (Consultant privilege) */}
                      {isManagement && (
                        <div className="p-4 border border-dashed rounded-2xl bg-slate-50/35 space-y-3">
                          <span className="text-[10px] font-bold text-slate-500 uppercase block">Novo Termo Aditivo Técnico</span>
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={newAdendumText}
                              onChange={(e) => setNewAdendumText(e.target.value)}
                              placeholder="Cláusula modificativa do aditivo..."
                              className="flex-1 glass-input text-xs"
                            />
                            <input 
                              type="text"
                              value={newAdendumValue}
                              onChange={(e) => setNewAdendumValue(e.target.value)}
                              placeholder="Reajuste R$ (ex.: 500 ou -500)"
                              className="w-28 glass-input text-xs"
                            />
                            <button
                              onClick={() => runExclusive('Contracts.handleAddAdendum', () => handleAddAdendum(selectedContract))}
                              className="px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl"
                            >
                              Anexar aditivo
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* REGULAR TAB: Timeline de Revisões de Texto */}
                {detailTab === 'revisoes' && (
                  <div className="space-y-6 animate-fadeIn text-left">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 border-slate-100">
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                          <History className="w-4 h-4 text-slate-650" />
                          Timeline de Revisões & Auditoria
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Compare o texto atual com versões anteriores ou faça novos ajustes controlados por versão.
                        </p>
                      </div>
                      
                      {!isEditingContractText && isManagement && (
                        <button
                          onClick={() => {
                            const currentText = typeof selectedContract.clauses === 'string'
                              ? selectedContract.clauses
                              : Array.isArray(selectedContract.clauses)
                                ? selectedContract.clauses.join('\n\n')
                                : '';
                            setEditedContractText(currentText);
                            setIsEditingContractText(true);
                            setEditChangeReason('');
                          }}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Nova Revisão de Texto
                        </button>
                      )}
                    </div>

                    {isEditingContractText ? (
                      /* EDITOR PARA NOVA VERSÃO */
                      <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 animate-slideIn">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                            <PenTool className="w-3.5 h-3.5 text-slate-600" />
                            Editor do Escopo do Contrato (Revisão #{(selectedContract.revisions?.length || 0) + (selectedContract.revisions?.length === 0 ? 2 : 1)})
                          </span>
                          <span className="text-[9px] bg-slate-100 text-slate-800 font-bold px-2 py-0.5 rounded-full uppercase">
                            Editor Humano / Assistente IA
                          </span>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Cláusulas e Condições de Escopo</label>
                          <textarea
                            rows={10}
                            value={editedContractText}
                            onChange={(e) => setEditedContractText(e.target.value)}
                            placeholder="Insira as cláusulas e escopos do contrato aqui..."
                            className="w-full p-4 border border-slate-200 rounded-2xl bg-white text-xs font-mono leading-relaxed focus:ring-emerald-500 focus:border-emerald-500 shadow-inner"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Motivo desta Alteração (Auditoria de Alterações)</label>
                          <input
                            type="text"
                            value={editChangeReason}
                            onChange={(e) => setEditChangeReason(e.target.value)}
                            placeholder="Ex: Ajuste de cláusula de pagamento de acordo com IA ou solicitação do cliente..."
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl bg-white text-xs"
                          />
                          <p className="text-[9px] text-slate-400 ml-1">Ficará registrado permanentemente no histórico de auditoria para o órgão regulador e gerentes.</p>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t">
                          <button
                            type="button"
                            onClick={() => setIsEditingContractText(false)}
                            className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-xs uppercase cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => runExclusive('Contracts.handleSaveContractRevision', () => handleSaveContractRevision(selectedContract))}
                            disabled={isSavingContractRevision || !editedContractText.trim()}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs uppercase rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md"
                          >
                            {isSavingContractRevision ? (
                              <>
                                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                                Salvando...
                              </>
                            ) : (
                              <>
                                <Save className="w-3.5 h-3.5" />
                                Salvar Revisão
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* TIMELINE E COMPARADOR VISUAL */
                      <div className="space-y-6">
                        
                        {/* Seletor de Comparação */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-750 uppercase block ml-1">Versão de Destino (Mais Recente/Base)</label>
                            <select
                              value={comparisonBaseRevisionId}
                              onChange={(e) => setComparisonBaseRevisionId(e.target.value)}
                              className="w-full text-xs py-2 px-3 bg-white border border-slate-150 rounded-xl font-medium text-slate-800 focus:outline-none"
                            >
                              <option value="current">Versão Ativa Atual</option>
                              {selectedContract.revisions && [...selectedContract.revisions].reverse().map(rev => (
                                <option key={rev.id} value={rev.id}>
                                  Revisão #{rev.version} ({new Date(rev.editedAt).toLocaleDateString('pt-BR')}) por {rev.editedBy}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-750 uppercase block ml-1">Versão de Origem (Para Comparar/Anterior)</label>
                            <select
                              value={comparisonTargetRevisionId}
                              onChange={(e) => setComparisonTargetRevisionId(e.target.value)}
                              className="w-full text-xs py-2 px-3 bg-white border border-slate-150 rounded-xl font-medium text-slate-800 focus:outline-none"
                            >
                              <option value="">-- Selecione para Comparar --</option>
                              {selectedContract.revisions && [...selectedContract.revisions].reverse().map(rev => (
                                <option key={rev.id} value={rev.id}>
                                  Revisão #{rev.version} ({new Date(rev.editedAt).toLocaleDateString('pt-BR')}) por {rev.editedBy}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Painel do Destaque de Diferenças */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              {comparisonTargetRevisionId 
                                ? 'Comparação Visual de Diferenças (Diff)' 
                                : 'Visualização do Texto Selecionado'}
                            </span>
                            {comparisonTargetRevisionId && (
                              <div className="flex items-center gap-3 text-[10px] font-bold uppercase">
                                <span className="flex items-center gap-1 text-rose-600">
                                  <span className="w-2 h-2 rounded-full bg-rose-500" /> Remoções
                                </span>
                                <span className="flex items-center gap-1 text-emerald-600">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Adições
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-950 p-4 max-h-96 overflow-y-auto font-mono text-[11px] leading-relaxed shadow-inner">
                            {(() => {
                              const getRevisionText = (revId: string) => {
                                if (revId === 'current') {
                                  return typeof selectedContract?.clauses === 'string'
                                    ? selectedContract.clauses
                                    : Array.isArray(selectedContract?.clauses)
                                      ? selectedContract.clauses.join('\n\n')
                                      : '';
                                }
                                const rev = selectedContract?.revisions?.find(r => r.id === revId);
                                return rev ? rev.text : '';
                              };

                              const baseText = getRevisionText(comparisonBaseRevisionId);
                              const targetText = comparisonTargetRevisionId ? getRevisionText(comparisonTargetRevisionId) : '';
                              
                              if (!baseText && !targetText) {
                                return (
                                  <p className="text-slate-500 text-center italic py-10">
                                    Nenhum texto disponível para esta versão.
                                  </p>
                                );
                              }

                              if (!comparisonTargetRevisionId) {
                                return (
                                  <pre className="whitespace-pre-wrap text-slate-300 font-mono text-xs text-left">
                                    {baseText}
                                  </pre>
                                );
                              }

                              const diffLines = computeLineDiff(targetText, baseText);
                              return (
                                <div className="space-y-0.5 text-left">
                                  {diffLines.map((line, idx) => {
                                    if (line.type === 'added') {
                                      return (
                                        <div key={idx} className="bg-emerald-950/85 text-emerald-300 border-l-4 border-emerald-500 px-3 py-1 font-mono rounded-r transition-colors hover:bg-emerald-900/60">
                                          <span className="text-emerald-500 select-none mr-3 font-bold">+</span>
                                          {line.text || ' '}
                                        </div>
                                      );
                                    } else if (line.type === 'removed') {
                                      return (
                                        <div key={idx} className="bg-rose-950/85 text-rose-300 border-l-4 border-rose-500 px-3 py-1 font-mono rounded-r line-through decoration-rose-450/70 transition-colors hover:bg-rose-900/60">
                                          <span className="text-rose-500 select-none mr-3 font-bold">-</span>
                                          {line.text || ' '}
                                        </div>
                                      );
                                    } else {
                                      return (
                                        <div key={idx} className="text-slate-400 border-l-4 border-transparent px-3 py-0.5 font-mono">
                                          <span className="text-slate-700 select-none mr-4"> </span>
                                          {line.text || ' '}
                                        </div>
                                      );
                                    }
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Linha do Tempo de Revisões Detalhada */}
                        <div className="space-y-3 pt-4 border-t border-slate-100">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Histórico Cronológico de Alterações</h4>
                          
                          {(!selectedContract.revisions || selectedContract.revisions.length === 0) ? (
                            <div className="p-5 border border-dashed rounded-2xl bg-slate-50 text-center space-y-2">
                              <p className="text-xs text-slate-500">Nenhuma revisão anterior registrada para este contrato.</p>
                              {isManagement && (
                                <button
                                  onClick={() => {
                                    const currentText = typeof selectedContract.clauses === 'string'
                                      ? selectedContract.clauses
                                      : Array.isArray(selectedContract.clauses)
                                        ? selectedContract.clauses.join('\n\n')
                                        : '';
                                    setEditedContractText(currentText);
                                    setIsEditingContractText(true);
                                    setEditChangeReason('Primeira revisão de cláusulas contratuais');
                                  }}
                                  className="text-xs font-bold text-slate-650 hover:text-slate-800 transition-colors cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Edit className="w-3 h-3" /> Criar Primeira Revisão
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="relative border-l-2 border-slate-150 pl-5 ml-2.5 py-1 space-y-6">
                              {/* Versão Atual/Ativa sempre no topo */}
                              <div className="relative group">
                                <div className="absolute -left-[26px] top-1 w-3 h-3 rounded-full bg-emerald-650 border-2 border-white ring-4 ring-emerald-100" />
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">Versão Ativa Atualmente</span>
                                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">Ativa</span>
                                  </div>
                                  <p className="text-[11px] text-slate-500">
                                    Esta é a versão jurídica oficial que será gerada no PDF e enviada para o produtor assinar eletronicamente.
                                  </p>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => setComparisonBaseRevisionId('current')}
                                      className="text-[10px] font-bold text-slate-600 hover:underline cursor-pointer"
                                    >
                                      Usar como Base
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Lista de revisões passadas */}
                              {[...selectedContract.revisions].reverse().map((rev) => (
                                <div key={rev.id} className="relative group">
                                  <div className="absolute -left-[26px] top-1 w-3 h-3 rounded-full bg-slate-300 border-2 border-white group-hover:bg-slate-400 transition-colors" />
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-slate-700">Revisão #{rev.version}</span>
                                      <span className="text-[10px] text-slate-400">
                                        {new Date(rev.editedAt).toLocaleDateString('pt-BR')} {new Date(rev.editedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                        por {rev.editedBy}
                                      </span>
                                    </div>
                                    
                                    <p className="text-[11px] text-slate-600 italic bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl inline-block max-w-full">
                                      "{rev.changeReason || 'Sem justificativa informada'}"
                                    </p>

                                    <div className="flex gap-3 pt-0.5 text-[10px]">
                                      <button
                                        onClick={() => setComparisonBaseRevisionId(rev.id)}
                                        className={`font-bold transition-all ${
                                          comparisonBaseRevisionId === rev.id 
                                            ? 'text-slate-650 underline font-black' 
                                            : 'text-slate-500 hover:text-slate-700 hover:underline'
                                        } cursor-pointer`}
                                      >
                                        Selecionar como Base
                                      </button>
                                      <span className="text-slate-300">|</span>
                                      <button
                                        onClick={() => setComparisonTargetRevisionId(rev.id)}
                                        className={`font-bold transition-all ${
                                          comparisonTargetRevisionId === rev.id 
                                            ? 'text-slate-650 underline font-black' 
                                            : 'text-slate-500 hover:text-slate-700 hover:underline'
                                        } cursor-pointer`}
                                      >
                                        Comparar (Origem)
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    )}
                  </div>
                )}

                {/* REGULAR TAB: Assinatura Digital */}
                {detailTab === 'assinatura' && (
                  <div className="space-y-4 animate-fadeIn">
                    {selectedContract.signatureBase64 ? (
                      <div className="space-y-4">
                        <div className="bg-emerald-50 text-emerald-800 p-4 rounded-2xl border border-emerald-100 flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">Contrato Assinado Digitalmente</h4>
                            <p className="text-[11px] text-emerald-700 mt-1 leading-relaxed">
                              Este documento foi formalizado juridicamente e assinado eletronicamente pelo produtor <strong>{selectedContract.signedByName || selectedContract.clientName}</strong> no dia <strong>{selectedContract.signedAt ? formatDate(selectedContract.signedAt) : ''}</strong> às {selectedContract.signedAt ? new Date(selectedContract.signedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} HS.
                            </p>
                          </div>
                        </div>

                        <div className="border border-slate-200 p-4 rounded-2xl flex flex-col items-center bg-slate-50/55">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">Imagem da Assinatura</span>
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs max-w-sm w-full flex items-center justify-center">
                            <img 
                              src={selectedContract.signatureBase64} 
                              alt="Assinatura Digital" 
                              className="max-h-[120px] object-contain"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <span className="text-[9px] font-mono text-slate-400 mt-3 block">ASSINANTE: {selectedContract.signedByName}</span>
                          <span className="text-[9px] font-mono text-slate-400 block">ID DO CONTRATO: {selectedContract.id}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedContract.status === 'pending_approval' ? (
                          <div className="p-8 text-center bg-amber-50/55 rounded-2xl border border-amber-200 flex flex-col items-center">
                            <Clock className="w-12 h-12 text-amber-500 mb-3 animate-pulse" />
                            <h4 className="text-sm font-bold text-amber-800">Validação Pendente</h4>
                            <p className="text-xs text-amber-700 mt-1.5 max-w-sm mx-auto leading-relaxed">
                              Este contrato foi preenchido e está aguardando a validação de um gestor antes de ser liberado para assinatura digital.
                            </p>
                            
                            {isManagement && (
                              <div className="w-full mt-6 pt-6 border-t border-amber-200 space-y-4 text-left">
                                {selectedContract.createdByRole !== 'admin' && (user?.effectiveRole ?? user?.role) !== 'admin' ? (
                                  <div className="p-4 bg-rose-50/80 border border-rose-150 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800">
                                    <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                                    <div>
                                      <p className="font-bold">Aprovação Restrita ao Administrador</p>
                                      <p className="text-[11px] text-rose-700 mt-1 leading-relaxed">
                                        Este contrato foi elaborado por um funcionário ou gerente ({selectedContract.createdByName || 'Colaborador'}) e requer a validação 'Aprovado' realizada exclusivamente por um Administrador Geral antes de ser finalizado e faturado.
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <h5 className="text-[10px] font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                                      🔒 Painel de Decisão do Gestor / Administrador
                                    </h5>
                                    <div className="space-y-1.5">
                                      <label className="text-[9px] font-bold text-slate-400 uppercase">Parecer Técnico/Jurídico / Observações</label>
                                      <textarea
                                        value={approvalNotes}
                                        onChange={(e) => setApprovalNotes(e.target.value)}
                                        placeholder="Insira observações, termos adicionais ou motivo de recusa..."
                                        className="w-full bg-white border border-amber-250 rounded-xl p-3 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-sans"
                                        rows={3}
                                      />
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <button
                                        type="button"
                                        onClick={() => runExclusive('Contracts.handleApproveContract', () => handleApproveContract(selectedContract, 'approved'))}
                                        className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-50"
                                      >
                                        <Check className="w-4 h-4" /> Aprovar e Liberar Assinatura
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => runExclusive('Contracts.handleApproveContract', () => handleApproveContract(selectedContract, 'draft'))}
                                        className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-750 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-rose-50"
                                      >
                                        <X className="w-4 h-4" /> Recusar e Retornar ao Rascunho
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (selectedContract.status === 'draft' || selectedContract.status === 'em_elaboracao') ? (
                          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 flex flex-col items-center">
                            <Settings className="w-12 h-12 text-slate-400 mb-3 animate-spin-slow" />
                            <h4 className="text-sm font-bold text-slate-700">Contrato em Elaboração (Rascunho)</h4>
                            <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
                              Este documento está na fase inicial de elaboração. Envie para validação técnica e jurídica do gestor para prosseguir para a etapa de assinatura.
                            </p>
                            {selectedContract.approvalNotes && (
                              <div className="w-full max-w-md mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-left">
                                <span className="text-[9px] font-bold text-rose-800 uppercase block">Motivo do último retorno:</span>
                                <p className="text-xs text-rose-700 italic mt-0.5">"{selectedContract.approvalNotes}"</p>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => runExclusive('Contracts.handleSendToApproval', () => handleSendToApproval(selectedContract))}
                              className="mt-6 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-100 flex items-center gap-1.5 cursor-pointer"
                            >
                              <ArrowRight className="w-4 h-4" /> Enviar para Aprovação do Gestor
                            </button>
                          </div>
                        ) : (selectedContract.status === 'cancelled' || selectedContract.status === 'cancelado' || selectedContract.status === 'suspenso') ? (
                          <div className="p-8 text-center bg-rose-50 rounded-2xl border border-rose-100 flex flex-col items-center">
                            <ShieldAlert className="w-12 h-12 text-rose-500 mb-3" />
                            <h4 className="text-sm font-bold text-rose-800">Contrato Cancelado</h4>
                            <p className="text-xs text-rose-600 mt-1.5 max-w-sm mx-auto">
                              Este contrato foi cancelado e não pode receber novas assinaturas ou modificações jurídicas.
                            </p>
                          </div>
                        ) : isSigning ? (
                          <SignaturePad 
                            documentTitle={`Contrato ${selectedContract.contractNumber} (${selectedContract.category})`}
                            defaultSignerName={selectedContract.clientName}
                            onSave={async (signatureDataUrl, signerName) => {
                              try {
                                const signedAtStr = new Date().toISOString();
                                
                                await updateDoc(doc(db, 'contracts', selectedContract.id), {
                                  signatureBase64: signatureDataUrl,
                                  signedAt: signedAtStr,
                                  signedByName: signerName,
                                  status: 'active',
                                  updatedAt: signedAtStr
                                });

                                await logAudit({
                                  userId: user?.uid || 'unknown',
                                  userName: user?.displayName || user?.email || 'Usuário',
                                  action: 'status_changed',
                                  collection: 'contracts',
                                  recordId: selectedContract.id,
                                  recordName: `Contrato ${selectedContract.contractNumber}`,
                                  details: `Contrato assinado digitalmente por ${signerName}. O status foi alterado para ATIVO.`,
                                  newValues: { signatureBase64: '[REDACTED_IMAGE_DATA]', signedAt: signedAtStr, signedByName: signerName, status: 'active' }
                                });

                                setSelectedContract(prev => prev ? {
                                  ...prev,
                                  signatureBase64: signatureDataUrl,
                                  signedAt: signedAtStr,
                                  signedByName: signerName,
                                  status: 'active'
                                } : null);

                                toast.success('Contrato assinado digitalmente com sucesso!');
                                setIsSigning(false);
                              } catch (e) {
                                console.error(e);
                                toast.error('Erro ao salvar assinatura digital.');
                              }
                            }}
                            onCancel={() => setIsSigning(false)}
                          />
                        ) : (
                          <div className="p-6 md:p-8 bg-slate-50 rounded-[2rem] border border-slate-200/60 flex flex-col items-center">
                            <PenTool className="w-12 h-12 text-slate-300 stroke-1 mb-3 animate-pulse" />
                            <h4 className="text-sm font-bold text-slate-650">Aguardando Assinatura Digital</h4>
                            <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto leading-relaxed text-center">
                              Este contrato foi <strong>aprovado pelo gestor</strong> e encontra-se pronto para assinatura oficial pelo produtor responsável.
                            </p>
                            {selectedContract.approvedBy && (
                              <div className="mt-3 text-[10px] text-emerald-600 font-bold uppercase tracking-wider bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Validado por: {selectedContract.approvedBy} em {selectedContract.approvedAt ? formatDate(selectedContract.approvedAt.substring(0, 10)) : ''}
                              </div>
                            )}

                            {/* Dual Signature Options */}
                            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-6 border-t border-slate-200">
                              {/* Option 1: Presencial */}
                              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between items-center text-center">
                                <div>
                                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Opção Presencial</span>
                                  <h5 className="text-xs font-bold text-slate-700">Assinar Localmente</h5>
                                  <p className="text-[10px] text-slate-455 mt-1 leading-normal max-w-[200px] mx-auto">
                                    O cliente está presente? Abra o painel de assinatura diretamente nesta tela de computador ou tablet.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setIsSigning(true)}
                                  className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-100 cursor-pointer"
                                >
                                  Assinar na Tela Atual
                                </button>
                              </div>

                              {/* Option 2: Remota */}
                              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex flex-col items-center text-center">
                                <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Opção Remota</span>
                                <h5 className="text-xs font-bold text-slate-700 font-display">Assinar por Celular</h5>
                                <p className="text-[10px] text-slate-455 mt-1 leading-normal max-w-[200px] mx-auto">
                                  Compartilhe o link de acesso seguro ou exiba o QR Code para assinatura remota via dispositivo móvel do cliente.
                                </p>
                                
                                <div className="mt-3.5 w-full space-y-2.5">
                                  {/localhost|127\.0\.0\.1/.test(window.location.origin) && (
                                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[9px] text-amber-800 font-semibold text-left">
                                      Atenção: este link só abre neste computador. Para o cliente assinar pelo celular, o sistema precisa estar publicado na internet. Por enquanto, colha a assinatura presencialmente.
                                    </div>
                                  )}
                                  {/* Link container */}
                                  <div className="flex gap-1.5 items-center">
                                    <input 
                                      type="text" 
                                      readOnly 
                                      value={window.location.origin + '/assinar/' + selectedContract.id}
                                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[9px] font-mono text-slate-500 focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const url = window.location.origin + '/assinar/' + selectedContract.id;
                                        navigator.clipboard.writeText(url);
                                        toast.success('Link de assinatura copiado com sucesso!');
                                      }}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[9px] font-bold uppercase cursor-pointer whitespace-nowrap"
                                    >
                                      Copiar
                                    </button>
                                  </div>

                                  {/* QR Code trigger */}
                                  <div className="pt-1.5 flex flex-col items-center">
                                    <img 
                                      src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.origin + '/assinar/' + selectedContract.id)}`} 
                                      alt="QR Code de Assinatura"
                                      className="w-16 h-16 border border-slate-200 p-1 rounded-lg shadow-xs"
                                      referrerPolicy="no-referrer"
                                    />
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-1.5 flex items-center gap-1">
                                      <Smartphone className="w-3 h-3 text-emerald-500 animate-pulse" /> Escanear com celular
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Action output to generate simplified draft contract in PDF or delete */}
              <div className="flex justify-between items-center border-t pt-4 gap-2">
                {(user?.effectiveRole ?? user?.role) === 'admin' && (
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(selectedContract.id)}
                  className="px-4 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 cursor-pointer"
                  title="Excluir Contrato"
                >
                  <Trash2 className="w-4 h-4" /> Excluir Contrato
                </button>
                )}
                <button
                  onClick={() => handleGenerateContractPDF(selectedContract)}
                  className="px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5"
                >
                  <FileText className="w-4 h-4" /> Emitir PDF Contrato Integrado
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Addition Wizard Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto animate-fadeIn">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-lg p-6 md:p-8 space-y-5 max-h-[92vh] overflow-y-auto relative text-slate-800"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="text-lg font-display font-bold text-slate-800">Criar Novo Contrato Agronômico</h3>
                <button onClick={() => { setIsAddModalOpen(false); resetForm(); }} className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stepper indicator */}
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                {[1, 2, 3].map((num) => (
                  <div key={num} className="flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      formStep === num 
                        ? 'bg-emerald-600 text-white shadow-xs' 
                        : formStep > num 
                        ? 'bg-emerald-500 text-white' 
                        : 'bg-slate-200 text-slate-500'
                    }`}>
                      {num}
                    </span>
                    <span className={`text-[10px] uppercase font-bold tracking-wider ${
                      formStep === num ? 'text-slate-600 font-black' : 'text-slate-400 font-medium'
                    }`}>
                      {num === 1 ? 'Identificação' : num === 2 ? 'Termos' : 'Faturamento'}
                    </span>
                  </div>
                ))}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Contracts.handleSaveContract', () => handleSaveContract(e)); }} className="space-y-4 text-xs">
                
                {formStep === 1 && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase block ml-1">Produtor / Cliente</label>
                      <select
                        value={formClientId}
                        onChange={(e) => {
                          setFormClientId(e.target.value);
                          if (formErrors.clientId) {
                            setFormErrors(prev => {
                              const copy = { ...prev };
                              delete copy.clientId;
                              return copy;
                            });
                          }
                        }}
                        className={`w-full glass-input text-xs h-10 py-1 ${formErrors.clientId ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500' : ''}`}
                      >
                        <option value="">Selecione o Produtor</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {formErrors.clientId && (
                        <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.clientId}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Número Contrato</label>
                        <input 
                          type="text"
                          value={formContractNumber}
                          onChange={(e) => {
                            setFormContractNumber(e.target.value);
                            if (formErrors.contractNumber) {
                              setFormErrors(prev => {
                                const copy = { ...prev };
                                delete copy.contractNumber;
                                return copy;
                              });
                            }
                          }}
                          className={`w-full glass-input font-mono ${formErrors.contractNumber ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500' : ''}`}
                        />
                        {formErrors.contractNumber && (
                          <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.contractNumber}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Objeto / Categoria</label>
                        <select
                          value={formObject}
                          onChange={(e) => setFormObject(e.target.value)}
                          className="w-full glass-input"
                        >
                          <option value="Análises Agronômicas Avançadas">Análises Agronômicas Avançadas</option>
                          <option value="Projetos de Irrigação de Precisão">Projetos de Irrigação de Precisão</option>
                          <option value="Regularização Ambiental de Imóveis">Regularização Ambiental de Imóveis</option>
                          <option value="Elaboração Consultoria Crédito Rural">Elaboração Consultoria Crédito Rural</option>
                          <option value="Levantamentos e Modelagem de Topografia">Levantamentos e Modelagem de Topografia</option>
                        <option value="Assistência Técnica e Extensão Rural">Assistência Técnica e Extensão Rural</option>
                        <option value="Perícia Judicial">Perícia Judicial</option>
                        <option value="Avaliação de Imóveis Rurais">Avaliação de Imóveis Rurais</option>
                        <option value="Outros Serviços Técnicos">Outros Serviços Técnicos</option>
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}

                {formStep === 2 && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Início Vigência</label>
                        <input 
                          type="date"
                          value={formStartDate}
                          onChange={(e) => setFormStartDate(e.target.value)}
                          className="w-full glass-input"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Fim Vigência</label>
                        <input 
                          type="date"
                          value={formEndDate}
                          onChange={(e) => {
                            setFormEndDate(e.target.value);
                            if (formErrors.endDate) {
                              setFormErrors(prev => {
                                const copy = { ...prev };
                                delete copy.endDate;
                                return copy;
                              });
                            }
                          }}
                          className={`w-full glass-input ${formErrors.endDate ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500' : ''}`}
                        />
                        {formErrors.endDate && (
                          <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.endDate}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                          ✨ Modelos de Contratos Inteligentes
                        </span>
                        <span className="text-[9px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full font-bold">
                          {formObject}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-700 leading-relaxed">
                        Preencha o contrato instantaneamente com variáveis dinâmicas do formulário. Escolha a versão/revisão técnica desejada:
                      </p>
                      
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <div className="col-span-2">
                          <select
                            value={selectedTemplateVersion}
                            onChange={(e) => setSelectedTemplateVersion(e.target.value)}
                            className="w-full glass-input text-[10px] py-1 px-2 h-8 font-bold text-slate-700"
                          >
                            {templates.find(t => t.category === formObject)?.versions.map(v => (
                              <option key={v.id} value={v.version}>
                                {v.version} ({v.authorName.split(' ')[0]})
                              </option>
                            )) || <option value="v1.0">v1.0 (Sistema)</option>}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyContractTemplate(formObject, selectedTemplateVersion)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all h-8 flex items-center justify-center cursor-pointer shadow-xs font-sans"
                        >
                          Carregar
                        </button>
                      </div>
                    </div>

                    {/* AI Minuta Assistant Card */}
                    <div className="space-y-2.5 p-3.5 bg-gradient-to-r from-emerald-50 to-emerald-50 border border-slate-100 rounded-2xl shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                          ✨ Assistente de Minutas por IA (Gemini)
                        </span>
                        <span className="text-[9px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full font-bold">
                          Personalização Avançada
                        </span>
                      </div>
                      
                      <p className="text-[10px] text-slate-700 leading-relaxed">
                        Gere uma minuta personalizada cruzando os dados do produtor com suas regras e cláusulas adicionais através de inteligência artificial.
                      </p>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-600 uppercase">Diretrizes ou Cláusulas Especiais (Ex: multas, obrigações)</label>
                        <textarea
                          rows={2}
                          value={aiCustomGuidelines}
                          onChange={(e) => setAiCustomGuidelines(e.target.value)}
                          placeholder="Ex: Adicionar multa de 10% por atraso de pagamento, visitas técnicas a cada 15 dias, ou prazos estritos para entrega de laudos..."
                          className="w-full glass-input text-[10px] py-1.5 px-2 bg-white/70 focus:bg-white border-slate-200 focus:border-emerald-400 placeholder-slate-300 font-sans"
                        />
                      </div>

                      {aiMinutaError && (
                        <p className="text-[9px] text-rose-500 font-bold leading-relaxed">{aiMinutaError}</p>
                      )}

                      <button
                        type="button"
                        disabled={isGeneratingMinuta}
                        onClick={() => runExclusive('Contracts.handleGenerateMinuta', () => handleGenerateMinuta())}
                        className="w-full py-2 bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      >
                        {isGeneratingMinuta ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span>Gerando minuta por IA...</span>
                          </>
                        ) : (
                          <>
                            <span>Gerar e aplicar minuta personalizada</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Parágrafo do Escopo de Cláusula</label>
                      <textarea
                        rows={7}
                        value={formMainClause}
                        onChange={(e) => {
                          setFormMainClause(e.target.value);
                          if (formErrors.mainClause) {
                            setFormErrors(prev => {
                              const copy = { ...prev };
                              delete copy.mainClause;
                              return copy;
                            });
                          }
                        }}
                        className={`w-full glass-input py-2 font-mono text-[10px] leading-relaxed ${formErrors.mainClause ? 'border-rose-500 focus:border-rose-500' : ''}`}
                        placeholder="Insira as cláusulas do contrato..."
                      />
                      {formErrors.mainClause && (
                        <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.mainClause}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Notas Administrativas / Condições</label>
                      <input 
                        type="text"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="Condição de parcelamento, observações de garantia..."
                        className="w-full glass-input"
                      />
                    </div>
                  </motion.div>
                )}

                {formStep === 3 && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Valor Contrato (R$)</label>
                        <input 
                          type="text"
                          value={formTotalValue}
                          onChange={(e) => {
                            setFormTotalValue(e.target.value);
                            if (formErrors.totalValue) {
                              setFormErrors(prev => {
                                const copy = { ...prev };
                                delete copy.totalValue;
                                return copy;
                              });
                            }
                          }}
                          placeholder="0,00"
                          className={`w-full glass-input font-bold ${formErrors.totalValue ? 'border-rose-500 focus:border-rose-500' : ''}`}
                        />
                        {formErrors.totalValue && (
                          <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.totalValue}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Número de Parcelas</label>
                        <input 
                          type="number"
                          min={1}
                          max={24}
                          value={formInstallmentsCount}
                          onChange={(e) => {
                            setFormInstallmentsCount(parseInt(e.target.value) || 1);
                            if (formErrors.installmentsCount) {
                              setFormErrors(prev => {
                                const copy = { ...prev };
                                delete copy.installmentsCount;
                                return copy;
                              });
                            }
                          }}
                          className={`w-full glass-input ${formErrors.installmentsCount ? 'border-rose-500 focus:border-rose-500' : ''}`}
                        />
                        {formErrors.installmentsCount && (
                          <p className="text-[10px] text-rose-500 font-bold ml-1">{formErrors.installmentsCount}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t">
                  {formStep > 1 ? (
                    <button
                      type="button"
                      onClick={() => setFormStep(prev => prev - 1)}
                      className="px-4 py-2 border border-slate-200 text-slate-650 hover:bg-slate-55 rounded-xl transition-all font-semibold"
                    >
                      Anterior
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setIsAddModalOpen(false); resetForm(); }}
                      className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl"
                    >
                      Cancelar
                    </button>
                  )}
                  {formStep < 3 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (validateStep(formStep)) {
                          setFormStep(prev => prev + 1);
                        } else {
                          toast.error('Preencha todos os campos obrigatórios deste passo antes de avançar.');
                        }
                      }}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold font-mono uppercase transition-all"
                    >
                      Próximo
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="px-5 py-2 bg-emerald-650 hover:bg-emerald-750 text-white rounded-xl font-bold font-mono uppercase transition-all shadow-md"
                    >
                      Salvar e Gerar Cronograma
                    </button>
                  )}
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={isDeleteModalOpen !== null}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteContract(isDeleteModalOpen)}
        title="Apagar Termo Contratual?"
        description="Esta operação removerá o acordo comercial e suas faturas correspondentes de forma irreversível."
      />

    </div>
  );
}
