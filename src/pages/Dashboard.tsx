import React, { useEffect, useState, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  Users, 
  MapPin, 
  CheckCircle2, 
  Clock,
  RefreshCw,
  AlertCircle,
  Calendar,
  ClipboardList,
  DollarSign,
  Package,
  FilePen,
  Leaf,
  Target,
  X,
  Printer,
  ArrowUp,
  ArrowDown,
  RotateCcw
} from 'lucide-react';
import PrintPreviewModal from '../components/PrintPreviewModal';
import { collection, query, limit, orderBy, onSnapshot, where, doc as fsDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Client, UserProfile, VacationRequest, InternalMessage, FieldVisit, FinancialRecord, InventoryItem, Contract, Vehicle } from '../types';
import { formatDate, cn, handleFirestoreError, OperationType, getAuthToken, todayLocalDateString, sortByDateDesc } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import AgendaWidget from '../components/AgendaWidget';
import PersonalReminders from '../components/PersonalReminders';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend,
  AreaChart,
  Area,
  CartesianGrid
} from 'recharts';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { LayoutDashboard as PageIcon } from 'lucide-react';

interface AgNews {
  id: string;
  title: string;
  source: string;
  time: string;
  summary: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [recentClients, setRecentClients] = useState<Client[]>([]);
  const [news, setNews] = useState<AgNews[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(false);
  const [recentUsers, setRecentUsers] = useState<UserProfile[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  
  const activeRoleDash = user?.effectiveRole ?? user?.role;
  const isManagement = activeRoleDash === 'admin' || activeRoleDash === 'hr' || activeRoleDash === 'manager';
  // Financeiro e contratos: só Gerente/Administrador (firestore.rules)
  const canSeeFinance = activeRoleDash === 'admin' || activeRoleDash === 'manager';

  const [stats, setStats] = useState({
    pendingAnalyses: 0,
    inProgressAnalyses: 0,
    completedAnalyses: 0,
    totalClients: 0,
    totalUsers: 0,
    unreadMessages: 0,
    unreadNotifications: 0,
    creditRevenue: 0
  });

  const [recentMessages, setRecentMessages] = useState<InternalMessage[]>([]);
  const [newsQuotaExceeded, setNewsQuotaExceeded] = useState(false);

  const [chartData, setChartData] = useState<any[]>([]);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);

  const navigate = useNavigate();
  const [checkingAlerts, setCheckingAlerts] = useState(false);

  const handleCheckAlerts = async () => {
    setCheckingAlerts(true);
    const toastId = toast.loading('Verificando pendências e gerando alertas por e-mail...');
    try {
      const idToken = await getAuthToken();
      
      const response = await fetch('/api/notifications/check', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) {
        throw new Error('Erro na resposta do servidor.');
      }
      const data = await response.json();
      toast.success(data.message || 'Alertas verificados e processados!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Falha ao processar os alertas automáticos.', { id: toastId });
    } finally {
      setCheckingAlerts(false);
    }
  };

  // Novos estados
  const [visitsThisMonth, setVisitsThisMonth] = useState(0);
  const [financialOverdue, setFinancialOverdue] = useState({ count: 0, total: 0 });
  const [inventoryAlerts, setInventoryAlerts] = useState(0);
  const [contractsExpiring, setContractsExpiring] = useState(0);
  const [recentVisits, setRecentVisits] = useState<FieldVisit[]>([]);

  // Estados para Metas Mensais
  const [financialRecords, setFinancialRecords] = useState<FinancialRecord[]>([]);
  const [faturamentoMeta, setFaturamentoMeta] = useState<number>(() => {
    const saved = localStorage.getItem('meta_faturamento');
    return saved ? parseFloat(saved) : 60000;
  });
  const [producaoMeta, setProducaoMeta] = useState<number>(() => {
    const saved = localStorage.getItem('meta_producao');
    return saved ? parseFloat(saved) : 500;
  });
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [tempFaturamento, setTempFaturamento] = useState('');
  const [tempProducao, setTempProducao] = useState('');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const DEFAULT_MODULE_ORDER = [
    'statCards',
    'alertsOfTheDay',
    'kpis',
    'desempenho',
    'fluxoCaixa',
    'safra',
    'metas',
    'noticias',
    'visitasRecentes',
    'agenda',
    'lembretes'
  ];

  const ALL_MODULE_METADATA: Record<string, { label: string; desc: string }> = {
    statCards: { label: 'Indicadores Rápidos (Clientes, Relatórios...)', desc: 'Resumo com contagens gerais no topo' },
    alertsOfTheDay: { label: 'Alertas Críticos do Dia', desc: 'Alertas importantes como vencimentos e estoque baixo' },
    kpis: { label: 'Faixa de KPIs Operacionais', desc: 'Contadores de visitas, cobranças e estoque crítico' },
    desempenho: { label: 'Gráfico Desempenho Semestral', desc: 'Análise de serviços ativos vs receita de crédito' },
    fluxoCaixa: { label: 'Gráfico Fluxo de Caixa Comparativo', desc: 'Entradas vs Saídas consolidadas' },
    safra: { label: 'Gráfico de Safra & Produção', desc: 'Estimativas de safras em toneladas' },
    metas: { label: 'Widget de Metas Mensais', desc: 'Progresso do faturamento e hectares assistidos' },
    noticias: { label: 'Widget de Notícias do Campo', desc: 'Manchetes e clima do agronegócio por IA' },
    visitasRecentes: { label: 'Widget de Visitas Técnicas Recentes', desc: 'Histórico recente de campo' },
    agenda: { label: 'Agenda de Compromissos Integrada', desc: 'Seus próximos eventos' },
    lembretes: { label: 'Lembretes e Notas Pessoais', desc: 'Suas tarefas e notas com priorização' }
  };

  const [moduleOrder, setModuleOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('dashboard_module_order');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [...parsed, ...DEFAULT_MODULE_ORDER.filter(k => !parsed.includes(k))];
        }
      } catch (e) {}
    }
    return DEFAULT_MODULE_ORDER;
  });

  const moveModule = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= moduleOrder.length) return;
    const updated = [...moduleOrder];
    const [moved] = updated.splice(index, 1);
    updated.splice(newIndex, 0, moved);
    setModuleOrder(updated);
    localStorage.setItem('dashboard_module_order', JSON.stringify(updated));
    toast.success('Posição do widget atualizada!');
  };

  const handleResetLayout = () => {
    setModuleOrder(DEFAULT_MODULE_ORDER);
    localStorage.setItem('dashboard_module_order', JSON.stringify(DEFAULT_MODULE_ORDER));
    const allVisible = DEFAULT_MODULE_ORDER.reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setVisibleModules(allVisible);
    localStorage.setItem('dashboard_personalization', JSON.stringify(allVisible));
    toast.success('Layout do painel restaurado para o padrão!');
  };

  const [visibleModules, setVisibleModules] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('dashboard_personalization');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      statCards: true,
      alertsOfTheDay: true,
      kpis: true,
      desempenho: true,
      fluxoCaixa: true,
      safra: true,
      metas: true,
      noticias: true,
      visitasRecentes: true,
      agenda: true,
      lembretes: true
    };
  });

  const toggleModule = (moduleKey: string) => {
    const updated = { ...visibleModules, [moduleKey]: !visibleModules[moduleKey] };
    setVisibleModules(updated);
    localStorage.setItem('dashboard_personalization', JSON.stringify(updated));
    toast.success('Visualização do painel atualizada!');
  };

  // Cálculos de Metas Mensais
  const currentMonthStr = useMemo(() => {
    return todayLocalDateString().substring(0, 7); // "YYYY-MM"
  }, []);

  const monthLabel = useMemo(() => {
    return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }, []);

  const financialsThisMonth = useMemo(() => {
    return financialRecords.filter(r => {
      const rMonth = (r.paymentDate || r.dueDate || r.createdAt || '').substring(0, 7);
      return rMonth === currentMonthStr;
    });
  }, [financialRecords, currentMonthStr]);

  const faturamentoRealizado = useMemo(() => {
    return financialsThisMonth
      .filter(r => r.status === 'paid')
      .reduce((sum, r) => sum + (r.value || 0), 0);
  }, [financialsThisMonth]);

  const faturamentoPendente = useMemo(() => {
    return financialsThisMonth
      .filter(r => r.status === 'pending')
      .reduce((sum, r) => sum + (r.value || 0), 0);
  }, [financialsThisMonth]);

  const producaoAgrícolaRealizada = useMemo(() => {
    // Calculado a partir de financiamento, irrigação e field_visit contratados e pagos
    const totalAgronomicInvestments = financialsThisMonth
      .filter(r => r.status === 'paid' && ['irrigation', 'credit', 'field_visit', 'analysis'].includes(r.category))
      .reduce((sum, r) => sum + (r.value || 0), 0);
    
    // R$ 100 pagos em categorias agrárias equivalem a 1 hectare assistido/produzido
    const calculatedHa = Math.round(totalAgronomicInvestments / 100);
    return calculatedHa || 0;
  }, [financialsThisMonth]);

  const faturamentoPercentm = useMemo(() => {
    if (faturamentoMeta <= 0) return 0;
    return Math.min(100, Math.round((faturamentoRealizado / faturamentoMeta) * 100));
  }, [faturamentoRealizado, faturamentoMeta]);

  const producaoPercentm = useMemo(() => {
    if (producaoMeta <= 0) return 0;
    return Math.min(100, Math.round((producaoAgrícolaRealizada / producaoMeta) * 100));
  }, [producaoAgrícolaRealizada, producaoMeta]);

  // Metas mensais ficam no banco (settings/dashboard_goals), iguais em todos
  // os computadores. Antes ficavam só neste PC: com dois computadores cada um
  // mostrava uma meta diferente. O valor local continua como reserva offline.
  useEffect(() => {
    const unsub = onSnapshot(fsDoc(db, 'settings', 'dashboard_goals'), (snap) => {
      const d = snap.data();
      if (typeof d?.faturamentoMeta === 'number' && d.faturamentoMeta > 0) {
        setFaturamentoMeta(d.faturamentoMeta);
        localStorage.setItem('meta_faturamento', String(d.faturamentoMeta));
      }
      if (typeof d?.producaoMeta === 'number' && d.producaoMeta > 0) {
        setProducaoMeta(d.producaoMeta);
        localStorage.setItem('meta_producao', String(d.producaoMeta));
      }
    }, () => { /* sem acesso: fica o valor local */ });
    return () => unsub();
  }, []);

  const handleSaveMetas = async (e: React.FormEvent) => {
    e.preventDefault();
    const fVal = parseFloat(tempFaturamento);
    const pVal = parseFloat(tempProducao);
    const update: Record<string, any> = {};
    if (!isNaN(fVal) && fVal > 0) update.faturamentoMeta = fVal;
    if (!isNaN(pVal) && pVal > 0) update.producaoMeta = pVal;
    if (Object.keys(update).length === 0) { setIsEditingMeta(false); return; }
    try {
      await setDoc(fsDoc(db, 'settings', 'dashboard_goals'), {
        ...update,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid || '',
      }, { merge: true });
      if (update.faturamentoMeta) setFaturamentoMeta(update.faturamentoMeta);
      if (update.producaoMeta) setProducaoMeta(update.producaoMeta);
      setIsEditingMeta(false);
      toast.success('Metas mensais atualizadas para toda a equipe!');
    } catch {
      toast.error('Somente Administrador, Gerente ou RH podem alterar as metas mensais.');
    }
  };

  const handleOpenEditMetas = () => {
    setTempFaturamento(faturamentoMeta.toString());
    setTempProducao(producaoMeta.toString());
    setIsEditingMeta(true);
  };

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [allInventoryItems, setAllInventoryItems] = useState<InventoryItem[]>([]);
  const [allContracts, setAllContracts] = useState<Contract[]>([]);

  // Consolidated Firestore onSnapshot listeners
  useEffect(() => {
    if (!user) return;

    const unsubs: (() => void)[] = [];

    // 1. Field Visits
    const qVisits = query(collection(db, 'field_visits'), orderBy('createdAt', 'desc'), limit(100));
    unsubs.push(onSnapshot(qVisits, (snap) => {
      const thisMonth = todayLocalDateString().substring(0, 7);
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as FieldVisit));
      setVisitsThisMonth(all.filter(v => v.visitDate?.startsWith(thisMonth)).length);
      setRecentVisits(all.sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || '')).slice(0, 4));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'field_visits');
    }));

    // 2. Financials (só Gerente/Admin lê o financeiro — ver firestore.rules)
    const qFinancials = query(collection(db, 'financials'), orderBy('createdAt', 'desc'), limit(100));
    if (canSeeFinance) unsubs.push(onSnapshot(qFinancials, (snap) => {
      const today = todayLocalDateString();
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as FinancialRecord));
      setFinancialRecords(all);
      const overdue = all.filter(r => r.status === 'overdue' || (r.status === 'pending' && r.dueDate < today));
      setFinancialOverdue({
        count: overdue.length,
        total: overdue.reduce((s, r) => s + (r.value || 0), 0),
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'financials');
    }));

    // 3. Inventory Items
    const qInventory = query(collection(db, 'inventory_items'), orderBy('createdAt', 'desc'), limit(100));
    unsubs.push(onSnapshot(qInventory, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
      setAllInventoryItems(all);
      setInventoryAlerts(all.filter(item => (item.currentQuantity || 0) <= (item.minQuantity || 0)).length);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventory_items');
    }));

    // 4. Contracts
    const qContracts = query(collection(db, 'contracts'), orderBy('createdAt', 'desc'), limit(100));
    if (canSeeFinance) unsubs.push(onSnapshot(qContracts, (snap) => {
      const today = todayLocalDateString();
      const in30 = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Contract));
      setAllContracts(all);
      setContractsExpiring(all.filter(c => c.endDate && c.endDate >= today && c.endDate <= in30 && c.status === 'active').length);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contracts');
    }));

    // 5. Vehicles
    const qVehicles = query(collection(db, 'vehicles'), orderBy('createdAt', 'desc'), limit(100));
    unsubs.push(onSnapshot(qVehicles, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle));
      setVehicles(all);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles');
    }));

    // 6. Chart & Combined Stats from analyses
    const qChart = query(collection(db, 'analyses'), orderBy('createdAt', 'desc'), limit(100));
    const collectionStats: Record<string, any> = {};

    function updateCombinedStats(source: string, docs: any[]) {
      const pending = docs.filter(a => {
        const s = (a.status || '').toLowerCase();
        return s.includes('pendent') || s.includes('levantamento') || s === 'pending';
      }).length;
      const inProgress = docs.filter(a => {
        const s = (a.status || '').toLowerCase();
        return s.includes('execu') || s.includes('anál') || s.includes('andamento') || s === 'in_progress' || s === 'review' || s === 'processo';
      }).length;
      const completed = docs.filter(a => {
        const s = (a.status || '').toLowerCase();
        return s.includes('conclu') || s.includes('entregue') || s === 'completed' || s === 'finalizado';
      }).length;

      let revenue = 0;
      if (source === 'analyses') {
        revenue = docs.filter(a => a.type === 'credit').reduce((acc, curr) => acc + (curr.cost || 0), 0);
      }

      collectionStats[source] = { pending, inProgress, completed, revenue };

      const total = Object.values(collectionStats).reduce((acc, curr) => ({
        pending: acc.pending + curr.pending,
        inProgress: acc.inProgress + curr.inProgress,
        completed: acc.completed + curr.completed,
        revenue: acc.revenue + curr.revenue
      }), { pending: 0, inProgress: 0, completed: 0, revenue: 0 });

      setStats(prev => ({ 
        ...prev, 
        pendingAnalyses: total.pending,
        inProgressAnalyses: total.inProgress,
        completedAnalyses: total.completed,
        creditRevenue: total.revenue
      }));
    }

    unsubs.push(onSnapshot(qChart, (snapshot) => {
      const analyses = snapshot.docs.map(doc => doc.data());
      updateCombinedStats('analyses', analyses);
      
      // Update chart data
      const months: Record<string, { month: string, services: number, revenue: number }> = {};
      analyses.forEach(a => {
        const date = a.createdAt ? new Date(a.createdAt) : new Date();
        const monthKey = date.toLocaleString('pt-BR', { month: 'short' });
        if (!months[monthKey]) {
          months[monthKey] = { month: monthKey, services: 0, revenue: 0 };
        }
        months[monthKey].services += 1;
        if (a.type === 'credit') {
          months[monthKey].revenue += (a.cost || 0);
        }
      });
      const monthOrder = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      const sortedMonths = Object.values(months).sort((a, b) => {
        const mKeyA = (a.month || '').toLowerCase().replace('.', '').trim();
        const mKeyB = (b.month || '').toLowerCase().replace('.', '').trim();
        return monthOrder.indexOf(mKeyA) - monthOrder.indexOf(mKeyB);
      }).slice(-6);
      setChartData(sortedMonths);
    }, (error) => {
      console.error("Dashboard Chart Error:", error);
    }));

    // 7. Topography services
    unsubs.push(onSnapshot(collection(db, 'topography_services'), (snapshot) => {
      const services = snapshot.docs.map(doc => doc.data());
      updateCombinedStats('topography', services);
    }, (error) => {
      console.error("Dashboard Topo Error:", error);
    }));

    // 8. Irrigation projects
    unsubs.push(onSnapshot(collection(db, 'irrigation_projects'), (snapshot) => {
      const services = snapshot.docs.map(doc => doc.data());
      updateCombinedStats('irrigation', services);
    }, (error) => {
      console.error("Dashboard Irrigation Error:", error);
    }));

    // 9. Regularization services
    unsubs.push(onSnapshot(collection(db, 'regularization_services'), (snapshot) => {
      const services = snapshot.docs.map(doc => doc.data());
      updateCombinedStats('regularization', services);
    }, (error) => {
      console.error("Dashboard Regularization Error:", error);
    }));

    // 10. Clients
    unsubs.push(onSnapshot(collection(db, 'clients'), (snapshot) => {
      const allClients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      setStats(prev => ({ ...prev, totalClients: snapshot.size }));
      const sorted = [...allClients].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setRecentClients(sorted.slice(0, 5));
      
      let count = 0;
      allClients.forEach(client => {
        if (client.properties) count += client.properties.length;
      });
      setMappedPropertiesCount(count);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    }));

    // 11. Users (Count & Recent)
    unsubs.push(onSnapshot(collection(db, 'users'), (snapshot) => {
      const allUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setStats(prev => ({ ...prev, totalUsers: snapshot.size }));
      const sorted = [...allUsers].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setRecentUsers(sorted.slice(0, 5));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }));

    // 12. Unread Messages
    // Sem orderBy/limit: recipientId + isRead + createdAt exigiria índice composto inexistente.
    const qMessages = query(
      collection(db, 'messages'),
      where('recipientId', '==', user.uid),
      where('isRead', '==', false)
    );
    unsubs.push(onSnapshot(qMessages, (snapshot) => {
      const unread = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as InternalMessage))
        .filter(m => !(m as any).isDraft);
      setRecentMessages(sortByDateDesc(unread, 'createdAt').slice(0, 3));
      setStats(prev => ({ ...prev, unreadMessages: unread.length }));
    }, (error) => {
      console.error("Dashboard Messages Error:", error);
    }));

    // 13. Unread Notifications
    const qNotify = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid),
      where('read', '==', false)
    );
    unsubs.push(onSnapshot(qNotify, (snapshot) => {
      setStats(prev => ({ ...prev, unreadNotifications: snapshot.size }));
    }, (error) => {
      console.error("Dashboard Notifications Error:", error);
    }));

    // 14. Vacations
    const qVacations = isManagement 
      ? query(collection(db, 'vacations'), orderBy('createdAt', 'desc'), limit(100))
      : query(collection(db, 'vacations'), where('userId', '==', user.uid));

    unsubs.push(onSnapshot(qVacations, (snapshot) => {
      setVacationRequests(sortByDateDesc(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VacationRequest)), 'createdAt'));
    }, (error) => {
      console.error("Dashboard Vacations Error:", error);
    }));

    fetchNews();

    return () => {
      unsubs.forEach(u => u());
    };
    // Só o uid importa aqui: com [user], qualquer mudança no perfil (ex.: tema
    // claro/escuro) derrubava e refazia as 14 consultas do painel.
  }, [user?.uid, isManagement, canSeeFinance]);

  const fetchNews = async () => {
    const CACHE_KEY = 'ag_news_cache';
    const CACHE_TIME_KEY = 'ag_news_cache_time';
    const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

    const cachedNews = localStorage.getItem(CACHE_KEY);
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
    const now = Date.now();

    if (cachedNews && cachedTime && now - parseInt(cachedTime) < CACHE_DURATION) {
      try {
        setNews(JSON.parse(cachedNews));
        return;
      } catch (e) {
        localStorage.removeItem(CACHE_KEY);
      }
    }

    setIsNewsLoading(true);
    setNewsQuotaExceeded(false);
    try {
      const idToken = await getAuthToken();

      const response = await fetch('/api/ai/news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          query: "Gere 4 manchetes curtas e impactantes sobre o mercado agrícola brasileiro hoje (soja, milho, gado, clima). Retorne apenas um JSON array de objetos com keys 'title' e 'source'. Ex: [{'title': 'Preço da soja sobe em Chicago', 'source': 'Reuters'}]. Seja profissional e focado em inteligência de mercado."
        })
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar notícias do servidor.');
      }

      const data = await response.json();
      const responseText = data.text;
      
      const jsonMatch = responseText.match(/\[.*\]/s);
      const jsonText = jsonMatch ? jsonMatch[0] : responseText.replace(/```json|```/g, '').trim();
      const parsedNews = JSON.parse(jsonText).map((n: any, i: number) => ({ 
        ...n, 
        id: i.toString(), 
        time: i === 0 ? 'Destaque' : 'Hoje' 
      }));
      
      setNews(parsedNews);
      localStorage.setItem(CACHE_KEY, JSON.stringify(parsedNews));
      localStorage.setItem(CACHE_TIME_KEY, now.toString());
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      const isQuotaExceeded = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || (typeof error === 'object' && error?.error?.code === 429);
      
      if (isQuotaExceeded) {
        setNewsQuotaExceeded(true);
        // Suppress detailed log for quota exceeded as it's a known limitation of free tier
        console.warn("Gemini API Quota reached - showing cached or default news data.");
      } else {
        console.error("Error fetching news:", error);
      }
      
      // Try to load even expired cache if available before using hardcoded fallback
      if (cachedNews) {
        try {
          const content = JSON.parse(cachedNews);
          setNews(content);
          return;
        } catch (e) {}
      }

      setNews([
        { id: '1', title: 'Soja: Mercado acompanha clima no Sul', source: 'Agência Brasil', time: 'Destaque' },
        { id: '2', title: 'Milho apresenta firmeza nos preços', source: 'Notícias Agrícolas', time: 'Hoje' },
        { id: '3', title: 'Exportações batem recorde no semestre', source: 'CNA', time: 'Hoje' },
        { id: '4', title: 'Pecuária: Escala de abate se alonga', source: 'Canal Rural', time: 'Hoje' }
      ]);
    } finally {
      setIsNewsLoading(false);
    }
  };

  // Contado no mesmo listener de "clients" acima (antes havia um segundo
  // listener idêntico, que baixava a coleção inteira de clientes duas vezes).
  const [mappedPropertiesCount, setMappedPropertiesCount] = useState(0);

  const distributionData = useMemo(() => [
    { name: 'Analises', value: stats.pendingAnalyses || 10, color: '#10b981' },
    { name: 'Topografia', value: 15, color: '#3b82f6' },
    { name: 'Irrigação', value: 5, color: '#f59e0b' },
    { name: 'Regularização', value: 8, color: '#6366f1' },
  ], [stats.pendingAnalyses]);

  const financialComparisonData = useMemo(() => {
    const monthsData: Record<string, { month: string, receita: number, despesa: number }> = {};
    const today = new Date();
    
    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = d.toISOString().substring(0, 7); // "YYYY-MM"
      const label = d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
      const formattedLabel = label.charAt(0).toUpperCase() + label.slice(1);
      monthsData[key] = {
        month: formattedLabel,
        receita: 0,
        despesa: 0
      };
    }

    // Populate with actual financialRecords (dados reais — sem números
    // inventados quando a conta ainda não tem lançamentos: antes, meses sem
    // nenhum registro financeiro real mostravam valores calculados por uma
    // fórmula artificial, como se fossem faturamento de verdade).
    financialRecords.forEach(r => {
      const comp = r.competencia || r.paymentDate || r.dueDate || r.createdAt || '';
      const key = comp.substring(0, 7); // "YYYY-MM"
      if (monthsData[key]) {
        const val = r.value || 0;
        const weightedVal = r.status === 'paid' ? val : (r.status === 'pending' || r.status === 'overdue') ? val * 0.8 : 0;
        if (r.isExpense) {
          monthsData[key].despesa += weightedVal;
        } else {
          monthsData[key].receita += weightedVal;
        }
      }
    });

    // Format final sorted list
    const sortedKeys = Object.keys(monthsData).sort();
    return sortedKeys.map((key) => {
      const data = monthsData[key];
      return {
        month: data.month,
        'Receitas': Math.round(data.receita),
        'Despesas': Math.round(data.despesa),
      };
    });
  }, [financialRecords]);

  const statCards = [
    { label: 'Serviços Pendentes', value: stats.pendingAnalyses, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10', unit: 'Aguardando' },
    { label: 'Relatórios Concluídos', value: stats.completedAnalyses, icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-500/10', unit: 'Entregues' },
    { label: 'Propriedades Mapeadas', value: mappedPropertiesCount, icon: MapPin, color: 'text-slate-700', bg: 'bg-emerald-500/10', unit: 'Total' },
    { label: 'Base de Clientes', value: stats.totalClients, icon: Users, color: 'text-slate-700', bg: 'bg-emerald-500/10', unit: 'Contatos' },
  ];

  const alertsOfTheDay = useMemo(() => {
    const alerts: { type: 'danger' | 'warning'; message: string; category: string }[] = [];
    const today = todayLocalDateString();
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];

    // 1. Contratos vencendo em ≤ 30 dias
    allContracts.forEach(c => {
      if (c.endDate && c.endDate >= today && c.endDate <= in30 && c.status === 'active') {
        alerts.push({
          type: 'warning',
          category: 'Contrato',
          message: `O contrato #${c.contractNumber} (${c.clientName}) vence em ${formatDate(c.endDate)}.`
        });
      }
    });

    // 2. Estoque abaixo do mínimo (usa <= igual ao contador do card KPI
    // "Estoque Crítico" logo acima, pra não ficar um número dizendo uma
    // coisa e a lista de alertas mostrando outra)
    allInventoryItems.forEach(item => {
      if ((item.currentQuantity || 0) <= (item.minQuantity || 0)) {
        alerts.push({
          type: 'danger',
          category: 'Estoque',
          message: `Insumo "${item.name}" está abaixo do mínimo (${item.currentQuantity}/${item.minQuantity} ${item.unit}).`
        });
      }
    });

    // 3. Veículos com seguro/IPVA vencendo em ≤ 30 dias
    vehicles.forEach(v => {
      if (v.insuranceExpiry && v.insuranceExpiry >= today && v.insuranceExpiry <= in30) {
        alerts.push({
          type: 'warning',
          category: 'Veículo',
          message: `Seguro do veículo ${v.brand} ${v.model} (${v.plate}) vence em ${formatDate(v.insuranceExpiry)}.`
        });
      }
      if (v.ipvaExpiry && v.ipvaExpiry >= today && v.ipvaExpiry <= in30) {
        alerts.push({
          type: 'warning',
          category: 'Veículo',
          message: `IPVA do veículo ${v.brand} ${v.model} (${v.plate}) vence em ${formatDate(v.ipvaExpiry)}.`
        });
      }
    });

    // 4. Férias aguardando aprovação
    vacationRequests.forEach(vr => {
      if (vr.status === 'pending') {
        alerts.push({
          type: 'danger',
          category: 'RH',
          message: `Solicitação de férias de ${vr.userName} (${vr.startDate} a ${vr.endDate}) aguarda aprovação.`
        });
      }
    });

    return alerts;
  }, [allContracts, allInventoryItems, vehicles, vacationRequests]);

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Top Header and Personalization Button */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Dashboard" subtitle="Visão geral da operação, métricas em tempo real e controle pessoal" />

        <div className="flex gap-2">
          <button 
            onClick={handleCheckAlerts}
            disabled={checkingAlerts}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={cn("w-4 h-4", checkingAlerts && "animate-spin")} />
            {checkingAlerts ? 'Verificando...' : 'Verificar Alertas'}
          </button>
          
          <button 
            onClick={() => setIsPrintPreviewOpen(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            title="Pré-visualizar e imprimir relatório A4 do painel"
          >
            <Printer className="w-4 h-4 text-emerald-400" /> Pré-visualizar Impressão
          </button>

          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-200"
          >
            <FilePen className="w-4 h-4" /> Personalizar Painel
          </button>
        </div>
      </div>

      {/* Personalization Drawer / Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-md p-8 shadow-2xl bg-white"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold text-slate-800 dark:text-slate-100">Personalizar Dashboard</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Reordene e ative ou desative cada módulo do seu painel operacional.</p>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                {moduleOrder.map((key, index) => {
                  const item = ALL_MODULE_METADATA[key] || { label: key, desc: '' };
                  const isVisible = visibleModules[key] ?? true;

                  return (
                    <div 
                      key={key} 
                      className={cn(
                        "flex items-center justify-between gap-2 p-3 rounded-2xl border transition-all",
                        isVisible 
                          ? "bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700" 
                          : "bg-slate-100/50 dark:bg-slate-800/40 border-slate-200/50 opacity-60"
                      )}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <input 
                          type="checkbox" 
                          checked={isVisible}
                          onChange={() => toggleModule(key)}
                          className="mt-1 h-4 w-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
                        />
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{item.label}</span>
                          <span className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{item.desc}</span>
                        </div>
                      </div>

                      {/* Reorder actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveModule(index, 'up')}
                          disabled={index === 0}
                          title="Mover para cima"
                          className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveModule(index, 'down')}
                          disabled={index === moduleOrder.length - 1}
                          title="Mover para baixo"
                          className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-150 dark:border-slate-700 flex items-center gap-3">
                <button 
                  type="button"
                  onClick={handleResetLayout}
                  className="py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restaurar Padrão
                </button>
                <button 
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all text-center cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  Confirmar e Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Vacation / License replacement notification block */}
      {user?.isVacationReplacement && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-amber-50 border border-amber-200 p-5 rounded-[2rem] flex items-start gap-3.5 text-left shadow-sm"
        >
          <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl shadow-inner shadow-amber-200">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">Substituição de Férias / Licença Ativa</h4>
            <p className="text-xs text-amber-800 leading-relaxed mt-1 font-medium">
              Você está cobrindo as funções do colaborador <span className="font-bold text-amber-950">{user.replacementForName}</span> no período de <span className="font-bold text-amber-950">{user.replacementStartDate?.split('-').reverse().join('/')}</span> a <span className="font-bold text-amber-950">{user.replacementEndDate?.split('-').reverse().join('/')}</span>.
            </p>
            <p className="text-[10px] text-amber-700/90 font-bold mt-1.5">
              * Durante a vigência desta cobertura, suas permissões e funções administrativas herdadas ({(user.role || '').toUpperCase()}) estão plenamente ativas.
            </p>
          </div>
        </motion.div>
      )}

      {/* Header Stat Cards */}
      {visibleModules.statCards && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, i) => (
            <motion.div 
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="group relative bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm hover:shadow-xl hover:shadow-emerald-500/5 hover:-translate-y-1 transition-all"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={cn("p-3 rounded-2xl", stat.bg)}>
                  <stat.icon className={cn("w-6 h-6", stat.color)} />
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-display font-bold", stat.color)}>{stat.value}</span>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{stat.unit}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Alertas do Dia Section */}
      {visibleModules.alertsOfTheDay && alertsOfTheDay.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm flex flex-col gap-4"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-500 animate-bounce" />
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Alertas do Dia</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {alertsOfTheDay.map((alert, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-3 rounded-2xl border flex items-start gap-2.5 text-xs font-medium leading-relaxed shadow-sm",
                  alert.type === 'danger'
                    ? "bg-rose-50/80 border-rose-200/60 text-rose-700"
                    : "bg-amber-50/80 border-amber-200/60 text-amber-700"
                )}
              >
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap",
                  alert.type === 'danger'
                    ? "bg-rose-200 text-rose-800"
                    : "bg-amber-200 text-amber-800"
                )}>
                  {alert.category}
                </span>
                <span className="flex-1">{alert.message}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Faixa de KPIs operacionais */}
      {visibleModules.kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visitas / Mês</span>
              <ClipboardList className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">{visitsThisMonth}</div>
          </div>

          <div className={cn("bg-white rounded-2xl p-4 border shadow-sm flex flex-col justify-between",
            financialOverdue.count > 0 ? "border-rose-200 bg-rose-50" : "border-slate-100")}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cobranças Vencidas</span>
              <DollarSign className={cn("w-4 h-4", financialOverdue.count > 0 ? "text-rose-500" : "text-slate-300")} />
            </div>
            <div>
              <div className={cn("text-2xl font-bold", financialOverdue.count > 0 ? "text-rose-600" : "text-slate-800")}>
                {financialOverdue.count}
              </div>
              {financialOverdue.total > 0 && (
                <div className="text-[10px] text-rose-500 mt-0.5">
                  R$ {financialOverdue.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              )}
            </div>
          </div>

          <div className={cn("bg-white rounded-2xl p-4 border shadow-sm flex flex-col justify-between",
            inventoryAlerts > 0 ? "border-amber-200 bg-amber-50" : "border-slate-100")}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estoque Crítico</span>
              <Package className={cn("w-4 h-4", inventoryAlerts > 0 ? "text-amber-500" : "text-slate-300")} />
            </div>
            <div className="text-2xl font-bold text-slate-800">{inventoryAlerts}</div>
          </div>

          <div className={cn("bg-white rounded-2xl p-4 border shadow-sm flex flex-col justify-between",
            contractsExpiring > 0 ? "border-slate-200 bg-slate-50" : "border-slate-100")}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contratos Vencendo</span>
              <FilePen className={cn("w-4 h-4", contractsExpiring > 0 ? "text-slate-500" : "text-slate-300")} />
            </div>
            <div className="text-2xl font-bold text-slate-800">{contractsExpiring}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Charts Section */}
          <div className="xl:col-span-2 flex flex-col gap-8">
            {visibleModules.desempenho && (
              <div className="bg-white/40 glass p-8 rounded-[2.5rem] border border-white/40 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Desempenho Semestral</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Serviços Ativos vs Receita de Crédito</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Serviços</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Receita (R$)</span>
                    </div>
                  </div>
                </div>
                
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorServices" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="month" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                      />
                      <Area 
                        name="Serviços"
                        type="monotone" 
                        dataKey="services" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorServices)" 
                      />
                      <Area 
                        name="Receita"
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#10b981" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorRevenue)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Seção de Gráficos Comparativos (Financeiro e Produtividade) */}
            {(visibleModules.fluxoCaixa || visibleModules.safra) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Comparativo Financeiro: Receitas x Despesas */}
                {visibleModules.fluxoCaixa && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-base font-display font-bold text-slate-800">Fluxo de Caixa Comparativo</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Receitas x Despesas (6 meses)</p>
                        </div>
                        <div className="p-2.5 bg-emerald-500/10 rounded-xl">
                          <DollarSign className="w-4 h-4 text-emerald-600" />
                        </div>
                      </div>
                      
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={financialComparisonData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="month" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                              tickFormatter={(v) => `R$ ${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                            />
                            <Tooltip 
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '11px' }}
                              formatter={(value: any) => [`R$ ${Number(value).toLocaleString('pt-BR')}`, '']}
                            />
                            <Legend 
                              iconSize={8}
                              wrapperStyle={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginTop: '10px' }}
                            />
                            <Bar name="Receitas" dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} barSize={10} />
                            <Bar name="Despesas" dataKey="Despesas" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={10} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Volume de Produção por Safra */}
                {visibleModules.safra && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-base font-display font-bold text-slate-800">Volume de Produção</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Produção por Safra (Toneladas)</p>
                        </div>
                        <div className="p-2.5 bg-emerald-500/10 rounded-xl">
                          <Leaf className="w-4 h-4 text-slate-600" />
                        </div>
                      </div>
                      
                      {/* Este indicador ficava preenchido com toneladas fictícias de
                          soja/milho/algodão, mesmo sem nenhum dado real de safra
                          cadastrado no sistema (não existe hoje nenhuma tela pra
                          registrar produção por safra). Preferimos deixar
                          claro que ainda não é calculado, em vez de mostrar
                          um número inventado como se fosse real. */}
                      <div className="h-[220px] w-full flex flex-col items-center justify-center text-center gap-2 px-4">
                        <Leaf className="w-6 h-6 text-slate-300" />
                        <p className="text-xs text-slate-400 font-medium">
                          Ainda não há registro de produção por safra no sistema.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>

        {/* Sidebar Widgets */}
        <div className="flex flex-col gap-8">
          {/* Widget de Metas Mensais */}
          {visibleModules.metas && (
            <div className="bg-white/40 glass p-6 rounded-[2.5rem] border border-white/45 shadow-sm flex flex-col gap-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl -z-10 group-hover:bg-emerald-500/10 transition-colors duration-500" />
              
              <div className="flex items-center justify-between">
                <h3 className="font-display font-medium text-slate-800 flex items-center gap-2">
                  <Target className="w-5 h-5 text-emerald-600 animate-pulse" /> Metas de {monthLabel[0].toUpperCase() + monthLabel.slice(1)}
                </h3>
                <button 
                  onClick={handleOpenEditMetas}
                  className="p-1.5 rounded-xl hover:bg-slate-100/80 text-slate-500 hover:text-emerald-600 transition-colors"
                  title="Ajustar metas"
                >
                  <FilePen className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-5 mt-2">
                {/* Progresso de Faturamento */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 flex items-center gap-1.5">
                      <DollarSign className="w-4 h-4 text-emerald-500" /> Faturamento de Serviços
                    </span>
                    <span className="font-mono font-bold text-emerald-600">{faturamentoPercentm}%</span>
                  </div>
                  
                  {/* Visual Progress Bar */}
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-[2px] border border-slate-200/40">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${faturamentoPercentm}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-500 rounded-full"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Pago: R$ {faturamentoRealizado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span>Meta: R$ {faturamentoMeta.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                  </div>
                  {faturamentoPendente > 0 && (
                    <div className="text-[9px] text-amber-600 font-semibold text-right">
                      R$ {faturamentoPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} pendentes neste mês
                    </div>
                  )}
                </div>

                {/* Progresso de Produção Agrícola */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 flex items-center gap-1.5">
                      <Leaf className="w-4 h-4 text-emerald-600" /> Produção Agrícola Assistida
                    </span>
                    <span className="font-mono font-bold text-slate-600">{producaoPercentm}%</span>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-[2px] border border-slate-200/40">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${producaoPercentm}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Monitorado: {producaoAgrícolaRealizada} ha</span>
                    <span>Meta: {producaoMeta} ha</span>
                  </div>
                  
                  <div className="p-2 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 text-[9px] text-slate-500 leading-relaxed font-semibold mt-1">
                    Metas de área estimadas com base em contratos agrários ativos pagos neste mês (fator R$ 100/Hectare).
                  </div>
                </div>
              </div>

              {/* Modal de Edição Inline de Metas */}
              <AnimatePresence>
                {isEditingMeta && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white/95 backdrop-blur-sm z-20 p-6 flex flex-col justify-between"
                  >
                    <form onSubmit={(e) => { e.preventDefault(); runExclusive('Dashboard.handleSaveMetas', () => handleSaveMetas(e)); }} className="space-y-4 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Ajustar Metas Mensais</span>
                          <button 
                            type="button" 
                            onClick={() => setIsEditingMeta(false)}
                            className="text-slate-400 hover:text-slate-600 font-bold text-sm"
                          >
                            Fechar
                          </button>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Meta de Faturamento (R$)</label>
                            <input 
                              type="number" 
                              value={tempFaturamento} 
                              onChange={(e) => setTempFaturamento(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500" 
                              placeholder="Ex: 60000"
                              required
                            />
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Meta de Produção Assistida (Hectares)</label>
                            <input 
                              type="number" 
                              value={tempProducao} 
                              onChange={(e) => setTempProducao(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500" 
                              placeholder="Ex: 500"
                              required
                            />
                          </div>
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className="w-full py-2 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl text-xs font-bold hover:shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all text-center mt-4"
                      >
                        Salvar Novas Metas
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Módulo de Lembretes Pessoais */}
          {visibleModules.lembretes && <PersonalReminders />}

          {/* Widget de notícias */}
          {visibleModules.noticias && (
            <div className="bg-white/40 glass p-6 rounded-[2.5rem] border border-white/40 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
                  <Leaf className="w-4 h-4 text-emerald-600 animate-pulse" /> Notícias do Campo
                </h3>
              </div>

              {newsQuotaExceeded && (
                <div className="p-2.5 bg-amber-50 rounded-2xl border border-amber-105 text-[10px] text-amber-700 font-semibold leading-relaxed">
                  Feedback do Servidor de Notícias: Limite de requisições excedido. Exibindo posts salvos offline.
                </div>
              )}

              <div className="space-y-3">
                {isNewsLoading ? (
                  <div className="space-y-2 animate-pulse">
                    {[1, 2, 3].map(n => (
                      <div key={n} className="h-10 bg-slate-100 rounded-xl w-full"></div>
                    ))}
                  </div>
                ) : (
                  news.slice(0, 4).map(item => (
                    <div key={item.id} className="flex flex-col gap-1 p-2 bg-white/50 rounded-2xl border border-white/20 hover:bg-white/80 transition-colors">
                      <span className="text-xs font-bold text-slate-700 line-clamp-2">{item.title}</span>
                      <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        <span>{item.source}</span>
                        <span>·</span>
                        <span>{item.time}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Widget de visitas recentes */}
          {visibleModules.visitasRecentes && recentVisits.length > 0 && (
            <div className="bg-white/40 glass p-6 rounded-[2.5rem] border border-white/40 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-emerald-500" /> Visitas Recentes
                </h3>
                <button onClick={() => navigate('/field_visits')}
                  className="text-xs text-emerald-600 font-bold hover:underline">Ver todas →</button>
              </div>
              <div className="space-y-2">
                {recentVisits.map(v => (
                  <div key={v.id} className="flex items-center justify-between p-3 bg-white/50 rounded-2xl border border-white/20">
                    <div>
                      <div className="text-xs font-bold text-slate-700">{v.clientName}</div>
                      <div className="text-[10px] text-slate-400">{v.propertyName} · {v.technicianName}</div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <div className="text-[10px] text-slate-400">{v.visitDate}</div>
                      <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full border",
                        v.syncStatus === 'synced' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                        v.syncStatus === 'pending_sync' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                        'bg-slate-100 text-slate-600 border-slate-200')}>
                        {v.syncStatus === 'synced' ? 'Sync ✓' : v.syncStatus === 'pending_sync' ? 'Aguard.' : 'Rascunho'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agenda Widget Section */}
      {visibleModules.agenda && <AgendaWidget />}

      {/* Modal de Pré-visualização de Impressão A4 */}
      <PrintPreviewModal
        isOpen={isPrintPreviewOpen}
        onClose={() => setIsPrintPreviewOpen(false)}
        title="Relatório Consolidado do Painel de Controle"
        subtitle="Resumo executivo de indicadores, carteira de clientes e operações agrícolas"
        category="Dashboard Executivo"
      >
        <div className="space-y-6">
          {/* Section 1: KPI Summary Cards */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              1. Indicadores Operacionais & Atendimentos
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Clientes Cadastrados</span>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">{stats.totalClients}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Análises Concluídas</span>
                <p className="text-lg font-extrabold text-emerald-700 mt-0.5">{stats.completedAnalyses}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Análises Pendentes</span>
                <p className="text-lg font-extrabold text-amber-700 mt-0.5">{stats.pendingAnalyses}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Equipe Ativa</span>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">{stats.totalUsers}</p>
              </div>
            </div>
          </div>

          {/* Section 2: Financial & Credit Revenue */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              2. Resumo de Faturamento & Crédito Rural
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200">
                <span className="text-[10px] text-emerald-800 font-bold uppercase">Receita Estimada em Crédito</span>
                <p className="text-xl font-extrabold text-emerald-800 mt-0.5">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.creditRevenue)}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Visitas Técnicas de Campo</span>
                <p className="text-xl font-extrabold text-slate-800 mt-0.5">{recentVisits.length} visitas recentes</p>
              </div>
            </div>
          </div>

          {/* Section 3: Recent Clients List */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              3. Clientes Recentes e Propriedades Atendidas
            </h3>
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-100 font-bold text-slate-700">
                  <th className="p-2 border border-slate-200">Nome / Razão Social</th>
                  <th className="p-2 border border-slate-200">CPF / CNPJ</th>
                  <th className="p-2 border border-slate-200">Município / UF</th>
                  <th className="p-2 border border-slate-200">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {recentClients.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-3 text-center text-slate-400 italic">Nenhum cliente recente registrado.</td>
                  </tr>
                ) : (
                  recentClients.slice(0, 6).map((c) => (
                    <tr key={c.id} className="border-b border-slate-200">
                      <td className="p-2 font-bold text-slate-800 border border-slate-200">{c.name}</td>
                      <td className="p-2 text-slate-600 border border-slate-200">{c.document || 'N/I'}</td>
                      <td className="p-2 text-slate-600 border border-slate-200">{c.city || 'Sapezal'} / {c.state || 'MT'}</td>
                      <td className="p-2 text-slate-600 border border-slate-200">{c.phone || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Section 4: Recent Technical Field Visits */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              4. Últimas Visitas Técnicas Registradas
            </h3>
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-100 font-bold text-slate-700">
                  <th className="p-2 border border-slate-200">Data</th>
                  <th className="p-2 border border-slate-200">Cliente</th>
                  <th className="p-2 border border-slate-200">Propriedade</th>
                  <th className="p-2 border border-slate-200">Responsável Técnico</th>
                </tr>
              </thead>
              <tbody>
                {recentVisits.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-3 text-center text-slate-400 italic">Nenhuma visita registrada recentemente.</td>
                  </tr>
                ) : (
                  recentVisits.slice(0, 5).map((v) => (
                    <tr key={v.id} className="border-b border-slate-200">
                      <td className="p-2 font-mono text-slate-700 border border-slate-200">{v.visitDate}</td>
                      <td className="p-2 font-bold text-slate-800 border border-slate-200">{v.clientName}</td>
                      <td className="p-2 text-slate-600 border border-slate-200">{v.propertyName}</td>
                      <td className="p-2 text-slate-600 border border-slate-200">{v.technicianName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </PrintPreviewModal>
    </div>
  );
}


