import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  Wallet, 
  Search, 
  Plus, 
  Calendar, 
  User, 
  CheckCircle2, 
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Briefcase,
  FileText,
  BadgePercent,
  Trash2,
  X,
  CreditCard,
  Landmark,
  FileDown
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { ServiceAnalysis, Client } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn, todayLocalDateString, formatDate } from '../lib/utils';
import { buildServiceReportPDF } from '../lib/pdfBranding';
import ServiceKpiCards, { formatBRL, isThisMonth } from '../components/service/ServiceKpiCards';

import ConfirmationModal from '../components/ConfirmationModal';
import PronafWizard from '../components/PronafWizard';
import { toast } from 'sonner';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Wallet as PageIcon } from 'lucide-react';
import { useInitialSearch } from '../hooks/useInitialSearch';
import ExportExcelButton from '../components/service/ExportExcelButton';
import { logAudit } from '../lib/audit';
import AuditTrail from '../components/AuditTrail';

export default function RuralCredit() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ServiceAnalysis[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [statusFilter, setStatusFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(1);
  const [selectedProject, setSelectedProject] = useState<ServiceAnalysis | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPronafOpen, setIsPronafOpen] = useState(false);
  const [pronafResumeProject, setPronafResumeProject] = useState<ServiceAnalysis | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    clientId: '',
    clientName: '',
    propertyName: '',
    description: '',
    value: 0,
    bank: '',
    financingType: '',
    category: 'Agricultura' as 'Agricultura' | 'Pecuária',
    scheduledDate: todayLocalDateString(),
    responsibleTechnician: user?.displayName || '',
  });

  const [clientProperties, setClientProperties] = useState<{name: string}[]>([]);
  const [displayValue, setDisplayValue] = useState('');

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(val);
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    const numericValue = Number(rawValue) / 100;
    
    setFormData({ ...formData, value: numericValue });
    
    // Format for display
    if (numericValue === 0) {
      setDisplayValue('');
    } else {
      setDisplayValue(
        new Intl.NumberFormat('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(numericValue)
      );
    }
  };

  useEffect(() => {
    // Sem orderBy no Firestore: a combinação type + createdAt exigia um índice composto que
    // não existe no projeto (a lista nunca carregava). Ordenamos aqui mesmo.
    const q = query(
      collection(db, 'analyses'),
      where('type', '==', 'credit')
    );

    const createdAtMs = (v: any) =>
      v?.toDate ? v.toDate().getTime() : typeof v?.seconds === 'number' ? v.seconds * 1000 : new Date(v || 0).getTime() || 0;

    const unsubProjects = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceAnalysis));
      list.sort((a: any, b: any) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
      setProjects(list);
      setLoading(false);
    }, (err) => {
      console.error('Erro ao carregar projetos de crédito:', err);
      toast.error('Não foi possível carregar os projetos de crédito rural.');
      setLoading(false);
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    return () => {
      unsubProjects();
      unsubClients();
    };
  }, []);

  useEffect(() => {
    if (formData.clientId) {
      const client = clients.find(c => c.id === formData.clientId);
      if (client && client.properties) {
        setClientProperties(client.properties);
        if ((client.properties || []).length === 1) {
          setFormData(prev => ({ ...prev, propertyName: client.properties[0].name }));
        } else {
          setFormData(prev => ({ ...prev, propertyName: '' }));
        }
      } else {
        setClientProperties([]);
        setFormData(prev => ({ ...prev, propertyName: '' }));
      }
    }
  }, [formData.clientId, clients]);


  // Histórico de alterações (Auditoria Global e "Histórico" nos detalhes)
  const audit = (action: string, recordId: string, recordName: string, details: string, extra: Record<string, any> = {}) =>
    logAudit({ userId: user?.uid || 'unknown', userName: user?.displayName || user?.email || 'Usuário', action, collection: 'analyses', recordId, recordName, details, ...extra });

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientId) return;

    const selectedClient = clients.find(c => c.id === formData.clientId);
    const executionCost = formData.value * 0.02;

    try {
      if (isEditMode && editingId) {
        await updateDoc(doc(db, 'analyses', editingId), {
          propertyName: formData.propertyName,
          description: formData.description,
          value: Number(formData.value),
          cost: executionCost,
          bank: formData.bank,
          financingType: formData.financingType,
          category: formData.category,
          updatedAt: new Date().toISOString(),
          responsibleTechnician: formData.responsibleTechnician,
        });

        if (user) {
          audit('updated', editingId, formData.clientName, `Projeto de crédito editado (${formData.financingType || 'crédito'}, ${formatCurrency(Number(formData.value))}).`, { newValues: { value: Number(formData.value), bank: formData.bank } });
          await createNotification(user.uid, 'Projeto Atualizado', `O projeto de ${formData.clientName} foi editado com sucesso.`, 'update', 'analysis_credit');
        }
      } else {
        await addDoc(collection(db, 'analyses'), {
          clientId: formData.clientId,
          clientName: selectedClient?.name || '',
          propertyName: formData.propertyName,
          type: 'credit',
          status: 'Pendente',
          description: formData.description,
          value: Number(formData.value),
          cost: executionCost,
          bank: formData.bank,
          financingType: formData.financingType,
          category: formData.category,
          scheduledDate: formData.scheduledDate,
          responsibleTechnician: formData.responsibleTechnician,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assignedTo: user?.uid || ''
        });

        if (user) {
          await createNotification(user.uid, 'Novo Projeto de Crédito', `Um novo projeto foi criado para ${selectedClient?.name}.`, 'success', 'analysis_credit');
        }
      }
      
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      setModalStep(1);
      setDisplayValue('');
      setFormData({
        clientId: '',
        clientName: '',
        propertyName: '',
        description: '',
        value: 0,
        bank: '',
        financingType: '',
        category: 'Agricultura',
        scheduledDate: todayLocalDateString(),
        responsibleTechnician: user?.displayName || '',
      });
    } catch (error) {
      console.error("Error saving credit project:", error);
    }
  };

  // Relatório final do projeto de crédito (logo + empresa + cliente + dados + resultado)
  const generateCreditReport = async (project: ServiceAnalysis) => {
    try {
      const p: any = project;
      const client = clients.find(c => c.id === project.clientId);
      const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
      const proposta = p.pronafData?.proposta;
      const itens: any[] = proposta?.programaInvestimentos?.itens || [];
      const sections: { title: string; rows?: [string, string][]; text?: string }[] = [
        {
          title: 'Dados do Projeto de Crédito',
          rows: [
            ['Linha / tipo de crédito', project.financingType || '—'],
            ['Banco financiador', project.bank || '—'],
            ['Atividade', project.category || '—'],
            ...(proposta?.dados?.finalidadeCredito ? [['Finalidade', proposta.dados.finalidadeCredito] as [string, string]] : []),
            ...(proposta?.dados?.agencia ? [['Agência', proposta.dados.agencia] as [string, string]] : []),
            ['Data prevista', project.scheduledDate ? formatDate(project.scheduledDate) : '—'],
            ['Situação', project.status || '—'],
          ],
        },
        {
          title: 'Resultado',
          rows: [
            ['Valor do projeto', brl(project.value || 0)],
            ['Custo de elaboração / execução', brl(project.cost || 0)],
          ],
        },
      ];
      const itensValidos = itens.filter(i => i.discriminacao);
      if (itensValidos.length) {
        sections.push({
          title: 'Itens de Investimento',
          rows: itensValidos.slice(0, 40).map(i => [
            i.discriminacao,
            `${i.quantidade || 0} ${i.unidade || ''} × ${brl(i.valorUnitario || 0)} = ${brl((i.quantidade || 0) * (i.valorUnitario || 0))}`,
          ] as [string, string]),
        });
      }
      sections.push({
        title: 'Descrição e Conclusões',
        text: (project.description || 'Sem descrição.') +
          (p.pronafData ? '\n\nO resumo da proposta em 2 vias (cliente e empresa) é gerado na etapa "Resumo e PDF" da proposta de crédito.' : ''),
      });
      const pdf = await buildServiceReportPDF({
        documentTitle: 'Relatório de Projeto de Crédito Rural',
        serviceName: project.financingType ? `Crédito Rural — ${project.financingType}` : 'Crédito Rural',
        client: {
          name: project.clientName,
          cpf: client?.cpf,
          property: project.propertyName,
          city: client?.address?.city ? `${client.address.city}${client.address.state ? '/' + client.address.state : ''}` : undefined,
        },
        sections,
        responsible: project.responsibleTechnician || user?.displayName || undefined,
        certification: (user as any)?.professionalCertification,
      });
      pdf.save(`Relatorio_Credito_Rural_${(project.clientName || 'Cliente').replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível gerar o relatório em PDF.');
    }
  };

  const openEditModal = (project: ServiceAnalysis) => {
    setEditingId(project.id);
    setIsEditMode(true);
    setFormData({
      clientId: project.clientId,
      clientName: project.clientName,
      propertyName: project.propertyName || '',
      description: project.description || '',
      value: project.value || 0,
      bank: project.bank || '',
      financingType: project.financingType || '',
      category: project.category || 'Agricultura',
      scheduledDate: project.scheduledDate || '',
      responsibleTechnician: project.responsibleTechnician || '',
    });
    
    const val = project.value || 0;
    setDisplayValue(
      new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val)
    );
    
    setIsModalOpen(true);
    setModalStep(1);
  };

  const updateStatus = async (projectId: string, newStatus: string) => {
    const project = projects.find(p => p.id === projectId);
    const previousStatus = project?.status;
    // Atualização otimista: reflete na tela na hora, sem esperar o listener do Firestore.
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus as any } : p));
    try {
      await updateDoc(doc(db, 'analyses', projectId), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      toast.success(`Status atualizado para: ${newStatus}`);
      audit('status_changed', projectId, project?.clientName || '', `Status alterado para ${newStatus}.`, { previousValues: { status: previousStatus }, newValues: { status: newStatus } });

      if (user) {
        await createNotification(
          user.uid,
          'Status de Crédito Atualizado',
          `O projeto de ${project?.clientName} foi alterado para: ${newStatus}`,
          'update',
          'analysis_credit'
        );
      }
    } catch (error) {
       console.error("Error updating status:", error);
       toast.error('Não foi possível atualizar o status. Verifique sua conexão.');
       // Reverte a atualização otimista se o servidor recusou.
       if (previousStatus) {
         setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: previousStatus } : p));
       }
    }
  };

  const deleteProject = async (id: string) => {
    // Remove da tela imediatamente, sem esperar o listener do Firestore reconciliar.
    const removed = projects.find(p => p.id === id);
    setProjects(prev => prev.filter(p => p.id !== id));
    try {
      await deleteDoc(doc(db, 'analyses', id));
      audit('deleted', id, removed?.clientName || '', 'Projeto de crédito excluído.');
      setIsDeleteConfirmOpen(null);
      toast.success('Projeto excluído com sucesso.');
      if (user) {
        await createNotification(user.uid, 'Projeto Excluído', 'Um projeto de crédito rural foi removido do sistema.', 'alert');
      }
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error('Erro ao excluir projeto.');
      setIsDeleteConfirmOpen(null);
      // Reverte a remoção otimista se o servidor recusou.
      if (removed) {
        setProjects(prev => prev.some(p => p.id === removed.id) ? prev : [...prev, removed]);
      }
    }
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = (p.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (p.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeProjects = projects.filter(p => p.status !== 'Concluído' && p.status !== 'Cancelado');
  const stats = {
    activeCount: activeProjects.length,
    activeValue: activeProjects.reduce((acc, p) => acc + (p.value || 0), 0),
    activeCost: activeProjects.reduce((acc, p) => acc + (p.cost || 0), 0),
    pendingCount: projects.filter(p => p.status === 'Pendente').length,
    analysisCount: projects.filter(p => p.status === 'Em Análise').length,
    completedCount: projects.filter(p => p.status === 'Concluído').length,
    completedMonth: projects.filter(p => p.status === 'Concluído' && isThisMonth(p.updatedAt)).length,
  };

  return (
    <div className="flex flex-col gap-6 h-full pb-6">
      {/* Header & Stats */}
      <header className="flex flex-col gap-6">
        <div className={PAGE_HEADER_CLASS} data-page-header>
          <PageTitle icon={PageIcon} title="Crédito Rural" subtitle="Financiamentos, custeio agropecuário e projetos Pronaf" />
          <div className="flex items-center gap-3">
          <ExportExcelButton fileName="Credito_Rural" getRows={() => filteredProjects.map((p: any) => ({
    'Cliente': p.clientName || '', 'Propriedade': p.propertyName || '', 'Linha': p.financingType || '', 'Banco': p.bank || '',
    'Atividade': p.category || '', 'Status': p.status || '', 'Valor (R$)': (typeof p.value === 'number' ? p.value : Number(p.value) || 0), 'Custo de Execução (R$)': (typeof p.cost === 'number' ? p.cost : Number(p.cost) || 0),
    'Previsão': (p.scheduledDate ? String(p.scheduledDate).split('T')[0].split('-').reverse().join('/') : ''), 'Responsável': p.responsibleTechnician || '',
  }))} />
          {(user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant' ? (
            <button
              disabled
              className="px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 shadow-none bg-slate-300 text-slate-500 cursor-not-allowed"
            >
              <Plus className="w-5 h-5" /> Apenas Leitura
            </button>
          ) : (
            <button
              onClick={() => { setPronafResumeProject(null); setIsPronafOpen(true); }}
              className="px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200"
            >
              <Landmark className="w-5 h-5" /> Nova Proposta de Crédito
            </button>
          )}
          </div>
        </div>

        <ServiceKpiCards items={[
          { label: 'Projetos Ativos', value: stats.activeCount, hint: `${stats.pendingCount} pendente(s) · ${stats.analysisCount} em análise`, icon: Landmark, tone: 'emerald' },
          { label: 'Total Solicitado', value: formatBRL(stats.activeValue), hint: 'Soma dos projetos ativos', icon: DollarSign, tone: 'slate' },
          { label: 'Custo de Execução (2%)', value: formatBRL(stats.activeCost), hint: 'A receber dos projetos ativos', icon: BadgePercent, tone: 'amber' },
          { label: 'Concluídos', value: stats.completedCount, hint: `${stats.completedMonth} neste mês`, icon: CheckCircle2, tone: 'emerald' },
        ]} />
      </header>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
          <input 
            type="text" 
            placeholder="Buscar por produtor ou projeto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 glass-input bg-white/50 border-white/60"
          />
        </div>
        <div className="flex gap-2">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-input h-12 px-4 text-xs font-bold uppercase tracking-widest text-slate-500"
          >
            <option value="all">Todos os Status</option>
            <option value="Pendente">Pendente</option>
            <option value="Em Execução">Em Execução</option>
            <option value="Em Análise">Em Análise</option>
            <option value="Concluído">Concluído</option>
            <option value="Cancelado">Cancelado</option>
          </select>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <motion.div 
              layout
              key={project.id}
              className="glass p-6 rounded-[2rem] border border-white/40 shadow-sm hover:shadow-xl hover:shadow-emerald-900/5 transition-all group flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <div className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  project.status === 'Concluído' ? "bg-emerald-100 text-emerald-600" :
                  project.status === 'Em Execução' ? "bg-slate-100 text-slate-600" :
                  project.status === 'Pendente' ? "bg-amber-100 text-amber-600" :
                  "bg-slate-100 text-slate-600"
                )}>
                  {project.status}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((project as any).pronafData) {
                        setPronafResumeProject(project);
                        setIsPronafOpen(true);
                      } else {
                        openEditModal(project);
                      }
                    }}
                    className="p-2 hover:bg-slate-50 text-slate-300 hover:text-slate-500 rounded-xl transition-all"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  {(user?.effectiveRole ?? user?.role) === 'admin' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDeleteConfirmOpen(project.id);
                      }}
                      className="p-2 hover:bg-rose-50 text-slate-300 hover:text-rose-500 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === project.id ? null : project.id);
                      }}
                      className="p-2 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4 text-slate-300" />
                    </button>
                    <AnimatePresence>
                      {openMenuId === project.id && (
                        <>
                          <div
                            className="fixed inset-0 z-[90]"
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }}
                          />
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.97 }}
                            transition={{ duration: 0.12 }}
                            className="absolute right-0 top-full mt-1 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-[100] overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                if ((project as any).pronafData) {
                                  setPronafResumeProject(project);
                                  setIsPronafOpen(true);
                                } else {
                                  openEditModal(project);
                                }
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <FileText className="w-3.5 h-3.5" /> Editar Projeto
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                generateCreditReport(project);
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <FileDown className="w-3.5 h-3.5" /> Relatório em PDF
                            </button>

                            <div className="px-4 pt-2 pb-1 text-[9px] font-black text-slate-400 uppercase tracking-widest">Alterar Status</div>
                            {['Pendente', 'Em Execução', 'Em Análise', 'Concluído', 'Cancelado'].map(status => (
                              <button
                                type="button"
                                key={status}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                  updateStatus(project.id, status);
                                }}
                                className={cn(
                                  "w-full text-left px-4 py-1.5 text-xs font-bold hover:bg-slate-50 flex items-center justify-between",
                                  project.status === status ? "text-emerald-600" : "text-slate-500"
                                )}
                              >
                                {status}
                                {project.status === status && <CheckCircle2 className="w-3.5 h-3.5" />}
                              </button>
                            ))}

                            {(user?.effectiveRole ?? user?.role) === 'admin' && (
                              <>
                                <div className="border-t border-slate-100 my-1" />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    setIsDeleteConfirmOpen(project.id);
                                  }}
                                  className="w-full text-left px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Excluir Projeto
                                </button>
                              </>
                            )}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-display font-bold text-slate-800 group-hover:text-emerald-700 transition-colors truncate flex-1">{project.clientName}</h3>
                  <span className={cn(
                    "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md",
                    project.category === 'Agricultura' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {project.category}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest flex items-center gap-2">
                  <Briefcase className="w-3 h-3" /> {project.propertyName || 'Propriedade não informada'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-0.5">
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Banco</span>
                  <span className="text-[10px] font-bold text-slate-700 truncate">{project.bank || '-'}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-0.5">
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Tipo</span>
                  <span className="text-[10px] font-bold text-slate-700 truncate">{project.financingType || '-'}</span>
                </div>
              </div>

              <div className="bg-slate-50/50 rounded-2xl p-4 mb-4 border border-slate-100">
                <p className="text-xs text-slate-600 line-clamp-2 italic">"{project.description}"</p>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400 font-medium">Valor do Projeto</span>
                  <span className="font-bold text-slate-800">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(project.value || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-emerald-600 font-bold">Custo de Execução (2%)</span>
                  <span className="font-bold text-emerald-600">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(project.cost || 0)}
                  </span>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-bold text-[10px]">
                    {project.responsibleTechnician?.[0] || 'T'}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{project.responsibleTechnician}</span>
                </div>
                <button 
                  onClick={() => setSelectedProject(project)}
                  className="text-emerald-600 hover:text-emerald-700 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1"
                >
                  Ver Detalhes <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {filteredProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white/30 rounded-[3rem] border border-dashed border-slate-200">
            <Wallet className="w-16 h-16 opacity-10 mb-4" />
            <p className="font-bold uppercase tracking-widest text-xs">Nenhum projeto de crédito encontrado</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card w-full max-w-xl p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden"
            >
              {/* Progress Bar */}
              <div className="absolute top-0 left-0 w-full h-1 bg-slate-100">
                <motion.div 
                  className="h-full bg-emerald-500"
                  animate={{ width: modalStep === 1 ? '50%' : '100%' }}
                />
              </div>

              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setModalStep(1);
                }}
                className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm shadow-emerald-200">
                  {modalStep === 1 ? <User className="w-6 h-6" /> : <CreditCard className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-slate-800">
                    {isEditMode ? 'Editar Projeto de Crédito' : (modalStep === 1 ? 'Passo 1: Identificação' : 'Passo 2: Detalhes do Crédito')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isEditMode ? 'Atualize as informações do financiamento.' : (modalStep === 1 ? 'Selecione o produtor e a propriedade.' : 'Informe os dados financeiros do financiamento.')}
                  </p>
                </div>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('RuralCredit.handleCreateProject', () => handleCreateProject(e)); }} className="flex flex-col gap-6">
                <AnimatePresence mode="wait">
                  {modalStep === 1 ? (
                    <motion.div 
                      key="step1"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="space-y-4"
                    >
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Produtor / Cliente</label>
                        <select 
                          value={formData.clientId}
                          onChange={(e) => setFormData({...formData, clientId: e.target.value})}
                          className="w-full glass-input bg-white/50"
                          required
                        >
                          <option value="">Selecione um cliente...</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name} - {c.cpf}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Propriedade</label>
                        <select 
                          value={formData.propertyName}
                          onChange={(e) => setFormData({...formData, propertyName: e.target.value})}
                          className="w-full glass-input bg-white/50"
                          required
                          disabled={!formData.clientId || clientProperties.length === 0}
                        >
                          <option value="">Selecione a propriedade...</option>
                          {clientProperties.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                        {!formData.clientId && <p className="text-[9px] text-slate-400 mt-1 italic">Selecione um cliente primeiro</p>}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Técnico Responsável</label>
                        <input 
                          type="text" 
                          value={formData.responsibleTechnician}
                          onChange={(e) => setFormData({...formData, responsibleTechnician: e.target.value})}
                          className="w-full glass-input bg-white/50"
                          required
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="step2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Categoria</label>
                          <div className="flex gap-2">
                            {['Agricultura', 'Pecuária'].map((cat) => (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setFormData({ ...formData, category: cat as any })}
                                className={cn(
                                  "flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                                  formData.category === cat 
                                    ? "bg-emerald-600 text-white border-emerald-600" 
                                    : "bg-white text-slate-400 border-slate-100 hover:border-slate-200"
                                )}
                              >
                                {cat[0]}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Banco / Instituição</label>
                          <select 
                            value={formData.bank}
                            onChange={(e) => setFormData({...formData, bank: e.target.value})}
                            className="w-full glass-input bg-white/50 py-2.5"
                            required
                          >
                            <option value="">Banco...</option>
                            <option value="Banco do Brasil">BB</option>
                            <option value="Sicredi">Sicredi</option>
                            <option value="Sicoob">Sicoob</option>
                            <option value="BNB">BNB</option>
                            <option value="Outro">Outro</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Linha de Crédito</label>
                          <select 
                            value={formData.financingType}
                            onChange={(e) => setFormData({...formData, financingType: e.target.value})}
                            className="w-full glass-input bg-white/50"
                            required
                          >
                            <option value="">Selecione a linha de crédito</option>
                            <option value="Pronaf (Agricultura Familiar)">Pronaf (Agricultura Familiar)</option>
                            <option value="Pronamp (Médio Produtor)">Pronamp (Médio Produtor)</option>
                            <option value="Pronampe">Pronampe</option>
                            <option value="Custeio Agrícola">Custeio Agrícola</option>
                            <option value="Investimento Rural">Investimento Rural</option>
                            <option value="FCO Rural">FCO Rural</option>
                            <option value="FNE Verde">FNE Verde</option>
                            <option value="Inovagro">Inovagro</option>
                            <option value="ABC+ (Agricultura de Baixo Carbono)">ABC+ (Agricultura de Baixo Carbono)</option>
                            <option value="Outros">Outros</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-emerald-600 uppercase ml-1 tracking-widest text-right">Taxa (2%)</label>
                          <div className="w-full glass-input bg-emerald-50/50 border-emerald-100 flex items-center justify-end font-bold text-emerald-700">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.value * 0.02)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Valor do Projeto</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">R$</span>
                          <input 
                            type="text" 
                            value={displayValue}
                            onChange={handleValueChange}
                            className="w-full glass-input bg-white/30 pl-10 text-lg font-bold"
                            placeholder="0,00"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-extrabold text-slate-400 uppercase ml-1 tracking-widest">Observações</label>
                        <textarea 
                          value={formData.description}
                          onChange={(e) => setFormData({...formData, description: e.target.value})}
                          rows={2}
                          className="w-full glass-input bg-white/50 text-xs"
                          placeholder="Notas rápidas sobre o projeto..."
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex gap-3 pt-2">
                  {modalStep === 2 && (
                    <button 
                      type="button" 
                      onClick={() => setModalStep(1)}
                      className="p-3 glass rounded-xl font-bold text-slate-600 hover:bg-white transition-all flex items-center gap-2"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  
                  {modalStep === 1 ? (
                    <button 
                      type="button"
                      disabled={!formData.clientId || !formData.propertyName}
                      onClick={() => setModalStep(2)}
                      className="flex-1 py-3 px-6 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                      Continuar <ChevronRight className="w-5 h-5" />
                    </button>
                  ) : (
                    <button 
                      type="submit"
                      disabled={!formData.value || !formData.bank || (user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant'}
                      className={cn(
                        "flex-1 py-3 px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                        ((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') ? "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-100"
                      )}
                    >
                      {(user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant' ? 'Apenas Leitura' : (isEditMode ? 'Salvar Alterações' : 'Finalizar e Criar')} <CheckCircle2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card w-full max-w-lg p-8 flex flex-col gap-6 shadow-2xl relative"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm shadow-emerald-200">
                  <FileText className="w-6 h-6" />
                </div>
                <div className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  selectedProject.status === 'Concluído' ? "bg-emerald-100 text-emerald-600" :
                  selectedProject.status === 'Em Execução' ? "bg-slate-100 text-slate-600" :
                  "bg-amber-100 text-amber-600"
                )}>
                  {selectedProject.status}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-2xl font-display font-bold text-slate-800">{selectedProject.clientName}</h3>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                    selectedProject.category === 'Agricultura' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {selectedProject.category}
                  </span>
                </div>
                <p className="text-sm text-slate-500">{selectedProject.propertyName}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Banco</div>
                  <div className="text-sm font-bold text-slate-800">{selectedProject.bank || 'Não informado'}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Tipo de Crédito</div>
                  <div className="text-sm font-bold text-slate-800">{selectedProject.financingType || 'Não informado'}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Valor do Crédito</div>
                    <div className="text-lg font-bold text-slate-800">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedProject.value || 0)}
                    </div>
                 </div>
                 <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Custo de Execução</div>
                    <div className="text-lg font-bold text-emerald-700">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedProject.cost || 0)}
                    </div>
                 </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Descrição</label>
                  <p className="text-sm text-slate-700 leading-relaxed">{selectedProject.description}</p>
                </div>
                <div className="flex items-center gap-3 py-3 border-y border-slate-100">
                  <Calendar className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Previsão: {formatDate(selectedProject.scheduledDate) || 'não informada'}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Alterar Status</label>
                 <div className="flex gap-2">
                    {['Pendente', 'Em Execução', 'Em Análise', 'Concluído', 'Cancelado'].map(status => (
                      <button 
                        key={status}
                        onClick={() => {
                          updateStatus(selectedProject.id, status);
                          setSelectedProject(null);
                        }}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                          selectedProject.status === status 
                            ? "bg-slate-800 text-white" 
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        )}
                      >
                        {status}
                      </button>
                    ))}
                 </div>
              </div>

              <AuditTrail recordId={selectedProject.id} collectionName="analyses" />
              <button
                onClick={() => generateCreditReport(selectedProject)}
                className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all text-xs uppercase tracking-widest mt-4 flex items-center justify-center gap-2"
              >
                <FileDown className="w-4 h-4" /> Relatório em PDF
              </button>
              <button 
                onClick={() => setSelectedProject(null)}
                className="w-full py-4 glass rounded-2xl font-bold text-slate-600 hover:bg-white transition-all text-xs uppercase tracking-widest"
              >
                Fechar Visualização
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <ConfirmationModal
        isOpen={!!isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(null)}
        onConfirm={() => isDeleteConfirmOpen && deleteProject(isDeleteConfirmOpen)}
        title="Excluir Projeto de Crédito?"
        description="Esta ação não pode ser desfeita. O projeto de crédito rural será removido permanentemente do sistema."
        confirmLabel="Excluir Agora"
      />
      <PronafWizard
        isOpen={isPronafOpen}
        onClose={() => { setIsPronafOpen(false); setPronafResumeProject(null); }}
        clients={clients}
        existingProject={pronafResumeProject}
      />
    </div>
  );
}
