import React, { useState, useEffect, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { X, Search, User, CheckCircle2, ArrowRight, ArrowLeft, AlertCircle, Loader2, MapPin, Landmark, Home, ChevronDown, ChevronUp, Tractor, FileCheck2, Plus, Trash2, Users, ShieldCheck, FileDown, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { Client, ServiceAnalysis } from '../types';
import { cn, formatCPF, formatCurrency, todayLocalDateString } from '../lib/utils';
import { getPdfBranding, drawBrandBanner, drawBrandFooter } from '../lib/pdfBranding';
import { CREDIT_PROGRAMS, BANCOS_FINANCIADORES, SAFRA_REFERENCIA, findCreditProgram, findFaixa, creditConditions, CreditProgram } from '../lib/creditPrograms';
import { toast } from 'sonner';

// ======================================================================
// Proposta de Crédito Rural — assistente em 3 etapas:
//   1. Banco → Programa (Pronaf A, B, V, Pronamp, demais) → Cliente (CPF ou nome)
//   2. Proposta simplificada: Dados, Imóvel, Programa de Investimentos e Garantias
//   3. Resumo + PDF em 2 vias (cliente leva uma; a outra, assinada, fica na empresa
//      e marca o início do projeto).
// Tudo fica salvo no projeto de Crédito Rural (coleção "analyses", campo
// pronafData), então dá para fechar e continuar depois.
//
// Simplificação pedida pelo dono (29/09/2026): saíram Objetivo e Finalidade do
// crédito, Região (semiárido), as marcações (decreto, agroecológica, plano
// territorial), Bases do Financiamento, Financiamentos Existentes, Indicadores,
// Textos, Declarações e Autorizações. Propostas antigas continuam abrindo — os
// campos antigos só deixam de aparecer.
// ======================================================================

export interface PronafCliente {
  clientId: string;
  nome: string;
  cpfCnpj: string;
  tipoCliente: 'PF' | 'PJ';
  endereco: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
  propriedades: { name: string }[];
}

export interface PronafData {
  cliente?: PronafCliente;
  proposta?: PronafProposta;
}

const STEP_LABELS = ['Banco, programa e cliente', 'Proposta', 'Resumo e PDF'];
const newId = () => Math.random().toString(36).slice(2, 10);
const round2 = (n: number) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const floor2 = (n: number) => Math.floor(((n || 0) + Number.EPSILON) * 100) / 100;
const normalize = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtDate = (iso?: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—');

const UNIDADES_INVESTIMENTO = ['HA', 'CAB', 'UN', 'M', 'M2', 'M3', 'KG', 'CX', 'DOSE', 'H/TE', 'DÚZIA'];
const USOS_INVESTIMENTO = [
  'Aquis/Desenv. Software', 'Capital de Giro', 'Cobertura do Solo', 'Construções Civis',
  'Estudos e Projetos', 'Instalações', 'Juros de Implantação', 'Máq./Equip. Estrangeiros',
  'Máq./Equip. Nacionais', 'Móveis e Utensílios', 'Obras Preliminares', 'Outras Desp. Implantação',
  'Outras Inv. Financeiras', 'Outras Inversões', 'Ração e Volumoso', 'Sais Minerais',
  'Semoventes', 'Terrenos', 'Treinamento de Pessoal', 'Vacinas e Medicamentos', 'Veículos/Embarcações',
];
const TIPOS_GARANTIA_REAL = ['Alienação Fiduciária', 'Aval', 'Fiança', 'Fundo de Aval', 'Hipoteca', 'Penhor - Agrícola', 'Penhor - Outros', 'Penhor - Pecuário'];
const MODALIDADE_POR_TIPO: Record<string, string> = {
  'Alienação Fiduciária': 'Alienação Fiduciária de Bem Móvel/Imóvel',
  'Aval': 'Garantia Pessoal',
  'Fiança': 'Garantia Pessoal',
  'Fundo de Aval': 'Fundo Garantidor',
  'Hipoteca': 'Garantia Real Imobiliária',
  'Penhor - Agrícola': 'Penhor Rural Agrícola',
  'Penhor - Outros': 'Penhor Rural',
  'Penhor - Pecuário': 'Penhor Rural Pecuário',
};

export interface ElaboradorInfo { empresa: string; cnpj: string; elaborador: string; cpfElaborador: string; }
const makeElaborador = (): ElaboradorInfo => ({ empresa: '', cnpj: '', elaborador: '', cpfElaborador: '' });

export interface DadosProposta {
  banco: string;
  programaId: string;
  faixaId: string;      // linha/taxa dentro do programa (ex.: Mais Alimentos — tratores 5%)
  dataProposta: string;
  agencia: string;
  atividadePrincipal: string;
  elaborador: ElaboradorInfo;
}
const makeDadosProposta = (): DadosProposta => ({
  banco: '', programaId: '', faixaId: '', dataProposta: todayLocalDateString(),
  agencia: '', atividadePrincipal: '', elaborador: makeElaborador(),
});
function calcPrevisaoContrato(dataProposta: string) {
  if (!dataProposta) return '';
  const d = new Date(dataProposta + 'T00:00:00');
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

export interface ImovelVinculado { denominacao: string; municipio: string; uf: string; areaHa?: number; }
const makeImovelVinculado = (): ImovelVinculado => ({ denominacao: '', municipio: '', uf: '', areaHa: 0 });

export interface InvestimentoItem {
  id: string;
  discriminacao: string;
  componeGarantia: boolean;
  quantidade: number;
  unidade: string;
  uso: string;
  numImovel: number;
  valorUnitario: number;
  recProprioUnitario: number;
}
const makeInvestimentoItem = (): InvestimentoItem => ({
  id: newId(), discriminacao: '', componeGarantia: false, quantidade: 0, unidade: 'UN',
  uso: '', numImovel: 1, valorUnitario: 0, recProprioUnitario: 0,
});
function calcValorFinanciamentoItem(item: InvestimentoItem) {
  return round2(item.valorUnitario * item.quantidade) - round2(item.recProprioUnitario * item.quantidade);
}
function calcInvestimentoTotalItem(item: InvestimentoItem) {
  return round2(calcValorFinanciamentoItem(item) + item.recProprioUnitario * item.quantidade);
}
function calcRecursoProprioTotalItem(item: InvestimentoItem) {
  return item.recProprioUnitario * item.quantidade;
}
function calcGarantiaEvolutivaItem(item: InvestimentoItem) {
  return item.componeGarantia ? calcInvestimentoTotalItem(item) : 0;
}

export interface CusteioVinculado { valor: number; recProprios: number; }
const makeCusteioVinculado = (): CusteioVinculado => ({ valor: 0, recProprios: 0 });
function calcCusteioFinanc(c: CusteioVinculado) { return (c.valor || 0) - (c.recProprios || 0); }
function calcCusteioTotal(c: CusteioVinculado) { return calcCusteioFinanc(c) + (c.recProprios || 0); }

export interface CustoAssessoria { tipo: 'percentual' | 'valor'; percentualOuValor: number; recProprios: number; }
const makeCustoAssessoria = (): CustoAssessoria => ({ tipo: 'percentual', percentualOuValor: 2, recProprios: 0 });

export interface TaxaElaboracaoIrrigacao { percentual: number; baseIrrigacaoValor: number; }
const makeTaxaElaboracaoIrrigacao = (): TaxaElaboracaoIrrigacao => ({ percentual: 0, baseIrrigacaoValor: 0 });

export interface LinhaAdicionalCusto { descricao: string; valor: number; recProprios: number; }
const makeLinhaAdicionalCusto = (): LinhaAdicionalCusto => ({ descricao: '', valor: 0, recProprios: 0 });

export interface ProgramaInvestimentos {
  itens: InvestimentoItem[];
  custeioAgricola: CusteioVinculado;
  custeioPecuario: CusteioVinculado;
  custoAssessoria: CustoAssessoria;
  taxaElaboracaoIrrigacao: TaxaElaboracaoIrrigacao;
  linhaAdicional: LinhaAdicionalCusto;
}
const makeProgramaInvestimentos = (): ProgramaInvestimentos => ({
  itens: [makeInvestimentoItem()],
  custeioAgricola: makeCusteioVinculado(),
  custeioPecuario: makeCusteioVinculado(),
  custoAssessoria: makeCustoAssessoria(),
  taxaElaboracaoIrrigacao: makeTaxaElaboracaoIrrigacao(),
  linhaAdicional: makeLinhaAdicionalCusto(),
});

function subtotalInvestimento(itens: InvestimentoItem[]) {
  return {
    recProprios: itens.reduce((a, i) => a + calcRecursoProprioTotalItem(i), 0),
    financiamento: itens.reduce((a, i) => a + calcValorFinanciamentoItem(i), 0),
    total: itens.reduce((a, i) => a + calcInvestimentoTotalItem(i), 0),
    garantiaEvolutiva: itens.reduce((a, i) => a + calcGarantiaEvolutivaItem(i), 0),
  };
}
function subtotalFinanciamentoGeral(prog: ProgramaInvestimentos) {
  const si = subtotalInvestimento(prog.itens);
  return {
    recProprios: si.recProprios + (prog.custeioAgricola.recProprios || 0) + (prog.custeioPecuario.recProprios || 0),
    financiamento: si.financiamento + calcCusteioFinanc(prog.custeioAgricola) + calcCusteioFinanc(prog.custeioPecuario),
    total: si.total + calcCusteioTotal(prog.custeioAgricola) + calcCusteioTotal(prog.custeioPecuario),
  };
}
function calcCustoAssessoriaValor(prog: ProgramaInvestimentos) {
  const base = subtotalFinanciamentoGeral(prog).financiamento;
  const { tipo, percentualOuValor } = prog.custoAssessoria;
  if (tipo === 'percentual') {
    const pct = Math.min(percentualOuValor || 0, 2);
    return floor2(base * pct / 100);
  }
  return floor2(percentualOuValor || 0);
}
function calcCustoAssessoriaFinanc(prog: ProgramaInvestimentos) {
  return calcCustoAssessoriaValor(prog) - (prog.custoAssessoria.recProprios || 0);
}
function calcCustoAssessoriaTotal(prog: ProgramaInvestimentos) {
  return calcCustoAssessoriaFinanc(prog) + (prog.custoAssessoria.recProprios || 0);
}
function calcTaxaElaboracaoValor(prog: ProgramaInvestimentos) {
  return (prog.taxaElaboracaoIrrigacao.percentual || 0) * (prog.taxaElaboracaoIrrigacao.baseIrrigacaoValor || 0) / 100;
}
function calcLinhaAdicionalFinanc(prog: ProgramaInvestimentos) {
  return (prog.linhaAdicional.valor || 0) - (prog.linhaAdicional.recProprios || 0);
}
function calcTotalGeralInvestimentos(prog: ProgramaInvestimentos) {
  const sf = subtotalFinanciamentoGeral(prog);
  const custosRecProprios = (prog.custoAssessoria.recProprios || 0) + (prog.linhaAdicional.recProprios || 0);
  const custosFinanc = calcCustoAssessoriaFinanc(prog) + calcTaxaElaboracaoValor(prog) + calcLinhaAdicionalFinanc(prog);
  return {
    recProprios: sf.recProprios + custosRecProprios,
    financiamento: round2(custosFinanc + sf.financiamento),
    investimentoTotal: sf.total + calcCustoAssessoriaTotal(prog) + calcTaxaElaboracaoValor(prog) + (prog.linhaAdicional.valor || 0),
  };
}

export interface AvalistaFiador {
  tipo: 'Aval' | 'Fiança' | '';
  nome: string; cpfCnpj: string;
  conjugeNome: string; conjugeCpf: string;
}
const makeAvalistaFiador = (): AvalistaFiador => ({ tipo: '', nome: '', cpfCnpj: '', conjugeNome: '', conjugeCpf: '' });

export interface GarantiaReal { id: string; denominacao: string; tipo: string; valor: number; }
const makeGarantiaReal = (): GarantiaReal => ({ id: newId(), denominacao: '', tipo: 'Hipoteca', valor: 0 });

export interface PronafProposta {
  dados: DadosProposta;
  imoveisVinculados: ImovelVinculado[];
  programaInvestimentos: ProgramaInvestimentos;
  avalistas: [AvalistaFiador, AvalistaFiador];
  garantiasReaisExtras: GarantiaReal[];
}
const makePronafProposta = (): PronafProposta => ({
  dados: makeDadosProposta(),
  imoveisVinculados: [makeImovelVinculado()],
  programaInvestimentos: makeProgramaInvestimentos(),
  avalistas: [makeAvalistaFiador(), makeAvalistaFiador()],
  garantiasReaisExtras: [],
});

// Proposta salva no formato antigo (11 seções): aproveita o que ainda existe e
// completa o que faltar, sem apagar nada do banco.
function normalizeProposta(raw: any): PronafProposta {
  const base = makePronafProposta();
  if (!raw) return base;
  const imoveis: ImovelVinculado[] = Array.isArray(raw.imoveisVinculados) && raw.imoveisVinculados.length
    ? raw.imoveisVinculados.map((i: any) => ({ denominacao: i?.denominacao || '', municipio: i?.municipio || '', uf: i?.uf || '', areaHa: Number(i?.areaHa) || 0 }))
    : base.imoveisVinculados;
  return {
    dados: { ...base.dados, ...(raw.dados || {}), elaborador: { ...base.dados.elaborador, ...(raw.dados?.elaborador || {}) } },
    imoveisVinculados: imoveis,
    programaInvestimentos: { ...base.programaInvestimentos, ...(raw.programaInvestimentos || {}) },
    avalistas: Array.isArray(raw.avalistas) && raw.avalistas.length === 2 ? raw.avalistas : base.avalistas,
    garantiasReaisExtras: Array.isArray(raw.garantiasReaisExtras) ? raw.garantiasReaisExtras : [],
  };
}

function resumoGarantias(proposta: PronafProposta) {
  const reaisPreExistentes = proposta.garantiasReaisExtras.reduce((a, g) => a + (g.valor || 0), 0);
  const reaisEvolutivas = subtotalInvestimento(proposta.programaInvestimentos.itens).garantiaEvolutiva;
  const total = reaisPreExistentes + reaisEvolutivas;
  const financTotal = calcTotalGeralInvestimentos(proposta.programaInvestimentos).financiamento;
  const pctGarantias = financTotal > 0 ? total / financTotal : 0;
  return { reaisPreExistentes, reaisEvolutivas, total, pctGarantias };
}

interface PronafWizardProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  existingProject?: ServiceAnalysis | null;
  onSaved?: () => void;
}

function SectionAccordion({ expanded, onToggle, icon, title, badge, children }: { expanded: boolean; onToggle: () => void; icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">{icon}{title}</span>
        <div className="flex items-center gap-3">
          {badge && <span className="text-xs text-slate-500 font-medium">{badge}</span>}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>
      {expanded && <div className="p-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

function ProgramConditions({ program, faixaId, compact }: { program: CreditProgram; faixaId?: string; compact?: boolean }) {
  const c = creditConditions(program, faixaId);
  const faixa = findFaixa(program, faixaId);
  const rows: [string, string][] = [
    ['Quem pode', program.publico],
    ...(faixa ? [['Linha', faixa.nome] as [string, string]] : []),
    ['Juros', c.juros],
    ['Limite', c.limite],
    ['Prazo', c.prazo],
    ['Carência', c.carencia],
    ...(c.bonus ? [['Bônus', c.bonus] as [string, string]] : []),
  ];
  return (
    <div className={cn('rounded-xl border border-emerald-200 bg-emerald-50/60', compact ? 'p-3' : 'p-4')}>
      <p className="text-xs font-bold text-emerald-800 mb-2">{program.nome}{program.nome.includes(program.finalidade) ? '' : ` · ${program.finalidade}`}</p>
      <div className="grid grid-cols-1 gap-1">
        {rows.map(([k, v]) => (
          <p key={k} className="text-[11px] text-slate-700"><span className="font-semibold text-slate-500">{k}:</span> {v}</p>
        ))}
      </div>
      <p className="text-[10px] text-emerald-700 mt-2 flex items-start gap-1"><Info className="w-3 h-3 shrink-0 mt-0.5" /> Referência: {SAFRA_REFERENCIA}. As condições finais são confirmadas pelo banco na contratação.</p>
    </div>
  );
}

export default function PronafWizard({ isOpen, onClose, clients, existingProject, onSaved }: PronafWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState('');
  const [foundClient, setFoundClient] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [proposta, setProposta] = useState<PronafProposta>(makePronafProposta());
  const [expandedSection, setExpandedSection] = useState<string | null>('dados');

  const program = findCreditProgram(proposta.dados.programaId);
  const faixa = findFaixa(program, proposta.dados.faixaId);
  const cond = program ? creditConditions(program, proposta.dados.faixaId) : null;

  useEffect(() => {
    if (!isOpen) return;
    setExpandedSection('dados');
    if (existingProject) {
      const p: any = existingProject;
      const pronafData: PronafData = p.pronafData || {};
      setProjectId(existingProject.id);
      const clienteMatch = clients.find(c => c.id === (pronafData.cliente?.clientId || existingProject.clientId)) || null;
      setFoundClient(clienteMatch);
      setClientQuery(clienteMatch?.name || pronafData.cliente?.nome || '');
      const nova = normalizeProposta(pronafData.proposta);
      if (!nova.dados.banco) nova.dados.banco = p.bank || '';
      if (!nova.dados.programaId) nova.dados.programaId = p.creditProgramId || '';
      nova.dados.programaId = findCreditProgram(nova.dados.programaId)?.id || '';
      setProposta(nova);
      // Sem programa escolhido (propostas antigas), volta para a etapa 1.
      setStep(pronafData.cliente && nova.dados.programaId ? 2 : 1);
    } else {
      setStep(1);
      setProjectId(null);
      setClientQuery('');
      setFoundClient(null);
      setProposta(makePronafProposta());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, existingProject?.id]);

  const resetAndClose = () => {
    setStep(1);
    setProjectId(null);
    setClientQuery('');
    setFoundClient(null);
    setProposta(makePronafProposta());
    onClose();
  };

  // Busca por CPF (só números) ou por nome (sem acento/maiúsculas).
  const clientResults = useMemo(() => {
    const q = clientQuery.trim();
    if (q.length < 2 || (foundClient && q === foundClient.name)) return [];
    const digits = q.replace(/\D/g, '');
    const onlyCpfChars = /^[\d.\-\s]+$/.test(q);
    return clients.filter(c => {
      if (onlyCpfChars) return digits.length >= 3 && (c.cpf || '').replace(/\D/g, '').includes(digits);
      return normalize(c.name).includes(normalize(q));
    }).slice(0, 8);
  }, [clientQuery, clients, foundClient]);

  const handleClientQuery = (value: string) => {
    const v = /^[\d.\-\s]+$/.test(value) ? formatCPF(value) : value;
    setClientQuery(v);
    if (foundClient && v !== foundClient.name) setFoundClient(null);
    const digits = v.replace(/\D/g, '');
    if (digits.length === 11) {
      const match = clients.find(c => (c.cpf || '').replace(/\D/g, '') === digits);
      if (match) { setFoundClient(match); setClientQuery(match.name); }
    }
  };

  const pickClient = (c: Client) => { setFoundClient(c); setClientQuery(c.name); };

  const imovelFromProperty = (prop: Client['properties'][number]): ImovelVinculado => ({
    denominacao: (prop?.name || '').slice(0, 40),
    municipio: prop?.city || foundClient?.address?.city || '',
    uf: prop?.state || foundClient?.address?.state || '',
    areaHa: Number(prop?.areaHectares) || 0,
  });

  const handleConfirmClient = async () => {
    if (!foundClient || !user) return;
    if (!proposta.dados.banco) { toast.error('Selecione o banco financiador.'); return; }
    if (!program) { toast.error('Selecione o programa de crédito.'); return; }
    if (program.faixas && !faixa) { toast.error('Selecione a linha / taxa de juros do programa.'); return; }
    setSaving(true);
    try {
      const pronafCliente: PronafCliente = {
        clientId: foundClient.id,
        nome: foundClient.name,
        cpfCnpj: foundClient.cpf,
        tipoCliente: 'PF',
        endereco: [foundClient.address?.street, foundClient.address?.number].filter(Boolean).join(', '),
        municipio: foundClient.address?.city || '',
        uf: foundClient.address?.state || '',
        telefone: foundClient.phone || '',
        email: foundClient.ownerEmail || '',
        propriedades: (foundClient.properties || []).map(p => ({ name: p.name })),
      };

      // Puxa do cadastro: imóvel (1ª propriedade) e empresa elaboradora/técnico.
      const branding = getPdfBranding();
      setProposta(prev => {
        const lista = [...prev.imoveisVinculados];
        if (!lista[0]?.denominacao && foundClient.properties?.[0]) lista[0] = imovelFromProperty(foundClient.properties[0]);
        else if (!lista[0]?.municipio) lista[0] = { ...lista[0], municipio: foundClient.address?.city || '', uf: foundClient.address?.state || '' };
        const el = prev.dados.elaborador;
        return {
          ...prev,
          imoveisVinculados: lista,
          dados: {
            ...prev.dados,
            elaborador: {
              ...el,
              empresa: el.empresa || branding.companyName || '',
              elaborador: el.elaborador || user.displayName || '',
            },
          },
        };
      });

      const common = {
        clientId: foundClient.id,
        clientName: foundClient.name,
        bank: proposta.dados.banco,
        financingType: program.nome,
        creditProgramId: program.id,
        updatedAt: new Date().toISOString(),
      };
      if (projectId) {
        await updateDoc(doc(db, 'analyses', projectId), { ...common, 'pronafData.cliente': pronafCliente });
      } else {
        const newDoc = await addDoc(collection(db, 'analyses'), {
          ...common,
          propertyName: foundClient.properties?.[0]?.name || '',
          type: 'credit',
          status: 'Pendente',
          description: `Proposta de crédito — ${program.nome}`,
          value: 0,
          cost: 0,
          category: 'Agricultura',
          scheduledDate: todayLocalDateString(),
          responsibleTechnician: user?.displayName || '',
          pronafData: { cliente: pronafCliente },
          createdAt: new Date().toISOString(),
          createdBy: user?.uid || '',
          assignedTo: user?.uid || '',
        });
        setProjectId(newDoc.id);
        await createNotification(user.uid, 'Nova proposta de crédito', `${program.nome} iniciada para ${foundClient.name}.`, 'success', 'analysis_credit');
      }

      toast.success('Cliente confirmado. Agora preencha a proposta.');
      onSaved?.();
      setStep(2);
    } catch (error) {
      console.error('Erro ao salvar proposta de crédito:', error);
      toast.error('Não foi possível salvar. Verifique sua conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // --- updaters ---
  const updateDados = (patch: Partial<DadosProposta>) => setProposta(prev => ({ ...prev, dados: { ...prev.dados, ...patch } }));
  const updateElaborador = (patch: Partial<ElaboradorInfo>) => setProposta(prev => ({ ...prev, dados: { ...prev.dados, elaborador: { ...prev.dados.elaborador, ...patch } } }));

  const addImovel = () => setProposta(prev => prev.imoveisVinculados.length >= 3 ? prev : ({ ...prev, imoveisVinculados: [...prev.imoveisVinculados, makeImovelVinculado()] }));
  const removeImovel = (idx: number) => setProposta(prev => prev.imoveisVinculados.length <= 1 ? prev : ({ ...prev, imoveisVinculados: prev.imoveisVinculados.filter((_, i) => i !== idx) }));
  const updateImovel = (idx: number, patch: Partial<ImovelVinculado>) => setProposta(prev => {
    const lista = [...prev.imoveisVinculados];
    lista[idx] = { ...lista[idx], ...patch };
    return { ...prev, imoveisVinculados: lista };
  });

  const setPI = (fn: (pi: ProgramaInvestimentos) => ProgramaInvestimentos) => setProposta(prev => ({ ...prev, programaInvestimentos: fn(prev.programaInvestimentos) }));
  const updateInvestItem = (idx: number, patch: Partial<InvestimentoItem>) => setPI(pi => {
    const itens = [...pi.itens];
    itens[idx] = { ...itens[idx], ...patch };
    return { ...pi, itens };
  });
  const addInvestItem = () => setPI(pi => ({ ...pi, itens: [...pi.itens, makeInvestimentoItem()] }));
  const removeInvestItem = (idx: number) => setPI(pi => pi.itens.length <= 1 ? pi : ({ ...pi, itens: pi.itens.filter((_, i) => i !== idx) }));
  const updateCusteioAgricola = (patch: Partial<CusteioVinculado>) => setPI(pi => ({ ...pi, custeioAgricola: { ...pi.custeioAgricola, ...patch } }));
  const updateCusteioPecuario = (patch: Partial<CusteioVinculado>) => setPI(pi => ({ ...pi, custeioPecuario: { ...pi.custeioPecuario, ...patch } }));
  const updateCustoAssessoria = (patch: Partial<CustoAssessoria>) => setPI(pi => ({ ...pi, custoAssessoria: { ...pi.custoAssessoria, ...patch } }));
  const updateTaxaElaboracao = (patch: Partial<TaxaElaboracaoIrrigacao>) => setPI(pi => ({ ...pi, taxaElaboracaoIrrigacao: { ...pi.taxaElaboracaoIrrigacao, ...patch } }));
  const updateLinhaAdicional = (patch: Partial<LinhaAdicionalCusto>) => setPI(pi => ({ ...pi, linhaAdicional: { ...pi.linhaAdicional, ...patch } }));

  const updateAvalista = (idx: 0 | 1, patch: Partial<AvalistaFiador>) => setProposta(prev => {
    const avalistas = [...prev.avalistas] as [AvalistaFiador, AvalistaFiador];
    avalistas[idx] = { ...avalistas[idx], ...patch };
    return { ...prev, avalistas };
  });
  const updateGarantiaExtra = (idx: number, patch: Partial<GarantiaReal>) => setProposta(prev => {
    const lista = [...prev.garantiasReaisExtras];
    lista[idx] = { ...lista[idx], ...patch };
    return { ...prev, garantiasReaisExtras: lista };
  });
  const addGarantiaExtra = () => setProposta(prev => ({ ...prev, garantiasReaisExtras: [...prev.garantiasReaisExtras, makeGarantiaReal()] }));
  const removeGarantiaExtra = (idx: number) => setProposta(prev => ({ ...prev, garantiasReaisExtras: prev.garantiasReaisExtras.filter((_, i) => i !== idx) }));

  const handleSaveProposta = async () => {
    if (!projectId) return;
    if (!proposta.dados.dataProposta) { toast.error('Informe a data da proposta.'); return; }
    if (!program) { toast.error('Selecione o programa de crédito.'); return; }
    if (program.faixas && !faixa) { toast.error('Selecione a linha / taxa de juros do programa.'); return; }
    if (!proposta.dados.banco) { toast.error('Selecione o banco financiador.'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'analyses', projectId), {
        'pronafData.proposta': proposta,
        value: calcTotalGeralInvestimentos(proposta.programaInvestimentos).investimentoTotal,
        bank: proposta.dados.banco,
        financingType: program.nome,
        creditProgramId: program.id,
        propertyName: proposta.imoveisVinculados[0]?.denominacao || '',
        updatedAt: new Date().toISOString(),
      });
      toast.success('Proposta salva.');
      onSaved?.();
      setStep(3);
    } catch (error) {
      console.error('Erro ao salvar proposta:', error);
      toast.error('Não foi possível salvar. Verifique sua conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // PDF do resumo em 2 vias (Cliente / Empresa), cada uma com campo de assinatura.
  const handleGeneratePdf = async () => {
    if (!foundClient || !program) return;
    setGeneratingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const w = pdf.internal.pageSize.getWidth();
      const branding = getPdfBranding();
      const empresa = proposta.dados.elaborador.empresa || branding.companyName || 'a empresa';
      const tot = calcTotalGeralInvestimentos(proposta.programaInvestimentos);
      const gar = resumoGarantias(proposta);
      const EMERALD: [number, number, number] = [5, 150, 105];
      const DARK: [number, number, number] = [30, 41, 59];
      const table = (y: number, title: string, body: string[][], opts: any = {}) => {
        autoTable(pdf, {
          startY: y,
          head: opts.head || [[title, '']],
          body,
          theme: 'grid',
          headStyles: { fillColor: opts.headColor || DARK, textColor: 255, fontStyle: 'bold' },
          columnStyles: opts.columnStyles || { 0: { cellWidth: 52, fontStyle: 'bold', textColor: [71, 85, 105] } },
          styles: { fontSize: 8, cellPadding: 1.3 },
          margin: { left: 14, right: 14, top: 16, bottom: 20 },
          ...opts.extra,
        });
        return (pdf as any).lastAutoTable.finalY + 5;
      };
      // Tabela "rótulo | valor | rótulo | valor" — deixa cada via caber em 1 página.
      const kv4 = (y: number, title: string, pairs: [string, string | undefined][], headColor = DARK) => {
        const body: any[] = [];
        // Rótulo começando com "!" ocupa a linha inteira.
        for (let i = 0; i < pairs.length; i++) {
          const a = pairs[i], b = pairs[i + 1];
          if (a[0].startsWith('!') || !b || b[0].startsWith('!')) {
            body.push([a[0].replace(/^!/, ''), { content: a[1] || '—', colSpan: 3 }]);
          } else {
            body.push([a[0], a[1] || '—', b[0], b[1] || '—']);
            i++;
          }
        }
        autoTable(pdf, {
          startY: y,
          head: [[{ content: title, colSpan: 4 }]],
          body,
          theme: 'grid',
          headStyles: { fillColor: headColor, textColor: 255, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold', textColor: [71, 85, 105] }, 2: { cellWidth: 30, fontStyle: 'bold', textColor: [71, 85, 105] } },
          styles: { fontSize: 8, cellPadding: 1.1 },
          margin: { left: 14, right: 14, top: 16, bottom: 20 },
        });
        return (pdf as any).lastAutoTable.finalY + 4;
      };
      const ensure = (y: number, need: number) => {
        if (y + need > 275) { pdf.addPage(); return 18; }
        return y;
      };

      const renderVia = (via: string) => {
        let y = drawBrandBanner(pdf, { height: 26 }) + 9;
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...DARK);
        pdf.text('PROPOSTA DE CRÉDITO RURAL — RESUMO', w / 2, y, { align: 'center' });
        y += 5.5;
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139);
        pdf.text(`${via} · ${program.nome} · ${proposta.dados.banco}`, w / 2, y, { align: 'center' });
        y += 6;

        y = kv4(y, 'Cliente', [
          ['Nome', foundClient.name], ['CPF', foundClient.cpf],
          ['Telefone', foundClient.phone], ['Município/UF', foundClient.address?.city ? `${foundClient.address.city}/${foundClient.address.state || ''}` : ''],
          ['Endereço', [foundClient.address?.street, foundClient.address?.number, foundClient.address?.neighborhood].filter(Boolean).join(', ')],
        ], EMERALD);

        // Condições do programa/linha entram aqui (valores de referência do Plano Safra).
        y = kv4(y, `Dados da Proposta — condições de referência do ${SAFRA_REFERENCIA}, confirmadas pelo banco na contratação`, [
          ['Banco', proposta.dados.banco], ['Agência', proposta.dados.agencia],
          ['Programa', program.nome], ['Finalidade', program.finalidade],
          ...(faixa ? [['!Linha', faixa.nome] as [string, string]] : []),
          ['Juros', cond!.juros], ['Limite', cond!.limite],
          ['Prazo', cond!.prazo], ['Carência', cond!.carencia],
          ...(cond!.bonus ? [['!Bônus', cond!.bonus] as [string, string]] : []),
          ['Data da proposta', fmtDate(proposta.dados.dataProposta)], ['Previsão contrato', fmtDate(calcPrevisaoContrato(proposta.dados.dataProposta))],
          ['Atividade', proposta.dados.atividadePrincipal], ['Técnico', proposta.dados.elaborador.elaborador],
          ['!Empresa', [proposta.dados.elaborador.empresa, proposta.dados.elaborador.cnpj].filter(Boolean).join(' · CNPJ ')],
        ]);

        const imoveis = proposta.imoveisVinculados.filter(i => (i.denominacao || '').trim());
        if (imoveis.length) {
          y = ensure(y, 20);
          y = table(y, '', imoveis.map((i, n) => [String(n + 1), i.denominacao, [i.municipio, i.uf].filter(Boolean).join('/') || '—', i.areaHa ? `${i.areaHa} ha` : '—']), {
            head: [['Nº', 'Imóvel onde serão feitas as inversões', 'Município/UF', 'Área']],
            columnStyles: { 0: { cellWidth: 10 }, 3: { cellWidth: 24, halign: 'right' } },
          });
        }

        const itens = proposta.programaInvestimentos.itens.filter(i => (i.discriminacao || '').trim());
        const pi = proposta.programaInvestimentos;
        const extras: string[][] = [];
        if (pi.custeioAgricola.valor) extras.push(['Custeio agrícola vinculado', '', formatCurrency(pi.custeioAgricola.recProprios || 0), formatCurrency(calcCusteioFinanc(pi.custeioAgricola)), formatCurrency(calcCusteioTotal(pi.custeioAgricola))]);
        if (pi.custeioPecuario.valor) extras.push(['Custeio pecuário vinculado', '', formatCurrency(pi.custeioPecuario.recProprios || 0), formatCurrency(calcCusteioFinanc(pi.custeioPecuario)), formatCurrency(calcCusteioTotal(pi.custeioPecuario))]);
        if (calcCustoAssessoriaValor(pi)) extras.push(['Assessoria empresarial e técnica', '', formatCurrency(pi.custoAssessoria.recProprios || 0), formatCurrency(calcCustoAssessoriaFinanc(pi)), formatCurrency(calcCustoAssessoriaTotal(pi))]);
        if (calcTaxaElaboracaoValor(pi)) extras.push(['Tx. elaboração + assist. técnica (irrigação)', '', formatCurrency(0), formatCurrency(calcTaxaElaboracaoValor(pi)), formatCurrency(calcTaxaElaboracaoValor(pi))]);
        if (pi.linhaAdicional.valor) extras.push([pi.linhaAdicional.descricao || 'Outros', '', formatCurrency(pi.linhaAdicional.recProprios || 0), formatCurrency(calcLinhaAdicionalFinanc(pi)), formatCurrency(pi.linhaAdicional.valor)]);
        y = ensure(y, 30);
        y = table(y, '', [
          ...itens.map(i => [i.discriminacao, `${i.quantidade || 0} ${i.unidade} × ${formatCurrency(i.valorUnitario)}`, formatCurrency(calcRecursoProprioTotalItem(i)), formatCurrency(calcValorFinanciamentoItem(i)), formatCurrency(calcInvestimentoTotalItem(i))]),
          ...extras,
          ...(itens.length || extras.length ? [] : [['Nenhum item informado', '', '', '', '']]),
        ], {
          head: [['Programa de investimentos', 'Quantidade', 'Rec. próprios', 'Financiado', 'Total']],
          columnStyles: { 0: { cellWidth: 62 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          extra: {
            foot: [['TOTAL', '', formatCurrency(tot.recProprios), formatCurrency(tot.financiamento), formatCurrency(tot.investimentoTotal)]],
            footStyles: { fillColor: EMERALD, textColor: 255, fontStyle: 'bold', halign: 'right' },
          },
        });

        const avs = proposta.avalistas.filter(a => (a.nome || '').trim());
        const garRows: string[][] = [
          ...avs.map(a => [`${a.tipo || 'Aval/Fiança'}`, `${a.nome}${a.cpfCnpj ? ' · CPF ' + a.cpfCnpj : ''}${a.conjugeNome ? ' · Cônjuge: ' + a.conjugeNome : ''}`]),
          ...proposta.garantiasReaisExtras.filter(g => (g.denominacao || '').trim() || g.valor).map(g => [g.tipo, `${g.denominacao || '—'} · ${formatCurrency(g.valor || 0)}`]),
          ...(gar.reaisEvolutivas ? [['Garantias reais evolutivas', formatCurrency(gar.reaisEvolutivas)]] : []),
          ['Total de garantias reais', `${formatCurrency(gar.total)} (${(gar.pctGarantias * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do financiado)`],
        ];
        y = ensure(y, 25);
        y = table(y, '', garRows, { head: [[{ content: 'Garantias', colSpan: 2 }]] });

        // Documentos em 2 colunas de checklist
        y = ensure(y, 30);
        const docs = program.documentos;
        const half = Math.ceil(docs.length / 2);
        y = table(y, '', Array.from({ length: half }, (_, i) => [`[  ] ${docs[i]}`, docs[i + half] ? `[  ] ${docs[i + half]}` : '']), {
          head: [[{ content: 'Documentos que o cliente deve providenciar', colSpan: 2 }]],
          columnStyles: { 0: { cellWidth: (w - 28) / 2 } },
          extra: { styles: { fontSize: 7.2, cellPadding: 1 } },
        });

        // Declaração + assinaturas (~44 mm; o rodapé começa em 283 mm)
        if (y + 44 > 280) { pdf.addPage(); y = 18; }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(51, 65, 85);
        const decl = `Declaro que as informações acima são verdadeiras e autorizo ${empresa} a iniciar a elaboração do projeto de crédito rural (${program.nome}) junto ao ${proposta.dados.banco}. Estou ciente de que a aprovação, o valor e as condições finais do financiamento dependem da análise do banco.`;
        const lines = pdf.splitTextToSize(decl, w - 28);
        pdf.text(lines, 14, y);
        y += lines.length * 3.9 + 2;
        const cidade = foundClient.address?.city || proposta.imoveisVinculados[0]?.municipio || '____________________';
        pdf.text(`${cidade}, ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`, 14, y);
        y += 15;
        pdf.setDrawColor(100, 116, 139);
        pdf.line(18, y, 92, y);
        pdf.line(w - 92, y, w - 18, y);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...DARK);
        pdf.text(foundClient.name || 'Cliente', 55, y + 5, { align: 'center' });
        pdf.text(proposta.dados.elaborador.elaborador || empresa, w - 55, y + 5, { align: 'center' });
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
        pdf.text(`CPF ${foundClient.cpf || '—'}`, 55, y + 9.5, { align: 'center' });
        pdf.text(empresa, w - 55, y + 9.5, { align: 'center' });
      };

      renderVia('VIA DO CLIENTE');
      pdf.addPage();
      renderVia('VIA DA EMPRESA');
      drawBrandFooter(pdf);
      pdf.save(`Proposta_Credito_${(foundClient.name || 'Cliente').replace(/\s+/g, '_')}.pdf`);
      toast.success('PDF gerado com 2 vias (cliente e empresa).');
    } catch (error) {
      console.error('Erro ao gerar PDF da proposta:', error);
      toast.error('Não foi possível gerar o PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!isOpen) return null;

  const totalGeralInvest = calcTotalGeralInvestimentos(proposta.programaInvestimentos);
  const resumoGar = resumoGarantias(proposta);
  const toggle = (id: string) => setExpandedSection(expandedSection === id ? null : id);
  const clientProps = foundClient?.properties || [];
  const canConfirm = !!foundClient && !!proposta.dados.banco && !!program && (!program.faixas || !!faixa) && !saving;
  const inputCls = 'w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs';
  const labelCls = 'text-[10px] font-medium text-slate-500 block mb-0.5';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={resetAndClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className={cn('bg-white rounded-2xl shadow-2xl w-full overflow-hidden max-h-[92vh] flex flex-col transition-all', step === 1 ? 'max-w-2xl' : 'max-w-6xl')}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Landmark className="w-5 h-5" /></div>
              <div>
                <h2 className="font-semibold text-lg leading-tight">Proposta de Crédito Rural</h2>
                <p className="text-emerald-100 text-xs">
                  Etapa {step} de 3 · {STEP_LABELS[step - 1]}
                  {step > 1 && program ? ` · ${program.nome}` : ''}
                  {step > 1 && foundClient ? ` · ${(foundClient.name || '').toUpperCase()}` : ''}
                </p>
              </div>
            </div>
            <button onClick={resetAndClose} className="text-white/80 hover:text-white transition-colors" aria-label="Fechar"><X className="w-5 h-5" /></button>
          </div>

          {/* Step indicator */}
          <div className="px-6 pt-4 flex items-center gap-1.5 shrink-0">
            {STEP_LABELS.map((label, idx) => (
              <div key={label} className="flex-1">
                <div className={cn('h-1.5 rounded-full', idx < step ? 'bg-emerald-500' : 'bg-slate-200')} />
                <p className={cn('text-[10px] mt-1 text-center', idx < step ? 'text-emerald-700 font-medium' : 'text-slate-400')}>{label}</p>
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto custom-scrollbar">
            {step === 1 && (
              <div className="flex flex-col gap-6">
                {/* 1. Banco e 2. Programa — listas de seleção lado a lado */}
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">1. Banco financiador</label>
                      <select value={proposta.dados.banco} onChange={(e) => updateDados({ banco: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium bg-white">
                        <option value="">Selecione o banco...</option>
                        {BANCOS_FINANCIADORES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">2. Programa de crédito</label>
                      <select value={proposta.dados.programaId} onChange={(e) => updateDados({ programaId: e.target.value, faixaId: '' })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium bg-white">
                        <option value="">Selecione o programa...</option>
                        {(['Pronaf', 'Pronamp', 'Demais produtores'] as const).map(grupo => (
                          <optgroup key={grupo} label={grupo}>
                            {CREDIT_PROGRAMS.filter(p => p.grupo === grupo).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>
                  {program?.faixas && (
                    <div className="mt-3">
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">Linha / taxa de juros</label>
                      <select value={proposta.dados.faixaId} onChange={(e) => updateDados({ faixaId: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium bg-white">
                        <option value="">Selecione o que será financiado...</option>
                        {program.faixas.map(f => <option key={f.id} value={f.id}>{f.juros.replace(' ao ano', ' a.a.')} — {f.nome}</option>)}
                      </select>
                    </div>
                  )}
                  {program && <div className="mt-3"><ProgramConditions program={program} faixaId={proposta.dados.faixaId} compact /></div>}
                </div>

                {/* 3. Cliente */}
                <div>
                  <p className="text-sm font-bold text-slate-700 mb-2">3. Cliente</p>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={clientQuery}
                      onChange={(e) => handleClientQuery(e.target.value)}
                      placeholder="Digite o CPF ou o nome do cliente"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium"
                    />
                  </div>
                  {clientResults.length > 0 && (
                    <div className="mt-2 rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                      {clientResults.map(c => (
                        <button key={c.id} type="button" onClick={() => pickClient(c)} className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-700 truncate">{c.name}</span>
                          <span className="text-[11px] text-slate-400 shrink-0">{c.cpf || 'sem CPF'}{c.address?.city ? ` · ${c.address.city}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {foundClient && (
                    <div className="mt-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><User className="w-5 h-5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 flex items-center gap-1.5">{foundClient.name}<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /></p>
                        <p className="text-xs text-slate-500 mt-0.5">CPF: {foundClient.cpf || '—'}{foundClient.phone ? ` · Tel.: ${foundClient.phone}` : ''}</p>
                        {foundClient.address?.city && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {foundClient.address.city}/{foundClient.address.state}</p>}
                        <p className="text-xs text-slate-500 mt-0.5">{clientProps.length} propriedade{clientProps.length === 1 ? '' : 's'} cadastrada{clientProps.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                  )}
                  {!foundClient && clientQuery.trim().length >= 3 && clientResults.length === 0 && (
                    <div className="mt-3 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Cliente não encontrado</p>
                        <p className="text-xs text-amber-700 mt-0.5">Cadastre o cliente na aba Clientes e volte aqui.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between bg-emerald-600 text-white rounded-2xl px-5 py-3.5 sticky top-0 z-10 shadow-lg flex-wrap gap-2">
                  <span className="text-sm font-medium">Investimento total da proposta</span>
                  <div className="flex items-center gap-4 text-xs flex-wrap">
                    <span>Rec. próprios: <strong>{formatCurrency(totalGeralInvest.recProprios)}</strong></span>
                    <span>Financiamento: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                    <span className="text-sm">Total: <strong>{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                  </div>
                </div>

                {/* Seção 1 - Dados da Proposta */}
                <SectionAccordion expanded={expandedSection === 'dados'} onToggle={() => toggle('dados')} icon={<Landmark className="w-4 h-4 text-emerald-600" />} title="Seção 1 · Dados da Proposta">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="col-span-2">
                      <label className={labelCls}>Cliente</label>
                      <p className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-600 truncate">{foundClient?.name?.toUpperCase() || '—'}{foundClient?.cpf ? ` · CPF ${foundClient.cpf}` : ''}</p>
                    </div>
                    <div>
                      <label className={labelCls}>Data da proposta</label>
                      <input type="date" value={proposta.dados.dataProposta} onChange={(e) => updateDados({ dataProposta: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Previsão do contrato</label>
                      <p className="px-2.5 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs font-semibold text-emerald-700">{fmtDate(calcPrevisaoContrato(proposta.dados.dataProposta))}</p>
                    </div>
                    <div>
                      <label className={labelCls}>Banco financiador</label>
                      <select value={proposta.dados.banco} onChange={(e) => updateDados({ banco: e.target.value })} className={cn(inputCls, 'bg-white')}>
                        <option value="">Selecione</option>
                        {BANCOS_FINANCIADORES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Programa</label>
                      <select value={proposta.dados.programaId} onChange={(e) => updateDados({ programaId: e.target.value, faixaId: '' })} className={cn(inputCls, 'bg-white')}>
                        <option value="">Selecione</option>
                        {CREDIT_PROGRAMS.map(p => <option key={p.id} value={p.id}>{p.nome} — {p.finalidade}</option>)}
                      </select>
                    </div>
                    {program?.faixas && (
                      <div className="col-span-2 md:col-span-4">
                        <label className={labelCls}>Linha / taxa de juros</label>
                        <select value={proposta.dados.faixaId} onChange={(e) => updateDados({ faixaId: e.target.value })} className={cn(inputCls, 'bg-white')}>
                          <option value="">Selecione</option>
                          {program.faixas.map(f => <option key={f.id} value={f.id}>{f.juros.replace(' ao ano', ' a.a.')} — {f.nome}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className={labelCls}>Agência</label>
                      <input value={proposta.dados.agencia} onChange={(e) => updateDados({ agencia: e.target.value })} placeholder="Ex.: 1234 — Almenara" className={inputCls} />
                    </div>
                    <div className="col-span-2 md:col-span-4">
                      <label className={labelCls}>Atividade principal</label>
                      <input value={proposta.dados.atividadePrincipal} onChange={(e) => updateDados({ atividadePrincipal: e.target.value })} placeholder="Ex.: bovinocultura de leite, cafeicultura, horticultura..." className={inputCls} />
                    </div>
                  </div>
                  {program && <ProgramConditions program={program} faixaId={proposta.dados.faixaId} compact />}
                  <p className="text-[11px] font-semibold text-slate-500 -mb-2">Empresa elaboradora</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input value={proposta.dados.elaborador.empresa} onChange={(e) => updateElaborador({ empresa: e.target.value })} placeholder="Empresa elaboradora" className={inputCls} />
                    <input value={proposta.dados.elaborador.cnpj} onChange={(e) => updateElaborador({ cnpj: e.target.value })} placeholder="CNPJ" className={inputCls} />
                    <input value={proposta.dados.elaborador.elaborador} onChange={(e) => updateElaborador({ elaborador: e.target.value })} placeholder="Técnico responsável" className={inputCls} />
                    <input value={proposta.dados.elaborador.cpfElaborador} onChange={(e) => updateElaborador({ cpfElaborador: formatCPF(e.target.value) })} placeholder="CPF do técnico" className={inputCls} />
                  </div>
                </SectionAccordion>

                {/* Seção 2 - Imóvel */}
                <SectionAccordion expanded={expandedSection === 'imoveis'} onToggle={() => toggle('imoveis')} icon={<Home className="w-4 h-4 text-emerald-600" />} title="Seção 2 · Imóvel onde Serão Realizadas as Inversões" badge={proposta.imoveisVinculados.filter(i => i.denominacao).length ? `${proposta.imoveisVinculados.filter(i => i.denominacao).length} imóvel(is)` : undefined}>
                  <p className="text-[11px] text-slate-500 -mt-1">Os dados vêm do cadastro do cliente. Escolha a propriedade na lista ou ajuste à mão.</p>
                  <div className="flex flex-col gap-2">
                    {proposta.imoveisVinculados.map((info, idx) => (
                      <div key={idx} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <p className="text-xs font-semibold text-slate-600">{idx === 0 ? 'Imóvel principal' : `Imóvel ${idx + 1}`}</p>
                          <div className="flex items-center gap-2">
                            {clientProps.length > 0 && (
                              <select value="" onChange={(e) => { const p = clientProps[Number(e.target.value)]; if (p) updateImovel(idx, imovelFromProperty(p)); }} className="px-2 py-1 rounded-lg border border-emerald-200 text-[11px] bg-emerald-50 text-emerald-700 font-semibold">
                                <option value="">Puxar do cadastro...</option>
                                {clientProps.map((p, i) => <option key={i} value={i}>{p.name}{p.areaHectares ? ` (${p.areaHectares} ha)` : ''}</option>)}
                              </select>
                            )}
                            {idx > 0 && (
                              <button type="button" onClick={() => removeImovel(idx)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /> Remover</button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          <input value={info.denominacao} onChange={(e) => updateImovel(idx, { denominacao: e.target.value.slice(0, 40) })} placeholder="Denominação" className={cn(inputCls, 'col-span-2')} />
                          <input value={info.municipio} onChange={(e) => updateImovel(idx, { municipio: e.target.value })} placeholder="Município" className={inputCls} />
                          <input value={info.uf} maxLength={2} onChange={(e) => updateImovel(idx, { uf: e.target.value.toUpperCase() })} placeholder="UF" className={cn(inputCls, 'uppercase')} />
                          <input type="number" value={info.areaHa || ''} onChange={(e) => updateImovel(idx, { areaHa: Number(e.target.value) })} placeholder="Área (ha)" className={inputCls} />
                        </div>
                      </div>
                    ))}
                    {proposta.imoveisVinculados.length < 3 && (
                      <button type="button" onClick={addImovel} disabled={!proposta.imoveisVinculados[proposta.imoveisVinculados.length - 1]?.denominacao?.trim()}
                        className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:text-slate-300 disabled:cursor-not-allowed">
                        <Plus className="w-3.5 h-3.5" /> Adicionar outro imóvel
                      </button>
                    )}
                  </div>
                </SectionAccordion>

                {/* Seção 3 - Programa de Investimentos */}
                <SectionAccordion expanded={expandedSection === 'investimentos'} onToggle={() => toggle('investimentos')} icon={<Tractor className="w-4 h-4 text-emerald-600" />} title="Seção 3 · Programa de Investimentos" badge={formatCurrency(totalGeralInvest.investimentoTotal)}>
                  <div className="flex flex-col gap-2">
                    {proposta.programaInvestimentos.itens.map((item, i) => (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-2.5 bg-slate-50">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">Item {i + 1}</span>
                          <button type="button" onClick={() => removeInvestItem(i)} disabled={proposta.programaInvestimentos.itens.length <= 1} className="flex items-center text-slate-300 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                          <input value={item.discriminacao} onChange={(e) => updateInvestItem(i, { discriminacao: e.target.value })} placeholder="Discriminação" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <select value={item.unidade} onChange={(e) => updateInvestItem(i, { unidade: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                            {UNIDADES_INVESTIMENTO.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <select value={item.numImovel} onChange={(e) => updateInvestItem(i, { numImovel: Number(e.target.value) })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                            {proposta.imoveisVinculados.map((im, n) => <option key={n} value={n + 1}>Imóvel {n + 1}{im.denominacao ? ` · ${im.denominacao}` : ''}</option>)}
                          </select>
                          <select value={item.uso} onChange={(e) => updateInvestItem(i, { uso: e.target.value })} className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                            <option value="">Uso</option>
                            {USOS_INVESTIMENTO.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <input type="number" value={item.quantidade || ''} onChange={(e) => updateInvestItem(i, { quantidade: Number(e.target.value) })} placeholder="Quant." className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={item.valorUnitario || ''} onChange={(e) => updateInvestItem(i, { valorUnitario: Number(e.target.value) })} placeholder="Vr. unitário" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={item.recProprioUnitario || ''} onChange={(e) => updateInvestItem(i, { recProprioUnitario: Number(e.target.value) })} placeholder="Rec. próprio unit." className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={item.componeGarantia} onChange={(e) => updateInvestItem(i, { componeGarantia: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Compõe garantia?</label>
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 mt-1.5 text-[11px] text-slate-500">
                          <span>Rec. próprio: <strong>{formatCurrency(calcRecursoProprioTotalItem(item))}</strong></span>
                          <span>Financiamento: <strong>{formatCurrency(calcValorFinanciamentoItem(item))}</strong></span>
                          <span>Total: <strong className="text-emerald-700">{formatCurrency(calcInvestimentoTotalItem(item))}</strong></span>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={addInvestItem} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar item</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {([['Custeio agrícola vinculado', proposta.programaInvestimentos.custeioAgricola, updateCusteioAgricola], ['Custeio pecuário vinculado', proposta.programaInvestimentos.custeioPecuario, updateCusteioPecuario]] as const).map(([titulo, c, upd]) => (
                      <div key={titulo} className="rounded-lg border border-slate-100 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">{titulo}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          <input type="number" value={c.valor || ''} onChange={(e) => upd({ valor: Number(e.target.value) })} placeholder="Valor" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={c.recProprios || ''} onChange={(e) => upd({ recProprios: Number(e.target.value) })} placeholder="Rec. próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        </div>
                        <p className="text-[11px] text-slate-500 text-right mt-1">Financ.: <strong>{formatCurrency(calcCusteioFinanc(c))}</strong></p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-slate-100 p-2.5">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Custo de assessoria empresarial e técnica (máx. 2%)</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <select value={proposta.programaInvestimentos.custoAssessoria.tipo} onChange={(e) => updateCustoAssessoria({ tipo: e.target.value as 'percentual' | 'valor' })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="percentual">Percentual (%)</option>
                        <option value="valor">Valor fixo (R$)</option>
                      </select>
                      <input type="number" value={proposta.programaInvestimentos.custoAssessoria.percentualOuValor || ''} onChange={(e) => updateCustoAssessoria({ percentualOuValor: Number(e.target.value) })} placeholder={proposta.programaInvestimentos.custoAssessoria.tipo === 'percentual' ? '%' : 'R$'} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      <input type="number" value={proposta.programaInvestimentos.custoAssessoria.recProprios || ''} onChange={(e) => updateCustoAssessoria({ recProprios: Number(e.target.value) })} placeholder="Rec. próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <p className="text-[11px] text-slate-500 text-right mt-1">Valor: <strong>{formatCurrency(calcCustoAssessoriaValor(proposta.programaInvestimentos))}</strong> · Financ.: <strong>{formatCurrency(calcCustoAssessoriaFinanc(proposta.programaInvestimentos))}</strong></p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-100 p-2.5">
                      <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Tx. elaboração + assistência técnica (itens de irrigação)</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="number" value={proposta.programaInvestimentos.taxaElaboracaoIrrigacao.percentual || ''} onChange={(e) => updateTaxaElaboracao({ percentual: Number(e.target.value) })} placeholder="Percentual (%)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input type="number" value={proposta.programaInvestimentos.taxaElaboracaoIrrigacao.baseIrrigacaoValor || ''} onChange={(e) => updateTaxaElaboracao({ baseIrrigacaoValor: Number(e.target.value) })} placeholder="Base irrigação (R$)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      </div>
                      <p className="text-[11px] text-slate-500 text-right mt-1">Valor: <strong>{formatCurrency(calcTaxaElaboracaoValor(proposta.programaInvestimentos))}</strong></p>
                    </div>
                    <div className="rounded-lg border border-slate-100 p-2.5">
                      <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Outra despesa (linha livre)</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <input value={proposta.programaInvestimentos.linhaAdicional.descricao} onChange={(e) => updateLinhaAdicional({ descricao: e.target.value })} placeholder="Descrição" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input type="number" value={proposta.programaInvestimentos.linhaAdicional.valor || ''} onChange={(e) => updateLinhaAdicional({ valor: Number(e.target.value) })} placeholder="Valor" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input type="number" value={proposta.programaInvestimentos.linhaAdicional.recProprios || ''} onChange={(e) => updateLinhaAdicional({ recProprios: Number(e.target.value) })} placeholder="Rec. próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      </div>
                      <p className="text-[11px] text-slate-500 text-right mt-1">Financ.: <strong>{formatCurrency(calcLinhaAdicionalFinanc(proposta.programaInvestimentos))}</strong></p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-emerald-600 text-white rounded-xl p-3 flex-wrap gap-2">
                    <span className="text-sm font-semibold">TOTAL GERAL</span>
                    <div className="flex items-center gap-4 text-xs flex-wrap">
                      <span>Rec. próprios: <strong>{formatCurrency(totalGeralInvest.recProprios)}</strong></span>
                      <span>Financiamento: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                      <span className="text-sm">Total: <strong>{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                    </div>
                  </div>
                </SectionAccordion>

                {/* Seção 4 - Garantias Fidejussórias */}
                <SectionAccordion expanded={expandedSection === 'fidejussorias'} onToggle={() => toggle('fidejussorias')} icon={<Users className="w-4 h-4 text-emerald-600" />} title="Seção 4 · Garantias Fidejussórias (aval / fiança)">
                  <div className="flex flex-col gap-2">
                    {([0, 1] as const).map(i => (
                      <div key={i} className="rounded-lg border border-slate-200 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Avalista/Fiador {i + 1}</p>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                          <select value={proposta.avalistas[i].tipo} onChange={(e) => updateAvalista(i, { tipo: e.target.value as 'Aval' | 'Fiança' | '' })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                            <option value="">Tipo</option>
                            <option value="Aval">Aval</option>
                            <option value="Fiança">Fiança</option>
                          </select>
                          <input value={proposta.avalistas[i].nome} onChange={(e) => updateAvalista(i, { nome: e.target.value })} placeholder="Nome" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={proposta.avalistas[i].cpfCnpj} onChange={(e) => updateAvalista(i, { cpfCnpj: formatCPF(e.target.value) })} placeholder="CPF" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={proposta.avalistas[i].conjugeNome} onChange={(e) => updateAvalista(i, { conjugeNome: e.target.value })} placeholder="Cônjuge — nome" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={proposta.avalistas[i].conjugeCpf} onChange={(e) => updateAvalista(i, { conjugeCpf: formatCPF(e.target.value) })} placeholder="Cônjuge — CPF" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionAccordion>

                {/* Seção 5 - Garantias Reais */}
                <SectionAccordion expanded={expandedSection === 'garantias-reais'} onToggle={() => toggle('garantias-reais')} icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />} title="Seção 5 · Outras Garantias (Reais)" badge={formatCurrency(resumoGar.total)}>
                  <div className="flex flex-col gap-1.5">
                    {proposta.garantiasReaisExtras.length === 0 && <p className="text-xs text-slate-400 italic">Nenhuma garantia real adicionada ainda.</p>}
                    {proposta.garantiasReaisExtras.map((g, i) => (
                      <div key={g.id} className="grid grid-cols-12 gap-1.5 items-center bg-slate-50 rounded-lg p-1.5">
                        <input value={g.denominacao} onChange={(e) => updateGarantiaExtra(i, { denominacao: e.target.value })} placeholder="Denominação (ex.: Fazenda X, matrícula 123)" className="col-span-4 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <select value={g.tipo} onChange={(e) => updateGarantiaExtra(i, { tipo: e.target.value })} className="col-span-3 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                          {TIPOS_GARANTIA_REAL.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span className="col-span-2 text-[10px] text-slate-400 truncate">{MODALIDADE_POR_TIPO[g.tipo]}</span>
                        <input type="number" value={g.valor || ''} onChange={(e) => updateGarantiaExtra(i, { valor: Number(e.target.value) })} placeholder="Valor" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <button type="button" onClick={() => removeGarantiaExtra(i)} className="col-span-1 flex justify-center text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={addGarantiaExtra} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar garantia</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs">
                    <span>Garantias reais pré-existentes: <strong>{formatCurrency(resumoGar.reaisPreExistentes)}</strong></span>
                    <span>Garantias reais evolutivas: <strong>{formatCurrency(resumoGar.reaisEvolutivas)}</strong></span>
                    <span>Total de garantias: <strong className="text-emerald-700">{formatCurrency(resumoGar.total)}</strong></span>
                    <span>% garantias/financiamento: <strong>{(resumoGar.pctGarantias * 100).toFixed(2)}%</strong></span>
                  </div>
                </SectionAccordion>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3"><CheckCircle2 className="w-8 h-8" /></div>
                  <h3 className="font-semibold text-slate-800 text-lg">Proposta pronta</h3>
                  <p className="text-sm text-slate-500 mt-1">Gere o PDF: ele sai com <strong>2 vias</strong> — o cliente leva uma e assina a outra, que fica com a empresa e dá início ao projeto.</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-slate-50 rounded-xl p-3">
                  <span>Cliente: <strong>{foundClient?.name || '—'}</strong></span>
                  <span>Banco: <strong>{proposta.dados.banco || '—'}</strong></span>
                  <span>Programa: <strong>{program?.nome || '—'}{cond ? ` · ${cond.juros.replace(' ao ano', ' a.a.')}` : ''}</strong></span>
                  <span>Data: <strong>{fmtDate(proposta.dados.dataProposta)}</strong></span>
                  <span>Imóvel: <strong>{proposta.imoveisVinculados[0]?.denominacao || '—'}</strong></span>
                  <span>Financiado: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                  <span>Total: <strong className="text-emerald-700">{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                  <span>Garantias: <strong>{formatCurrency(resumoGar.total)}</strong></span>
                </div>

                {program && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ProgramConditions program={program} faixaId={proposta.dados.faixaId} compact />
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5"><FileCheck2 className="w-4 h-4 text-emerald-600" /> Documentos que o cliente deve providenciar</p>
                      <ul className="flex flex-col gap-1">
                        {program.documentos.map(d => <li key={d} className="text-[11px] text-slate-600 flex gap-1.5"><span className="text-slate-300">☐</span>{d}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-3 flex items-center justify-between shrink-0 border-t border-slate-100">
            {step === 1 && (
              <>
                <button onClick={resetAndClose} className="text-sm text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                <button onClick={() => runExclusive('PronafWizard.handleConfirmClient', () => handleConfirmClient())} disabled={!canConfirm}
                  className={cn('flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all', canConfirm ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}
                  title={!proposta.dados.banco ? 'Escolha o banco' : !program ? 'Escolha o programa' : program.faixas && !faixa ? 'Escolha a linha / taxa de juros' : !foundClient ? 'Escolha o cliente' : ''}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Confirmar e continuar <ArrowRight className="w-4 h-4" /></>}
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <button onClick={() => runExclusive('PronafWizard.handleSaveProposta', () => handleSaveProposta())} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Salvar e ver resumo <ArrowRight className="w-4 h-4" /></>}
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar e editar</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => runExclusive('PronafWizard.pdf', () => handleGeneratePdf())} disabled={generatingPdf} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                    {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Gerar PDF (2 vias)
                  </button>
                  <button onClick={resetAndClose} className="px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm">Concluir</button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
