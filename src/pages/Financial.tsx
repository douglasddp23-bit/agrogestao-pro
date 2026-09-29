import React, { useState, useEffect, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { motion, AnimatePresence } from 'motion/react';
import { 
  DollarSign, 
  PlusCircle, 
  ArrowUpRight, 
  ArrowDownRight, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Trash2, 
  CheckCircle2, 
  Calendar, 
  Filter, 
  Search, 
  User,
  Clock,
  Briefcase,
  AlertCircle,
  X,
  ChevronRight,
  ArrowLeft,
  Check,
  TrendingUp,
  CreditCard,
  Ban,
  ShieldAlert,
  Eye,
  Lock
} from 'lucide-react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { PERMISSIONS } from '../lib/permissions';
import { logAudit } from '../lib/audit';
import { toast } from 'sonner';
import { exportToExcel } from '../lib/exportExcel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import SkeletonList from '../components/SkeletonList';
import { formatDateTime, formatDate, todayLocalDateString, formatCurrency } from '../lib/utils';
import ConfirmationModal from '../components/ConfirmationModal';
import { FinancialRecord, FinancialStatus, PaymentMethod, FinancialCategory, Client, ServiceAnalysis, ExpenseReport, UserRole } from '../types';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { DollarSign as PageIcon } from 'lucide-react';

export default function Financial() {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as UserRole;
  const canView = PERMISSIONS.canViewFinancial(role); // manager+

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-12 bg-white/30 rounded-2xl glass border border-white/40">
        <Lock className="w-12 h-12 text-slate-300" />
        <p className="text-slate-500 text-sm font-medium">
          Você não tem permissão para acessar o módulo financeiro.
        </p>
      </div>
    );
  }

  // Os hooks ficam num componente separado: antes eles vinham depois do "return"
  // acima, e a tela quebrava quando o cargo efetivo mudava com ela aberta.
  return <FinancialContent />;
}

function FinancialContent() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [analyses, setAnalyses] = useState<ServiceAnalysis[]>([]);
  const [expenseReports, setExpenseReports] = useState<ExpenseReport[]>([]);

  // Tabs state
  const [activeTab, setActiveTab] = useState<'flow' | 'dre' | 'expenses'>('flow');
  const [dreMonth, setDreMonth] = useState(todayLocalDateString().substring(0, 7)); // YYYY-MM

  // Expense Report Form State
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [expenseFormDescription, setExpenseFormDescription] = useState('');
  const [expenseFormValue, setExpenseFormValue] = useState('');
  const [expenseFormDueDate, setExpenseFormDueDate] = useState(todayLocalDateString());
  const [expenseFormCategory, setExpenseFormCategory] = useState<'combustivel' | 'alimentacao' | 'hospedagem' | 'equipamentos' | 'outros'>('combustivel');
  const [expenseFormNotes, setExpenseFormNotes] = useState('');

  // Expense Approval Modal State
  const [selectedExpenseReport, setSelectedExpenseReport] = useState<ExpenseReport | null>(null);
  const [expenseApprovalNotes, setExpenseApprovalNotes] = useState('');
  const [isExpenseApprovalModalOpen, setIsExpenseApprovalModalOpen] = useState(false);
  const [savingExpenseDecision, setSavingExpenseDecision] = useState(false);

  // Filtering / Searching State
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all'); // format: YYYY-MM
  const [selectedTechnician, setSelectedTechnician] = useState('all');

  // Date period states in memory
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);

  // Multi-step form state
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [formClientId, setFormClientId] = useState('');
  const [formCategory, setFormCategory] = useState<FinancialCategory>('analysis');
  const [formDescription, setFormDescription] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formDueDate, setFormDueDate] = useState(todayLocalDateString());
  const [formLinkedServiceId, setFormLinkedServiceId] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>('pix');
  const [formNotes, setFormNotes] = useState('');
  const [formStatus, setFormStatus] = useState<FinancialStatus>('pending');
  const [formCompetencia, setFormCompetencia] = useState(todayLocalDateString().substring(0, 7));
  const [formNfse, setFormNfse] = useState('');

  const isManagement = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager';

  // Listen to Firestore real-time
  useEffect(() => {
    const q = query(collection(db, 'financials'), orderBy('dueDate', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinancialRecord));
      setRecords(data);
      setLoading(false);

      // Atualizar cobranças vencidas automaticamente se vencidas
      const today = todayLocalDateString();
      const batchUpdates: Promise<void>[] = [];
      snapshot.docs.forEach(docSnap => {
        const item = docSnap.data() as FinancialRecord;
        if (item.status === 'pending' && item.dueDate < today) {
          batchUpdates.push(updateDoc(docSnap.ref, { status: 'overdue' }));
        }
      });
      if (batchUpdates.length > 0) {
        Promise.all(batchUpdates)
          .then(() => toast.info(`${batchUpdates.length} cobrança(s) pendente(s) atualizada(s) para vencida(s) automaticamente.`))
          .catch(err => console.error('Erro ao atualizar vencidos automaticamente:', err));
      }
    }, (error) => {
      console.error(error);
      toast.error("Erro ao carregar dados financeiros.");
      setLoading(false);
    });

    const unsubscribeClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    const unsubscribeAnalyses = onSnapshot(collection(db, 'analyses'), (snapshot) => {
      setAnalyses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceAnalysis)));
    });

    const unsubscribeExpenses = onSnapshot(collection(db, 'expense_reports'), (snapshot) => {
      setExpenseReports(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseReport)));
    });

    return () => {
      unsubscribe();
      unsubscribeClients();
      unsubscribeAnalyses();
      unsubscribeExpenses();
    };
  }, []);

  const today = todayLocalDateString();
  const processedRecords = useMemo(() => {
    return records.map(r => ({
      ...r,
      status: r.status === 'pending' && r.dueDate < today
        ? 'overdue' as FinancialStatus : r.status
    }));
  }, [records, today]);

  // Filter Records by role (consultants/staff only see their own records, as specified in instructions)
  const visibleRecords = processedRecords.filter(rec => {
    if (isManagement) return true;
    return rec.createdBy === user?.uid || rec.clientId === user?.uid; // simple ownership match
  });

  const dreMonthRecords = useMemo(() => {
    return visibleRecords.filter(r => {
      if (r.status !== 'paid') return false;
      const comp = r.competencia || r.paymentDate || r.dueDate;
      return comp && comp.startsWith(dreMonth);
    });
  }, [visibleRecords, dreMonth]);

  const dreStats = useMemo(() => {
    const bruto = dreMonthRecords.filter(r => !r.isExpense).reduce((acc, r) => acc + r.value, 0);
    const actualExpenses = dreMonthRecords.filter(r => r.isExpense).reduce((acc, r) => acc + r.value, 0);
    // Imposto estimado (alíquota padrão do Simples/ISS); o valor real depende do regime da empresa.
    const deducoes = bruto * 0.06;
    const liquida = bruto - deducoes;
    // Antes somava 35% fixos do faturamento como "custo" inventado; agora só despesas reais lançadas.
    const custos = actualExpenses;
    const resultado = liquida - custos;
    return { bruto, deducoes, liquida, custos, resultado, actualExpenses };
  }, [dreMonthRecords]);

  const filteredRecords = visibleRecords.filter(item => {
    const matchesSearch = 
      (item.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    
    let matchesMonth = true;
    if (monthFilter !== 'all') {
      const recMonth = item.dueDate.substring(0, 7); // 'YYYY-MM'
      matchesMonth = recMonth === monthFilter;
    }

    let matchesPeriod = true;
    if (startDateFilter) {
      matchesPeriod = matchesPeriod && item.dueDate >= startDateFilter;
    }
    if (endDateFilter) {
      matchesPeriod = matchesPeriod && item.dueDate <= endDateFilter;
    }

    return matchesSearch && matchesCategory && matchesStatus && matchesMonth && matchesPeriod;
  });

  // KPI Calculations (Considering SELECTED PERIOD Filtered Records - MELHORIA 5)
  const now = new Date();
  const currentYearStr = now.getFullYear().toString();
  const currentMonthStr = (now.getMonth() + 1).toString().padStart(2, '0');

  // 1. Receita Líquida do período (paid records matching current filter minus expenses)
  const monthlyRevenue = filteredRecords
    .filter(r => r.status === 'paid')
    .reduce((sum, r) => sum + (r.isExpense ? -r.value : r.value), 0);

  // 2. Receita Bruta do período (paid receipts matching current filter, ignoring expenses)
  const yearlyRevenue = filteredRecords
    .filter(r => r.status === 'paid' && !r.isExpense)
    .reduce((sum, r) => sum + r.value, 0);

  // 3. Total em aberto líquido (pending + overdue records matching current filter)
  const totalOpen = filteredRecords
    .filter(r => r.status === 'pending' || r.status === 'overdue')
    .reduce((sum, r) => sum + (r.isExpense ? -r.value : r.value), 0);

  // 4. Ticket médio por serviço (matching current filter, excluding expense reports)
  const serviceRecords = filteredRecords.filter(r => r.category !== 'other' && r.category !== 'expense_report' && !r.isExpense);
  const averageTicket = serviceRecords.length > 0
    ? serviceRecords.reduce((sum, r) => sum + r.value, 0) / serviceRecords.length
    : 0;

  // Recharts Monthly Revenue for last 6 months (filtered by matching selection and dates)
  const getMonthlyChartData = () => {
    const months: Record<string, number> = {};
    
    // Create placeholders for last 6 months as default baseline
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      months[key] = 0;
    }

    filteredRecords
      .filter(r => r.status === 'paid')
      .forEach(r => {
        const monthKey = (r.paymentDate || r.dueDate).substring(0, 7);
        const diff = r.isExpense ? -r.value : r.value;
        if (months[monthKey] !== undefined) {
          months[monthKey] += diff;
        } else {
          // Dynamically support and add months that fall outside but match filters
          months[monthKey] = diff;
        }
      });

    // Translate to visual labels sorted chronologically
    return Object.entries(months)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, val]) => {
        const [year, mo] = key.split('-');
        return {
          month: `${mo}/${year}`,
          Receita: val
        };
      });
  };

  // Recharts PieChart data (matching current filter)
  const getCategoryPieData = () => {
    const catMap: Record<string, number> = {
      analysis: 0,
      irrigation: 0,
      topography: 0,
      credit: 0,
      regularization: 0,
      expense_report: 0,
      other: 0,
    };

    filteredRecords.forEach(r => {
      if (catMap[r.category] !== undefined) {
        catMap[r.category] += r.value;
      } else {
        catMap.other += r.value;
      }
    });

    const categoriesTranslations: Record<string, string> = {
      analysis: 'Análises',
      irrigation: 'Irrigação',
      topography: 'Topografia',
      credit: 'Crédito',
      regularization: 'Regularização',
      expense_report: 'Despesas Homologadas',
      other: 'Outros'
    };

    return Object.entries(catMap)
      .filter(([_, val]) => val > 0)
      .map(([key, val]) => ({
        name: categoriesTranslations[key] || key,
        value: val
      }));
  };

  const PIE_COLORS = ['#10b981', '#06b6d4', '#f15922', '#f59e0b', '#8b5cf6', '#64748b'];

  // Multi-step submit handler
  const handleSaveTransaction = async () => {
    if (!formClientId) {
      toast.error("Por favor, selecione o cliente/produtor.");
      return;
    }
    const client = clients.find(c => c.id === formClientId);
    if (!client) return;

    const valNum = parseFloat(formValue.replace(',', '.'));
    if (isNaN(valNum) || valNum <= 0) {
      toast.error("Insira um valor financeiro válido maior que zero.");
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<FinancialRecord> = {
        clientId: formClientId,
        clientName: client.name,
        category: formCategory,
        description: formDescription || `Faturamento de laudo — ${client.name}`,
        value: valNum,
        dueDate: formDueDate,
        paymentDate: formStatus === 'paid' ? todayLocalDateString() : undefined,
        paymentMethod: formPaymentMethod,
        status: formStatus,
        serviceId: formLinkedServiceId || undefined,
        serviceType: formCategory === 'analysis' ? 'soil' : formCategory === 'other' ? 'other' : undefined,
        notes: formNotes || undefined,
        competencia: formCompetencia || undefined,
        nfse: formNfse || undefined,
        createdBy: user?.uid || 'web-portal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'financials'), payload);
      toast.success("Lançamento financeiro cadastrado com sucesso!");
      setIsAddModalOpen(false);
      resetForm();
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao cadastrar faturamento: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormClientId('');
    setFormCategory('analysis');
    setFormDescription('');
    setFormValue('');
    setFormDueDate(todayLocalDateString());
    setFormLinkedServiceId('');
    setFormPaymentMethod('pix');
    setFormNotes('');
    setFormStatus('pending');
    setFormCompetencia(todayLocalDateString().substring(0, 7));
    setFormNfse('');
    setCurrentStep(1);
  };

  // --- CONTROLLER FOR EXPENSE REPORTS ---
  const handleSaveExpenseReport = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!expenseFormDescription.trim() || !expenseFormValue.trim()) {
      toast.error("Por favor, preencha os campos obrigatórios da despesa.");
      return;
    }

    const valNum = parseFloat(expenseFormValue.replace(',', '.'));
    if (isNaN(valNum) || valNum <= 0) {
      toast.error("Insira um valor numérico de despesa válido maior que zero.");
      return;
    }

    setSaving(true);
    try {
      const expenseId = doc(collection(db, 'expense_reports')).id;
      const payload: ExpenseReport = {
        id: expenseId,
        description: expenseFormDescription,
        value: valNum,
        dueDate: expenseFormDueDate,
        category: expenseFormCategory,
        notes: expenseFormNotes || '',
        createdBy: user?.uid || 'unknown',
        createdByName: user?.displayName || user?.email || 'Colaborador',
        createdByRole: (user?.effectiveRole ?? user?.role) || 'staff',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending_approval'
      };

      await addDoc(collection(db, 'expense_reports'), payload);

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'created',
        collection: 'expense_reports',
        recordId: expenseId,
        recordName: `Despesa - ${payload.description}`,
        details: `Solicitação de reembolso de despesa criada por ${payload.createdByName} (${(payload.category || '').toUpperCase()}) no valor de R$ ${payload.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
        newValues: payload
      });

      toast.success("Solicitação de despesa enviada para aprovação do administrador!");
      setIsExpenseModalOpen(false);
      
      // Reset expense form
      setExpenseFormDescription('');
      setExpenseFormValue('');
      setExpenseFormDueDate(todayLocalDateString());
      setExpenseFormCategory('combustivel');
      setExpenseFormNotes('');
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao solicitar reembolso: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveExpenseReport = async (report: ExpenseReport) => {
    if ((user?.effectiveRole ?? user?.role) !== 'admin') {
      toast.error("Apenas administradores podem homologar e aprovar despesas.");
      return;
    }

    setSavingExpenseDecision(true);
    try {
      // 1. Update expense status to approved
      await updateDoc(doc(db, 'expense_reports', report.id), {
        status: 'approved',
        approvedBy: user?.displayName || user?.email || 'Administrador',
        approvedAt: new Date().toISOString(),
        approvalNotes: expenseApprovalNotes.trim() || 'Aprovado pelo Administrador',
        updatedAt: new Date().toISOString()
      });

      // 2. Add to financials (contabilizar no sistema financeiro) as an active expense
      const financialPayload: Partial<FinancialRecord> = {
        clientId: 'empresa-interna',
        clientName: 'AgroGestão Pro (Gasto Interno)',
        category: 'expense_report',
        description: `[Despesa Aprovada] ${report.description} (${report.createdByName})`,
        value: report.value,
        dueDate: report.dueDate,
        paymentDate: todayLocalDateString(),
        paymentMethod: 'transferencia',
        status: 'paid', // approved implies finalized/paid
        serviceId: report.id,
        serviceType: 'expense_report',
        notes: `Reembolso de despesa de ${report.createdByName} (${(report.category || '').toUpperCase()}). Parecer: ${expenseApprovalNotes.trim() || 'Aprovado'}. ${report.notes || ''}`,
        createdBy: report.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isExpense: true // indicates it is an expense
      };

      await addDoc(collection(db, 'financials'), financialPayload);

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'expense_reports',
        recordId: report.id,
        recordName: `Despesa - ${report.description}`,
        details: `Despesa homologada e contabilizada nas Finanças. Parecer: ${expenseApprovalNotes || 'Nenhum'}.`,
        newValues: { status: 'approved', approvedBy: user?.displayName || user?.email }
      });

      toast.success("Despesa aprovada e contabilizada com sucesso nas Finanças!");
      setIsExpenseApprovalModalOpen(false);
      setSelectedExpenseReport(null);
      setExpenseApprovalNotes('');
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao aprovar despesa: " + e.message);
    } finally {
      setSavingExpenseDecision(false);
    }
  };

  const handleRejectExpenseReport = async (report: ExpenseReport) => {
    if ((user?.effectiveRole ?? user?.role) !== 'admin') {
      toast.error("Apenas administradores podem recusar despesas.");
      return;
    }

    setSavingExpenseDecision(true);
    try {
      await updateDoc(doc(db, 'expense_reports', report.id), {
        status: 'rejected',
        approvedBy: user?.displayName || user?.email || 'Administrador',
        approvedAt: new Date().toISOString(),
        approvalNotes: expenseApprovalNotes.trim() || 'Recusado pelo Administrador',
        updatedAt: new Date().toISOString()
      });

      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'expense_reports',
        recordId: report.id,
        recordName: `Despesa - ${report.description}`,
        details: `Despesa recusada pelo Administrador. Motivo: ${expenseApprovalNotes || 'Nenhum'}.`,
        newValues: { status: 'rejected', approvedBy: user?.displayName || user?.email }
      });

      toast.success("Solicitação de despesa recusada.");
      setIsExpenseApprovalModalOpen(false);
      setSelectedExpenseReport(null);
      setExpenseApprovalNotes('');
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao recusar despesa: " + e.message);
    } finally {
      setSavingExpenseDecision(false);
    }
  };

  // Change single status shortcut
  const handleToggleState = async (record: FinancialRecord, nextStatus: FinancialStatus) => {
    if (!isManagement) {
      toast.error("Somente gestores ou administradores podem alterar faturamentos.");
      return;
    }
    try {
      await updateDoc(doc(db, 'financials', record.id), {
        status: nextStatus,
        paymentDate: nextStatus === 'paid' ? todayLocalDateString() : null,
        updatedAt: new Date().toISOString()
      });
      const statusLabel: Record<string, string> = { paid: 'Pago', pending: 'Pendente', overdue: 'Vencido', cancelled: 'Cancelado' };
      toast.success(`Faturamento marcado como ${statusLabel[nextStatus] || nextStatus}.`);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao realizar alteração no faturamento.");
    }
  };

  // Delete ledger entry
  const handleDeleteEntry = async () => {
    if (!isDeleteModalOpen) return;
    const targetRecord = records.find(r => r.id === isDeleteModalOpen);
    try {
      await deleteDoc(doc(db, 'financials', isDeleteModalOpen));
      
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'deleted',
        collection: 'financials',
        recordId: isDeleteModalOpen,
        recordName: targetRecord ? targetRecord.description : `Faturamento ${isDeleteModalOpen}`,
        details: targetRecord 
          ? `Lançamento financeiro "${targetRecord.description}" para o cliente "${targetRecord.clientName}" no valor de R$ ${targetRecord.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} foi excluído permanentemente.`
          : `Lançamento financeiro ID ${isDeleteModalOpen} foi excluído permanentemente.`,
        previousValues: targetRecord || undefined
      });

      toast.success("Lançamento financeiro excluído.");
      setIsDeleteModalOpen(null);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao excluir o lançamento.");
    }
  };

  // Export Sheets using SheetJS
  const handleExportXLSX = () => {
    const formatted = filteredRecords.map(r => ({
      Data: formatDate(r.dueDate),
      Cliente: r.clientName,
      Descrição: r.description,
      Valor: r.value,
      Status: r.status === 'paid' ? 'Pago' : r.status === 'overdue' ? 'Vencido' : r.status === 'cancelled' ? 'Cancelado' : 'Pendente',
      Método: r.paymentMethod,
      Categoria: r.category
    }));
    exportToExcel(formatted, 'Controle_Caixa_AgroGestao');
    toast.success("Exportado em formato excel.");
  };

  // Export PDF with autoTable
  const handleExportPDF = () => {
    const doc = new jsPDF() as any;
    
    doc.setFillColor(16, 185, 129); // Emerald 500
    doc.rect(0, 0, 210, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('AgroGestão Pro', 15, 15);
    doc.setFontSize(10);
    doc.text('Relatório Financeiro de Contas e Receitas', 15, 25);
    doc.text(`Data de Emissão: ${new Date().toLocaleDateString()}`, 140, 25);

    doc.setTextColor(51, 65, 85);
    doc.setFontSize(11);
    doc.text(`Total Filtrado: ${formatCurrency(filteredRecords.reduce((s, r) => s + r.value, 0))}`, 15, 45);

    const pdfRows = filteredRecords.map(r => [
      formatDate(r.dueDate),
      r.clientName,
      r.description,
      (r.category || '').toUpperCase(),
      (r.paymentMethod || '').toUpperCase(),
      (r.status || '').toUpperCase(),
      `${formatCurrency(r.value)}`
    ]);

    autoTable(doc, {
      startY: 50,
      head: [['Vencimento', 'Cliente', 'Descrição', 'Categoria', 'Forma', 'Status', 'Valor']],
      body: pdfRows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8 }
    });

    doc.save('Financeiro_AgroGestao_Pro.pdf');
    toast.success("Relatório de faturamento PDF exportado!");
  };

  const handleExportDrePDF = () => {
    const doc = new jsPDF() as any;
    
    // Top Banner
    doc.setFillColor(16, 185, 129); // Emerald 500
    doc.rect(0, 0, 210, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('Helvetica', 'bold');
    doc.text('AgroGestão Pro', 15, 15);
    doc.setFontSize(10);
    doc.setFont('Helvetica', 'normal');
    doc.text(`Demonstrativo de Resultado de Exercício (DRE) - Competência: ${dreMonth}`, 15, 25);
    doc.text(`Data de Emissão: ${new Date().toLocaleDateString()}`, 140, 25);

    // DRE detailed values
    const tableData = [
      ['(1) RECEITA BRUTA DE SERVIÇOS', `R$ ${dreStats.bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['(-) Impostos estimados (6% — confirme com seu contador)', `- R$ ${dreStats.deducoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['(=) RECEITA LÍQUIDA OPERACIONAL', `R$ ${dreStats.liquida.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['(-) Despesas reais lançadas no período', `- R$ ${dreStats.custos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['(=) RESULTADO OPERACIONAL LÍQUIDO', `R$ ${dreStats.resultado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]
    ];

    autoTable(doc, {
      startY: 45,
      head: [['Rubrica / Conta DRE', 'Valor Consolidado']],
      body: tableData,
      headStyles: { fillColor: [30, 41, 59] }, // Dark Slate
      styles: { fontSize: 10, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 140 },
        1: { cellWidth: 40, halign: 'right' }
      }
    });

    // Add list of payments if any
    const finalY = (doc as any).lastAutoTable.finalY || 100;
    
    doc.setFontSize(11);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Faturamentos e Receitas Vinculadas no Mês:', 15, finalY + 12);

    if (dreMonthRecords.length > 0) {
      const recordsRows = dreMonthRecords.map(r => [
        formatDate(r.dueDate),
        r.clientName,
        r.description,
        r.nfse ? `NF-Se #${r.nfse}` : 'Sem Nota',
        `R$ ${r.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      ]);

      autoTable(doc, {
        startY: finalY + 16,
        head: [['Data Venc.', 'Produtor / Cliente', 'Descrição', 'Nº Nota', 'Valor']],
        body: recordsRows,
        headStyles: { fillColor: [16, 185, 129] },
        styles: { fontSize: 8.5 }
      });
    } else {
      doc.setFontSize(9);
      doc.setFont('Helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      doc.text('Nenhum lançamento conciliado para esta competência.', 15, finalY + 20);
    }

    doc.save(`DRE_AgroGestao_Pro_${dreMonth}.pdf`);
    toast.success("DRE exportado em PDF com sucesso!");
  };

  const statusBadge = {
    pending: { label: 'Pendente', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    paid: { label: 'Pago', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    overdue: { label: 'Atrasado', color: 'bg-rose-100 text-rose-800 border-rose-200' },
    cancelled: { label: 'Cancelado', color: 'bg-slate-100 text-slate-800 border-slate-250' }
  };

  return (
    <div className="space-y-6">
      
      {/* Page Header banner */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Financeiro" subtitle="Recebimentos, despesas, faturamento e conciliação" />

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={handleExportXLSX}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel
          </button>
          <button
            onClick={handleExportPDF}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl"
          >
            <FileText className="w-4 h-4 text-emerald-600" /> PDF
          </button>
          
          {isManagement && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold rounded-xl transition-all shadow-md shadow-emerald-100 active:scale-95"
            >
              <PlusCircle className="w-5 h-5" /> Adicionar Lançamento
            </button>
          )}
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('flow')}
          className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'flow'
              ? "border-emerald-600 text-emerald-700 font-black"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Fluxo de Caixa
        </button>
        <button
          onClick={() => setActiveTab('dre')}
          className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'dre'
              ? "border-emerald-600 text-emerald-700 font-black"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          DRE Mensal
        </button>
      </div>

      {activeTab === 'flow' ? (
        <>
          {/* KPIs Grid display */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Receita Mensal ({currentMonthStr}/{currentYearStr})</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-display font-bold text-emerald-700">R$ {monthlyRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold uppercase py-0.5 px-1.5 rounded-md">Mês</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Faturamento do Ano ({currentYearStr})</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-display font-bold text-emerald-800">R$ {yearlyRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold uppercase py-0.5 px-1.5 rounded-md">Ano</span>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total em Aberto (Cobrar)</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-display font-bold text-amber-700">R$ {totalOpen.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold uppercase py-0.5 px-1.5 rounded-md">Aberto</span>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ticket Médio por Serviço</span>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-xl font-display font-bold text-slate-700">R$ {averageTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            <span className="text-[10px] bg-slate-100 text-slate-800 font-bold uppercase py-0.5 px-1.5 rounded-md">Média</span>
          </div>
        </div>
      </div>

      {/* Charts section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recorrencia mensal faturamento Bar */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" /> Faturamento por Mês (Últimos 6 meses)
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={getMonthlyChartData()}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" fontSize={11} stroke="#94a3b8" />
                <YAxis fontSize={11} stroke="#94a3b8" />
                <Tooltip formatter={(value) => `R$ ${value.toLocaleString('pt-BR')}`} />
                <Bar dataKey="Receita" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Categorias Pie Chart */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Distribuição por Categoria</h3>
          <div className="h-44 w-full relative flex items-center justify-center">
            {getCategoryPieData().length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={getCategoryPieData()}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {getCategoryPieData().map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `R$ ${value.toLocaleString('pt-BR')}`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400">Nenhum dado faturado no período</p>
            )}
          </div>
          
          <div className="space-y-1.5 mt-2">
            {getCategoryPieData().map((item, index) => (
              <div key={item.name} className="flex justify-between text-xs items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                  <span className="text-slate-600">{item.name}</span>
                </div>
                <span className="font-bold text-slate-800">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 space-y-1.5 w-full">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Buscar por Lançamento/Cliente</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                placeholder="Pesquise por nome do produtor rural ou descrição do faturamento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full glass-input pl-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 w-full md:w-auto md:min-w-[400px]">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Categoria</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full glass-input text-xs"
              >
                <option value="all">Todas</option>
                <option value="analysis">Análises</option>
                <option value="irrigation">Irrigação</option>
                <option value="topography">Topografia</option>
                <option value="credit">Crédito</option>
                <option value="regularization">Regularização</option>
                <option value="field_visit">Visitas</option>
                <option value="contract">Contratos</option>
                <option value="other">Outros</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Mês Ref.</label>
              <input 
                type="month"
                value={monthFilter === 'all' ? '' : monthFilter}
                onChange={(e) => setMonthFilter(e.target.value || 'all')}
                className="w-full glass-input text-xs h-10 py-1"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full glass-input text-xs"
              >
                <option value="all">Todos</option>
                <option value="paid">Pago</option>
                <option value="pending">Pendente</option>
                <option value="overdue">Atrasado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          </div>
        </div>

        {/* MELHORIA 5: Filtro de Período Personalizado */}
        <div className="flex flex-col sm:flex-row gap-4 pt-3 border-t border-slate-100 items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold uppercase tracking-wider">
            <Calendar className="w-4 h-4 text-emerald-600" />
            Filtro de Período (Dívidas/Vencimentos)
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase">De:</span>
              <input 
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="glass-input text-xs max-w-[140px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Até:</span>
              <input 
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="glass-input text-xs max-w-[140px]"
              />
            </div>
            {(startDateFilter || endDateFilter) && (
              <button
                onClick={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-black uppercase text-[9px] tracking-wider rounded-lg transition-colors cursor-pointer"
              >
                Limpar Período
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Ledger Table list */}
      {loading ? (
        <SkeletonList variant="table" count={5} />
      ) : filteredRecords.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
          <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-600">Nenhum lançamento corresponde à busca</h4>
          <p className="text-xs text-slate-400 mt-1">Crie novos faturamentos administrativos para alimentar o fluxo de caixa.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm relative z-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4">Vencimento</th>
                  <th className="px-6 py-4">Produtor / Cliente</th>
                  <th className="px-6 py-4">Serviço / Descrição</th>
                  <th className="px-6 py-4">Meio Pagto.</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Valor</th>
                  {isManagement && <th className="px-6 py-4 text-center">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredRecords.map((item) => {
                  const status = statusBadge[item.status] || statusBadge.pending;
                  
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {formatDate(item.dueDate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-slate-800">{item.clientName}</span>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <span className="font-medium text-slate-700 block truncate" title={item.description}>{item.description}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 mt-1 inline-block">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs uppercase font-mono text-slate-500 whitespace-nowrap">
                        {item.paymentMethod || 'Dinheiro'}
                      </td>
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <span className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg uppercase tracking-wider ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <span className="font-display font-bold text-emerald-700">
                          R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </td>

                      {isManagement && (
                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          {/* Dropdowns of actions */}
                          <div className="flex justify-center items-center gap-1.5">
                            {item.status !== 'paid' && (
                              <button
                                onClick={() => handleToggleState(item, 'paid')}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                title="Marcar como pago"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                            
                            {item.status !== 'cancelled' && (
                              <button
                                onClick={() => handleToggleState(item, 'cancelled')}
                                className="p-1 text-slate-400 hover:bg-slate-50 rounded"
                                title="Cancelar faturamento"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            )}

                            {(user?.effectiveRole ?? user?.role) === 'admin' && (
                            <button
                              onClick={() => setIsDeleteModalOpen(item.id)}
                              className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      ) : activeTab === 'dre' ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Monthly Selection and Info */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display font-bold text-slate-800">Demonstrativo de Resultado de Exercício (DRE)</h2>
              <p className="text-xs text-slate-500">Resultados operacionais e fiscais consolidados sob regime de competência de faturamento</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Mês de Competência:</span>
                <input
                  type="month"
                  value={dreMonth}
                  onChange={(e) => setDreMonth(e.target.value)}
                  className="glass-input text-xs font-bold w-40 animate-pulse-subtle"
                />
              </div>
              <button
                onClick={handleExportDrePDF}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold rounded-xl transition-all cursor-pointer w-full sm:w-auto shadow-md shadow-emerald-100"
              >
                <FileText className="w-4 h-4" /> Exportar PDF
              </button>
            </div>
          </div>

          {/* DRE Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white p-6 rounded-[2rem] shadow-md relative overflow-hidden flex flex-col justify-between h-40">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <DollarSign className="w-24 h-24" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Faturamento Bruto</span>
              <span className="text-3xl font-black">R$ {dreStats.bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              <span className="text-[10px] bg-white/20 px-2.5 py-1 rounded-full w-max text-xs font-bold">Consolidado em {dreMonth}</span>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-between h-40">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Custos & Impostos</span>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Impostos estimados (6%):</span>
                  <span className="font-bold">R$ {dreStats.deducoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Despesas reais do período:</span>
                  <span className="font-bold">R$ {dreStats.custos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between text-sm font-bold text-slate-700">
                <span>Total Retido:</span>
                <span>R$ {(dreStats.deducoes + dreStats.custos).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white p-6 rounded-[2rem] shadow-md relative overflow-hidden flex flex-col justify-between h-40">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <TrendingUp className="w-24 h-24" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Resultado Líquido</span>
              <span className="text-3xl font-black">R$ {dreStats.resultado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              <span className="text-[10px] bg-white/20 px-2.5 py-1 rounded-full w-max text-xs font-bold">Margem Operacional: 59.0%</span>
            </div>
          </div>

          {/* DRE Spreadsheet Representation */}
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden p-6 md:p-8">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-6 pb-2 border-b border-slate-150">DRE Detalhado — Competência {dreMonth}</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm font-bold text-slate-800 py-2 border-b border-slate-100">
                <span>(1) RECEITA BRUTA DE SERVIÇOS</span>
                <span className="font-mono font-bold">R$ {dreStats.bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-xs text-slate-500 pl-4 py-1.5">
                <span>(-) Impostos estimados (6% — alíquota padrão; confirme com seu contador)</span>
                <span className="font-mono text-rose-500 font-bold">- R$ {dreStats.deducoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-sm font-bold text-slate-700 py-2 border-b border-slate-100 bg-slate-50/50 px-3 rounded-lg">
                <span>(=) RECEITA LÍQUIDA OPERACIONAL</span>
                <span className="font-mono font-bold">R$ {dreStats.liquida.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-xs text-slate-500 pl-4 py-1.5">
                <span>(-) Despesas reais lançadas (reembolsos aprovados e saídas pagas)</span>
                <span className="font-mono text-rose-500 font-bold">- R$ {dreStats.custos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-base font-black text-emerald-700 py-3 border-t border-b border-emerald-100 bg-emerald-50/40 px-3 rounded-lg">
                <span>(=) RESULTADO OPERACIONAL LÍQUIDO</span>
                <span className="font-mono font-bold">R$ {dreStats.resultado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* List of launch items included */}
            <div className="mt-8 space-y-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Documentos e Faturamentos Vinculados ({dreMonthRecords.length})</h4>
              {dreMonthRecords.length > 0 ? (
                <div className="divide-y divide-slate-100 border border-slate-200/60 rounded-2xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                  {dreMonthRecords.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-3 hover:bg-slate-50 text-xs">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-700">{item.description}</span>
                        <div className="flex gap-2 items-center text-[10px] text-slate-400 mt-1">
                          <span className="font-medium bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[8px] uppercase">PAGO</span>
                          <span>{item.clientName}</span>
                          {item.nfse && <span className="bg-slate-100 text-slate-600 px-1 rounded font-mono">NF-Se #{item.nfse}</span>}
                        </div>
                      </div>
                      <span className="font-mono font-bold text-slate-800">R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
                  Nenhum faturamento conciliado para esta competência.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fadeIn">
          {/* EXPENSE REPORTS CONTENT */}
          {/* KPIs for Expenses */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Despesas Pendentes</span>
                <span className="text-xl font-display font-bold text-amber-600 mt-1 block">
                  R$ {expenseReports.filter(r => r.status === 'pending_approval').reduce((s, r) => s + r.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-10 h-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center font-mono text-sm font-bold">
                {expenseReports.filter(r => r.status === 'pending_approval').length}
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Homologadas (Contabilizadas)</span>
                <span className="text-xl font-display font-bold text-emerald-600 mt-1 block">
                  R$ {expenseReports.filter(r => r.status === 'approved').reduce((s, r) => s + r.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-mono text-sm font-bold">
                {expenseReports.filter(r => r.status === 'approved').length}
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Solicitações Recusadas</span>
                <span className="text-xl font-display font-bold text-rose-500 mt-1 block">
                  R$ {expenseReports.filter(r => r.status === 'rejected').reduce((s, r) => s + r.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-10 h-10 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center font-mono text-sm font-bold">
                {expenseReports.filter(r => r.status === 'rejected').length}
              </div>
            </div>
          </div>

          {/* Table list of Expense Reports */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Histórico de Reembolsos e Despesas de Viagem</h3>
                <p className="text-xs text-slate-500 mt-0.5">Qualquer despesa criada por funcionário ou gerente necessita de homologação do administrador antes de ser contabilizada.</p>
              </div>
              <button
                onClick={() => setIsExpenseModalOpen(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-50 cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PlusCircle className="w-4 h-4" /> Nova Solicitação de Despesa
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                    <th className="px-6 py-4">Vencimento/Gasto</th>
                    <th className="px-6 py-4">Colaborador</th>
                    <th className="px-6 py-4">Categoria</th>
                    <th className="px-6 py-4">Descrição</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                    <th className="px-6 py-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {expenseReports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic text-xs">
                        Nenhuma solicitação de despesa lançada no sistema.
                      </td>
                    </tr>
                  ) : (
                    expenseReports.map((report) => {
                      const categoryLabels: Record<string, string> = {
                        combustivel: 'Combustível',
                        alimentacao: 'Alimentação',
                        hospedagem: 'Hospedagem',
                        equipamentos: 'Equipamentos',
                        outros: 'Outros'
                      };
                      return (
                        <tr key={report.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="px-6 py-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                            {formatDate(report.dueDate)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-800">{report.createdByName}</span>
                              <span className="text-[10px] text-slate-400 uppercase font-mono">{report.createdByRole}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                              {categoryLabels[report.category] || report.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 max-w-xs">
                            <span className="font-medium text-slate-700 block truncate" title={report.description}>
                              {report.description}
                            </span>
                            {report.notes && (
                              <p className="text-[10px] text-slate-400 italic truncate mt-0.5">"{report.notes}"</p>
                            )}
                            {report.approvalNotes && (
                              <p className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 mt-1 inline-block">
                                💬 Parecer do Admin: "{report.approvalNotes}"
                              </p>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center whitespace-nowrap">
                            <span className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg uppercase tracking-wider ${
                              report.status === 'approved' 
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : report.status === 'rejected'
                                ? 'bg-rose-100 text-rose-800 border-rose-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                            }`}>
                              {report.status === 'approved' 
                                ? 'Aprovado' 
                                : report.status === 'rejected' 
                                ? 'Recusado' 
                                : 'Pendente de Aprovação'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap font-display font-bold text-slate-700">
                            R$ {report.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-center whitespace-nowrap">
                            {report.status === 'pending_approval' ? (
                              (user?.effectiveRole ?? user?.role) === 'admin' ? (
                                <button
                                  onClick={() => {
                                    setSelectedExpenseReport(report);
                                    setIsExpenseApprovalModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase rounded-lg transition-all flex items-center gap-1 mx-auto cursor-pointer"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" /> Avaliar
                                </button>
                              ) : (
                                <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1 justify-center">
                                  <Clock className="w-3.5 h-3.5" /> Aguardando Admin
                                </span>
                              )
                            ) : (
                              <span className="text-xs text-slate-400 font-medium">Avaliado</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Multi-step Addition Form Dialog */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-lg p-6 md:p-8 space-y-6 relative text-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Lançamento de Faturamento</h3>
                    <p className="text-xs text-slate-500">Passo {currentStep} de 3 — Progresso: {Math.round((currentStep / 3) * 100)}%</p>
                  </div>
                </div>
                <button onClick={() => { setIsAddModalOpen(false); resetForm(); }} className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Progress visual bar */}
              <div className="flex gap-1.5 px-1">
                {[1, 2, 3].map(step => (
                  <div key={step} className={`flex-1 h-1 rounded-full ${step === currentStep ? 'bg-emerald-600' : step < currentStep ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                ))}
              </div>

              <div className="py-2">
                
                {/* Step 1: Core Details */}
                {currentStep === 1 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Produtor / Cliente</label>
                      <select
                        value={formClientId}
                        onChange={(e) => setFormClientId(e.target.value)}
                        className="w-full glass-input"
                        required
                      >
                        <option value="">Selecione o Cliente</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Categoria de Caixa</label>
                        <select
                          value={formCategory}
                          onChange={(e: any) => setFormCategory(e.target.value)}
                          className="w-full glass-input"
                        >
                          <option value="analysis">Análises Técnicas</option>
                          <option value="irrigation">Irrigação</option>
                          <option value="topography">Topografia</option>
                          <option value="credit">Crédito Rural</option>
                          <option value="regularization">Regularização</option>
                          <option value="field_visit">Visitas de Campo</option>
                          <option value="contract">Contrato</option>
                          <option value="other">Outros</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Valor (R$)</label>
                        <input 
                          type="text"
                          required
                          value={formValue}
                          onChange={(e) => setFormValue(e.target.value)}
                          className="w-full glass-input text-emerald-700 font-bold"
                          placeholder="0,00"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Descrição</label>
                      <input 
                        type="text"
                        required
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        className="w-full glass-input"
                        placeholder="Ex: Pagamento referente ao laudo técnico de solo da Gleba A"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Data de Vencimento</label>
                      <input 
                        type="date"
                        required
                        value={formDueDate}
                        onChange={(e) => setFormDueDate(e.target.value)}
                        className="w-full glass-input"
                      />
                    </div>
                  </div>
                )}

                {/* Step 2: Link service */}
                {currentStep === 2 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Vincular Serviço em Execução (Opcional)</label>
                      <select
                        value={formLinkedServiceId}
                        onChange={(e) => setFormLinkedServiceId(e.target.value)}
                        className="w-full glass-input"
                      >
                        <option value="">Nenhum Serviço Direto</option>
                        {analyses.filter(a => a.clientId === formClientId).map(a => (
                          <option key={a.id} value={a.id}>{a.propertyName || 'Fazenda'} - {(a.type || '').toUpperCase()}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 max-w-md">Isso vincula esta cobrança a uma análise técnica ativa.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Meio de Pagamento Preferencial</label>
                      <select
                        value={formPaymentMethod}
                        onChange={(e: any) => setFormPaymentMethod(e.target.value)}
                        className="w-full glass-input"
                      >
                        <option value="pix">PIX</option>
                        <option value="boleto">Boleto</option>
                        <option value="transferencia">Transferência Bancária</option>
                        <option value="dinheiro">Dinheiro vivo</option>
                        <option value="cheque">Cheque Rural</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Mês de Competência</label>
                        <input
                          type="month"
                          value={formCompetencia}
                          onChange={(e) => setFormCompetencia(e.target.value)}
                          className="w-full glass-input"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Número NF-Se (Opcional)</label>
                        <input
                          type="text"
                          value={formNfse}
                          onChange={(e) => setFormNfse(e.target.value)}
                          placeholder="Ex: 202604"
                          className="w-full glass-input"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Observações / Notas Administrativas</label>
                      <textarea
                        rows={3}
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        className="w-full glass-input py-2.5"
                        placeholder="Quaisquer condições especiais acordadas..."
                      />
                    </div>
                  </div>
                )}

                {/* Step 3: Review & Confirm */}
                {currentStep === 3 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 space-y-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detalhamento para Gravação</h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Cliente</span>
                          <span className="font-bold text-slate-700">{clients.find(c => c.id === formClientId)?.name || 'Empresa'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Valor do Serviço</span>
                          <span className="font-bold text-emerald-700">{formatCurrency(parseFloat(formValue.replace(',', '.')))}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Vencimento Cobrança</span>
                          <span className="font-bold text-slate-700">{formatDate(formDueDate)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Meio de Pagamento</span>
                          <span className="font-bold text-slate-700 uppercase">{formPaymentMethod}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Status de Cadastro</label>
                      <select
                        value={formStatus}
                        onChange={(e: any) => setFormStatus(e.target.value)}
                        className="w-full glass-input text-xs font-bold font-mono"
                      >
                        <option value="pending">Aguardando Pagamento (Pendente)</option>
                        <option value="paid">Já está Pago (Conciliação imediata)</option>
                        <option value="overdue">Atrasado</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </div>
                  </div>
                )}

              </div>

              {/* Navigation buttons */}
              <div className="flex gap-3 justify-between border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={() => setCurrentStep(prev => prev - 1)}
                  disabled={currentStep === 1 || saving}
                  className="px-4 py-2.5 glass text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-50 disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar
                </button>

                {currentStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentStep === 1 && (!formClientId || !formValue)) {
                        toast.error("Por favor preencha o cliente e o valor.");
                        return;
                      }
                      setCurrentStep(prev => prev + 1);
                    }}
                    className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    Próximo <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => runExclusive('Financial.handleSaveTransaction', () => handleSaveTransaction())}
                    disabled={saving}
                    className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-200 active:scale-95 disabled:opacity-70"
                  >
                    {saving ? 'Salvando...' : 'Gravar Faturamento'} <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={isDeleteModalOpen !== null}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={handleDeleteEntry}
        title="Cancelar Lançamento?"
        description="Esta ação impossibilitará conciliar este faturamento rural. Os relatórios de produtividade fiscal serão alterados permanentemente."
      />

      {/* Modal de Nova Solicitação de Despesa */}
      <AnimatePresence>
        {isExpenseModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-lg p-6 md:p-8 space-y-6 relative text-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-lg flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Solicitar Reembolso / Despesa</h3>
                    <p className="text-xs text-slate-500">Envie um comprovante ou lançamento para aprovação administrativa.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsExpenseModalOpen(false)} 
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Financial.handleSaveExpenseReport', () => handleSaveExpenseReport(e)); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Categoria</label>
                    <select
                      value={expenseFormCategory}
                      onChange={(e: any) => setExpenseFormCategory(e.target.value)}
                      className="w-full glass-input"
                    >
                      <option value="combustivel">Combustível / Km</option>
                      <option value="alimentacao">Alimentação / Refeição</option>
                      <option value="hospedagem">Hospedagem / Hotel</option>
                      <option value="equipamentos">Equipamentos / Insumos</option>
                      <option value="outros">Outros Gastos de Viagem</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Valor do Gasto (R$)</label>
                    <input
                      type="text"
                      required
                      value={expenseFormValue}
                      onChange={(e) => setExpenseFormValue(e.target.value)}
                      className="w-full glass-input text-slate-700 font-bold"
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Data do Gasto / Vencimento</label>
                  <input
                    type="date"
                    required
                    value={expenseFormDueDate}
                    onChange={(e) => setExpenseFormDueDate(e.target.value)}
                    className="w-full glass-input"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Descrição Curta</label>
                  <input
                    type="text"
                    required
                    value={expenseFormDescription}
                    onChange={(e) => setExpenseFormDescription(e.target.value)}
                    className="w-full glass-input"
                    placeholder="Ex: Combustível visita fazenda Santa Luzia"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Observações / Detalhes</label>
                  <textarea
                    value={expenseFormNotes}
                    onChange={(e) => setExpenseFormNotes(e.target.value)}
                    className="w-full glass-input min-h-[80px]"
                    placeholder="Detalhe o motivo da despesa ou insira links de recibos..."
                  />
                </div>

                <div className="flex gap-3 justify-end border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={() => setIsExpenseModalOpen(false)}
                    className="px-4 py-2.5 glass text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase shadow-md active:scale-95 disabled:opacity-70"
                  >
                    {saving ? 'Enviando...' : 'Solicitar Reembolso'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Avaliação de Despesa pelo Administrador */}
      <AnimatePresence>
        {isExpenseApprovalModalOpen && selectedExpenseReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-lg p-6 md:p-8 space-y-6 relative text-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Avaliar Despesa de Viagem</h3>
                    <p className="text-xs text-slate-500">Homologação de reembolso de funcionário ou gerente.</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsExpenseApprovalModalOpen(false);
                    setSelectedExpenseReport(null);
                    setExpenseApprovalNotes('');
                  }} 
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-400 uppercase font-bold tracking-wider block">Colaborador</span>
                    <span className="font-bold text-slate-800 block text-sm mt-0.5">{selectedExpenseReport.createdByName}</span>
                    <span className="text-[10px] text-slate-400 uppercase font-mono">Cargo: {selectedExpenseReport.createdByRole}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 uppercase font-bold tracking-wider block">Valor Requerido</span>
                    <span className="font-display font-bold text-emerald-700 block text-base mt-0.5">
                      R$ {selectedExpenseReport.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 uppercase font-bold tracking-wider block">Descrição do Gasto</span>
                  <span className="font-semibold text-slate-700 mt-0.5 block">{selectedExpenseReport.description}</span>
                </div>

                {selectedExpenseReport.notes && (
                  <div>
                    <span className="text-slate-400 uppercase font-bold tracking-wider block">Observações do Colaborador</span>
                    <p className="text-slate-600 italic bg-white p-2 rounded-lg border border-slate-200/50 mt-1">"{selectedExpenseReport.notes}"</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Parecer de Homologação / Motivo (Aprovado ou Recusado)</label>
                <textarea
                  value={expenseApprovalNotes}
                  onChange={(e) => setExpenseApprovalNotes(e.target.value)}
                  className="w-full glass-input min-h-[80px]"
                  placeholder="Insira observações de justificativa para o colaborador e relatórios..."
                  required
                />
              </div>

              <div className="flex gap-3 justify-end border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={() => {
                    setIsExpenseApprovalModalOpen(false);
                    setSelectedExpenseReport(null);
                    setExpenseApprovalNotes('');
                  }}
                  className="px-4 py-2.5 glass text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingExpenseDecision || !expenseApprovalNotes.trim()}
                  onClick={() => runExclusive('Financial.handleRejectExpenseReport', () => handleRejectExpenseReport(selectedExpenseReport))}
                  className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl font-bold text-xs uppercase flex items-center gap-1 transition-all disabled:opacity-50"
                >
                  Recusar Despesa
                </button>
                <button
                  type="button"
                  disabled={savingExpenseDecision || !expenseApprovalNotes.trim()}
                  onClick={() => runExclusive('Financial.handleApproveExpenseReport', () => handleApproveExpenseReport(selectedExpenseReport))}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-md shadow-emerald-100"
                >
                  {savingExpenseDecision ? 'Processando...' : 'Aprovar & Lançar Caixa'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
