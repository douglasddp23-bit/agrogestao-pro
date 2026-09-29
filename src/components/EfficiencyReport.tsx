import React, { useState, useMemo } from 'react';
import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  ZAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  Cell,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { 
  Sprout, 
  TrendingUp, 
  Activity, 
  Filter, 
  Download, 
  Info, 
  Award, 
  Zap, 
  Printer, 
  CheckCircle2, 
  AlertTriangle,
  HelpCircle,
  BarChart2,
  FileSpreadsheet,
  Layers,
  Sparkles
} from 'lucide-react';
import { ServiceAnalysis, Client } from '../types';
import PrintPreviewModal from './PrintPreviewModal';
import { exportToExcel } from '../lib/exportExcel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

interface EfficiencyReportProps {
  analyses?: ServiceAnalysis[];
  clients?: Client[];
}

export interface EfficiencySamplePoint {
  id: string;
  clientName: string;
  propertyName: string;
  crop: 'Soja' | 'Milho' | 'Algodão' | 'Café' | 'Feijão';
  v_percent: number;   // Saturação por Bases (%)
  p_mg: number;        // Fósforo (mg/dm³)
  k_cmol: number;      // Potássio (cmolc/dm³)
  mo_g: number;        // Matéria Orgânica (g/dm³)
  ph: number;          // pH CaCl2
  expectedYield: number; // sc/ha
  potentialYield: number; // sc/ha
  efficiencyIndex: number; // %
  status: 'Otimizado' | 'Adequado' | 'Limitado' | 'Deficiente';
  recommendation: string;
}

const CROP_COLORS: Record<string, string> = {
  'Soja': '#10b981',    // Emerald
  'Milho': '#f59e0b',   // Amber
  'Algodão': '#6366f1', // Indigo
  'Café': '#8b5cf6',    // Purple
  'Feijão': '#ec4899',   // Pink
};

const METRIC_CONFIGS: Record<string, { label: string; unit: string; minIdeal: number; maxIdeal: number; step: number; xDomain: [number, number] }> = {
  v_percent: { label: 'Saturação por Bases (V%)', unit: '%', minIdeal: 60, maxIdeal: 70, step: 5, xDomain: [30, 90] },
  p_mg: { label: 'Fósforo (P)', unit: 'mg/dm³', minIdeal: 15, maxIdeal: 30, step: 5, xDomain: [0, 60] },
  k_cmol: { label: 'Potássio (K)', unit: 'cmolc/dm³', minIdeal: 0.25, maxIdeal: 0.50, step: 0.05, xDomain: [0.05, 0.8] },
  mo_g: { label: 'Matéria Orgânica (M.O.)', unit: 'g/dm³', minIdeal: 25, maxIdeal: 40, step: 5, xDomain: [10, 50] },
  ph: { label: 'pH (CaCl₂)', unit: '-', minIdeal: 5.5, maxIdeal: 6.5, step: 0.2, xDomain: [4.0, 7.5] },
};

// Antes havia aqui 12 fazendas fictícias exibidas quando o banco tinha poucas análises.

export default function EfficiencyReport({ analyses = [], clients = [] }: EfficiencyReportProps) {
  const [selectedMetric, setSelectedMetric] = useState<string>('v_percent');
  const [selectedCrop, setSelectedCrop] = useState<string>('Todas');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Extract real soil analysis results from Firestore or fallback to SEED dataset
  const dataset: EfficiencySamplePoint[] = useMemo(() => {
    const soilAnalyses = analyses.filter(a => a.type === 'soil' && a.results && Object.keys(a.results).length > 0);
    
    if (soilAnalyses.length === 0) return [];

    const parsedFromDB: EfficiencySamplePoint[] = soilAnalyses.map((a, idx) => {
      const res = a.results || {};
      const num = (...vals: any[]) => { for (const x of vals) { const n = parseFloat(String(x ?? '').replace(',', '.')); if (Number.isFinite(n)) return n; } return NaN; };
      const v = num(res.v_percent, res.v);
      const p = num(res.p);
      const k = num(res.k);
      const mo = num(res.mo);
      const ph = num(res.ph);
      
      // Determine crop type and expected yield from analysis or client properties
      const cropRaw = String(res.crop || res.cultura || (a as any).crop || '').trim();
      const known = ['Soja', 'Milho', 'Algodão', 'Café', 'Feijão'];
      const crop = (known.find(c => c.toLowerCase() === cropRaw.toLowerCase()) || (cropRaw ? cropRaw : 'Não informada')) as any;

      let expectedYield = 70;
      let potentialYield = 90;

      if (crop === 'Soja') {
        expectedYield = Math.round(45 + (v * 0.55) + (p * 0.4));
        potentialYield = 92;
      } else if (crop === 'Milho') {
        expectedYield = Math.round(80 + (v * 0.8) + (p * 0.6));
        potentialYield = 150;
      } else if (crop === 'Algodão') {
        expectedYield = Math.round(200 + (v * 1.5) + (p * 1.2));
        potentialYield = 330;
      } else if (crop === 'Café') {
        expectedYield = Math.round(30 + (v * 0.3) + (p * 0.2));
        potentialYield = 60;
      } else {
        expectedYield = Math.round(25 + (v * 0.25) + (p * 0.3));
        potentialYield = 50;
      }

      const efficiencyIndex = Math.min(99, Math.round((expectedYield / potentialYield) * 1000) / 10);
      let status: 'Otimizado' | 'Adequado' | 'Limitado' | 'Deficiente' = 'Adequado';
      if (efficiencyIndex >= 92) status = 'Otimizado';
      else if (efficiencyIndex >= 82) status = 'Adequado';
      else if (efficiencyIndex >= 72) status = 'Limitado';
      else status = 'Deficiente';

      return {
        id: a.id || `DB-${idx}`,
        clientName: a.clientName || '—',
        propertyName: a.propertyName || '—',
        crop,
        v_percent: Math.round(v * 10) / 10,
        p_mg: Math.round(p * 10) / 10,
        k_cmol: Math.round(k * 100) / 100,
        mo_g: Math.round(mo * 10) / 10,
        ph: Math.round(ph * 10) / 10,
        expectedYield,
        potentialYield,
        efficiencyIndex,
        status,
        recommendation: a.description || `Manejo nutricional baseado em saturação por bases de ${v}%.`
      };
    });

    // Só entram amostras com V% e P informados (base da estimativa)
    return parsedFromDB.filter(s => Number.isFinite(s.v_percent) && Number.isFinite(s.p_mg));
  }, [analyses]);

  // Filter dataset based on selected crop and search query
  const filteredData = useMemo(() => {
    return dataset.filter(item => {
      const matchCrop = selectedCrop === 'Todas' || item.crop === selectedCrop;
      const matchSearch = !searchTerm || 
        (item.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (item.propertyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.recommendation || '').toLowerCase().includes(searchTerm.toLowerCase());
      return matchCrop && matchSearch;
    });
  }, [dataset, selectedCrop, searchTerm]);

  // Scatter chart data prepared for Recharts
  const scatterData = useMemo(() => {
    return filteredData.filter(item => Number.isFinite((item as any)[selectedMetric])).map(item => {
      let xVal = item.v_percent;
      if (selectedMetric === 'p_mg') xVal = item.p_mg;
      else if (selectedMetric === 'k_cmol') xVal = item.k_cmol;
      else if (selectedMetric === 'mo_g') xVal = item.mo_g;
      else if (selectedMetric === 'ph') xVal = item.ph;

      return {
        ...item,
        x: xVal,
        y: item.expectedYield,
        z: item.efficiencyIndex
      };
    });
  }, [filteredData, selectedMetric]);

  // Calculate Agronomic Statistics (KPIs)
  const stats = useMemo(() => {
    // Só amostras com o elemento escolhido informado (nada é preenchido por estimativa)
    const pts = filteredData.filter(item => Number.isFinite((item as any)[selectedMetric]));
    if (pts.length === 0) {
      return { totalSamples: 0, avgMetric: 0, avgYield: 0, avgEfficiency: 0, r2Correlation: 0 };
    }
    const xs = pts.map(item => (item as any)[selectedMetric] as number);
    const ys = pts.map(item => item.expectedYield);
    const n = pts.length;
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const mx = mean(xs), my = mean(ys);
    const avgMetric = mx.toFixed(1);
    const avgYield = Math.round(my);
    const avgEfficiency = mean(pts.map(item => item.efficiencyIndex)).toFixed(1);
    // R² real (Pearson ao quadrado) entre o elemento do solo e a produtividade estimada.
    // Antes era um número fixo (0,86 ou 0,74) escolhido pela média de eficiência.
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const r2Correlation = n >= 3 && sxx > 0 && syy > 0 ? Math.round(((sxy * sxy) / (sxx * syy)) * 100) / 100 : 0;
    return { totalSamples: n, avgMetric, avgYield, avgEfficiency, r2Correlation };
  }, [filteredData, selectedMetric]);

  const currentConfig = METRIC_CONFIGS[selectedMetric] || METRIC_CONFIGS.v_percent;

  // Handle Export to Excel
  const handleExportExcel = () => {
    if (filteredData.length === 0) {
      toast.error('Nenhum dado disponível para exportar.');
      return;
    }
    const exportRows = filteredData.map(d => ({
      Cliente: d.clientName,
      Propriedade: d.propertyName,
      Cultura: d.crop,
      'Saturação de Bases (V%)': d.v_percent,
      'Fósforo (P mg/dm³)': d.p_mg,
      'Potássio (K cmolc/dm³)': d.k_cmol,
      'M.O. (g/dm³)': d.mo_g,
      'pH CaCl2': d.ph,
      'Produtividade Esperada (sc/ha)': d.expectedYield,
      'Produtividade Potencial (sc/ha)': d.potentialYield,
      'Índice de Eficiência (%)': `${d.efficiencyIndex}%`,
      Status: d.status,
      Recomendação: d.recommendation
    }));

    exportToExcel(exportRows, `Relatorio_Eficiencia_Nutricional_${selectedMetric}`, 'Eficiência Agronômica');
    toast.success('Relatório de eficiência exportado em Excel!');
  };

  // Custom Tooltip Renderer for ScatterChart
  const CustomScatterTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: EfficiencySamplePoint & { x: number; y: number } = payload[0].payload;
      return (
        <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-xl max-w-xs text-xs space-y-2 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-bold text-emerald-400">{data.propertyName}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-900" style={{ backgroundColor: CROP_COLORS[data.crop] || '#10b981' }}>
              {data.crop}
            </span>
          </div>
          <p className="text-slate-300 font-semibold">{data.clientName}</p>
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700/50">
              <span className="text-slate-400 block text-[9px] uppercase">{currentConfig.label}</span>
              <span className="font-mono font-bold text-white text-sm">{data.x} {currentConfig.unit}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded border border-slate-700/50">
              <span className="text-slate-400 block text-[9px] uppercase">Produtividade</span>
              <span className="font-mono font-bold text-emerald-400 text-sm">{data.y} sc/ha</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800">
            <span className="text-slate-400">Eficiência Nutricional:</span>
            <span className="font-bold text-emerald-300">{data.efficiencyIndex}% ({data.status})</span>
          </div>
          <p className="text-[10px] text-slate-400 italic pt-0.5">{data.recommendation}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      
      {/* Module Title Header Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100 shadow-xs">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-display font-bold text-slate-900">Relatório de Eficiência Agronômica</h2>
              <span className="px-2.5 py-0.5 text-[10px] uppercase font-mono font-extrabold bg-emerald-100 text-emerald-800 rounded-full">
                Gráfico de Dispersão
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Produtividade <strong>estimada por modelo</strong> a partir de V% e P das análises de solo reais (não é colheita medida). Amostras sem esses resultados não entram.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            title="Pré-visualizar e imprimir relatório A4"
          >
            <Printer className="w-4 h-4 text-emerald-400" /> Imprimir A4
          </button>
          <button
            onClick={handleExportExcel}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            title="Exportar dados para Excel"
          >
            <FileSpreadsheet className="w-4 h-4" /> Exportar Planilha
          </button>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
        
        {/* Metric Selector */}
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Atributo do Solo (Eixo X)
          </label>
          <select
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
          >
            {Object.entries(METRIC_CONFIGS).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>

        {/* Crop Filter */}
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Filtrar Cultura Agrícola
          </label>
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
            {['Todas', 'Soja', 'Milho', 'Algodão', 'Café', 'Feijão'].map((crop) => (
              <button
                key={crop}
                onClick={() => setSelectedCrop(crop)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  selectedCrop === crop
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {crop}
              </button>
            ))}
          </div>
        </div>

        {/* Search Filter */}
        <div className="lg:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Buscar Produtor / Propriedade
          </label>
          <input
            type="text"
            placeholder="Digite o nome da fazenda..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
          />
        </div>
      </div>

      {/* Key Agronomic Performance Indicators (KPIs) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amostras Analisadas</span>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{stats.totalSamples} áreas</p>
          </div>
          <div className="p-2.5 bg-slate-100 text-slate-700 rounded-xl">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{currentConfig.label.split('(')[0]} Média</span>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{stats.avgMetric} <span className="text-xs font-normal text-slate-500">{currentConfig.unit}</span></p>
          </div>
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Produtividade Esperada Média</span>
            <p className="text-2xl font-extrabold text-emerald-700 mt-1">{stats.avgYield} <span className="text-xs font-normal text-slate-500">sc/ha</span></p>
          </div>
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-100">
            <Sprout className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Índice de Eficiência Médio</span>
            <p className="text-2xl font-extrabold text-emerald-800 mt-1">{stats.avgEfficiency}%</p>
          </div>
          <div className="p-2.5 bg-emerald-500 text-slate-950 rounded-xl shadow-xs">
            <Award className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Scatter Chart Interactive Panel */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-600" />
              Dispersão: {currentConfig.label} x Produtividade Esperada (sc/ha)
            </h3>
            <p className="text-xs text-slate-500">
              Cada ponto representa uma amostra de solo analisada. Passe o mouse sobre os pontos para detalhes agronômicos.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              <span className="text-slate-600 font-medium">Soja</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
              <span className="text-slate-600 font-medium">Milho</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              <span className="text-slate-600 font-medium">Algodão</span>
            </div>
          </div>
        </div>

        {/* Recharts Scatter Plot */}
        <div className="h-[380px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis 
                type="number" 
                dataKey="x" 
                name={currentConfig.label} 
                unit={currentConfig.unit} 
                domain={currentConfig.xDomain}
                tick={{ fontSize: 11, fill: '#64748b' }}
                label={{ value: `${currentConfig.label} (${currentConfig.unit})`, position: 'insideBottom', offset: -10, fontSize: 11, fill: '#475569' }}
              />
              <YAxis 
                type="number" 
                dataKey="y" 
                name="Produtividade" 
                unit=" sc/ha" 
                tick={{ fontSize: 11, fill: '#64748b' }}
                label={{ value: 'Produtividade Esperada (sc/ha)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#475569' }}
              />
              <ZAxis type="number" dataKey="z" range={[60, 240]} name="Eficiência" />
              <Tooltip content={<CustomScatterTooltip />} />
              
              {/* Agronomic Ideal Threshold Lines */}
              <ReferenceLine 
                x={currentConfig.minIdeal} 
                stroke="#10b981" 
                strokeDasharray="3 3" 
                label={{ value: `Mínimo Ideal (${currentConfig.minIdeal})`, position: 'top', fill: '#059669', fontSize: 10, fontWeight: 'bold' }} 
              />
              <ReferenceLine 
                x={currentConfig.maxIdeal} 
                stroke="#059669" 
                strokeDasharray="3 3" 
                label={{ value: `Ideal Superior (${currentConfig.maxIdeal})`, position: 'top', fill: '#047857', fontSize: 10, fontWeight: 'bold' }} 
              />
              
              <ReferenceLine y={stats.avgYield} stroke="#cbd5e1" strokeDasharray="5 5" label={{ value: 'Média Esperada', fill: '#94a3b8', fontSize: 10 }} />

              <Scatter name="Amostras de Solo" data={scatterData}>
                {scatterData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={CROP_COLORS[entry.crop] || '#10b981'} 
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Automatic Trend & Agronomic Insights Box */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              Diagnóstico de Tendências Nutricionais Identificadas
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
              Correlação R² = {stats.r2Correlation}
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {stats.totalSamples < 3 ? (
              <>Há <strong>{stats.totalSamples}</strong> amostra(s) com {currentConfig.label} informada — são necessárias pelo menos 3 para indicar tendência.</>
            ) : (() => {
              const below = scatterData.filter(p => p.x < currentConfig.minIdeal).length;
              const above = scatterData.filter(p => p.x > currentConfig.maxIdeal).length;
              const forca = stats.r2Correlation >= 0.6 ? 'forte' : stats.r2Correlation >= 0.3 ? 'moderada' : 'fraca';
              return (
                <>Em <strong>{stats.totalSamples} amostras</strong>, a relação entre {currentConfig.label} e a produtividade estimada é <strong>{forca}</strong> (R² = {stats.r2Correlation}). <strong>{below}</strong> amostra(s) estão abaixo da faixa recomendada ({currentConfig.minIdeal}–{currentConfig.maxIdeal} {currentConfig.unit}) e <strong>{above}</strong> acima.</>
              );
            })()}
          </p>
        </div>
      </div>

      {/* Detailed Soil Analysis & Yield Efficiency Table */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Tabela de Amostras & Índices de Eficiência</h3>
            <p className="text-xs text-slate-500">Listagem detalhada das propriedades sob monitoramento agronômico</p>
          </div>
          <span className="text-xs text-slate-500 font-mono">Total: {filteredData.length} registros</span>
        </div>

        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-xl">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3">Produtor / Propriedade</th>
                <th className="p-3">Cultura</th>
                <th className="p-3 font-mono">{currentConfig.label}</th>
                <th className="p-3 font-mono">Prod. Esperada</th>
                <th className="p-3 font-mono">Índice Eficiência</th>
                <th className="p-3">Status Agronômico</th>
                <th className="p-3">Recomendação Técnica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400 italic">
                    Nenhuma amostra encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredData.map((sample) => {
                  let metricValue = sample.v_percent;
                  if (selectedMetric === 'p_mg') metricValue = sample.p_mg;
                  else if (selectedMetric === 'k_cmol') metricValue = sample.k_cmol;
                  else if (selectedMetric === 'mo_g') metricValue = sample.mo_g;
                  else if (selectedMetric === 'ph') metricValue = sample.ph;

                  return (
                    <tr key={sample.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">{sample.propertyName}</span>
                        <span className="text-[10px] text-slate-500">{sample.clientName}</span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-900" style={{ backgroundColor: CROP_COLORS[sample.crop] || '#cbd5e1' }}>
                          {sample.crop}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {metricValue} {currentConfig.unit}
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-700">
                        {sample.expectedYield} sc/ha
                      </td>
                      <td className="p-3 font-mono">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-full rounded-full" 
                              style={{ width: `${Math.min(100, sample.efficiencyIndex)}%` }} 
                            />
                          </div>
                          <span className="font-bold text-slate-900">{sample.efficiencyIndex}%</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          sample.status === 'Otimizado' ? 'bg-emerald-100 text-emerald-800' :
                          sample.status === 'Adequado' ? 'bg-slate-100 text-slate-800' :
                          sample.status === 'Limitado' ? 'bg-amber-100 text-amber-800' :
                          'bg-rose-100 text-rose-800'
                        }`}>
                          {sample.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 max-w-xs truncate" title={sample.recommendation}>
                        {sample.recommendation}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print Preview Modal Integration */}
      <PrintPreviewModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Relatório Técnico de Eficiência Agronômica"
        subtitle={`Atributo do solo analisado: ${currentConfig.label} | Filtro: Cultura ${selectedCrop}`}
        category="Relatório de Inteligência Nutricional"
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              1. Resumo de Indicadores da Amostra
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Amostras</span>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">{stats.totalSamples} áreas</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">{currentConfig.label.split('(')[0]} Média</span>
                <p className="text-lg font-extrabold text-emerald-800 mt-0.5">{stats.avgMetric} {currentConfig.unit}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Produtividade Média</span>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">{stats.avgYield} sc/ha</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Eficiência Médio</span>
                <p className="text-lg font-extrabold text-emerald-700 mt-0.5">{stats.avgEfficiency}%</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 pb-1 border-b border-slate-200">
              2. Amostras de Solo e Índice de Produtividade Esperada
            </h3>
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-100 font-bold text-slate-700">
                  <th className="p-2 border border-slate-200">Propriedade / Produtor</th>
                  <th className="p-2 border border-slate-200">Cultura</th>
                  <th className="p-2 border border-slate-200">{currentConfig.label}</th>
                  <th className="p-2 border border-slate-200">Prod. Esperada</th>
                  <th className="p-2 border border-slate-200">Eficiência %</th>
                  <th className="p-2 border border-slate-200">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((sample) => {
                  let val = sample.v_percent;
                  if (selectedMetric === 'p_mg') val = sample.p_mg;
                  else if (selectedMetric === 'k_cmol') val = sample.k_cmol;
                  else if (selectedMetric === 'mo_g') val = sample.mo_g;
                  else if (selectedMetric === 'ph') val = sample.ph;

                  return (
                    <tr key={sample.id} className="border-b border-slate-200">
                      <td className="p-2 font-bold text-slate-800 border border-slate-200">{sample.propertyName} ({sample.clientName})</td>
                      <td className="p-2 text-slate-700 border border-slate-200">{sample.crop}</td>
                      <td className="p-2 text-slate-900 font-mono font-bold border border-slate-200">{val} {currentConfig.unit}</td>
                      <td className="p-2 text-emerald-800 font-mono font-bold border border-slate-200">{sample.expectedYield} sc/ha</td>
                      <td className="p-2 text-slate-900 font-mono font-bold border border-slate-200">{sample.efficiencyIndex}%</td>
                      <td className="p-2 text-slate-700 border border-slate-200">{sample.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs space-y-1">
            <h4 className="font-bold text-slate-800">Conclusão Agronômica e Parecer de Campo:</h4>
            <p className="text-slate-600">
              Com base nos parâmetros analisados, a calagem e adubação equilibrada com foco na faixa ideal de {currentConfig.minIdeal} a {currentConfig.maxIdeal} {currentConfig.unit} garantem incremento de teto produtivo superior a 15%. Recomenda-se acompanhamento por vistoria técnica periódica.
            </p>
          </div>
        </div>
      </PrintPreviewModal>

    </div>
  );
}
