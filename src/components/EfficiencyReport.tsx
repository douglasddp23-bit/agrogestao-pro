import React, { useState, useMemo, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine } from 'recharts';
import {
  Sprout,
  TrendingUp,
  Activity,
  Printer,
  BarChart2,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Wheat,
  Plus,
  Edit3,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ServiceAnalysis, Client, Harvest } from '../types';
import PrintPreviewModal from './PrintPreviewModal';
import HarvestFormModal, { HarvestPrefill } from './HarvestFormModal';
import ConfirmationModal from './ConfirmationModal';
import { exportToExcel } from '../lib/exportExcel';
import { harvestForAnalysis, harvestYieldScHa, HARVEST_UNITS } from '../lib/harvest';
import { isManagementRole } from '../lib/permissions';
import { logAudit } from '../lib/audit';
import { formatDate } from '../lib/utils';
import { toast } from 'sonner';

// Relatório de Eficiência: atributo do solo (análise real) x PRODUTIVIDADE REAL
// (colheita lançada). Até 29/09/2026 a produtividade era estimada por fórmula a
// partir de V% e P; agora, sem colheita lançada, o relatório diz "não informada"
// e a amostra fica fora do gráfico e das médias — nada é estimado.

interface EfficiencyReportProps {
  analyses?: ServiceAnalysis[];
  clients?: Client[];
}

type Faixa = 'Abaixo da faixa' | 'Na faixa ideal' | 'Acima da faixa' | '—';

export interface EfficiencySamplePoint {
  id: string;
  analysis: ServiceAnalysis;
  clientName: string;
  propertyName: string;
  crop: string;
  v_percent: number;
  p_mg: number;
  k_cmol: number;
  mo_g: number;
  ph: number;
  harvest: Harvest | null;
  realYield: number | null; // sc/ha (60 kg) da colheita lançada
  recommendation: string;
}

const CROP_COLORS: Record<string, string> = {
  'Soja': '#10b981',
  'Milho': '#f59e0b',
  'Algodão': '#6366f1',
  'Café': '#8b5cf6',
  'Feijão': '#ec4899',
};

const METRIC_CONFIGS: Record<string, { label: string; unit: string; minIdeal: number; maxIdeal: number; xDomain: [number, number] }> = {
  v_percent: { label: 'Saturação por Bases (V%)', unit: '%', minIdeal: 60, maxIdeal: 70, xDomain: [30, 90] },
  p_mg: { label: 'Fósforo (P)', unit: 'mg/dm³', minIdeal: 15, maxIdeal: 30, xDomain: [0, 60] },
  k_cmol: { label: 'Potássio (K)', unit: 'cmolc/dm³', minIdeal: 0.25, maxIdeal: 0.50, xDomain: [0.05, 0.8] },
  mo_g: { label: 'Matéria Orgânica (M.O.)', unit: 'g/dm³', minIdeal: 25, maxIdeal: 40, xDomain: [10, 50] },
  ph: { label: 'pH (CaCl₂)', unit: '-', minIdeal: 5.5, maxIdeal: 6.5, xDomain: [4.0, 7.5] },
};

const fmt1 = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtR2 = (r: number | null) => r == null ? '—' : r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = (u: string) => HARVEST_UNITS.find(x => x.value === u)?.label.split(' (')[0].toLowerCase() || u;

export default function EfficiencyReport({ analyses = [], clients = [] }: EfficiencyReportProps) {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string;
  const isAdmin = role === 'admin';
  // Lança colheita quem acompanha a lavoura: Consultor, Gerente e Administrador.
  const canLaunch = ['consultant', 'staff', 'manager', 'admin'].includes(role);
  const canEditHarvest = (h: Harvest) => isManagementRole(role) || h.createdBy === user?.uid;

  const [selectedMetric, setSelectedMetric] = useState<string>('v_percent');
  const [selectedCrop, setSelectedCrop] = useState<string>('Todas');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [harvests, setHarvests] = useState<Harvest[]>([]);
  const [harvestModal, setHarvestModal] = useState<{ open: boolean; editing?: Harvest | null; prefill?: HarvestPrefill | null }>({ open: false });
  const [deleting, setDeleting] = useState<Harvest | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'harvests'), snap => {
      setHarvests(snap.docs.map(d => ({ id: d.id, ...d.data() } as Harvest)));
    }, err => console.warn('Colheitas indisponíveis:', err));
    return () => unsub();
  }, []);

  const currentConfig = METRIC_CONFIGS[selectedMetric] || METRIC_CONFIGS.v_percent;
  const metricOf = (s: EfficiencySamplePoint) => (s as any)[selectedMetric] as number;
  const faixaOf = (v: number): Faixa =>
    !Number.isFinite(v) ? '—' : v < currentConfig.minIdeal ? 'Abaixo da faixa' : v > currentConfig.maxIdeal ? 'Acima da faixa' : 'Na faixa ideal';

  // Análises de solo reais + a colheita real daquela área (se lançada).
  const dataset: EfficiencySamplePoint[] = useMemo(() => {
    const num = (...vals: any[]) => { for (const x of vals) { const n = parseFloat(String(x ?? '').replace(',', '.')); if (Number.isFinite(n)) return n; } return NaN; };
    return analyses
      .filter(a => a.type === 'soil' && a.results && Object.keys(a.results).length > 0)
      .map(a => {
        const res: any = a.results || {};
        const harvest = harvestForAnalysis(a, harvests);
        const cropRaw = String(harvest?.crop || res.crop || res.cultura || (a as any).crop || '').trim();
        return {
          id: a.id,
          analysis: a,
          clientName: a.clientName || '—',
          propertyName: a.propertyName || '—',
          crop: cropRaw || 'Não informada',
          v_percent: num(res.v_percent, res.v),
          p_mg: num(res.p),
          k_cmol: num(res.k),
          mo_g: num(res.mo),
          ph: num(res.ph),
          harvest,
          realYield: harvest ? harvestYieldScHa(harvest) : null,
          recommendation: a.description || '',
        };
      })
      .filter(s => [s.v_percent, s.p_mg, s.k_cmol, s.mo_g, s.ph].some(Number.isFinite));
  }, [analyses, harvests]);

  const filteredData = useMemo(() => dataset.filter(item => {
    const q = searchTerm.toLowerCase();
    const matchCrop = selectedCrop === 'Todas' || item.crop === selectedCrop;
    const matchSearch = !q || item.clientName.toLowerCase().includes(q) || item.propertyName.toLowerCase().includes(q) || item.recommendation.toLowerCase().includes(q);
    return matchCrop && matchSearch;
  }), [dataset, selectedCrop, searchTerm]);

  // Só entra no gráfico quem tem o atributo E a colheita real.
  const scatterData = useMemo(() => filteredData
    .filter(item => Number.isFinite(metricOf(item)) && item.realYield != null)
    .map(item => ({ ...item, x: metricOf(item), y: item.realYield as number })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filteredData, selectedMetric]);

  const stats = useMemo(() => {
    const withMetric = filteredData.filter(i => Number.isFinite(metricOf(i)));
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const n = scatterData.length;
    let r2: number | null = null;
    if (n >= 3) {
      const xs = scatterData.map(p => p.x), ys = scatterData.map(p => p.y);
      const mx = mean(xs), my = mean(ys);
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      r2 = sxx > 0 && syy > 0 ? Math.round(((sxy * sxy) / (sxx * syy)) * 100) / 100 : null;
    }
    return {
      totalSamples: filteredData.length,
      withHarvest: filteredData.filter(i => i.realYield != null).length,
      avgMetric: withMetric.length ? fmt1(mean(withMetric.map(metricOf))) : '—',
      avgYield: n ? Math.round(mean(scatterData.map(p => p.y)) * 10) / 10 : null,
      pointsInChart: n,
      r2,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, scatterData, selectedMetric]);

  const cropsInData = useMemo(() => ['Todas', ...Array.from(new Set(dataset.map(d => d.crop)))], [dataset]);

  const conclusion = (() => {
    if (stats.totalSamples === 0) return 'Ainda não há análises de solo com resultados para montar o relatório.';
    if (stats.withHarvest === 0) return `Há ${stats.totalSamples} análise(s) de solo, mas nenhuma colheita foi lançada para essas áreas. Lance a colheita real para comparar solo e produtividade.`;
    if (stats.pointsInChart < 3) return `Há ${stats.pointsInChart} área(s) com ${currentConfig.label} e colheita informadas — são necessárias pelo menos 3 para indicar tendência. ${stats.totalSamples - stats.withHarvest} área(s) aguardam o lançamento da colheita.`;
    const below = scatterData.filter(p => p.x < currentConfig.minIdeal);
    const inRange = scatterData.filter(p => p.x >= currentConfig.minIdeal && p.x <= currentConfig.maxIdeal);
    const avg = (arr: typeof scatterData) => arr.length ? `${fmt1(arr.reduce((s, p) => s + p.y, 0) / arr.length)} sc/ha` : '—';
    const forca = (stats.r2 ?? 0) >= 0.6 ? 'forte' : (stats.r2 ?? 0) >= 0.3 ? 'moderada' : 'fraca';
    return `Em ${stats.pointsInChart} áreas com colheita real, a relação entre ${currentConfig.label} e a produtividade é ${forca} (R² = ${fmtR2(stats.r2)}). Produtividade média real: na faixa ideal (${currentConfig.minIdeal}–${currentConfig.maxIdeal} ${currentConfig.unit}) ${avg(inRange)}; abaixo da faixa ${avg(below)}. ${stats.totalSamples - stats.withHarvest} área(s) ainda sem colheita lançada não entram na conta.`;
  })();

  const handleExportExcel = () => {
    if (filteredData.length === 0) { toast.error('Nenhum dado disponível para exportar.'); return; }
    exportToExcel(filteredData.map(d => ({
      Cliente: d.clientName,
      Propriedade: d.propertyName,
      Talhão: d.harvest?.plot || '',
      Cultura: d.crop,
      'Saturação de Bases (V%)': Number.isFinite(d.v_percent) ? d.v_percent : '',
      'Fósforo (P mg/dm³)': Number.isFinite(d.p_mg) ? d.p_mg : '',
      'Potássio (K cmolc/dm³)': Number.isFinite(d.k_cmol) ? d.k_cmol : '',
      'M.O. (g/dm³)': Number.isFinite(d.mo_g) ? d.mo_g : '',
      'pH CaCl2': Number.isFinite(d.ph) ? d.ph : '',
      'Colheita (data)': d.harvest ? formatDate(d.harvest.harvestDate) : 'Não informada',
      'Safra': d.harvest?.season || '',
      'Quantidade colhida': d.harvest ? `${d.harvest.quantity} ${unitLabel(d.harvest.unit)}` : '',
      'Área colhida (ha)': d.harvest?.areaHa ?? '',
      'Produtividade real (sc/ha)': d.realYield ?? 'Não informada',
    })), `Relatorio_Eficiencia_${selectedMetric}`, 'Eficiência Agronômica');
    toast.success('Relatório de eficiência exportado em Excel!');
  };

  const handleDeleteHarvest = async () => {
    if (!deleting || !isAdmin) return;
    try {
      await deleteDoc(doc(db, 'harvests', deleting.id));
      logAudit({ userId: user?.uid || '', userName: user?.displayName || user?.email || 'Usuário', action: 'deleted', collection: 'harvests', recordId: deleting.id, recordName: `${deleting.crop} · ${deleting.propertyName}`, details: 'Colheita excluída.' });
      toast.success('Colheita excluída.');
    } catch (e: any) {
      toast.error('Não foi possível excluir.', { description: e?.message });
    } finally {
      setDeleting(null);
    }
  };

  const openLaunch = (s?: EfficiencySamplePoint) => setHarvestModal({
    open: true, editing: null,
    prefill: s ? { clientId: s.analysis.clientId, propertyName: s.analysis.propertyName, analysisId: s.analysis.id, crop: s.crop } : null,
  });

  const CustomScatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as EfficiencySamplePoint & { x: number; y: number };
    return (
      <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-xl max-w-xs text-xs space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 gap-2">
          <span className="font-bold text-emerald-400">{d.propertyName}{d.harvest?.plot ? ` / ${d.harvest.plot}` : ''}</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-900" style={{ backgroundColor: CROP_COLORS[d.crop] || '#cbd5e1' }}>{d.crop}</span>
        </div>
        <p className="text-slate-300 font-semibold">{d.clientName}</p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-slate-800/80 p-1.5 rounded"><span className="text-slate-400 block text-[9px] uppercase">{currentConfig.label}</span><span className="font-mono font-bold text-sm">{d.x} {currentConfig.unit}</span></div>
          <div className="bg-slate-800/80 p-1.5 rounded"><span className="text-slate-400 block text-[9px] uppercase">Colheita real</span><span className="font-mono font-bold text-emerald-400 text-sm">{fmt1(d.y)} sc/ha</span></div>
        </div>
        {d.harvest && <p className="text-[10px] text-slate-400">Colhido em {formatDate(d.harvest.harvestDate)} · safra {d.harvest.season}</p>}
      </div>
    );
  };

  const kpi = (title: string, value: React.ReactNode, icon: React.ReactNode, hint?: string) => (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
      <div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{title}</span>
        <p className="text-2xl font-extrabold text-slate-900 mt-1">{value}</p>
        {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
      </div>
      <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">{icon}</div>
    </div>
  );

  const HarvestCell = ({ s }: { s: EfficiencySamplePoint }) => s.harvest && s.realYield != null ? (
    <div>
      <span className="font-mono font-bold text-emerald-700">{fmt1(s.realYield)} sc/ha</span>
      <span className="block text-[10px] text-slate-500">{formatDate(s.harvest.harvestDate)} · safra {s.harvest.season}</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Colheita não informada</span>
      {canLaunch && <button onClick={() => openLaunch(s)} className="text-[10px] font-bold text-emerald-700 hover:underline">Lançar</button>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100"><TrendingUp className="w-6 h-6" /></div>
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">Relatório de Eficiência Agronômica</h2>
            <p className="text-xs text-slate-500 mt-0.5">Atributo do solo (análise real) x <strong>produtividade real da colheita lançada</strong>. Área sem colheita lançada aparece como "não informada" e não entra no gráfico nem nas médias.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          {canLaunch && (
            <button onClick={() => openLaunch()} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm">
              <Wheat className="w-4 h-4" /> Lançar colheita
            </button>
          )}
          <button onClick={() => setIsPrintModalOpen(true)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm">
            <Printer className="w-4 h-4 text-emerald-400" /> Imprimir A4
          </button>
          <button onClick={handleExportExcel} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm">
            <FileSpreadsheet className="w-4 h-4" /> Exportar Planilha
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Atributo do Solo (Eixo X)</label>
          <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none">
            {Object.entries(METRIC_CONFIGS).map(([k, cfg]) => <option key={k} value={k}>{cfg.label}</option>)}
          </select>
        </div>
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Filtrar Cultura</label>
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
            {cropsInData.map(crop => (
              <button key={crop} onClick={() => setSelectedCrop(crop)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${selectedCrop === crop ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{crop}</button>
            ))}
          </div>
        </div>
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Buscar Produtor / Propriedade</label>
          <input type="text" placeholder="Digite o nome da fazenda..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none" />
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpi('Análises de Solo', `${stats.totalSamples} áreas`, <Layers className="w-5 h-5" />)}
        {kpi('Com Colheita Lançada', `${stats.withHarvest} de ${stats.totalSamples}`, <Wheat className="w-5 h-5" />, stats.totalSamples - stats.withHarvest > 0 ? `${stats.totalSamples - stats.withHarvest} aguardando lançamento` : undefined)}
        {kpi(`${currentConfig.label.split('(')[0]} Média`, <>{stats.avgMetric} <span className="text-xs font-normal text-slate-500">{currentConfig.unit}</span></>, <Activity className="w-5 h-5" />)}
        {kpi('Produtividade Real Média', stats.avgYield != null ? <>{fmt1(stats.avgYield)} <span className="text-xs font-normal text-slate-500">sc/ha</span></> : <span className="text-base text-amber-600">Não informada</span>, <Sprout className="w-5 h-5" />, stats.avgYield != null ? `${stats.pointsInChart} área(s) com colheita` : 'Nenhuma colheita lançada')}
      </div>

      {/* Gráfico */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><BarChart2 className="w-4 h-4 text-emerald-600" /> Dispersão: {currentConfig.label} x Produtividade Real (sc/ha)</h3>
          <p className="text-xs text-slate-500">Cada ponto é uma área com análise de solo <strong>e</strong> colheita lançada.</p>
        </div>
        {scatterData.length === 0 ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2 text-slate-500">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-semibold text-slate-700">Produtividade ainda não informada</p>
            <p className="text-xs max-w-md">Nenhuma área com {currentConfig.label} tem colheita lançada. O gráfico aparece quando a colheita real for registrada — o sistema não estima produtividade.</p>
            {canLaunch && <button onClick={() => openLaunch()} className="mt-1 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Lançar colheita</button>}
          </div>
        ) : (
          <div className="h-[380px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" dataKey="x" name={currentConfig.label} unit={currentConfig.unit} domain={currentConfig.xDomain} tick={{ fontSize: 11, fill: '#64748b' }} label={{ value: `${currentConfig.label} (${currentConfig.unit})`, position: 'insideBottom', offset: -10, fontSize: 11, fill: '#475569' }} />
                <YAxis type="number" dataKey="y" name="Produtividade" unit=" sc/ha" tick={{ fontSize: 11, fill: '#64748b' }} width={70} label={{ value: 'Produtividade Real (sc/ha)', angle: -90, position: 'left', offset: 10, fontSize: 11, fill: '#475569', style: { textAnchor: 'middle' } }} />
                <Tooltip content={<CustomScatterTooltip />} />
                <ReferenceLine x={currentConfig.minIdeal} stroke="#10b981" strokeDasharray="3 3" label={{ value: `Mínimo ideal (${currentConfig.minIdeal})`, position: 'top', fill: '#059669', fontSize: 10 }} />
                <ReferenceLine x={currentConfig.maxIdeal} stroke="#059669" strokeDasharray="3 3" label={{ value: `Ideal superior (${currentConfig.maxIdeal})`, position: 'top', fill: '#047857', fontSize: 10 }} />
                {stats.avgYield != null && <ReferenceLine y={stats.avgYield} stroke="#cbd5e1" strokeDasharray="5 5" label={{ value: 'Média real', fill: '#94a3b8', fontSize: 10 }} />}
                <Scatter name="Áreas" data={scatterData}>
                  {scatterData.map((e, i) => <Cell key={i} fill={CROP_COLORS[e.crop] || '#10b981'} stroke="#ffffff" strokeWidth={2} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-600" /> Diagnóstico com dados reais</span>
            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">R² = {fmtR2(stats.r2)}</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{conclusion}</p>
        </div>
      </div>

      {/* Tabela: análise x colheita */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Análises de Solo x Colheita Real</h3>
            <p className="text-xs text-slate-500">Uma linha por análise de solo; a colheita vem do lançamento vinculado àquela área.</p>
          </div>
          <span className="text-xs text-slate-500 font-mono">Total: {filteredData.length}</span>
        </div>
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-xl">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3">Produtor / Propriedade</th>
                <th className="p-3">Cultura</th>
                <th className="p-3 font-mono">{currentConfig.label}</th>
                <th className="p-3">Situação do atributo</th>
                <th className="p-3">Produtividade real</th>
                <th className="p-3">Recomendação técnica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {filteredData.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-slate-400 italic">Nenhuma análise de solo com resultados para os filtros selecionados.</td></tr>
              ) : filteredData.map(s => {
                const v = metricOf(s);
                const faixa = faixaOf(v);
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-3"><span className="font-bold text-slate-900 block">{s.propertyName}{s.harvest?.plot ? ` / ${s.harvest.plot}` : ''}</span><span className="text-[10px] text-slate-500">{s.clientName}</span></td>
                    <td className="p-3"><span className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-900" style={{ backgroundColor: CROP_COLORS[s.crop] || '#e2e8f0' }}>{s.crop}</span></td>
                    <td className="p-3 font-mono font-bold">{Number.isFinite(v) ? `${v} ${currentConfig.unit}` : '—'}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${faixa === 'Na faixa ideal' ? 'bg-emerald-100 text-emerald-800' : faixa === '—' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-800'}`}>{faixa}</span></td>
                    <td className="p-3"><HarvestCell s={s} /></td>
                    <td className="p-3 text-slate-600 max-w-xs truncate" title={s.recommendation}>{s.recommendation || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Colheitas lançadas */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4" data-harvest-list>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Wheat className="w-4 h-4 text-amber-600" /> Colheitas lançadas</h3>
            <p className="text-xs text-slate-500">Registro da colheita real por talhão/área.</p>
          </div>
          <span className="text-xs text-slate-500 font-mono">{harvests.length} lançamento(s)</span>
        </div>
        {harvests.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Nenhuma colheita lançada ainda.</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <th className="p-3">Data</th><th className="p-3">Cliente / Área</th><th className="p-3">Cultura · Safra</th>
                  <th className="p-3">Colhido</th><th className="p-3">Área</th><th className="p-3">sc/ha</th><th className="p-3">Lançado por</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {[...harvests].sort((a, b) => b.harvestDate.localeCompare(a.harvestDate)).map(h => {
                  const y = harvestYieldScHa(h);
                  return (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono">{formatDate(h.harvestDate)}</td>
                      <td className="p-3"><span className="font-bold block">{h.clientName}</span><span className="text-[10px] text-slate-500">{h.propertyName}{h.plot ? ` / ${h.plot}` : ''}</span></td>
                      <td className="p-3">{h.crop} · {h.season}</td>
                      <td className="p-3 font-mono">{Number(h.quantity).toLocaleString('pt-BR')} {unitLabel(h.unit)}</td>
                      <td className="p-3 font-mono">{Number(h.areaHa).toLocaleString('pt-BR')} ha</td>
                      <td className="p-3 font-mono font-bold text-emerald-700">{y != null ? fmt1(y) : '—'}</td>
                      <td className="p-3 text-slate-500">{h.createdByName || '—'}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1 justify-end">
                          {canEditHarvest(h) && <button title="Editar colheita" onClick={() => setHarvestModal({ open: true, editing: h })} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><Edit3 className="w-3.5 h-3.5" /></button>}
                          {isAdmin && <button title="Excluir colheita" onClick={() => setDeleting(h)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HarvestFormModal
        isOpen={harvestModal.open}
        onClose={() => setHarvestModal({ open: false })}
        clients={clients}
        analyses={analyses}
        editing={harvestModal.editing}
        prefill={harvestModal.prefill}
      />
      <ConfirmationModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDeleteHarvest}
        title="Excluir colheita"
        description="O lançamento será removido e a área volta a aparecer como 'colheita não informada' no relatório."
        confirmLabel="Excluir"
        variant="danger"
      />

      {/* Impressão A4 */}
      <PrintPreviewModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Relatório Técnico de Eficiência Agronômica"
        subtitle={`Atributo do solo: ${currentConfig.label} | Cultura: ${selectedCrop} | Produtividade: colheita real lançada`}
        category="Relatório de Inteligência Nutricional"
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">1. Resumo</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200"><span className="text-[10px] text-slate-500 font-bold uppercase">Análises de solo</span><p className="text-lg font-extrabold text-slate-900">{stats.totalSamples}</p></div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200"><span className="text-[10px] text-slate-500 font-bold uppercase">Com colheita</span><p className="text-lg font-extrabold text-slate-900">{stats.withHarvest} de {stats.totalSamples}</p></div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200"><span className="text-[10px] text-slate-500 font-bold uppercase">{currentConfig.label.split('(')[0]} média</span><p className="text-lg font-extrabold text-emerald-800">{stats.avgMetric} {currentConfig.unit}</p></div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200"><span className="text-[10px] text-slate-500 font-bold uppercase">Produtividade real média</span><p className="text-lg font-extrabold text-slate-900">{stats.avgYield != null ? `${fmt1(stats.avgYield)} sc/ha` : 'Não informada'}</p></div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">2. Análises de solo e colheita real</h3>
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-100 font-bold text-slate-700">
                  <th className="p-2 border border-slate-200">Propriedade / Produtor</th>
                  <th className="p-2 border border-slate-200">Cultura</th>
                  <th className="p-2 border border-slate-200">{currentConfig.label}</th>
                  <th className="p-2 border border-slate-200">Situação</th>
                  <th className="p-2 border border-slate-200">Produtividade real</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(s => {
                  const v = metricOf(s);
                  return (
                    <tr key={s.id}>
                      <td className="p-2 font-bold text-slate-800 border border-slate-200">{s.propertyName} ({s.clientName})</td>
                      <td className="p-2 border border-slate-200">{s.crop}</td>
                      <td className="p-2 font-mono border border-slate-200">{Number.isFinite(v) ? `${v} ${currentConfig.unit}` : '—'}</td>
                      <td className="p-2 border border-slate-200">{faixaOf(v)}</td>
                      <td className="p-2 font-mono border border-slate-200">{s.realYield != null ? `${fmt1(s.realYield)} sc/ha (${formatDate(s.harvest!.harvestDate)})` : 'Colheita não informada'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs space-y-1">
            <h4 className="font-bold text-slate-800">Conclusão (somente com dados reais):</h4>
            <p className="text-slate-600">{conclusion}</p>
          </div>
        </div>
      </PrintPreviewModal>
    </div>
  );
}
