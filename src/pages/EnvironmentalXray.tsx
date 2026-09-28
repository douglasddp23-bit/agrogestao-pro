import React, { useEffect, useState, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { useConfirm } from '../hooks/useConfirm';
import { 
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { EnvironmentalXray, Client } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Leaf, Plus, Search, Trash2, Edit3, X, Eye, Check, AlertTriangle, 
  Map, Droplet, ShieldAlert, Award, FileText, ChevronRight, BarChart, Download
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, todayLocalDateString } from '../lib/utils';
import { 
  ResponsiveContainer, PieChart, Pie, Cell, RadarChart, PolarGrid, 
  PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, Legend 
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function EnvironmentalXrayPage() {
  const { user } = useAuth();
  const [confirmAction, confirmModal] = useConfirm();
  const [records, setRecords] = useState<EnvironmentalXray[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const handleExportPDF = (record: EnvironmentalXray | any) => {
    try {
      const doc = new jsPDF();
      const today = new Date().toLocaleDateString('pt-BR');

      // Capa
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('LAUDO DE RAIO-X AMBIENTAL', 105, 30, { align: 'center' });
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Propriedade: ${record.propertyName}`, 20, 50);
      doc.text(`Município: ${record.municipality || record.city || record.clientName || '-'}`, 20, 60);
      doc.text(`Score ESG: ${record.score}/100`, 20, 70);
      doc.text(`Data: ${today}`, 20, 80);

      // Critérios avaliados
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('CRITÉRIOS AVALIADOS', 20, 100);

      const criteriaRows = (record.criteria && Array.isArray(record.criteria)) ? (record.criteria || []).map((c: any) => [
        c.name || c.label,
        c.status === 'ok' ? 'Conforme' : c.status === 'warning' ? 'Atenção' : 'Não conforme',
        c.points || c.score || '-',
      ]) : [
        ['Inscrição CAR', record.legalCompliance?.carRegistered ? 'Conforme' : 'Não conforme', record.legalCompliance?.carRegistered ? '25' : '0'],
        ['Averbação Reserva Legal', record.legalCompliance?.legalReserveRegistered ? 'Conforme' : 'Não conforme', record.legalCompliance?.legalReserveRegistered ? '20' : '0'],
        ['ITR Quitado', record.legalCompliance?.itrUpToDate ? 'Conforme' : 'Não conforme', record.legalCompliance?.itrUpToDate ? '15' : '0'],
        ['CCIR em Dia', record.legalCompliance?.ccirUpToDate ? 'Conforme' : 'Não conforme', record.legalCompliance?.ccirUpToDate ? '15' : '0'],
        ['Outorga de Água', record.waterResources?.hasWaterGrant ? 'Conforme' : 'Atenção', record.waterResources?.hasWaterGrant ? '15' : '0'],
        ['Passivos Ambientais', (!record.environmentalLiabilities?.illegalDeforestation && !record.environmentalLiabilities?.erosion) ? 'Conforme' : 'Não conforme', '10'],
      ];

      autoTable(doc, {
        startY: 108,
        head: [['Critério', 'Status', 'Pontos']],
        body: criteriaRows,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [34, 197, 94] },
      });

      // Conclusão e assinatura
      const finalY = (doc as any).lastAutoTable?.finalY || 150;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(`Conclusão: Score ESG de ${record.score}/100 — ${
        record.score >= 80 ? 'Excelente conformidade ambiental.' :
        record.score >= 50 ? 'Conformidade moderada. Ações corretivas recomendadas.' :
        'Alto risco ambiental. Regularização urgente necessária.'
      }`, 20, finalY + 20, { maxWidth: 170 });

      doc.line(20, finalY + 55, 100, finalY + 55);
      doc.text(`${user?.displayName || 'Responsável Técnico'}`, 20, finalY + 62);
      doc.text(`Engenheiro Agrônomo`, 20, finalY + 68);
      if (user?.professionalCertification) {
        doc.text(`CREA-MG nº ${user.professionalCertification}`, 20, finalY + 74);
      }
      doc.text(`${today}`, 20, finalY + 80);

      doc.save(`raio-x-ambiental-${record.propertyName?.replace(/\s/g,'_') || 'laudo'}.pdf`);
      toast.success('Laudo PDF gerado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao gerar laudo PDF:', err);
      toast.error('Erro ao gerar laudo PDF.');
    }
  };

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'completed'>('all');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high_risk' | 'moderate' | 'excellent'>('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<EnvironmentalXray | null>(null);
  const [editingRecordIdx, setEditingRecordIdx] = useState<string | null>(null);

  // Form State
  const [formClientId, setFormClientId] = useState('');
  const [formPropertyName, setFormPropertyName] = useState('');
  const [formVisitDate, setFormVisitDate] = useState(todayLocalDateString());
  const [formTotalAreaHa, setFormTotalAreaHa] = useState<number>(0);

  // Land use percentages
  const [formPreservedAreaPct, setFormPreservedAreaPct] = useState<number>(20);
  const [formPastureAreaPct, setFormPastureAreaPct] = useState<number>(40);
  const [formCropAreaPct, setFormCropAreaPct] = useState<number>(20);
  const [formAppAreaPct, setFormAppAreaPct] = useState<number>(10);
  const [formLegalReserveAreaPct, setFormLegalReserveAreaPct] = useState<number>(10);

  // Water
  const [formHasSpringWater, setFormHasSpringWater] = useState(false);
  const [formSpringCount, setFormSpringCount] = useState<number>(0);
  const [formHasWaterBodies, setFormHasWaterBodies] = useState(false);
  const [formHasWaterGrant, setFormHasWaterGrant] = useState(false);

  // Legal
  const [formCarRegistered, setFormCarRegistered] = useState(true);
  const [formItrUpToDate, setFormItrUpToDate] = useState(true);
  const [formCcirUpToDate, setFormCcirUpToDate] = useState(true);
  const [formLegalReserveRegistered, setFormLegalReserveRegistered] = useState(true);

  // Liabilities
  const [formIllegalDeforestation, setFormIllegalDeforestation] = useState(false);
  const [formErosion, setFormErosion] = useState(false);
  const [formSoilContamination, setFormSoilContamination] = useState(false);
  const [formWaterContamination, setFormWaterContamination] = useState(false);
  const [formLiabilitiesDetails, setFormLiabilitiesDetails] = useState('');

  // Carbon
  const [formEligibleAreaHa, setFormEligibleAreaHa] = useState<number>(0);
  const [formPsaEligible, setFormPsaEligible] = useState(false);
  const [formCarbonNotes, setFormCarbonNotes] = useState('');

  const [formTechnicalOpinion, setFormTechnicalOpinion] = useState('');
  const [formStatus, setFormStatus] = useState<'draft' | 'completed'>('draft');

  // Load clients and records
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
      query(collection(db, 'environmental_xray'), orderBy('createdAt', 'desc')), 
      (snapshot) => {
        const list: EnvironmentalXray[] = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() } as EnvironmentalXray);
        });
        setRecords(list);
        setLoading(false);
      },
      (error) => {
        console.error("Error loaded EnvironmentalXrays:", error);
        toast.error("Erro ao carregar os dados do Raio-X Ambiental.");
        setLoading(false);
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribeRecords();
    };
  }, [user]);

  // Compute ESG Sustainability score
  const computedScore = useMemo(() => {
    let base = 100;

    // Legal compliance
    if (!formCarRegistered) base -= 20;
    if (!formItrUpToDate) base -= 10;
    if (!formCcirUpToDate) base -= 10;
    if (!formLegalReserveRegistered) base -= 15;

    // Environmental liabilities
    if (formIllegalDeforestation) base -= 30;
    if (formErosion) base -= 10;
    if (formSoilContamination) base -= 10;
    if (formWaterContamination) base -= 10;

    // Water issues
    if (formHasWaterBodies && !formHasWaterGrant) {
      base -= 10;
    }

    return Math.max(0, Math.min(100, base));
  }, [
    formCarRegistered, formItrUpToDate, formCcirUpToDate, formLegalReserveRegistered,
    formIllegalDeforestation, formErosion, formSoilContamination, formWaterContamination,
    formHasWaterBodies, formHasWaterGrant
  ]);

  const resetForm = () => {
    setFormClientId('');
    setFormPropertyName('');
    setFormVisitDate(todayLocalDateString());
    setFormTotalAreaHa(0);
    setFormPreservedAreaPct(20);
    setFormPastureAreaPct(40);
    setFormCropAreaPct(20);
    setFormAppAreaPct(10);
    setFormLegalReserveAreaPct(10);
    setFormHasSpringWater(false);
    setFormSpringCount(0);
    setFormHasWaterBodies(false);
    setFormHasWaterGrant(false);
    setFormCarRegistered(true);
    setFormItrUpToDate(true);
    setFormCcirUpToDate(true);
    setFormLegalReserveRegistered(true);
    setFormIllegalDeforestation(false);
    setFormErosion(false);
    setFormSoilContamination(false);
    setFormWaterContamination(false);
    setFormLiabilitiesDetails('');
    setFormEligibleAreaHa(0);
    setFormPsaEligible(false);
    setFormCarbonNotes('');
    setFormTechnicalOpinion('');
    setFormStatus('draft');
    setEditingRecordIdx(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formClientId) {
      toast.error("Por favor, selecione um cliente.");
      return;
    }

    const selectedClient = clients.find(c => c.id === formClientId);
    if (!selectedClient) {
      toast.error("Cliente inválido.");
      return;
    }

    // Validation for sums
    const totalPct = formPreservedAreaPct + formPastureAreaPct + formCropAreaPct + formAppAreaPct + formLegalReserveAreaPct;
    if (totalPct > 100) {
      toast.error(`A soma das porcentagens de uso do solo (${totalPct}%) excede 100%. Por favor, ajuste.`);
      return;
    }

    const dataPayload: Omit<EnvironmentalXray, 'id'> = {
      clientId: formClientId,
      clientName: selectedClient.name,
      propertyName: formPropertyName || 'Propriedade Principal',
      technicianId: user?.uid || 'system',
      technicianName: user?.displayName || user?.email || 'Técnico AgroGestão',
      visitDate: formVisitDate,
      totalAreaHa: Number(formTotalAreaHa) || 0,
      landUse: {
        preservedAreaPct: Number(formPreservedAreaPct) || 0,
        pastureAreaPct: Number(formPastureAreaPct) || 0,
        cropAreaPct: Number(formCropAreaPct) || 0,
        appAreaPct: Number(formAppAreaPct) || 0,
        legalReserveAreaPct: Number(formLegalReserveAreaPct) || 0,
      },
      waterResources: {
        hasSpringWater: formSpringWaterCountAndState(),
        springCount: formHasSpringWater ? Number(formSpringCount) : 0,
        hasWaterBodies: formHasWaterBodies,
        hasWaterGrant: formHasWaterGrant,
      },
      legalCompliance: {
        carRegistered: formCarRegistered,
        itrUpToDate: formItrUpToDate,
        ccirUpToDate: formCcirUpToDate,
        legalReserveRegistered: formLegalReserveRegistered,
      },
      environmentalLiabilities: {
        illegalDeforestation: formIllegalDeforestation,
        erosion: formErosion,
        soilContamination: formSoilContamination,
        waterContamination: formWaterContamination,
        details: formLiabilitiesDetails,
      },
      carbonPotential: {
        eligibleAreaHa: Number(formEligibleAreaHa) || 0,
        psaEligible: formPsaEligible,
        notes: formCarbonNotes,
      },
      technicalOpinion: formTechnicalOpinion,
      score: computedScore,
      status: formStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingRecordIdx) {
        await updateDoc(doc(db, 'environmental_xray', editingRecordIdx), {
          ...dataPayload,
          updatedAt: new Date().toISOString()
        });
        toast.success("Diagnóstico Ambiental atualizado com sucesso!");
      } else {
        await addDoc(collection(db, 'environmental_xray'), dataPayload);
        toast.success("Novo Diagnóstico Ambiental gravado com sucesso!");
      }

      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao salvar o Diagnóstico Ambiental.");
    }
  };

  const formSpringWaterCountAndState = () => {
    return formHasSpringWater;
  };

  const handleEdit = (record: EnvironmentalXray) => {
    setEditingRecordIdx(record.id);
    setFormClientId(record.clientId);
    setFormPropertyName(record.propertyName);
    setFormVisitDate(record.visitDate);
    setFormTotalAreaHa(record.totalAreaHa);
    setFormPreservedAreaPct(record.landUse.preservedAreaPct);
    setFormPastureAreaPct(record.landUse.pastureAreaPct);
    setFormCropAreaPct(record.landUse.cropAreaPct);
    setFormAppAreaPct(record.landUse.appAreaPct);
    setFormLegalReserveAreaPct(record.landUse.legalReserveAreaPct);
    setFormHasSpringWater(record.waterResources.hasSpringWater);
    setFormSpringCount(record.waterResources.springCount || 0);
    setFormHasWaterBodies(record.waterResources.hasWaterBodies);
    setFormHasWaterGrant(record.waterResources.hasWaterGrant);
    setFormCarRegistered(record.legalCompliance.carRegistered);
    setFormItrUpToDate(record.legalCompliance.itrUpToDate);
    setFormCcirUpToDate(record.legalCompliance.ccirUpToDate);
    setFormLegalReserveRegistered(record.legalCompliance.legalReserveRegistered);
    setFormIllegalDeforestation(record.environmentalLiabilities.illegalDeforestation);
    setFormErosion(record.environmentalLiabilities.erosion);
    setFormSoilContamination(record.environmentalLiabilities.soilContamination);
    setFormWaterContamination(record.environmentalLiabilities.waterContamination);
    setFormLiabilitiesDetails(record.environmentalLiabilities.details || '');
    setFormEligibleAreaHa(record.carbonPotential.eligibleAreaHa);
    setFormPsaEligible(record.carbonPotential.psaEligible);
    setFormCarbonNotes(record.carbonPotential.notes || '');
    setFormTechnicalOpinion(record.technicalOpinion);
    setFormStatus(record.status);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (await confirmAction({
      title: 'Excluir diagnóstico?',
      description: 'Tem certeza que deseja remover este diagnóstico? Esta ação é irreversível.',
      confirmLabel: 'Excluir',
    })) {
      try {
        await deleteDoc(doc(db, 'environmental_xray', id));
        toast.success("Diagnóstico deletado com sucesso!");
      } catch (err) {
        toast.error("Erro ao deletar registro.");
      }
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter(rec => {
      const matchesSearch = (rec.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (rec.propertyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (rec.technicianName || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || rec.status === statusFilter;

      let matchesScore = true;
      if (scoreFilter === 'high_risk') matchesScore = rec.score < 50;
      else if (scoreFilter === 'moderate') matchesScore = rec.score >= 50 && rec.score < 80;
      else if (scoreFilter === 'excellent') matchesScore = rec.score >= 80;

      return matchesSearch && matchesStatus && matchesScore;
    });
  }, [records, searchTerm, statusFilter, scoreFilter]);

  // Overall Statistics for Dashboard
  const statsOverview = useMemo(() => {
    if (records.length === 0) return { avgScore: 0, totalAuditedArea: 0, compliancesCount: 0 };
    const completed = records.filter(r => r.status === 'completed');
    const avgScore = completed.reduce((acc, r) => acc + r.score, 0) / (completed.length || 1);
    const auditedArea = records.reduce((acc, r) => acc + r.totalAreaHa, 0);
    const highRankCount = completed.filter(r => r.score >= 80).length;

    return {
      avgScore: Math.round(avgScore),
      totalAuditedArea: auditedArea,
      highRankCount
    };
  }, [records]);

  return (
    <div className="space-y-6 pb-12 text-slate-700">
      {confirmModal}
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/40 p-6 rounded-[2rem] glass border border-white/40 shadow-sm">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-800 flex items-center gap-2">
            <Leaf className="w-6 h-6 text-emerald-600" /> Raio-X Ambiental & ESG
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Auditorias ecológicas de propriedades, conformidade com código florestal e análise de passivos</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase transition-all shadow-md active:scale-95 self-start md:self-auto"
        >
          <Plus className="w-4 h-4" /> Novo Diagnóstico
        </button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Score Médio ESG</span>
            <span className="text-2xl font-display font-bold text-emerald-600">{statsOverview.avgScore}%</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Baseado em dados finalizados</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-100">
            <Map className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Área Total Mapeada</span>
            <span className="text-2xl font-display font-bold text-slate-750">{statsOverview.totalAuditedArea.toLocaleString('pt-BR')} ha</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Soma de todas as vistorias</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-100">
            <Check className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Propriedades Nota A (&gt;=80)</span>
            <span className="text-2xl font-display font-bold text-slate-600">{statsOverview.highRankCount}</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Com conformidade máxima</span>
          </div>
        </div>
      </div>

      {/* Filtration Drawer */}
      <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input 
            type="text"
            placeholder="Buscar produtor, propriedade ou técnico..."
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
            <option value="draft">Rascunho</option>
            <option value="completed">Concluídos</option>
          </select>

          <select 
            value={scoreFilter}
            onChange={(e: any) => setScoreFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-600 outline-none"
          >
            <option value="all">Todos Níveis de Risco</option>
            <option value="high_risk">Alto Risco (Score &lt; 50)</option>
            <option value="moderate">Risco Moderado (50 - 79)</option>
            <option value="excellent">Sustentável (80 - 100)</option>
          </select>
        </div>
      </div>

      {/* Grid listing */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-64 bg-slate-100 rounded-3xl w-full"></div>
          ))}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="bg-white rounded-3xl py-12 px-6 border border-slate-100 shadow-sm text-center">
          <Leaf className="w-12 h-12 text-slate-300 mx-auto animate-bounce mb-3" />
          <h3 className="font-display font-black text-slate-700">Nenhum Diagnóstico Encontrado</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Tente ajustar seus refinamentos de busca ou inicie um diagnóstico agora mesmo.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecords.map(rec => {
            const scoreColor = rec.score < 50 ? 'text-rose-600 bg-rose-50 border-rose-100' :
                               rec.score < 80 ? 'text-amber-600 bg-amber-50 border-amber-100' :
                               'text-emerald-600 bg-emerald-50 border-emerald-100';

            return (
              <motion.div 
                key={rec.id}
                layout
                className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col gap-4 relative overflow-hidden"
              >
                {/* Score badge top corner */}
                <span className={cn("text-xs font-black px-2.5 py-1.5 rounded-2xl border absolute right-6 top-6", scoreColor)}>
                  Score {rec.score}%
                </span>

                <div className="flex flex-col gap-1 pr-[80px]">
                  <h4 className="font-display font-extrabold text-slate-800 tracking-tight leading-tight block truncate">
                    {rec.clientName}
                  </h4>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{rec.propertyName}</span>
                </div>

                <div className="grid grid-cols-2 gap-4 py-2 border-y border-slate-50 text-[10px] text-slate-500">
                  <div>
                    <span className="font-bold text-slate-400 uppercase">Vistoria</span>
                    <p className="font-sans font-semibold text-slate-705">{new Date(rec.visitDate).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 uppercase">Área Própria</span>
                    <p className="font-sans font-semibold text-slate-705">{rec.totalAreaHa} hectares</p>
                  </div>
                </div>

                {/* Score Level Explanation */}
                <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  {rec.score < 50 ? (
                    <>
                      <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                      <div className="text-[10px] text-slate-500 leading-relaxed">
                        <strong className="text-rose-600">Alta Vulnerabilidade:</strong> Possui passivos e irregularidades críticas que requerem intervenção para evitar sanções.
                      </div>
                    </>
                  ) : rec.score < 80 ? (
                    <>
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-[10px] text-slate-500 leading-relaxed">
                        <strong className="text-amber-600">Risco Moderado:</strong> Legislação básica consolidada, mas apresenta pendências gerenciais ou passivo de média escala.
                      </div>
                    </>
                  ) : (
                    <>
                      <Award className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="text-[10px] text-slate-500 leading-relaxed">
                        <strong className="text-emerald-700">Modelo Sustentável:</strong> Excelente grau de preservação e conformidade. Elegível a créditos ESG e projetos de carbono.
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                  <span className={cn("text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-md", 
                    rec.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-105 text-slate-500'
                  )}>
                    {rec.status === 'completed' ? 'Concluído' : 'Rascunho'}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button 
                      onClick={() => setViewingRecord(rec)}
                      className="p-1.5 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600"
                      title="Visualizar Detalhes"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleEdit(rec)}
                      className="p-1.5 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-emerald-600"
                      title="Editar Diagnóstico"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(rec.id)}
                      className="p-1.5 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-rose-600"
                      title="Remover Diagnóstico"
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

      {/* Diagnóstico Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] w-full max-w-4xl p-6 md:p-8 space-y-6 max-h-[92vh] overflow-y-auto relative text-slate-700"
            >
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-lg font-display font-bold text-slate-800">
                    {editingRecordIdx ? 'Atualizar Diagnóstico Ambiental' : 'Novo Diagnóstico Ambiental / ESG'}
                  </h3>
                </div>
                <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('EnvironmentalXray.handleSave', () => handleSave(e)); }} className="space-y-6 text-xs text-slate-650">
                {/* Visual score dynamic preview at top of modal */}
                <div className="flex flex-col md:flex-row items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100 gap-4">
                  <div className="space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Score ESG Estimado</span>
                    <strong className="text-xs text-slate-600 leading-relaxed block max-w-md">O score ambiental é recalculado dinamicamente com base na conformidade regulatória e passivos informados.</strong>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-3xl font-display font-black px-4 py-2 rounded-2xl border", 
                      computedScore < 50 ? 'bg-rose-100 border-rose-200 text-rose-700' :
                      computedScore < 80 ? 'bg-amber-100 border-amber-200 text-amber-700' :
                      'bg-emerald-100 border-emerald-200 text-emerald-800'
                    )}>
                      {computedScore}%
                    </span>
                  </div>
                </div>

                {/* Seção 1: Produtor e Identificação */}
                <div className="space-y-4">
                  <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">1. Identificação Geral</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Produtor</label>
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

                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Propriedade / Fazenda</label>
                      <input 
                        type="text"
                        value={formPropertyName}
                        onChange={(e) => setFormPropertyName(e.target.value)}
                        placeholder="Ex: Fazenda Santa Maria"
                        className="w-full glass-input"
                        required
                      />
                    </div>

                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Data da Vistoria</label>
                      <input 
                        type="date"
                        value={formVisitDate}
                        onChange={(e) => setFormVisitDate(e.target.value)}
                        className="w-full glass-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Área Total (Hectares)</label>
                      <input 
                        type="number"
                        min={0.1}
                        step="any"
                        value={formTotalAreaHa || ''}
                        onChange={(e) => setFormTotalAreaHa(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full glass-input"
                        required
                      />
                    </div>
                    <div className="space-y-1.5 col-span-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Distribuição da Ocupação do Solo (%)</span>
                      <div className="grid grid-cols-5 gap-2 mt-1">
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 uppercase block">Preservada</label>
                          <input type="number" min={0} max={100} value={formPreservedAreaPct} onChange={(e)=>setFormPreservedAreaPct(Number(e.target.value) || 0)} className="w-full glass-input font-mono h-8 text-[11px]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 uppercase block">Pastagem</label>
                          <input type="number" min={0} max={100} value={formPastureAreaPct} onChange={(e)=>setFormPastureAreaPct(Number(e.target.value) || 0)} className="w-full glass-input font-mono h-8 text-[11px]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 uppercase block">Lavoura</label>
                          <input type="number" min={0} max={100} value={formCropAreaPct} onChange={(e)=>setFormCropAreaPct(Number(e.target.value) || 0)} className="w-full glass-input font-mono h-8 text-[11px]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 uppercase block">APP</label>
                          <input type="number" min={0} max={100} value={formAppAreaPct} onChange={(e)=>setFormAppAreaPct(Number(e.target.value) || 0)} className="w-full glass-input font-mono h-8 text-[11px]" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 uppercase block">Res. Legal</label>
                          <input type="number" min={0} max={100} value={formLegalReserveAreaPct} onChange={(e)=>setFormLegalReserveAreaPct(Number(e.target.value) || 0)} className="w-full glass-input font-mono h-8 text-[11px]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seção 2: Recursos Hídricos e Legal */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">2. Recursos Hídricos</h4>
                    <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Contém Nascentes / Olhos d'Água</span>
                        <input 
                          type="checkbox"
                          checked={formHasSpringWater}
                          onChange={(e) => setFormHasSpringWater(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      {formHasSpringWater && (
                        <div className="space-y-1.5 animate-fadeIn">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Quantidade de Nascentes</label>
                          <input 
                            type="number"
                            min={0}
                            value={formSpringCount}
                            onChange={(e) => setFormSpringCount(parseInt(e.target.value) || 0)}
                            className="w-full glass-input h-9 text-xs"
                          />
                        </div>
                      )}

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Cursos, Rios ou Corpos D'Água</span>
                        <input 
                          type="checkbox"
                          checked={formHasWaterBodies}
                          onChange={(e) => setFormHasWaterBodies(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Possui Outorga / Licença de Uso</span>
                        <input 
                          type="checkbox"
                          checked={formHasWaterGrant}
                          onChange={(e) => setFormHasWaterGrant(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">3. Conformidade Legal</h4>
                    <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs">
                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Cadastro Ambiental Rural (CAR)</span>
                        <input 
                          type="checkbox"
                          checked={formCarRegistered}
                          onChange={(e) => setFormCarRegistered(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Reserva Legal Delimitada / Averbada</span>
                        <input 
                          type="checkbox"
                          checked={formLegalReserveRegistered}
                          onChange={(e) => setFormLegalReserveRegistered(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">ITR Declarado e Pago</span>
                        <input 
                          type="checkbox"
                          checked={formItrUpToDate}
                          onChange={(e) => setFormItrUpToDate(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">CCIR Regularizado</span>
                        <input 
                          type="checkbox"
                          checked={formCcirUpToDate}
                          onChange={(e) => setFormCcirUpToDate(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Seção 3: Passivos Ambientais / Riscos */}
                <div className="space-y-4">
                  <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">4. Riscos & Passivos Identificados</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-rose-50/10 p-5 rounded-3xl border border-rose-500/10">
                    <div className="space-y-2">
                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium flex items-center gap-1.5">
                          Desmatamento Irregular pós-2008
                        </span>
                        <input 
                          type="checkbox"
                          checked={formIllegalDeforestation}
                          onChange={(e) => setFormIllegalDeforestation(e.target.checked)}
                          className="rounded text-rose-500 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Processos de Erosão Ativos</span>
                        <input 
                          type="checkbox"
                          checked={formErosion}
                          onChange={(e) => setFormErosion(e.target.checked)}
                          className="rounded text-rose-500 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Potencial de Contaminação do Solo</span>
                        <input 
                          type="checkbox"
                          checked={formSoilContamination}
                          onChange={(e) => setFormSoilContamination(e.target.checked)}
                          className="rounded text-rose-500 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-600 font-medium">Contaminação de Corpos D'Água</span>
                        <input 
                          type="checkbox"
                          checked={formWaterContamination}
                          onChange={(e) => setFormWaterContamination(e.target.checked)}
                          className="rounded text-rose-500 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Detalhamento dos Passivos / Observações</label>
                      <textarea
                        rows={4}
                        value={formLiabilitiesDetails}
                        onChange={(e) => setFormLiabilitiesDetails(e.target.value)}
                        placeholder="Descrever foco de erosão, falta de revestimento de bacia de dejetos, ou locais sem curva de nível..."
                        className="w-full glass-input py-2"
                      />
                    </div>
                  </div>
                </div>

                {/* Seção 4: Crédito Carbono e PSA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">5. Potencial Carbono & PSA</h4>
                    <div className="space-y-3 p-4 bg-slate-50/15 rounded-2xl border border-emerald-500/10 text-xs">
                      <label className="flex items-center justify-between py-1.5 cursor-pointer">
                        <span className="text-slate-650 font-bold">Elegível Pagamento Serviços Ambientais (PSA)</span>
                        <input 
                          type="checkbox"
                          checked={formPsaEligible}
                          onChange={(e) => setFormPsaEligible(e.target.checked)}
                          className="rounded text-slate-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </label>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Área Potencial de Regeneração / Silvicultura (ha)</label>
                        <input 
                          type="number"
                          step="any"
                          value={formEligibleAreaHa || ''}
                          onChange={(e) => setFormEligibleAreaHa(parseFloat(e.target.value) || 0)}
                          className="w-full glass-input h-9 text-xs font-mono"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-display font-bold uppercase tracking-wider text-[10px] text-slate-400 border-b pb-1">6. Parecer Técnico Final</h4>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Diagnóstico / Conclusão de Auditoria</label>
                      <textarea
                        rows={3.5}
                        required
                        value={formTechnicalOpinion}
                        onChange={(e) => setFormTechnicalOpinion(e.target.value)}
                        placeholder="Indicar as principais recomendações, planos de mitigação e prazos para readequação ecológica da gleba analisada..."
                        className="w-full glass-input py-2"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Status Diagnóstico</span>
                    <label className="flex items-center gap-1 cursor-pointer font-semibold text-slate-600">
                      <input 
                        type="radio" 
                        name="status" 
                        value="draft" 
                        checked={formStatus === 'draft'} 
                        onChange={() => setFormStatus('draft')} 
                        className="text-emerald-600" 
                      />
                      <span>Rascunho</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer font-semibold text-slate-600">
                      <input 
                        type="radio" 
                        name="status" 
                        value="completed" 
                        checked={formStatus === 'completed'} 
                        onChange={() => setFormStatus('completed')} 
                        className="text-emerald-600" 
                      />
                      <span>Finalizar</span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setIsModalOpen(false); resetForm(); }}
                      className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md uppercase transition-all"
                    >
                      Salvar Cadastro
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Visualizer Detail View Modal (Full Read only) */}
      <AnimatePresence>
        {viewingRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2.5rem] w-full max-w-4xl p-6 md:p-8 space-y-6 max-h-[92vh] overflow-y-auto relative text-slate-700"
            >
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-lg font-display font-bold text-slate-800">
                    Dossiê Ecológico: {viewingRecord.clientName}
                  </h3>
                </div>
                <button onClick={() => setViewingRecord(null)} className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Dossiê Contents */}
              <div className="space-y-6 text-xs text-slate-600 leading-relaxed">
                
                {/* Score and opinion banner */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  {/* Gauge indicator */}
                  <div className="flex flex-col items-center justify-center text-center gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selo Ambiental</span>
                    <div className={cn("w-28 h-28 rounded-full flex flex-col items-center justify-center text-center shadow-lg border-4",
                      viewingRecord.score < 50 ? 'border-rose-400 bg-rose-50 text-rose-700' :
                      viewingRecord.score < 80 ? 'border-amber-400 bg-amber-50 text-amber-700' :
                      'border-emerald-400 bg-emerald-50 text-emerald-800'
                    )}>
                      <span className="text-2xl font-black">{viewingRecord.score}%</span>
                      <span className="text-[9px] uppercase font-bold tracking-tight">Adequação</span>
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                      <span>RESPONSÁVEL: {viewingRecord.technicianName}</span>
                      <span>{new Date(viewingRecord.visitDate).toLocaleDateString()}</span>
                    </div>
                    <p className="p-3 bg-white border border-slate-100 rounded-2xl italic text-slate-600">
                      "{viewingRecord.technicalOpinion}"
                    </p>
                  </div>
                </div>

                {/* Subdivisions of Land Cover chart */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Soil distribution map */}
                  <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs flex flex-col gap-3">
                    <h4 className="font-display font-extrabold text-slate-750 flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-400">
                      <BarChart className="w-3.5 h-3.5" /> Ocupação Territorial ({viewingRecord.totalAreaHa} ha)
                    </h4>
                    <div className="h-[180px] w-full mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Preservada', value: viewingRecord.landUse.preservedAreaPct, color: '#10b981' },
                              { name: 'Pastagem', value: viewingRecord.landUse.pastureAreaPct, color: '#f59e0b' },
                              { name: 'Lavoura', value: viewingRecord.landUse.cropAreaPct, color: '#3b82f6' },
                              { name: 'APP', value: viewingRecord.landUse.appAreaPct, color: '#6366f1' },
                              { name: 'Res. Legal', value: viewingRecord.landUse.legalReserveAreaPct, color: '#64748b' }
                            ]}
                            cx="50%"
                            cy="50%"
                            outerRadius={65}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {[
                              '#10b981', '#f59e0b', '#3b82f6', '#6366f1', '#64748b'
                            ].map((color, idx) => (
                              <Cell key={idx} fill={color} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 9, fontWeight: 700 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Grid showing parameters compliance */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 flex flex-col justify-between">
                      <span className="text-[9px] font-black uppercase text-slate-400">Conformidade Legal</span>
                      <div className="space-y-1.5 mt-2">
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Inscr. CAR</span>
                          <span className={cn("font-bold", viewingRecord.legalCompliance.carRegistered ? 'text-emerald-600' : 'text-rose-500')}>
                            {viewingRecord.legalCompliance.carRegistered ? '✓ REGULAR' : '✗ PENDENTE'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Averb. Res. Legal</span>
                          <span className={cn("font-bold", viewingRecord.legalCompliance.legalReserveRegistered ? 'text-emerald-600' : 'text-rose-500')}>
                            {viewingRecord.legalCompliance.legalReserveRegistered ? '✓ REGULAR' : '✗ PENDENTE'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Imposto ITR</span>
                          <span className={cn("font-bold", viewingRecord.legalCompliance.itrUpToDate ? 'text-emerald-600' : 'text-rose-500')}>
                            {viewingRecord.legalCompliance.itrUpToDate ? '✓ QUITADO' : '✗ PENDENTE'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span>CCIR Titular</span>
                          <span className={cn("font-bold", viewingRecord.legalCompliance.ccirUpToDate ? 'text-emerald-600' : 'text-rose-500')}>
                            {viewingRecord.legalCompliance.ccirUpToDate ? '✓ EM DIA' : '✗ PENDENTE'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 flex flex-col justify-between">
                      <span className="text-[9px] font-black uppercase text-slate-400">Segurança Hídrica</span>
                      <div className="space-y-1.5 mt-2">
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Nascentes</span>
                          <span className="font-bold text-slate-650">
                            {viewingRecord.waterResources.hasSpringWater ? `${viewingRecord.waterResources.springCount || 0} Ativas` : 'Sem foco'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Rios/Córregos</span>
                          <span className="font-bold text-slate-655">
                            {viewingRecord.waterResources.hasWaterBodies ? 'Sim' : 'Não'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span>Outorga Saneam.</span>
                          <span className={cn("font-bold", viewingRecord.waterResources.hasWaterGrant ? 'text-emerald-600' : 'text-rose-500')}>
                            {viewingRecord.waterResources.hasWaterGrant ? '✓ OUTORGADO' : '✗ FALTA OUTORGA'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Potentials for CO2 and Environmental payments */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-emerald-50/10 p-5 rounded-3xl border border-emerald-500/10">
                  <div className="space-y-2">
                    <h5 className="font-bold text-emerald-800 text-[11px] uppercase tracking-wider flex items-center gap-1">
                      <Award className="w-4 h-4 text-emerald-600 animate-spin" /> Eixo de PSA e Crédito Carbono
                    </h5>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span>Elegibilidade ao PSA</span>
                        <strong className={cn(viewingRecord.carbonPotential.psaEligible ? 'text-emerald-700' : 'text-slate-500')}>
                          {viewingRecord.carbonPotential.psaEligible ? 'Habilitado ✓' : 'Inelegível'}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Área Livre p/ Silvicultura Regenerativa</span>
                        <strong>{viewingRecord.carbonPotential.eligibleAreaHa || 0} hectares</strong>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Observações da Gleba de Carbono</span>
                    <p className="bg-white/50 p-2.5 rounded-2xl border border-slate-50 text-[10.5px]">
                      {viewingRecord.carbonPotential.notes || 'Nenhuma observação técnica registrada para crédito florestal.'}
                    </p>
                  </div>
                </div>

                {/* Sub-block listing liabilities and detailed contamination notes */}
                <div className="bg-rose-50/20 p-5 rounded-3xl border border-rose-500/15">
                  <h5 className="font-bold text-rose-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <ShieldAlert className="w-4 h-4 text-rose-600 animate-bounce" /> Status de Passivos Ambientais / Multas Potenciais
                  </h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-2 border-b border-rose-100">
                    <div className="flex items-center justify-between p-2.5 bg-white/70 rounded-xl">
                      <span>Desmate Ilegal</span>
                      <strong className={viewingRecord.environmentalLiabilities.illegalDeforestation ? 'text-rose-650 font-black' : 'text-emerald-600'}>
                        {viewingRecord.environmentalLiabilities.illegalDeforestation ? 'SIM' : 'NÃO'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between p-2.5 bg-white/70 rounded-xl">
                      <span>Erosões</span>
                      <strong className={viewingRecord.environmentalLiabilities.erosion ? 'text-rose-650 font-black' : 'text-emerald-600'}>
                        {viewingRecord.environmentalLiabilities.erosion ? 'SIM' : 'NÃO'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between p-2.5 bg-white/70 rounded-xl">
                      <span>Contam. Solo</span>
                      <strong className={viewingRecord.environmentalLiabilities.soilContamination ? 'text-rose-650 font-black' : 'text-emerald-600'}>
                        {viewingRecord.environmentalLiabilities.soilContamination ? 'SIM' : 'NÃO'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between p-2.5 bg-white/70 rounded-xl">
                      <span>Contam. Água</span>
                      <strong className={viewingRecord.environmentalLiabilities.waterContamination ? 'text-rose-650 font-black' : 'text-emerald-600'}>
                        {viewingRecord.environmentalLiabilities.waterContamination ? 'SIM' : 'NÃO'}
                      </strong>
                    </div>
                  </div>
                  {viewingRecord.environmentalLiabilities.details && (
                    <div className="space-y-1 mt-3">
                      <span className="text-[10px] font-bold text-rose-500 uppercase block">Histórico Detalhado de Risco</span>
                      <p className="bg-white/80 p-3 rounded-2xl text-[10.5px] italic text-rose-800">
                        {viewingRecord.environmentalLiabilities.details}
                      </p>
                    </div>
                  )}
                </div>

              </div>

              <div className="flex items-center justify-between pt-4 border-t gap-3">
                <button 
                  type="button"
                  onClick={() => handleExportPDF(viewingRecord)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm text-xs transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Exportar Laudo PDF
                </button>
                <button 
                  onClick={() => setViewingRecord(null)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs"
                >
                  Fechar Diagnóstico
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
