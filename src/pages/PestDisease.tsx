import React, { useEffect, useState, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { useConfirm } from '../hooks/useConfirm';
import { 
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy 
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { PestDiseaseRecord, Client, PestSeverity } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bug, Plus, Search, Trash2, Edit3, X, Eye, Check, AlertTriangle, 
  MapPin, ShieldAlert, Sparkles, Calendar, ClipboardCheck, Info, Crop, Tag
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, PieChart, Pie, Cell 
} from 'recharts';

export default function PestDiseasePage() {
  const { user } = useAuth();
  const [confirmAction, confirmModal] = useConfirm();
  const [records, setRecords] = useState<PestDiseaseRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Diagnosis state
  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [formAiLoading, setFormAiLoading] = useState(false);

  const handleFormAiAssistance = async () => {
    if (!formCrop && !formPestOrDisease) {
      toast.error('Informe ao menos a cultura ou o nome da praga/doença para consulta.');
      return;
    }
    setFormAiLoading(true);
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const res = await fetch('/api/ai/diagnose-pest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          crop: formCrop,
          pestOrDisease: formPestOrDisease,
          symptoms: formSymptoms
        })
      });
      const data = await res.json();
      if (data.scientificName && !formScientificName) {
        setFormScientificName(data.scientificName);
      }
      if (data.symptoms && (!formSymptoms || formSymptoms.trim().length < 10)) {
        setFormSymptoms(data.symptoms);
      }
      if (data.recommendedControl) {
        setFormRecommendedControl(data.recommendedControl);
      }
      if (data.severityAssessment && !editingRecordIdx) {
        setFormSeverity(data.severityAssessment);
      }
      toast.success('Diagnóstico e prescrição agronômica preenchidos com IA!');
    } catch (err: any) {
      toast.error('Erro ao consultar IA de fitossanidade.');
    } finally {
      setFormAiLoading(false);
    }
  };

  const handleAIDiagnosis = async (pest: PestDiseaseRecord) => {
    setAiLoading(true);
    setAiDiagnosis(null);
    try {
      const token = auth.currentUser
        ? await auth.currentUser.getIdToken()
        : '';
      const res = await fetch('/api/ai/reports-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: `Sou um engenheiro agrônomo. Identifique o agente causal e recomende controle para:
            Cultura: ${pest.crop || 'não informada'}
            Sintomas: ${pest.symptoms || 'não informados'}
            Severidade: ${pest.severity || 'não informada'}
            Município: ${pest.propertyName || 'não informado'}
            Responda em 3 tópicos: 1. Provável agente causal, 2. Nível de risco, 3. Recomendação de controle.`
        })
      });
      const data = await res.json();
      setAiDiagnosis(data.text || data.reply || data.message || 'Sem resposta da IA.');
    } catch (err: any) {
      setAiDiagnosis('Erro ao consultar IA. Verifique a conexão.');
    } finally {
      setAiLoading(false);
    }
  };

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'monitoring' | 'controlled' | 'closed'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all');
  const [cropFilter, setCropFilter] = useState('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<PestDiseaseRecord | null>(null);
  const [editingRecordIdx, setEditingRecordIdx] = useState<string | null>(null);

  // Form states matching PestDiseaseRecord
  const [formClientId, setFormClientId] = useState('');
  const [formPropertyName, setFormPropertyName] = useState('');
  const [formCrop, setFormCrop] = useState('');
  const [formPestOrDisease, setFormPestOrDisease] = useState('');
  const [formScientificName, setFormScientificName] = useState('');
  const [formSeverity, setFormSeverity] = useState<PestSeverity>('low');
  const [formAffectedAreaHectares, setFormAffectedAreaHectares] = useState<number>(0);
  const [formSymptoms, setFormSymptoms] = useState('');
  const [formRecommendedControl, setFormRecommendedControl] = useState('');
  const [formAppliedControl, setFormAppliedControl] = useState('');
  const [formApplicationDate, setFormApplicationDate] = useState('');
  const [formFollowUpDate, setFormFollowUpDate] = useState('');
  const [formStatus, setFormStatus] = useState<PestDiseaseRecord['status']>('open');
  const [formLatitude, setFormLatitude] = useState<string>('');
  const [formLongitude, setFormLongitude] = useState<string>('');

  useEffect(() => {
    if (!user) return;

    const unsubscribeClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const list: Client[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as Client);
      });
      setClients(list);
    });

    const unsubscribeRecords = onSnapshot(
      query(collection(db, 'pest_disease'), orderBy('createdAt', 'desc')), 
      (snapshot) => {
        const list: PestDiseaseRecord[] = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() } as PestDiseaseRecord);
        });
        setRecords(list);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading pest records:", error);
        toast.error("Erro ao carregar o monitoramento de pragas.");
        setLoading(false);
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribeRecords();
    };
  }, [user]);

  // Unique crop list for filter
  const cropsList = useMemo(() => {
    const list = new Set<string>();
    records.forEach(r => {
      if (r.crop) list.add(r.crop);
    });
    return Array.from(list);
  }, [records]);

  const resetForm = () => {
    setFormClientId('');
    setFormPropertyName('');
    setFormCrop('');
    setFormPestOrDisease('');
    setFormScientificName('');
    setFormSeverity('low');
    setFormAffectedAreaHectares(0);
    setFormSymptoms('');
    setFormRecommendedControl('');
    setFormAppliedControl('');
    setFormApplicationDate('');
    setFormFollowUpDate('');
    setFormStatus('open');
    setFormLatitude('');
    setFormLongitude('');
    setEditingRecordIdx(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formClientId) {
      toast.error("Por favor, selecione um produtor.");
      return;
    }
    if (!formCrop) {
      toast.error("Por favor, informe a cultura afetada.");
      return;
    }
    if (!formPestOrDisease) {
      toast.error("Por favor, informe a praga ou doença.");
      return;
    }

    const selectedClient = clients.find(c => c.id === formClientId);
    if (!selectedClient) {
      toast.error("Produtor inválido.");
      return;
    }

    const payload: Omit<PestDiseaseRecord, 'id'> = {
      clientId: formClientId,
      clientName: selectedClient.name,
      propertyName: formPropertyName || 'Talhão Principal',
      reportedById: user?.uid || 'system',
      reportedByName: user?.displayName || user?.email || 'Engenheiro Agrônomo',
      crop: formCrop,
      pestOrDisease: formPestOrDisease,
      scientificName: formScientificName || undefined,
      severity: formSeverity,
      affectedAreaHectares: Number(formAffectedAreaHectares) || 0,
      symptoms: formSymptoms,
      recommendedControl: formRecommendedControl,
      appliedControl: formAppliedControl || undefined,
      applicationDate: formApplicationDate || undefined,
      followUpDate: formFollowUpDate || undefined,
      photos: [],
      status: formStatus,
      latitude: formLatitude ? Number(formLatitude) : undefined,
      longitude: formLongitude ? Number(formLongitude) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingRecordIdx) {
        await updateDoc(doc(db, 'pest_disease', editingRecordIdx), {
          ...payload,
          updatedAt: new Date().toISOString()
        });
        toast.success("Registro de Praga & Doença atualizado!");
      } else {
        await addDoc(collection(db, 'pest_disease'), payload);
        toast.success("Monitoramento de Praga & Doença cadastrado com sucesso!");
      }

      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao salvar o monitoramento.");
    }
  };

  const handleEdit = (rec: PestDiseaseRecord) => {
    setEditingRecordIdx(rec.id);
    setFormClientId(rec.clientId);
    setFormPropertyName(rec.propertyName);
    setFormCrop(rec.crop);
    setFormPestOrDisease(rec.pestOrDisease);
    setFormScientificName(rec.scientificName || '');
    setFormSeverity(rec.severity);
    setFormAffectedAreaHectares(rec.affectedAreaHectares);
    setFormSymptoms(rec.symptoms);
    setFormRecommendedControl(rec.recommendedControl);
    setFormAppliedControl(rec.appliedControl || '');
    setFormApplicationDate(rec.applicationDate || '');
    setFormFollowUpDate(rec.followUpDate || '');
    setFormStatus(rec.status);
    setFormLatitude(rec.latitude ? String(rec.latitude) : '');
    setFormLongitude(rec.longitude ? String(rec.longitude) : '');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (await confirmAction({
      title: 'Excluir vistoria?',
      description: 'Deseja mesmo remover permanentemente este registro de pragas/doenças do banco de vistorias?',
      confirmLabel: 'Excluir',
    })) {
      try {
        await deleteDoc(doc(db, 'pest_disease', id));
        toast.success("Vistoria excluída!");
      } catch (err) {
        toast.error("Erro ao deletar.");
      }
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter(rec => {
      const matchesSearch = (rec.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (rec.pestOrDisease || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (rec.crop || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (rec.propertyName && (rec.propertyName || '').toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === 'all' || rec.status === statusFilter;
      const matchesSeverity = severityFilter === 'all' || rec.severity === severityFilter;
      const matchesCrop = cropFilter === 'all' || rec.crop === cropFilter;

      return matchesSearch && matchesStatus && matchesSeverity && matchesCrop;
    });
  }, [records, searchTerm, statusFilter, severityFilter, cropFilter]);

  // Aggregated analytics metrics for cards
  const statsOverview = useMemo(() => {
    const active = records.filter(r => r.status === 'open' || r.status === 'monitoring');
    const criticalCount = active.filter(r => r.severity === 'critical' || r.severity === 'high').length;
    const affectedArea = active.reduce((acc, r) => acc + r.affectedAreaHectares, 0);

    return {
      activeCount: active.length,
      criticalCount,
      affectedArea: Math.round(affectedArea * 10) / 10
    };
  }, [records]);

  // Charts Severity Distribution
  const chartSeverityData = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0 };
    records.forEach(r => {
      if (r.status !== 'closed' && r.status !== 'controlled') {
        counts[r.severity] = (counts[r.severity] || 0) + 1;
      }
    });

    return [
      { name: 'Baixo', value: counts.low, color: '#10b981' },
      { name: 'Médio', value: counts.medium, color: '#f59e0b' },
      { name: 'Alto', value: counts.high, color: '#ef4444' },
      { name: 'Crítico', value: counts.critical, color: '#7f1d1d' },
    ].filter(item => item.value > 0);
  }, [records]);

  const severityLabels = {
    low: { label: 'Baixa', color: 'bg-emerald-100 text-emerald-800 border-emerald-250 text-emerald-700' },
    medium: { label: 'Média', color: 'bg-amber-100 text-amber-800 border-amber-250 text-amber-700' },
    high: { label: 'Alta', color: 'bg-amber-100 text-amber-850 border-amber-200 text-amber-700' },
    critical: { label: 'Crítica', color: 'bg-rose-100 text-rose-850 border-rose-250 text-rose-800 animate-pulse' }
  };

  const statusLabels = {
    open: { label: 'Ativo', color: 'bg-rose-50 text-rose-600 border-rose-100' },
    monitoring: { label: 'Em Monitoramento', color: 'bg-slate-50 text-slate-600 border-slate-100' },
    controlled: { label: 'Controlado', color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
    closed: { label: 'Fechado', color: 'bg-slate-100 text-slate-500 border-slate-200' }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-700">
      {confirmModal}
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/40 p-6 rounded-[2rem] glass border border-white/40 shadow-sm">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-800 flex items-center gap-2">
            <Bug className="w-6 h-6 text-emerald-600" /> Detecção de Pragas & Fitossanidade
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Gestão integrada do combate a patógenos, infestações de lagartas, insetos e monitoramento de talhões</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase transition-all shadow-md active:scale-95 self-start md:self-auto"
        >
          <Plus className="w-4 h-4" /> Registrar Foco
        </button>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
            <Bug className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Focos Ativos</span>
            <span className="text-2xl font-display font-bold text-slate-750">{statsOverview.activeCount}</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Sob vigilância sanitária</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-605 flex items-center justify-center border border-rose-100">
            <ShieldAlert className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Severidade Crítica / Alta</span>
            <span className="text-2xl font-display font-bold text-rose-600">{statsOverview.criticalCount}</span>
            <span className="text-[10px] text-rose-450 block mt-0.5 font-bold">Risco iminente de prejuízo</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-100">
            <Crop className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Área sob Impacto</span>
            <span className="text-2xl font-display font-bold text-slate-600">{statsOverview.affectedArea} ha</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Soma de parcelas atingidas</span>
          </div>
        </div>
      </div>

      {/* Visual Charts section */}
      {chartSeverityData.length > 0 && (
        <div className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm">
          <h3 className="font-display font-bold text-slate-800 text-xs uppercase tracking-wider mb-4">Mapeamento Dinâmico de Riscos Fitossanitários Ativos</h3>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSeverityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="value" fill="#10b981" radius={[8, 8, 0, 0]}>
                  {chartSeverityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input 
            type="text"
            placeholder="Buscar por praga, cultura, produtor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 font-sans"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <select 
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-600 outline-none"
          >
            <option value="all">Todos Status</option>
            <option value="open">Ativo</option>
            <option value="monitoring">Em Monitoramento</option>
            <option value="controlled">Controlado</option>
            <option value="closed">Fechado</option>
          </select>

          <select 
            value={severityFilter}
            onChange={(e: any) => setSeverityFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-600 outline-none"
          >
            <option value="all">Todas Severidades</option>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>

          <select 
            value={cropFilter}
            onChange={(e) => setCropFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-600 outline-none"
          >
            <option value="all">Todas Culturas</option>
            {cropsList.map(cr => (
              <option key={cr} value={cr}>{cr}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid listing */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-48 bg-slate-105 rounded-3xl w-full"></div>
          ))}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="bg-white rounded-3xl py-12 px-6 border border-slate-100 shadow-sm text-center">
          <Bug className="w-12 h-12 text-slate-300 mx-auto animate-bounce mb-3" />
          <h3 className="font-display font-black text-slate-700">Nenhum Registro Sanitário</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Nenhum foco de praga de campo ou infecção corresponde ao filtro.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecords.map(rec => {
            const sevInfo = severityLabels[rec.severity] || { label: rec.severity, color: 'bg-slate-100' };
            const statInfo = statusLabels[rec.status] || { label: rec.status, color: 'bg-slate-100' };

            return (
              <motion.div 
                key={rec.id}
                layout
                className="bg-white rounded-3xl p-6 border border-slate-105 shadow-sm flex flex-col justify-between gap-4 relative"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block font-sans">
                      {rec.crop}
                    </span>
                    <span className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border", sevInfo.color)}>
                      {sevInfo.label}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <h3 className="text-base font-display font-bold text-slate-800 leading-tight">
                      {rec.pestOrDisease}
                    </h3>
                    {rec.scientificName && (
                      <span className="text-[10px] italic text-slate-400 block font-serif">
                        {rec.scientificName}
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-2xl text-[10px] text-slate-500 leading-relaxed font-sans">
                    <strong>Produtor:</strong> {rec.clientName} <br />
                    <strong>Localidade/Talhão:</strong> {rec.propertyName} <br />
                    <strong>Área Acometida:</strong> {rec.affectedAreaHectares} ha
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                  <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-md border", statInfo.color)}>
                    {statInfo.label}
                  </span>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setViewingRecord(rec)}
                      className="p-1.5 hover:bg-slate-55 rounded-xl text-slate-400 hover:text-slate-600"
                      title="Visualizar Diagnóstico"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleEdit(rec)}
                      className="p-1.5 hover:bg-slate-55 rounded-xl text-slate-400 hover:text-emerald-600"
                      title="Especificar Controle"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(rec.id)}
                      className="p-1.5 hover:bg-slate-55 rounded-xl text-slate-400 hover:text-rose-600"
                      title="Deletar Doença"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] w-full max-w-2xl p-6 md:p-8 space-y-6 max-h-[92vh] overflow-y-auto relative text-slate-700 font-sans"
            >
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <Bug className="w-5 h-5 text-emerald-650" />
                  <h3 className="text-lg font-display font-black text-slate-850">
                    {editingRecordIdx ? 'Atualizar Combate Fitossanitário' : 'Novo Registro de Pragas / Patógenos'}
                  </h3>
                </div>
                <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('PestDisease.handleSave', () => handleSave(e)); }} className="space-y-4 text-xs">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Produtor / Cliente</label>
                    <select
                      value={formClientId}
                      onChange={(e) => setFormClientId(e.target.value)}
                      className="w-full glass-input"
                      required
                    >
                      <option value="">Selecione o Produtor</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Nome da Propriedade / Talhão</label>
                    <input 
                      type="text"
                      value={formPropertyName}
                      onChange={(e) => setFormPropertyName(e.target.value)}
                      placeholder="Ex: Pivô 3 - Café Central"
                      className="w-full glass-input"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Identificação Agronômica</span>
                  <button
                    type="button"
                    onClick={handleFormAiAssistance}
                    disabled={formAiLoading}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-[11px] font-bold transition-all border border-emerald-200"
                  >
                    <Sparkles className={cn("w-3.5 h-3.5", formAiLoading && "animate-spin text-emerald-500")} />
                    {formAiLoading ? "Consultando IA..." : "Sugerir com Gemini AI"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Cultura Afetada</label>
                    <input 
                      type="text"
                      value={formCrop}
                      onChange={(e) => setFormCrop(e.target.value)}
                      placeholder="Ex: Soja, Milho, Café, Sorgo"
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Praga ou Doença (Comum)</label>
                    <input 
                      type="text"
                      value={formPestOrDisease}
                      onChange={(e) => setFormPestOrDisease(e.target.value)}
                      placeholder="Ex: Ferrugem Asiática"
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Nome Científico (Opcional)</label>
                    <input 
                      type="text"
                      value={formScientificName}
                      onChange={(e) => setFormScientificName(e.target.value)}
                      placeholder="Ex: Phakopsora pachyrhizi"
                      className="w-full glass-input italic"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Grau de Severidade</label>
                    <select
                      value={formSeverity}
                      onChange={(e: any) => setFormSeverity(e.target.value)}
                      className="w-full glass-input"
                    >
                      <option value="low">Baixa (Menor que 5% de área foliar/dano)</option>
                      <option value="medium">Média (Entre 5% e 15% de área foliar)</option>
                      <option value="high">Alta (Nível de controle ultrapassado)</option>
                      <option value="critical">Crítica (Risco imediato de perda de lote)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Área Total Afetada (hectares)</label>
                    <input 
                      type="number"
                      step="any"
                      min={0}
                      value={formAffectedAreaHectares || ''}
                      onChange={(e) => setFormAffectedAreaHectares(parseFloat(e.target.value) || 0)}
                      placeholder="0.0"
                      className="w-full glass-input font-bold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Status Foco</label>
                    <select
                      value={formStatus}
                      onChange={(e: any) => setFormStatus(e.target.value)}
                      className="w-full glass-input"
                    >
                      <option value="open">Ativo / Aberto</option>
                      <option value="monitoring">Sob Monitoramento</option>
                      <option value="controlled">Controlado</option>
                      <option value="closed">Fechado / Encerrado</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Sintomas Observados / Danos</label>
                    <textarea
                      rows={2.5}
                      value={formSymptoms}
                      onChange={(e) => setFormSymptoms(e.target.value)}
                      placeholder="Ex: Amarelecimento foliar, pontos escuros na folhagem, tombamento de hastes..."
                      className="w-full glass-input py-2"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Recomendações de Controle (Químico/Biológico)</label>
                    <textarea
                      rows={2.5}
                      value={formRecommendedControl}
                      onChange={(e) => setFormRecommendedControl(e.target.value)}
                      placeholder="Indique a bula do defensivo, dosagem, ou uso de controladores biológicos..."
                      className="w-full glass-input py-2"
                      required
                    />
                  </div>
                </div>

                {/* Seção Opcional de Aplicação e Controle */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50 space-y-3">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Histórico de Aplicação / Tratamento Consolidado</span>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-400 font-bold uppercase">Tratamento Aplicado</label>
                      <input 
                        type="text"
                        value={formAppliedControl}
                        onChange={(e) => setFormAppliedControl(e.target.value)}
                        placeholder="Nome comercial do defensivo ou calda..."
                        className="w-full glass-input h-8 text-[11px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-400 font-bold uppercase">Data de Execução</label>
                      <input 
                        type="date"
                        value={formApplicationDate}
                        onChange={(e) => setFormApplicationDate(e.target.value)}
                        className="w-full glass-input h-8 text-[11px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-400 font-bold uppercase">Próxima Reavaliação</label>
                      <input 
                        type="date"
                        value={formFollowUpDate}
                        onChange={(e) => setFormFollowUpDate(e.target.value)}
                        className="w-full glass-input h-8 text-[11px]"
                      />
                    </div>
                  </div>
                </div>

                {/* Coordenadas Geográficas de Hotspot */}
                <div className="p-3 bg-slate-50/10 rounded-2xl border border-emerald-500/10 flex flex-col md:flex-row items-center gap-3">
                  <div className="text-left font-sans flex-1">
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest block">Georreferenciamento de Pragas (GPS)</span>
                    <strong className="text-[10px] text-slate-400 font-medium">Assegura o mapeamento visual exato do foco fitossanitário no satélite.</strong>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <input 
                      type="number"
                      step="any"
                      placeholder="Latitude (S)"
                      value={formLatitude}
                      onChange={(e) => setFormLatitude(e.target.value)}
                      className="w-28 glass-input h-8 font-mono text-[11px]"
                    />
                    <input 
                      type="number"
                      step="any"
                      placeholder="Longitude (W)"
                      value={formLongitude}
                      onChange={(e) => setFormLongitude(e.target.value)}
                      className="w-28 glass-input h-8 font-mono text-[11px]"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => { setIsModalOpen(false); resetForm(); }}
                    className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md uppercase transition-all"
                  >
                    Gravar Monitoramento
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Viewer drawer */}
      <AnimatePresence>
        {viewingRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] w-full max-w-xl p-6 md:p-8 space-y-5 relative text-slate-705 text-xs font-sans"
            >
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <Bug className="w-5 h-5 text-rose-600" />
                  <h3 className="text-base font-display font-bold text-slate-800">
                    Inspeção Fitossanitária: {viewingRecord.pestOrDisease}
                  </h3>
                </div>
                <button onClick={() => setViewingRecord(null)} className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Detail Content */}
              <div className="space-y-4">
                
                <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Cultura Atingida</span>
                    <strong className="text-sm text-slate-800 block mt-0.5">{viewingRecord.crop}</strong>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Severidade do Dano</span>
                    <strong className="text-xs text-rose-600 block mt-0.5 font-bold">
                      {severityLabels[viewingRecord.severity]?.label || viewingRecord.severity}
                    </strong>
                  </div>
                </div>

                <div className="space-y-2 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Laudo Sanitário Geral</span>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 font-semibold block">Produtor:</span>
                      <strong className="text-slate-700">{viewingRecord.clientName}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold block">Gleba/Talhão:</span>
                      <strong className="text-slate-700">{viewingRecord.propertyName}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold block">Área sob Foco:</span>
                      <strong className="text-slate-700">{viewingRecord.affectedAreaHectares} hectares</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold block">Autor da Vistoria:</span>
                      <strong className="text-slate-700">{viewingRecord.reportedByName}</strong>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-[10px] uppercase text-slate-400">Sintomas Técnicos Observados</h4>
                  <p className="bg-slate-50 p-3 rounded-2xl text-[11px] leading-relaxed italic text-slate-700">
                    "{viewingRecord.symptoms}"
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-[10px] uppercase text-slate-400">Controles e Combates Recomendados</h4>
                  <p className="bg-emerald-50/10 p-3 rounded-2xl border border-emerald-500/15 text-[11px] leading-relaxed text-slate-700">
                    {viewingRecord.recommendedControl}
                  </p>
                </div>

                {viewingRecord.appliedControl && (
                  <div className="p-4 bg-slate-50/20 rounded-3xl border border-emerald-500/15 space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest block">Tratamentos Históricos Efetuados</span>
                    <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                      <div>
                        <strong>Cura Empregada:</strong> {viewingRecord.appliedControl}
                      </div>
                      <div>
                        <strong>Data da Aplicação:</strong> {viewingRecord.applicationDate ? new Date(viewingRecord.applicationDate).toLocaleDateString() : 'N/D'}
                      </div>
                      {viewingRecord.followUpDate && (
                        <div className="col-span-2 text-slate-805 font-bold mt-1 shadow-xs">
                          Próxima Vistoria Agendada: {new Date(viewingRecord.followUpDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {viewingRecord.latitude && viewingRecord.longitude && (
                  <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[10px]">
                    <MapPin className="text-slate-600 w-4 h-4 shrink-0" />
                    <strong>Coordenadas GPS do Hotspot:</strong>
                    <span className="font-mono text-slate-700">Lat {viewingRecord.latitude}, Lng {viewingRecord.longitude}</span>
                  </div>
                )}

                {/* AI Diagnosis Action & Output */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleAIDiagnosis(viewingRecord)}
                    disabled={aiLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    {aiLoading ? 'Analisando...' : 'Diagnosticar por IA'}
                  </button>

                  {aiDiagnosis && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-2 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Diagnóstico IA (beta)
                      </p>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {aiDiagnosis}
                      </p>
                    </div>
                  )}
                </div>

              </div>

              <div className="flex justify-end pt-3 border-t">
                <button 
                  onClick={() => { setViewingRecord(null); setAiDiagnosis(null); }}
                  className="px-5 py-2 hover:bg-slate-100 rounded-xl border border-slate-200 text-slate-550"
                >
                  Fechar Detalhes
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
