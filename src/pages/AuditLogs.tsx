import React, { useState, useEffect } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  Calendar, 
  Clock, 
  Eye, 
  Trash2, 
  Check, 
  X, 
  AlertTriangle,
  RotateCcw,
  Layers,
  Sparkles,
  Activity,
  TrendingUp,
  Award,
  UserCheck,
  BarChart2,
  Download
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, UserProfile } from '../types';
import { cn, formatDateTime, todayLocalDateString } from '../lib/utils';
import { toast } from 'sonner';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { History as PageIcon } from 'lucide-react';

export default function AuditLogs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [rightPanelTab, setRightPanelTab] = useState<'productivity' | 'details'>('details');
  
  // Filtering & Search states
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [crudFilter, setCrudFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [activeView, setActiveView] = useState<'table' | 'timeline'>('timeline');

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const parsed = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as unknown as UserProfile));
      setUsersList(parsed);
    }, (error) => {
      console.error("Error reading users:", error);
    });

    return unsubUsers;
  }, []);

  useEffect(() => {
    if (userFilter !== 'all') {
      setRightPanelTab('productivity');
    } else {
      setRightPanelTab('details');
    }
  }, [userFilter]);

  // Individual Productivity Analytics
  const getProductivityStats = (selectedUser: string) => {
    const userLogs = logs.filter(log => (log.userName || 'Desconhecido') === selectedUser);
    const total = userLogs.length;
    
    const created = userLogs.filter(l => l.action === 'created').length;
    const read = userLogs.filter(l => l.action === 'read').length;
    const deleted = userLogs.filter(l => l.action === 'deleted').length;
    const updated = userLogs.filter(l => 
      l.action === 'updated' || 
      l.action === 'status_changed' || 
      l.action === 'approved' || 
      l.action === 'rejected'
    ).length;

    // Most active module
    const moduleCounts: Record<string, number> = {};
    userLogs.forEach(l => {
      moduleCounts[l.collection] = (moduleCounts[l.collection] || 0) + 1;
    });
    let maxCount = 0;
    let mostActive = 'Nenhum';
    Object.entries(moduleCounts).forEach(([mod, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostActive = mod;
      }
    });

    const moduleNames: Record<string, string> = {
      contracts: 'Contratos',
      financials: 'Financeiro',
      clients: 'Clientes/Produtores',
      users: 'Usuários',
      audit_logs: 'Auditoria'
    };
    const resolvedMostActive = moduleNames[mostActive] || mostActive;

    // Heuristics for profile type
    let profileType = 'Perfil Versátil';
    let profileDesc = 'Atividade equilibrada entre criação e edição de registros.';
    if (created > updated && created > deleted) {
      profileType = 'Foco em Cadastro';
      profileDesc = 'Principal responsável por inserir novos dados e expandir o sistema.';
    } else if (updated > created && updated > deleted) {
      profileType = 'Foco em Manutenção';
      profileDesc = 'Dedicado à atualização de informações, aprovações e fluxo de processos.';
    } else if (deleted > created && deleted > updated) {
      profileType = 'Foco em Saneamento';
      profileDesc = 'Foco em limpeza de registros obsoletos e organização de dados.';
    }

    // Heuristics for active level
    let activityLevel = 'Baixa Atividade';
    let activityColor = 'bg-slate-100 text-slate-700 border-slate-200';
    if (total > 50) {
      activityLevel = 'Alta Produtividade';
      activityColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    } else if (total > 15) {
      activityLevel = 'Média Produtividade';
      activityColor = 'bg-slate-100 text-slate-800 border-slate-200';
    } else if (total > 0) {
      activityLevel = 'Moderado';
      activityColor = 'bg-amber-100 text-amber-800 border-amber-200';
    }

    // Last action timestamp
    const lastActionTime = userLogs.length > 0 ? userLogs[0].timestamp : null;

    return {
      total,
      created,
      read,
      updated,
      deleted,
      mostActive: resolvedMostActive,
      profileType,
      profileDesc,
      activityLevel,
      activityColor,
      lastActionTime
    };
  };

  useEffect(() => {
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(300));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as AuditLog));
      setLogs(parsed);
      setLoading(false);
    }, (error) => {
      console.error("Error reading audit logs:", error);
      toast.error("Não foi possível carregar os registros de auditoria.");
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Compute unique users, actions, and collections for dropdown filters
  const uniqueUsers = Array.from(new Set([
    ...logs.map(log => log.userName).filter(Boolean),
    ...usersList.map(u => u.displayName || u.email).filter(Boolean)
  ])).sort() as string[];
  const uniqueCollections = Array.from(new Set(logs.map(log => log.collection)));

  const filteredLogs = logs.filter(log => {
    // Search filter
    const matchesSearch = 
      (log.recordName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.details || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.userName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.recordId || '').toLowerCase().includes(searchTerm.toLowerCase());

    // Dropdown filters
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesCollection = collectionFilter === 'all' || log.collection === collectionFilter;
    const matchesUser = userFilter === 'all' || log.userName === userFilter;

    // CRUD Filter
    let matchesCrud = true;
    if (crudFilter !== 'all') {
      const act = log.action;
      if (crudFilter === 'C') {
        matchesCrud = act === 'created';
      } else if (crudFilter === 'R') {
        matchesCrud = act === 'read';
      } else if (crudFilter === 'U') {
        matchesCrud = act === 'updated' || act === 'status_changed' || act === 'approved' || act === 'rejected';
      } else if (crudFilter === 'D') {
        matchesCrud = act === 'deleted';
      }
    }

    // Date Filters
    let matchesDate = true;
    if (startDate || endDate) {
      const logDate = new Date(log.timestamp);
      const logDateString = logDate.toISOString().split('T')[0];
      
      if (startDate && logDateString < startDate) {
        matchesDate = false;
      }
      if (endDate && logDateString > endDate) {
        matchesDate = false;
      }
    }

    return matchesSearch && matchesAction && matchesCollection && matchesUser && matchesCrud && matchesDate;
  });

  const getActionBadge = (action: AuditLog['action']) => {
    switch (action) {
      case 'read':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
            <Eye className="w-3.5 h-3.5" /> Visualizado
          </span>
        );
      case 'created':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
            <Sparkles className="w-3 h-3" /> Criado
          </span>
        );
      case 'updated':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 uppercase">
            <History className="w-3 h-3" /> Editado
          </span>
        );
      case 'deleted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
            <Trash2 className="w-3 h-3" /> Excluído
          </span>
        );
      case 'status_changed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
            <Clock className="w-3 h-3" /> Status Alterado
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
            <Check className="w-3 h-3" /> Aprovado
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
            <X className="w-3 h-3" /> Recusado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 uppercase">
            Alterado
          </span>
        );
    }
  };

  const getCollectionBadge = (collectionName: string) => {
    const names: Record<string, string> = {
      contracts: 'Contratos',
      financials: 'Financeiro',
      clients: 'Clientes/Produtores',
      users: 'Usuários',
      audit_logs: 'Auditoria'
    };
    const colors: Record<string, string> = {
      contracts: 'bg-slate-50 text-slate-700 border-slate-100',
      financials: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      clients: 'bg-slate-50 text-slate-700 border-slate-100',
      users: 'bg-slate-50 text-slate-700 border-slate-100',
      audit_logs: 'bg-slate-50 text-slate-700 border-slate-150'
    };
    return (
      <span className={cn("px-2 py-0.5 rounded-md text-[9px] font-bold border uppercase tracking-wider", colors[collectionName] || "bg-slate-50 text-slate-700 border-slate-100")}>
        {names[collectionName] || collectionName}
      </span>
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setActionFilter('all');
    setCollectionFilter('all');
    setUserFilter('all');
    setCrudFilter('all');
    setStartDate('');
    setEndDate('');
    toast.success('Filtros limpos com sucesso.');
  };

  const handleExportAuditLogsCSV = () => {
    if (filteredLogs.length === 0) {
      toast.error('Nenhum log para exportar com os filtros atuais.');
      return;
    }
    const headers = ['Data/Hora', 'Usuário', 'Ação', 'Módulo/Coleção', 'ID Registro', 'Nome do Registro', 'Detalhes'];
    const rows = filteredLogs.map(l => [
      `"${formatDateTime(l.timestamp)}"`,
      `"${(l.userName || 'Sistema').replace(/"/g, '""')}"`,
      `"${l.action}"`,
      `"${l.collection}"`,
      `"${l.recordId}"`,
      `"${(l.recordName || '').replace(/"/g, '""')}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Audit_Logs_AgroGestao_${todayLocalDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exportados ${filteredLogs.length} registros de auditoria em CSV!`);
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Auditoria Global" subtitle="Registro de acessos e alterações feitas no sistema" />

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAuditLogsCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 bg-slate-50/70 hover:bg-slate-50 text-xs font-bold tracking-wide transition-all cursor-pointer shadow-xs"
            title="Exportar logs filtrados em CSV"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV ({filteredLogs.length})
          </button>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 bg-white/70 hover:bg-white text-xs font-semibold tracking-wide transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Limpar Filtros
          </button>
        </div>
      </header>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 bg-white/40 p-3.5 rounded-2xl glass border border-white/30">
        <div className="relative col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-1">
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Buscar por termo</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Ex: João, CTR..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input w-full text-xs"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Operação (CRUD)</label>
          <div className="flex items-center gap-1.5 relative">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={crudFilter}
              onChange={(e) => setCrudFilter(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input text-xs w-full bg-white/80"
            >
              <option value="all">CRUD (Todas)</option>
              <option value="C">C - Criar (Create)</option>
              <option value="R">R - Visualizar (Read)</option>
              <option value="U">U - Atualizar (Update)</option>
              <option value="D">D - Excluir (Delete)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Módulo / Coleção</label>
          <div className="flex items-center gap-1.5 relative">
            <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input text-xs w-full bg-white/80"
            >
              <option value="all">Módulos (Todos)</option>
              {uniqueCollections.map(c => (
                <option key={c} value={c}>
                  {c === 'contracts' ? 'Contratos' : c === 'financials' ? 'Financeiro' : c === 'clients' ? 'Clientes' : c === 'audit_logs' ? 'Auditoria' : c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Atividade do Funcionário</label>
          <div className="flex items-center gap-1.5 relative">
            <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input text-xs w-full bg-white/80 border-slate-150/70"
            >
              <option value="all">Colaborador (Todos)</option>
              {uniqueUsers.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Data Inicial</label>
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input text-xs w-full bg-white/80"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Data Final</label>
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="pl-9 pr-3 py-1.5 glass-input text-xs w-full bg-white/80"
            />
          </div>
        </div>
      </div>

      {/* View Mode Selector Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200/85 pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView('timeline')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer border",
              activeView === 'timeline' 
                ? "bg-emerald-600 text-white shadow-sm border-emerald-650" 
                : "bg-white/50 text-slate-600 hover:bg-white hover:text-slate-900 border-slate-200"
            )}
          >
            <Clock className="w-4 h-4" /> Linha do Tempo (Timeline)
          </button>
          <button
            onClick={() => setActiveView('table')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer border",
              activeView === 'table' 
                ? "bg-emerald-600 text-white shadow-sm border-emerald-650" 
                : "bg-white/50 text-slate-600 hover:bg-white hover:text-slate-900 border-slate-200"
            )}
          >
            <Layers className="w-4 h-4" /> Tabela de Auditoria
          </button>
        </div>

        <div className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {filteredLogs.length} logs {filteredLogs.length === 1 ? 'encontrado' : 'encontrados'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {activeView === 'table' ? (
          /* Logs Table View */
          <div className="lg:col-span-2 bg-white/50 border border-slate-200/60 rounded-3xl overflow-hidden glass shadow-sm">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/60 border-b border-slate-200">
                    <th className="px-4 py-3.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Momento</th>
                    <th className="px-4 py-3.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Ação / Módulo</th>
                    <th className="px-4 py-3.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Responsável</th>
                    <th className="px-4 py-3.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Registro Alvo</th>
                    <th className="px-4 py-3.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Buscando histórico...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <AlertTriangle className="w-8 h-8 text-slate-300" />
                          <p className="font-semibold text-slate-500">Nenhum log de auditoria encontrado.</p>
                          <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed">
                            Tente ajustar seus critérios de filtros ou faça alterações críticas no sistema para disparar logs.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map(log => {
                      const dateObj = new Date(log.timestamp);
                      const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                      const formattedDate = dateObj.toLocaleDateString('pt-BR');
                      
                      return (
                        <tr 
                          key={log.id} 
                          className={cn(
                            "hover:bg-slate-50/70 transition-all cursor-pointer",
                            selectedLog?.id === log.id ? "bg-slate-50/50 hover:bg-slate-50" : ""
                          )}
                          onClick={() => setSelectedLog(log)}
                        >
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            <div className="font-semibold">{formattedDate}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{formattedTime}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-start">
                              {getActionBadge(log.action)}
                              {getCollectionBadge(log.collection)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 bg-slate-200 text-slate-700 font-bold rounded-full flex items-center justify-center text-[9px] uppercase">
                                {log.userName ? log.userName.substring(0, 1) : '?'}
                              </div>
                              <div className="font-semibold truncate max-w-[120px]" title={log.userName}>
                                {log.userName || 'Sistema'}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-700 truncate max-w-[150px]" title={log.recordName}>
                              {log.recordName}
                            </div>
                            <div className="text-[9px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]">
                              ID: {log.recordId}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLog(log);
                              }}
                              className="p-1.5 bg-white border border-slate-200 hover:border-slate-200 text-slate-500 hover:text-slate-600 rounded-lg shadow-2xs transition-all cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Timeline Visualizer View */
          <div className="lg:col-span-2 space-y-6 max-h-[680px] overflow-y-auto custom-scrollbar pr-3">
            {loading ? (
              <div className="bg-white/40 rounded-3xl p-12 text-center text-slate-400 glass border border-white/20">
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gerando Linha do Tempo...</span>
                </div>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="bg-white/40 rounded-3xl p-12 text-center text-slate-400 glass border border-white/20">
                <div className="flex flex-col items-center justify-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-slate-300" />
                  <p className="font-semibold text-slate-500">Nenhum evento na linha do tempo.</p>
                  <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed">
                    Tente ajustar os filtros acima para listar outras operações ou datas.
                  </p>
                </div>
              </div>
            ) : (
              <div className="pl-2 space-y-5">
                {filteredLogs.map((log, idx) => {
                  const dateObj = new Date(log.timestamp);
                  const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const formattedDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                  
                  // CRUD styling & setup
                  let opColor = 'bg-slate-50 text-slate-700 border-slate-200';
                  let opIcon = <History className="w-3.5 h-3.5" />;
                  let opLabel = 'U';
                  
                  if (log.action === 'created') {
                    opColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                    opIcon = <Sparkles className="w-3.5 h-3.5" />;
                    opLabel = 'C';
                  } else if (log.action === 'read') {
                    opColor = 'bg-slate-100 text-slate-700 border-slate-200';
                    opIcon = <Eye className="w-3.5 h-3.5" />;
                    opLabel = 'R';
                  } else if (log.action === 'deleted') {
                    opColor = 'bg-rose-50 text-rose-700 border-rose-200';
                    opIcon = <Trash2 className="w-3.5 h-3.5" />;
                    opLabel = 'D';
                  } else {
                    opColor = 'bg-amber-50 text-amber-700 border-amber-200';
                    opIcon = <Clock className="w-3.5 h-3.5" />;
                    opLabel = 'U';
                  }

                  const isSelected = selectedLog?.id === log.id;

                  return (
                    <div 
                      key={log.id} 
                      className={cn(
                        "flex gap-4 relative group transition-all duration-300",
                        idx < filteredLogs.length - 1 ? "pb-2" : ""
                      )}
                    >
                      {/* Vertical line connector */}
                      {idx < filteredLogs.length - 1 && (
                        <div className="absolute left-[54px] top-8 bottom-0 w-0.5 bg-dashed border-l border-dashed border-slate-200 group-hover:border-slate-200 transition-colors" />
                      )}

                      {/* Time and Date sidebar */}
                      <div className="w-[45px] pt-1 text-right shrink-0">
                        <div className="text-[10px] font-bold text-slate-500 uppercase">{formattedDate}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{formattedTime}</div>
                      </div>

                      {/* Dynamic Icon Node on Timeline axis */}
                      <div className="relative shrink-0 z-10">
                        <div 
                          title={`Operação: ${opLabel}`}
                          className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center border shadow-xs transition-all duration-300 cursor-pointer",
                            isSelected 
                              ? "ring-2 ring-emerald-500 ring-offset-2 scale-110" 
                              : "group-hover:scale-105",
                            opColor
                          )}
                          onClick={() => setSelectedLog(log)}
                        >
                          {opIcon}
                        </div>
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white text-[8px] font-bold flex items-center justify-center border border-slate-150 text-slate-500 shadow-3xs uppercase">
                          {opLabel}
                        </span>
                      </div>

                      {/* Card Content block */}
                      <div 
                        onClick={() => setSelectedLog(log)}
                        className={cn(
                          "flex-1 bg-white border rounded-2xl p-4 transition-all duration-300 hover:shadow-md cursor-pointer text-left",
                          isSelected 
                            ? "border-emerald-400 bg-slate-50/20 shadow-xs" 
                            : "border-slate-200/70 hover:border-slate-350"
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 bg-slate-150 text-slate-700 font-bold rounded-full flex items-center justify-center text-[9px] uppercase">
                              {log.userName ? log.userName.substring(0, 1) : '?'}
                            </div>
                            <span className="font-semibold text-slate-800 text-xs">{log.userName || 'Sistema'}</span>
                            <span className="text-[10px] text-slate-450">• {getCollectionBadge(log.collection)}</span>
                          </div>
                          
                          <div className="flex items-center gap-1.5">
                            {getActionBadge(log.action)}
                          </div>
                        </div>

                        {/* Title and details */}
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1">
                            <span className="text-slate-650 truncate max-w-[220px]" title={log.recordName}>{log.recordName}</span>
                          </h4>
                          <p className="text-[11px] text-slate-600 leading-relaxed font-sans font-medium">
                            {log.details || 'Ação executada com sucesso.'}
                          </p>
                        </div>

                        {/* Changed fields summary badges */}
                        {log.changedFields && log.changedFields.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-3 pt-2.5 border-t border-slate-100">
                            <span className="text-[9px] font-bold text-slate-450 uppercase mr-1 mt-0.5">Alterados:</span>
                            {log.changedFields.map(field => (
                              <span key={field} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[8px] text-slate-500">
                                {field}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Selected Log Details & Productivity panel */}
        <div className="bg-white/50 border border-slate-200/60 rounded-3xl p-5 glass shadow-sm min-h-[400px] flex flex-col justify-between">
          <div>
            {userFilter !== 'all' && (
              <div className="flex bg-slate-100/80 p-1 rounded-xl mb-4 gap-1">
                <button
                  type="button"
                  onClick={() => setRightPanelTab('productivity')}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer",
                    rightPanelTab === 'productivity'
                      ? "bg-white text-slate-600 shadow-3xs"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  Produtividade
                </button>
                <button
                  type="button"
                  disabled={!selectedLog}
                  onClick={() => setRightPanelTab('details')}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer",
                    !selectedLog ? "opacity-50 cursor-not-allowed" : "",
                    rightPanelTab === 'details'
                      ? "bg-white text-slate-600 shadow-3xs"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  Log Detalhado
                </button>
              </div>
            )}

            {rightPanelTab === 'productivity' && userFilter !== 'all' ? (
              // Employee Productivity Audit View
              (() => {
                const matchedUserProfile = usersList.find(u => u.displayName === userFilter);
                const stats = getProductivityStats(userFilter);
                
                return (
                  <div className="space-y-5 text-left">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                        <Activity className="w-4 h-4 animate-pulse" /> Auditoria de Produtividade
                      </span>
                    </div>

                    {/* Profile Card */}
                    <div className="flex gap-3 items-center p-3 bg-white border border-slate-150 rounded-2xl shadow-3xs">
                      {matchedUserProfile?.photoURL ? (
                        <img 
                          src={matchedUserProfile.photoURL} 
                          alt={userFilter} 
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-full object-cover border-2 border-slate-150 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-emerald-600 text-white font-bold rounded-full flex items-center justify-center text-lg shrink-0 shadow-sm uppercase">
                          {userFilter.substring(0, 1)}
                        </div>
                      )}
                      <div className="overflow-hidden">
                        <h4 className="text-xs font-bold text-slate-800 truncate">{userFilter}</h4>
                        <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wide truncate">
                          {matchedUserProfile?.role === 'admin' ? 'Administrador' :
                           matchedUserProfile?.role === 'manager' ? 'Gerente Agrônomo' :
                           matchedUserProfile?.role === 'consultant' ? 'Consultor de Campo' :
                           matchedUserProfile?.role === 'hr' ? 'Recursos Humanos' :
                           matchedUserProfile?.role === 'staff' ? 'Equipe Técnica' : 'Colaborador'}
                        </p>
                        {matchedUserProfile?.registrationNumber && (
                          <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                            Matrícula: {matchedUserProfile.registrationNumber}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Activity Level and Total Volume */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Volume de Ações</span>
                        <div className="flex items-center justify-center gap-1.5">
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <span className="text-xl font-bold text-slate-850 font-mono">{stats.total}</span>
                        </div>
                        <span className="text-[8px] text-slate-400 mt-1 block">Ações no período</span>
                      </div>
                      
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center flex flex-col justify-between">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Módulo Foco</span>
                        <div className="font-bold text-xs text-slate-850 truncate px-1" title={stats.mostActive}>
                          {stats.mostActive}
                        </div>
                        <span className="text-[8px] text-slate-400 mt-1 block">Módulo mais acessado</span>
                      </div>
                    </div>

                    {/* Quality Classification */}
                    <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Award className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Perfil Operacional</span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 mb-0.5">{stats.profileType}</h5>
                      <p className="text-[10px] text-slate-600 leading-relaxed">{stats.profileDesc}</p>
                    </div>

                    {/* Effort Breakdown (CRUD Progress Bars) */}
                    <div className="space-y-3 bg-white border border-slate-150 p-3 rounded-2xl">
                      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <BarChart2 className="w-3.5 h-3.5 text-slate-500" /> Distribuição de Esforço
                      </h5>
                      
                      <div className="space-y-2 text-xs">
                        {/* Create */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-650">
                            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-emerald-500" /> Cadastro (C)</span>
                            <span className="font-mono">{stats.created} ({stats.total > 0 ? Math.round((stats.created / stats.total) * 100) : 0}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                              style={{ width: `${stats.total > 0 ? (stats.created / stats.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Read */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-650">
                            <span className="flex items-center gap-1"><Eye className="w-3 h-3 text-slate-500" /> Consulta (R)</span>
                            <span className="font-mono">{stats.read} ({stats.total > 0 ? Math.round((stats.read / stats.total) * 100) : 0}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-slate-400 h-full rounded-full transition-all duration-500" 
                              style={{ width: `${stats.total > 0 ? (stats.read / stats.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Update */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-650">
                            <span className="flex items-center gap-1"><History className="w-3 h-3 text-slate-500" /> Edição/Fluxo (U)</span>
                            <span className="font-mono">{stats.updated} ({stats.total > 0 ? Math.round((stats.updated / stats.total) * 100) : 0}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                              style={{ width: `${stats.total > 0 ? (stats.updated / stats.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Delete */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-650">
                            <span className="flex items-center gap-1"><Trash2 className="w-3 h-3 text-rose-500" /> Exclusão (D)</span>
                            <span className="font-mono">{stats.deleted} ({stats.total > 0 ? Math.round((stats.deleted / stats.total) * 100) : 0}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-rose-500 h-full rounded-full transition-all duration-500" 
                              style={{ width: `${stats.total > 0 ? (stats.deleted / stats.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Last active time */}
                    {stats.lastActionTime && (
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 justify-center mt-2 font-medium">
                        <Clock className="w-3.5 h-3.5" /> Última atividade registrada: {new Date(stats.lastActionTime).toLocaleString('pt-BR')}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : selectedLog ? (
              // Selected Log Details View
              <div className="space-y-5 text-left">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Detalhes do Registro
                    </span>
                    <button 
                      onClick={() => setSelectedLog(null)}
                      className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Ação / Evento</span>
                    <div className="flex items-center gap-2">
                      {getActionBadge(selectedLog.action)}
                      {getCollectionBadge(selectedLog.collection)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Registro Modificado</span>
                    <p className="text-xs font-bold text-slate-800">{selectedLog.recordName}</p>
                    <p className="text-[9px] text-slate-400 font-mono bg-slate-100 p-1 rounded border border-slate-150 break-all select-all">
                      {selectedLog.recordId}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Carimbo de Tempo (UTC)</span>
                    <div className="text-xs text-slate-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>{new Date(selectedLog.timestamp).toLocaleString('pt-BR')}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Responsável pela Alteração</span>
                    <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-150 rounded-xl">
                      <div className="w-6 h-6 bg-emerald-600 text-white font-bold rounded-full flex items-center justify-center text-xs uppercase">
                        {selectedLog.userName ? selectedLog.userName.substring(0, 1).toUpperCase() : '?'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-700">{selectedLog.userName || 'Sistema'}</p>
                        <p className="text-[9px] font-mono text-slate-400">UID: {selectedLog.userId}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase font-sans">Descrição do Evento</span>
                    <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/30 p-3 rounded-xl border border-slate-100">
                      {selectedLog.details || 'Nenhuma descrição detalhada fornecida.'}
                    </p>
                  </div>

                  {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase">Campos Alterados</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedLog.changedFields.map(field => (
                          <span key={field} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[9px] text-slate-600">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Collapsible raw details payload visualization */}
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Metadados Brutos (JSON)</span>
                  <details className="group border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50 font-mono text-[9px] text-slate-600">
                    <summary className="p-2 cursor-pointer select-none bg-slate-100 font-bold hover:bg-slate-150 flex items-center justify-between text-[10px]">
                      <span>Ver carga de dados</span>
                      <span className="group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="p-3 max-h-[150px] overflow-y-auto custom-scrollbar leading-relaxed">
                      <pre className="whitespace-pre-wrap font-sans text-left">
                        {JSON.stringify({
                          previous: selectedLog.previousValues,
                          new: selectedLog.newValues
                        }, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              // Empty selection state
              <div className="flex flex-col items-center justify-center text-center py-16 text-slate-400 gap-3">
                <History className="w-10 h-10 text-slate-300 stroke-1" />
                <p className="font-semibold text-xs text-slate-500">Nenhum registro selecionado</p>
                <p className="text-[10px] text-slate-400 max-w-[200px] leading-relaxed mx-auto">
                  Clique em qualquer linha da lista à esquerda para carregar a auditoria forense do registro.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
