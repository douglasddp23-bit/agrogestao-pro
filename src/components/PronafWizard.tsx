import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { X, Search, User, CheckCircle2, ArrowRight, ArrowLeft, AlertCircle, Loader2, MapPin, Landmark, Home, ChevronDown, ChevronUp, Tractor, FileCheck2, ClipboardList, Plus, Trash2, Users, Percent, ShieldCheck, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { Client, ServiceAnalysis } from '../types';
import { cn, formatCPF, formatCurrency, todayLocalDateString } from '../lib/utils';
import { toast } from 'sonner';

// ======================================================================
// Estrutura de dados da "Planilha PRONAF" que vamos preenchendo aos poucos,
// etapa por etapa, dentro do sistema — espelhando a ordem da planilha oficial
// (Cliente > Avaliação de Bens > Proposta de Investimentos > Coordenadas
// Geodésicas > Atividades > Cronograma). Cada etapa concluída é salva na hora
// no próprio projeto de Crédito Rural (campo pronafData), então dá pra fechar
// e continuar depois de onde parou.
//
// Simplificações conscientes desta primeira versão (avisadas ao Douglas):
// - Município é texto livre (com sugestões) em vez de uma lista oficial com
//   código IBGE + bioma automático — isso não existe em lugar nenhum do
//   sistema ainda; feito à parte quando for necessário.
// - A lista de culturas agrícolas é uma sugestão comum (não o cadastro de
//   ~15 mil códigos do BACEN da planilha original).
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
  // geodesica?: {...}  -> Fase futura (Coordenadas Geodésicas)
}

const STEP_LABELS = ['Cliente', 'Proposta', 'Resumo'];
const newId = () => Math.random().toString(36).slice(2, 10);
const round2 = (n: number) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const floor2 = (n: number) => Math.floor(((n || 0) + Number.EPSILON) * 100) / 100;

// ======================================================================
// Fase 3 — Proposta / Plano de Negócio, espelhando a aba "Proposta" da
// planilha do Banco do Nordeste, integrada ao Cliente e à Avaliação de Bens.
//
// Simplificações conscientes desta primeira versão (avisadas ao Douglas):
// - Programa, Agência, Atividade Principal e Unidade/Uso do investimento
//   são um recorte comum das listas oficiais, não o cadastro completo do
//   BNB/SICOR (mesmo espírito da lista de culturas da Avaliação de Bens).
// - "Região" de cada imóvel é escolhida manualmente — o sistema ainda não
//   tem um mapeamento automático de município → região semi-árido.
// - Seção 10 (Declarações) traz as opções principais da planilha, mas sem
//   a lista legal completa de cargos da Pessoa Politicamente Exposta.
// - A Taxa de Elaboração/Assist. Técnica de itens de irrigação usa uma
//   base informada manualmente, já que os itens do Programa de
//   Investimentos ainda não têm uma marcação própria de "irrigação".
// ======================================================================

export const PROGRAMAS_PRONAF = [
  { code: '406', label: 'FNE/PRONAF MULHER' },
  { code: '417', label: 'FNE/PRONAF AGROECOLOGIA' },
  { code: '698', label: 'FNE/PRONAF COTAS-PARTES' },
  { code: '427', label: 'FNE/PRONAF ECO' },
  { code: '377', label: 'FNE/PRONAF FLORESTA' },
  { code: '407', label: 'FNE/PRONAF JOVEM' },
  { code: '434', label: 'FNE/PRONAF MAIS ALIMENTOS' },
  { code: '405', label: 'FNE/PRONAF SEMI-ÁRIDO' },
  { code: '615', label: 'PRONAF PRODUTIVO ORIENTADO' },
  { code: '398', label: 'FNE/PRONAF-AGROINDÚSTRIA' },
];
const OBJETIVOS_CREDITO = ['Ampliação', 'Expansão', 'Implantação', 'Modernização'];
const FINALIDADES_CREDITO = ['INVESTIMENTOS FIXOS', 'INVESTIMENTOS MISTOS', 'CUSTEIO VINCULADO'];
const UNIDADES_INVESTIMENTO = ['HA', 'CAB', 'UN', 'M', 'M2', 'M3', 'KG', 'CX', 'DOSE', 'H/TE', 'DÚZIA'];
const USOS_INVESTIMENTO = [
  'Aquis/Desenv. Software', 'Capital de Giro', 'Cobertura do Solo', 'Construções Civis',
  'Estudos e Projetos', 'Instalações', 'Juros de Implantação', 'Máq./Equip. Estrangeiros',
  'Máq./Equip. Nacionais', 'Móveis e Utensílios', 'Obras Preliminares', 'Outras Desp. Implantação',
  'Outras Inv. Financeiras', 'Outras Inversões', 'Ração e Volumoso', 'Sais Minerais',
  'Semoventes', 'Terrenos', 'Treinamento de Pessoal', 'Vacinas e Medicamentos', 'Veículos/Embarcações',
];
const REGIAO_OPTIONS = ['Semi-árido', 'Fora do Semi-árido'];
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
const PERIODICIDADE_OPTIONS = ['Anual', 'Semestral', 'Mensal', 'Única no Vencimento'];
const METODO_CALCULO_OPTIONS = ['Price', 'SAC', 'Sem Método (Parcela Única)'];

export interface ElaboradorInfo { empresa: string; cnpj: string; elaborador: string; cpfElaborador: string; }
const makeElaborador = (): ElaboradorInfo => ({ empresa: '', cnpj: '', elaborador: '', cpfElaborador: '' });

export interface DadosProposta {
  banco: string;
  dataProposta: string;
  objetivoCredito: string;
  programa: string;
  agencia: string;
  regiao: string;
  atividadePrincipal: string;
  municipioDecretoEmergencia: boolean;
  finalidadeCredito: string;
  producaoAgroecologica: boolean;
  origemPlanoTerritorial: boolean;
  elaborador: ElaboradorInfo;
}
const makeDadosProposta = (): DadosProposta => ({
  banco: '',
  dataProposta: todayLocalDateString(),
  objetivoCredito: '', programa: '', agencia: '', regiao: '',
  atividadePrincipal: '', municipioDecretoEmergencia: false,
  finalidadeCredito: 'INVESTIMENTOS FIXOS', producaoAgroecologica: false,
  origemPlanoTerritorial: false, elaborador: makeElaborador(),
});
const BANCOS_FINANCIADORES = ['Banco do Nordeste (BNB)', 'Banco do Brasil', 'Sicredi', 'Sicoob', 'Outro'];
function calcPrevisaoContrato(dataProposta: string) {
  if (!dataProposta) return '';
  const d = new Date(dataProposta + 'T00:00:00');
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

export interface ImovelVinculado { denominacao: string; municipio: string; uf: string; regiao: string; }
const makeImovelVinculado = (): ImovelVinculado => ({ denominacao: '', municipio: '', uf: '', regiao: '' });

export interface Imovel4Inversao { denominacao: string; municipio: string; uf: string; regiao: string; }
const makeImovel4Inversao = (): Imovel4Inversao => ({ denominacao: '', municipio: '', uf: '', regiao: '' });

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

export interface BasesFinanciamento {
  prazoMeses: number;
  carenciaMeses: number;
  jurosPctAa: number;
  rebatePctAa: number;
  delCrederePctAa: number;
  periodicidadeReembolso: string;
  periodicidadeJurosCarencia: string;
  periodicidadeJurosPrestacao: string;
  metodoCalculo: string;
}
const makeBasesFinanciamento = (): BasesFinanciamento => ({
  prazoMeses: 0, carenciaMeses: 0, jurosPctAa: 0, rebatePctAa: 0, delCrederePctAa: 0,
  periodicidadeReembolso: 'Anual', periodicidadeJurosCarencia: 'Anual', periodicidadeJurosPrestacao: 'Anual',
  metodoCalculo: 'Price',
});

export interface FinanciamentoExistente {
  id: string;
  denominacao: string;
  agenteFinanceiro: 'BNB' | 'Outros';
  saldoDevedor: number;
  mesmaAtividadeConjuge: boolean;
  pertenceTitular: boolean;
  jurosPctAa: number;
  carenciaMeses: number;
  prazoRestanteMeses: number;
  dataContratacao: string;
}
const makeFinanciamentoExistente = (): FinanciamentoExistente => ({
  id: newId(), denominacao: '', agenteFinanceiro: 'BNB', saldoDevedor: 0,
  mesmaAtividadeConjuge: false, pertenceTitular: true, jurosPctAa: 0,
  carenciaMeses: 0, prazoRestanteMeses: 0, dataContratacao: '',
});

export interface AvalistaFiador {
  tipo: 'Aval' | 'Fiança' | '';
  nome: string; cpfCnpj: string;
  conjugeNome: string; conjugeCpf: string;
}
const makeAvalistaFiador = (): AvalistaFiador => ({ tipo: '', nome: '', cpfCnpj: '', conjugeNome: '', conjugeCpf: '' });

export interface GarantiaReal { id: string; denominacao: string; tipo: string; valor: number; }
const makeGarantiaReal = (): GarantiaReal => ({ id: newId(), denominacao: '', tipo: 'Hipoteca', valor: 0 });

export interface IndicadoresSociais { empregadosAtual: number; empregadosEstabilizacao: number; }
const makeIndicadoresSociais = (): IndicadoresSociais => ({ empregadosAtual: 0, empregadosEstabilizacao: 0 });
function calcInvestimentoPorEmpregado(indicadores: IndicadoresSociais, investimentoTotal: number) {
  return indicadores.empregadosEstabilizacao > 0 ? investimentoTotal / indicadores.empregadosEstabilizacao : 0;
}

export interface TextosProposta { comentarios: string; parecerTecnico: string; }
const makeTextosProposta = (): TextosProposta => ({ comentarios: '', parecerTecnico: '' });

export interface OperacaoExistenteBNB {
  id: string; bancoCooperativa: string; dataContratoOuRenovacao: string; valorContrato: number;
  fonteRecursos: string; bonus200: boolean; bonus700: boolean; saldoDevedor: number;
}
const makeOperacaoExistenteBNB = (): OperacaoExistenteBNB => ({
  id: newId(), bancoCooperativa: '', dataContratoOuRenovacao: '', valorContrato: 0,
  fonteRecursos: '', bonus200: false, bonus700: false, saldoDevedor: 0,
});

export interface DeclaracoesProposta {
  respondePorOperacoes: 'nao' | 'sim' | '';
  operacoesExistentesBNB: OperacaoExistenteBNB[];
  bonus700Situacao: 'primeira' | 'enesima_sem_bonus' | 'enesima_com_bonus' | '';
  numeroOperacao: number;
  renegociacaoMp432: 'nao' | 'amortizou' | '';
  anoRenegociacao: number;
  ppe: 'enquadro' | 'nao_enquadro' | '';
  metodologiaJuros: 'prefixada' | 'posfixada' | '';
}
const makeDeclaracoesProposta = (): DeclaracoesProposta => ({
  respondePorOperacoes: '', operacoesExistentesBNB: [makeOperacaoExistenteBNB()],
  bonus700Situacao: '', numeroOperacao: 1, renegociacaoMp432: '', anoRenegociacao: new Date().getFullYear(),
  ppe: '', metodologiaJuros: '',
});

export interface PronafProposta {
  dados: DadosProposta;
  imoveisVinculados: ImovelVinculado[];
  imovel4: Imovel4Inversao;
  programaInvestimentos: ProgramaInvestimentos;
  basesFinanciamento: BasesFinanciamento;
  financiamentosExistentes: FinanciamentoExistente[];
  avalistas: [AvalistaFiador, AvalistaFiador];
  garantiasReaisExtras: GarantiaReal[];
  indicadores: IndicadoresSociais;
  textos: TextosProposta;
  declaracoes: DeclaracoesProposta;
}
const makePronafProposta = (): PronafProposta => ({
  dados: makeDadosProposta(),
  imoveisVinculados: [makeImovelVinculado()],
  imovel4: makeImovel4Inversao(),
  programaInvestimentos: makeProgramaInvestimentos(),
  basesFinanciamento: makeBasesFinanciamento(),
  financiamentosExistentes: [makeFinanciamentoExistente()],
  avalistas: [makeAvalistaFiador(), makeAvalistaFiador()],
  garantiasReaisExtras: [],
  indicadores: makeIndicadoresSociais(),
  textos: makeTextosProposta(),
  declaracoes: makeDeclaracoesProposta(),
});

function imoveisInversaoRows(proposta: PronafProposta) {
  const rows: { n: number; denominacao: string; municipioUf: string; regiao: string }[] = [];
  proposta.imoveisVinculados.forEach((info, idx) => {
    if ((info.denominacao || '').trim()) rows.push({ n: idx + 1, denominacao: info.denominacao, municipioUf: `${info.municipio}-${info.uf}`, regiao: info.regiao });
  });
  const imovel4 = proposta.imovel4;
  if ((imovel4.denominacao || '').trim() && (imovel4.municipio || '').trim()) rows.push({ n: 4, denominacao: imovel4.denominacao, municipioUf: `${imovel4.municipio}-${imovel4.uf}`, regiao: imovel4.regiao });
  return rows;
}

function resumoGarantias(proposta: PronafProposta) {
  const reaisPreExistentes = proposta.garantiasReaisExtras.reduce((a, g) => a + (g.valor || 0), 0);
  const reaisEvolutivas = subtotalInvestimento(proposta.programaInvestimentos.itens).garantiaEvolutiva;
  const fidejussorias = 0; // avais/fianças não têm valor monetário próprio na planilha original
  const total = fidejussorias + reaisPreExistentes + reaisEvolutivas;
  const financTotal = calcTotalGeralInvestimentos(proposta.programaInvestimentos).financiamento;
  const pctGarantias = financTotal > 0 ? total / financTotal : 0;
  return { fidejussorias, reaisPreExistentes, reaisEvolutivas, total, pctGarantias };
}

interface PronafWizardProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  existingProject?: ServiceAnalysis | null;
  onSaved?: () => void;
}

// ---------- Sub-componentes de UI reutilizados na Proposta e no Resumo ----------
function SectionAccordion({ id, expanded, onToggle, icon, title, badge, children }: { id: string; expanded: boolean; onToggle: () => void; icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode }) {
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

export default function PronafWizard({ isOpen, onClose, clients, existingProject, onSaved }: PronafWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cpfInput, setCpfInput] = useState('');
  const [foundClient, setFoundClient] = useState<Client | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposta, setProposta] = useState<PronafProposta>(makePronafProposta());
  const [expandedPropostaSection, setExpandedPropostaSection] = useState<string | null>('dados');

  useEffect(() => {
    if (!isOpen) return;
    if (existingProject) {
      const pronafData: PronafData = (existingProject as any).pronafData || {};
      setProjectId(existingProject.id);
      if (pronafData.cliente) {
        const clienteMatch = clients.find(c => c.id === pronafData.cliente!.clientId) || null;
        setFoundClient(clienteMatch);
        setCpfInput(pronafData.cliente.cpfCnpj || '');
      }
      if (pronafData.proposta) {
        // Reabrir uma proposta já iniciada sempre leva de volta pro formulário
        // editável da Proposta — igual a quando ela foi preenchida da primeira
        // vez — e não direto pro Resumo, pra dar pra continuar ajustando.
        const propostaCarregada = pronafData.proposta;
        if (!propostaCarregada.dados.banco && (existingProject as any).bank) {
          // Propostas salvas antes do campo "Banco" existir: recupera o banco
          // que já estava gravado no projeto, pra não aparecer em branco.
          propostaCarregada.dados = { ...propostaCarregada.dados, banco: (existingProject as any).bank };
        }
        setProposta(propostaCarregada);
        setStep(2);
      } else if (pronafData.cliente) {
        const nova = makePronafProposta();
        nova.dados.banco = (existingProject as any).bank || '';
        nova.imoveisVinculados[0] = {
          ...nova.imoveisVinculados[0],
          denominacao: pronafData.cliente.propriedades?.[0]?.name || '',
          municipio: pronafData.cliente.municipio || '',
          uf: pronafData.cliente.uf || '',
        };
        setProposta(nova);
        setStep(2);
      } else {
        setStep(1);
      }
    } else {
      setStep(1);
      setProjectId(null);
      setCpfInput('');
      setFoundClient(null);
      setSearchAttempted(false);
      setProposta(makePronafProposta());
      setExpandedPropostaSection('dados');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, existingProject, clients]);

  const resetAndClose = () => {
    setStep(1);
    setProjectId(null);
    setCpfInput('');
    setFoundClient(null);
    setSearchAttempted(false);
    setProposta(makePronafProposta());
    onClose();
  };

  const addImovelVinculado = () => setProposta(prev => {
    if (prev.imoveisVinculados.length >= 3) return prev;
    return { ...prev, imoveisVinculados: [...prev.imoveisVinculados, makeImovelVinculado()] };
  });
  const removeImovelVinculado = (idx: number) => setProposta(prev => {
    if (prev.imoveisVinculados.length <= 1 || idx !== prev.imoveisVinculados.length - 1) return prev;
    return { ...prev, imoveisVinculados: prev.imoveisVinculados.filter((_, i) => i !== idx) };
  });
  const updateImovelVinculado = (idx: number, patch: Partial<ImovelVinculado>) => setProposta(prev => {
    const lista = [...prev.imoveisVinculados];
    lista[idx] = { ...lista[idx], ...patch };
    return { ...prev, imoveisVinculados: lista };
  });

  const handleSearchCpf = (value: string) => {
    const formatted = formatCPF(value);
    setCpfInput(formatted);
    const digits = formatted.replace(/\D/g, '');
    if (digits.length === 11) {
      const match = clients.find(c => (c.cpf || '').replace(/\D/g, '') === digits);
      setFoundClient(match || null);
      setSearchAttempted(true);
    } else {
      setFoundClient(null);
      setSearchAttempted(false);
    }
  };

  const handleConfirmClient = async () => {
    if (!foundClient || !user) return;
    if (!projectId && !proposta.dados.banco) {
      toast.error('Selecione o banco financiador antes de continuar.');
      return;
    }
    setSaving(true);
    try {
      const pronafCliente: PronafCliente = {
        clientId: foundClient.id,
        nome: foundClient.name,
        cpfCnpj: foundClient.cpf,
        tipoCliente: 'PF',
        endereco: `${foundClient.address?.street || ''}, ${foundClient.address?.number || ''}`.trim(),
        municipio: foundClient.address?.city || '',
        uf: foundClient.address?.state || '',
        telefone: foundClient.phone || '',
        email: foundClient.ownerEmail || '',
        propriedades: foundClient.properties || [],
      };

      // Pré-preenche o Imóvel 1 (Seção 2 da Proposta) com os dados do cliente,
      // pra economizar digitação na próxima etapa (ele pode ajustar depois).
      setProposta(prev => {
        const lista = [...prev.imoveisVinculados];
        lista[0] = {
          ...lista[0],
          denominacao: lista[0].denominacao || foundClient.properties?.[0]?.name || '',
          municipio: lista[0].municipio || foundClient.address?.city || '',
          uf: lista[0].uf || foundClient.address?.state || '',
        };
        return { ...prev, imoveisVinculados: lista };
      });

      if (projectId) {
        await updateDoc(doc(db, 'analyses', projectId), {
          'pronafData.cliente': pronafCliente,
          clientId: foundClient.id,
          clientName: foundClient.name,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const newDoc = await addDoc(collection(db, 'analyses'), {
          clientId: foundClient.id,
          clientName: foundClient.name,
          propertyName: foundClient.properties?.[0]?.name || '',
          type: 'credit',
          status: 'Pendente',
          description: 'Proposta PRONAF (Procedimento Simplificado)',
          value: 0,
          cost: 0,
          bank: proposta.dados.banco || 'Banco do Nordeste (BNB)',
          financingType: 'PRONAF',
          category: 'Agricultura',
          scheduledDate: todayLocalDateString(),
          responsibleTechnician: user?.displayName || '',
          pronafData: { cliente: pronafCliente },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assignedTo: user?.uid || ''
        });
        setProjectId(newDoc.id);
        await createNotification(user.uid, 'Nova Proposta PRONAF', `Proposta PRONAF iniciada para ${foundClient.name}.`, 'success', 'analysis_credit');
      }

      toast.success('Cliente confirmado. Seguindo para a Proposta.');
      onSaved?.();
      setStep(2);
    } catch (error) {
      console.error('Erro ao salvar Proposta PRONAF:', error);
      toast.error('Não foi possível salvar. Verifique sua conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };


  // --- updaters da Proposta / Plano de Negócio ---
  const updateDadosProposta = (patch: Partial<DadosProposta>) => setProposta(prev => ({ ...prev, dados: { ...prev.dados, ...patch } }));
  const updateElaborador = (patch: Partial<ElaboradorInfo>) => setProposta(prev => ({ ...prev, dados: { ...prev.dados, elaborador: { ...prev.dados.elaborador, ...patch } } }));
  const updateImovel4Proposta = (patch: Partial<Imovel4Inversao>) => setProposta(prev => ({ ...prev, imovel4: { ...prev.imovel4, ...patch } }));

  const updateInvestItem = (idx: number, patch: Partial<InvestimentoItem>) => setProposta(prev => {
    const itens = [...prev.programaInvestimentos.itens];
    itens[idx] = { ...itens[idx], ...patch };
    return { ...prev, programaInvestimentos: { ...prev.programaInvestimentos, itens } };
  });
  const addInvestItem = () => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, itens: [...prev.programaInvestimentos.itens, makeInvestimentoItem()] } }));
  const removeInvestItem = (idx: number) => setProposta(prev => {
    if (prev.programaInvestimentos.itens.length <= 1) return prev;
    return { ...prev, programaInvestimentos: { ...prev.programaInvestimentos, itens: prev.programaInvestimentos.itens.filter((_, i) => i !== idx) } };
  });
  const updateCusteioAgricola = (patch: Partial<CusteioVinculado>) => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, custeioAgricola: { ...prev.programaInvestimentos.custeioAgricola, ...patch } } }));
  const updateCusteioPecuario = (patch: Partial<CusteioVinculado>) => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, custeioPecuario: { ...prev.programaInvestimentos.custeioPecuario, ...patch } } }));
  const updateCustoAssessoria = (patch: Partial<CustoAssessoria>) => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, custoAssessoria: { ...prev.programaInvestimentos.custoAssessoria, ...patch } } }));
  const updateTaxaElaboracao = (patch: Partial<TaxaElaboracaoIrrigacao>) => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, taxaElaboracaoIrrigacao: { ...prev.programaInvestimentos.taxaElaboracaoIrrigacao, ...patch } } }));
  const updateLinhaAdicional = (patch: Partial<LinhaAdicionalCusto>) => setProposta(prev => ({ ...prev, programaInvestimentos: { ...prev.programaInvestimentos, linhaAdicional: { ...prev.programaInvestimentos.linhaAdicional, ...patch } } }));

  const updateBasesFinanciamento = (patch: Partial<BasesFinanciamento>) => setProposta(prev => ({ ...prev, basesFinanciamento: { ...prev.basesFinanciamento, ...patch } }));

  const updateFinanciamentoExistente = (idx: number, patch: Partial<FinanciamentoExistente>) => setProposta(prev => {
    const lista = [...prev.financiamentosExistentes];
    lista[idx] = { ...lista[idx], ...patch };
    return { ...prev, financiamentosExistentes: lista };
  });
  const addFinanciamentoExistente = () => setProposta(prev => ({ ...prev, financiamentosExistentes: [...prev.financiamentosExistentes, makeFinanciamentoExistente()] }));
  const removeFinanciamentoExistente = (idx: number) => setProposta(prev => {
    if (prev.financiamentosExistentes.length <= 1) return prev;
    return { ...prev, financiamentosExistentes: prev.financiamentosExistentes.filter((_, i) => i !== idx) };
  });

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

  const updateIndicadores = (patch: Partial<IndicadoresSociais>) => setProposta(prev => ({ ...prev, indicadores: { ...prev.indicadores, ...patch } }));
  const updateTextos = (patch: Partial<TextosProposta>) => setProposta(prev => ({ ...prev, textos: { ...prev.textos, ...patch } }));

  const updateDeclaracoes = (patch: Partial<DeclaracoesProposta>) => setProposta(prev => ({ ...prev, declaracoes: { ...prev.declaracoes, ...patch } }));
  const updateOperacaoBNB = (idx: number, patch: Partial<OperacaoExistenteBNB>) => setProposta(prev => {
    const lista = [...prev.declaracoes.operacoesExistentesBNB];
    lista[idx] = { ...lista[idx], ...patch };
    return { ...prev, declaracoes: { ...prev.declaracoes, operacoesExistentesBNB: lista } };
  });
  const addOperacaoBNB = () => setProposta(prev => {
    if (prev.declaracoes.operacoesExistentesBNB.length >= 10) return prev;
    return { ...prev, declaracoes: { ...prev.declaracoes, operacoesExistentesBNB: [...prev.declaracoes.operacoesExistentesBNB, makeOperacaoExistenteBNB()] } };
  });
  const removeOperacaoBNB = (idx: number) => setProposta(prev => {
    if (prev.declaracoes.operacoesExistentesBNB.length <= 1) return prev;
    return { ...prev, declaracoes: { ...prev.declaracoes, operacoesExistentesBNB: prev.declaracoes.operacoesExistentesBNB.filter((_, i) => i !== idx) } };
  });

  const handleSaveProposta = async () => {
    if (!projectId) return;
    if (!proposta.dados.dataProposta) {
      toast.error('Informe a Data da Proposta.');
      return;
    }
    if (!proposta.dados.objetivoCredito || !proposta.dados.programa) {
      toast.error('Informe o Objetivo do Crédito e o Programa.');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'analyses', projectId), {
        'pronafData.proposta': proposta,
        value: calcTotalGeralInvestimentos(proposta.programaInvestimentos).investimentoTotal,
        bank: proposta.dados.banco || 'Banco do Nordeste (BNB)',
        updatedAt: new Date().toISOString(),
      });
      toast.success('Proposta / Plano de Negócio salva.');
      onSaved?.();
      setStep(3);
    } catch (error) {
      console.error('Erro ao salvar Proposta:', error);
      toast.error('Não foi possível salvar. Verifique sua conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => window.print();

  if (!isOpen) return null;

  const headerSubtitle =
    step === 1 ? 'Etapa 1 de 3 · Identificação do Cliente' :
    step === 2 ? 'Etapa 2 de 3 · Proposta / Plano de Negócio' :
    'Etapa 3 de 3 · Resumo e Impressão';

  const linhasImovelInversao = imoveisInversaoRows(proposta);
  const totalGeralInvest = calcTotalGeralInvestimentos(proposta.programaInvestimentos);
  const resumoGar = resumoGarantias(proposta);

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
          className={cn(
            "bg-white rounded-2xl shadow-2xl w-full overflow-hidden max-h-[92vh] flex flex-col transition-all",
            step === 2 || step === 3 ? "max-w-6xl" : "max-w-lg"
          )}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-lg leading-tight">Proposta PRONAF</h2>
                <p className="text-emerald-100 text-xs">{headerSubtitle}{foundClient ? ` · Cliente: ${(foundClient.name || '').toUpperCase()}` : ''}</p>
              </div>
            </div>
            <button onClick={resetAndClose} className="text-white/80 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="px-6 pt-4 flex items-center gap-1.5 shrink-0">
            {STEP_LABELS.map((label, idx) => (
              <div key={label} className="flex-1">
                <div className={cn("h-1.5 rounded-full", idx < step ? "bg-emerald-500" : "bg-slate-200")} />
                <p className={cn("text-[10px] mt-1 text-center", idx < step ? "text-emerald-700 font-medium" : "text-slate-400")}>{label}</p>
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto custom-scrollbar">
            {step === 1 && (
              <>
                <p className="text-sm text-slate-600 mb-4">
                  Digite o CPF do cliente. Se ele já estiver cadastrado na aba <strong>Clientes</strong>, os dados são puxados automaticamente — não precisa digitar tudo de novo.
                </p>

                <label className="text-xs font-medium text-slate-500 mb-1.5 block">Banco Financiador</label>
                <select
                  value={proposta.dados.banco}
                  onChange={(e) => updateDadosProposta({ banco: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium bg-white mb-4"
                >
                  <option value="">Selecione o banco...</option>
                  {BANCOS_FINANCIADORES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>

                <label className="text-xs font-medium text-slate-500 mb-1.5 block">CPF do Cliente</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cpfInput}
                    onChange={(e) => handleSearchCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    autoFocus
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium tracking-wide"
                  />
                </div>
                <AnimatePresence mode="wait">
                  {foundClient && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><User className="w-5 h-5" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 flex items-center gap-1.5">{foundClient.name}<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /></p>
                          <p className="text-xs text-slate-500 mt-0.5">CPF: {foundClient.cpf}</p>
                          {foundClient.address?.city && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {foundClient.address.city}/{foundClient.address.state}</p>}
                          {foundClient.properties?.length > 0 && <p className="text-xs text-slate-500 mt-0.5">{foundClient.properties.length} propriedade(s) cadastrada(s)</p>}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {searchAttempted && !foundClient && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Cliente não encontrado</p>
                        <p className="text-xs text-amber-700 mt-0.5">Esse CPF ainda não está cadastrado na aba Clientes. Cadastre o cliente primeiro e volte aqui.</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between bg-emerald-600 text-white rounded-2xl px-5 py-3.5 sticky top-0 z-10 shadow-lg flex-wrap gap-2">
                  <span className="text-sm font-medium">Investimento Total da Proposta</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span>Rec. Próprios: <strong>{formatCurrency(totalGeralInvest.recProprios)}</strong></span>
                    <span>Financiamento: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                    <span className="text-sm">Total: <strong>{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                  </div>
                </div>

                {/* Seção 1 - Dados da Proposta */}
                <SectionAccordion id="dados" expanded={expandedPropostaSection === 'dados'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'dados' ? null : 'dados')} icon={<Landmark className="w-4 h-4 text-emerald-600" />} title="Seção 1 · Dados da Proposta">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Cliente</label>
                      <p className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-600 truncate">{foundClient?.name?.toUpperCase() || '—'}</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Data da Proposta</label>
                      <input type="date" value={proposta.dados.dataProposta} onChange={(e) => updateDadosProposta({ dataProposta: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Previsão do Contrato</label>
                      <p className="px-2.5 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs font-semibold text-emerald-700">{calcPrevisaoContrato(proposta.dados.dataProposta) ? new Date(calcPrevisaoContrato(proposta.dados.dataProposta) + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Objetivo do Crédito</label>
                      <select value={proposta.dados.objetivoCredito} onChange={(e) => updateDadosProposta({ objetivoCredito: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="">Selecione</option>
                        {OBJETIVOS_CREDITO.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Programa</label>
                      <select value={proposta.dados.programa} onChange={(e) => updateDadosProposta({ programa: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="">Selecione</option>
                        {PROGRAMAS_PRONAF.map(p => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Banco Financiador</label>
                      <select value={proposta.dados.banco} onChange={(e) => updateDadosProposta({ banco: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="">Selecione</option>
                        {BANCOS_FINANCIADORES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Agência</label>
                      <input value={proposta.dados.agencia} onChange={(e) => updateDadosProposta({ agencia: e.target.value })} placeholder="Agência" className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Região</label>
                      <select value={proposta.dados.regiao} onChange={(e) => updateDadosProposta({ regiao: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="">Selecione</option>
                        {REGIAO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Atividade Principal</label>
                      <input value={proposta.dados.atividadePrincipal} onChange={(e) => updateDadosProposta({ atividadePrincipal: e.target.value })} placeholder="Atividade Principal" className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Finalidade do Crédito</label>
                      <select value={proposta.dados.finalidadeCredito} onChange={(e) => updateDadosProposta({ finalidadeCredito: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                        {FINALIDADES_CREDITO.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-1">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={proposta.dados.municipioDecretoEmergencia} onChange={(e) => updateDadosProposta({ municipioDecretoEmergencia: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Município com Decreto de Emergência?</label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={proposta.dados.producaoAgroecologica} onChange={(e) => updateDadosProposta({ producaoAgroecologica: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Produção de Base Agroecológica/Orgânica?</label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={proposta.dados.origemPlanoTerritorial} onChange={(e) => updateDadosProposta({ origemPlanoTerritorial: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Proposta com origem em planos de ação territorial?</label>
                  </div>
                  <p className="text-[11px] font-semibold text-slate-500 mt-2 mb-1">Empresa Elaboradora (opcional)</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input value={proposta.dados.elaborador.empresa} onChange={(e) => updateElaborador({ empresa: e.target.value })} placeholder="Empresa Elaboradora" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    <input value={proposta.dados.elaborador.cnpj} onChange={(e) => updateElaborador({ cnpj: e.target.value })} placeholder="CNPJ" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    <input value={proposta.dados.elaborador.elaborador} onChange={(e) => updateElaborador({ elaborador: e.target.value })} placeholder="Elaborador" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    <input value={proposta.dados.elaborador.cpfElaborador} onChange={(e) => updateElaborador({ cpfElaborador: formatCPF(e.target.value) })} placeholder="CPF do Elaborador" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                  </div>
                </SectionAccordion>

                {/* Seção 2 - Imóvel onde serão realizadas as inversões */}
                <SectionAccordion id="imoveis-inversao" expanded={expandedPropostaSection === 'imoveis-inversao'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'imoveis-inversao' ? null : 'imoveis-inversao')} icon={<Home className="w-4 h-4 text-emerald-600" />} title="Seção 2 · Imóvel onde Serão Realizadas as Inversões">
                  <div className="flex flex-col gap-2">
                    {proposta.imoveisVinculados.map((info, idx) => (
                      <div key={idx} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-600">{idx === 0 ? 'Imóvel Principal' : `Imóvel ${idx + 1}`}</p>
                          {idx > 0 && idx === proposta.imoveisVinculados.length - 1 && (
                            <button type="button" onClick={() => removeImovelVinculado(idx)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500">
                              <Trash2 className="w-3.5 h-3.5" /> Remover
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <input value={info.denominacao} onChange={(e) => updateImovelVinculado(idx, { denominacao: e.target.value.slice(0, 40) })} placeholder="Denominação" className="col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                          <input value={info.municipio} onChange={(e) => updateImovelVinculado(idx, { municipio: e.target.value })} placeholder="Município" list="municipios-sugestoes" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                          <input value={info.uf} maxLength={2} onChange={(e) => updateImovelVinculado(idx, { uf: e.target.value.toUpperCase() })} placeholder="UF" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs uppercase" />
                          <select value={info.regiao} onChange={(e) => updateImovelVinculado(idx, { regiao: e.target.value })} className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                            <option value="">Região</option>
                            {REGIAO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                    {proposta.imoveisVinculados.length < 3 && (
                      <button
                        type="button"
                        onClick={addImovelVinculado}
                        disabled={!proposta.imoveisVinculados[proposta.imoveisVinculados.length - 1]?.denominacao?.trim()}
                        className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:text-slate-300 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" /> Adicionar outro imóvel
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-slate-500 mt-2 mb-1">Imóvel 4 (opcional — usado também nas Seções 8 e 9)</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input value={proposta.imovel4.denominacao} onChange={(e) => updateImovel4Proposta({ denominacao: e.target.value })} placeholder="Denominação" className="col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    <input value={proposta.imovel4.municipio} onChange={(e) => updateImovel4Proposta({ municipio: e.target.value })} placeholder="Município" list="municipios-sugestoes" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                    <input value={proposta.imovel4.uf} maxLength={2} onChange={(e) => updateImovel4Proposta({ uf: e.target.value.toUpperCase() })} placeholder="UF" className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs uppercase" />
                    <select value={proposta.imovel4.regiao} onChange={(e) => updateImovel4Proposta({ regiao: e.target.value })} className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">
                      <option value="">Região</option>
                      {REGIAO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <datalist id="municipios-sugestoes">
                    {Array.from(new Set(clients.map(c => c.address?.city).filter(Boolean))).map(city => <option key={city} value={city} />)}
                  </datalist>
                </SectionAccordion>

                {/* Seção 3 - Programa de Investimentos */}
                <SectionAccordion id="investimentos" expanded={expandedPropostaSection === 'investimentos'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'investimentos' ? null : 'investimentos')} icon={<Tractor className="w-4 h-4 text-emerald-600" />} title="Seção 3 · Programa de Investimentos" badge={formatCurrency(subtotalInvestimento(proposta.programaInvestimentos.itens).total)}>
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
                            <option value={0}>Nº Imóvel: 0</option>
                            {linhasImovelInversao.map(r => <option key={r.n} value={r.n}>Imóvel {r.n}</option>)}
                          </select>
                          <select value={item.uso} onChange={(e) => updateInvestItem(i, { uso: e.target.value })} className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                            <option value="">Uso</option>
                            {USOS_INVESTIMENTO.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <input type="number" value={item.quantidade || ''} onChange={(e) => updateInvestItem(i, { quantidade: Number(e.target.value) })} placeholder="Quant." className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={item.valorUnitario || ''} onChange={(e) => updateInvestItem(i, { valorUnitario: Number(e.target.value) })} placeholder="Vr. Unitário" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={item.recProprioUnitario || ''} onChange={(e) => updateInvestItem(i, { recProprioUnitario: Number(e.target.value) })} placeholder="Rec. Próprio Unit." className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={item.componeGarantia} onChange={(e) => updateInvestItem(i, { componeGarantia: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Compõe Garantia?</label>
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 mt-1.5 text-[11px] text-slate-500">
                          <span>Rec. Próprio: <strong>{formatCurrency(calcRecursoProprioTotalItem(item))}</strong></span>
                          <span>Financiamento: <strong>{formatCurrency(calcValorFinanciamentoItem(item))}</strong></span>
                          <span>Investimento Total: <strong className="text-emerald-700">{formatCurrency(calcInvestimentoTotalItem(item))}</strong></span>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={addInvestItem} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar item</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-emerald-50 rounded-lg p-2.5 mt-1 text-xs">
                    <span>Rec. Próprios: <strong>{formatCurrency(subtotalInvestimento(proposta.programaInvestimentos.itens).recProprios)}</strong></span>
                    <span>Financiamento: <strong>{formatCurrency(subtotalInvestimento(proposta.programaInvestimentos.itens).financiamento)}</strong></span>
                    <span>Investimento Total: <strong>{formatCurrency(subtotalInvestimento(proposta.programaInvestimentos.itens).total)}</strong></span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    <div className="rounded-lg border border-slate-100 p-2.5">
                      <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Custeio Agrícola vinculado ao investimento</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="number" value={proposta.programaInvestimentos.custeioAgricola.valor || ''} onChange={(e) => updateCusteioAgricola({ valor: Number(e.target.value) })} placeholder="Valor" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input type="number" value={proposta.programaInvestimentos.custeioAgricola.recProprios || ''} onChange={(e) => updateCusteioAgricola({ recProprios: Number(e.target.value) })} placeholder="Rec. Próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      </div>
                      <p className="text-[11px] text-slate-500 text-right mt-1">Financ.: <strong>{formatCurrency(calcCusteioFinanc(proposta.programaInvestimentos.custeioAgricola))}</strong></p>
                    </div>
                    <div className="rounded-lg border border-slate-100 p-2.5">
                      <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Custeio Pecuário vinculado ao investimento</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="number" value={proposta.programaInvestimentos.custeioPecuario.valor || ''} onChange={(e) => updateCusteioPecuario({ valor: Number(e.target.value) })} placeholder="Valor" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input type="number" value={proposta.programaInvestimentos.custeioPecuario.recProprios || ''} onChange={(e) => updateCusteioPecuario({ recProprios: Number(e.target.value) })} placeholder="Rec. Próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      </div>
                      <p className="text-[11px] text-slate-500 text-right mt-1">Financ.: <strong>{formatCurrency(calcCusteioFinanc(proposta.programaInvestimentos.custeioPecuario))}</strong></p>
                    </div>
                  </div>

                  <div className="flex justify-end text-xs text-slate-500 mt-1">SUBTOTAL do Financiamento: <span className="font-semibold text-slate-700 ml-1">{formatCurrency(subtotalFinanciamentoGeral(proposta.programaInvestimentos).financiamento)}</span></div>

                  <div className="rounded-lg border border-slate-100 p-2.5 mt-2">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Custo de Assessoria Empresarial e Técnica (máx. 2%)</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <select value={proposta.programaInvestimentos.custoAssessoria.tipo} onChange={(e) => updateCustoAssessoria({ tipo: e.target.value as 'percentual' | 'valor' })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="percentual">Percentual (%)</option>
                        <option value="valor">Valor Fixo (R$)</option>
                      </select>
                      <input type="number" value={proposta.programaInvestimentos.custoAssessoria.percentualOuValor || ''} onChange={(e) => updateCustoAssessoria({ percentualOuValor: Number(e.target.value) })} placeholder={proposta.programaInvestimentos.custoAssessoria.tipo === 'percentual' ? '%' : 'R$'} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      <input type="number" value={proposta.programaInvestimentos.custoAssessoria.recProprios || ''} onChange={(e) => updateCustoAssessoria({ recProprios: Number(e.target.value) })} placeholder="Rec. Próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <p className="text-[11px] text-slate-500 text-right mt-1">Valor: <strong>{formatCurrency(calcCustoAssessoriaValor(proposta.programaInvestimentos))}</strong> · Financ.: <strong>{formatCurrency(calcCustoAssessoriaFinanc(proposta.programaInvestimentos))}</strong></p>
                  </div>

                  <div className="rounded-lg border border-slate-100 p-2.5 mt-2">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Tx. Elaboração + Assistência Técnica (itens de irrigação)</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="number" value={proposta.programaInvestimentos.taxaElaboracaoIrrigacao.percentual || ''} onChange={(e) => updateTaxaElaboracao({ percentual: Number(e.target.value) })} placeholder="Percentual (%)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      <input type="number" value={proposta.programaInvestimentos.taxaElaboracaoIrrigacao.baseIrrigacaoValor || ''} onChange={(e) => updateTaxaElaboracao({ baseIrrigacaoValor: Number(e.target.value) })} placeholder="Base dos itens de irrigação (R$)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <p className="text-[11px] text-slate-500 text-right mt-1">Valor: <strong>{formatCurrency(calcTaxaElaboracaoValor(proposta.programaInvestimentos))}</strong></p>
                  </div>

                  <div className="rounded-lg border border-slate-100 p-2.5 mt-2">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Linha Adicional Livre</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input value={proposta.programaInvestimentos.linhaAdicional.descricao} onChange={(e) => updateLinhaAdicional({ descricao: e.target.value })} placeholder="Descrição" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      <input type="number" value={proposta.programaInvestimentos.linhaAdicional.valor || ''} onChange={(e) => updateLinhaAdicional({ valor: Number(e.target.value) })} placeholder="Valor" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      <input type="number" value={proposta.programaInvestimentos.linhaAdicional.recProprios || ''} onChange={(e) => updateLinhaAdicional({ recProprios: Number(e.target.value) })} placeholder="Rec. Próprios" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                    </div>
                    <p className="text-[11px] text-slate-500 text-right mt-1">Financ.: <strong>{formatCurrency(calcLinhaAdicionalFinanc(proposta.programaInvestimentos))}</strong></p>
                  </div>

                  <div className="flex items-center justify-between bg-emerald-600 text-white rounded-xl p-3 mt-2 flex-wrap gap-2">
                    <span className="text-sm font-semibold">TOTAL GERAL</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Rec. Próprios: <strong>{formatCurrency(totalGeralInvest.recProprios)}</strong></span>
                      <span>Financiamento: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                      <span className="text-sm">Investimento Total: <strong>{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                    </div>
                  </div>
                </SectionAccordion>

                {/* Seção 4 - Bases do Financiamento */}
                <SectionAccordion id="bases" expanded={expandedPropostaSection === 'bases'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'bases' ? null : 'bases')} icon={<FileCheck2 className="w-4 h-4 text-emerald-600" />} title="Seção 4 · Bases do Financiamento">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Prazo (meses)</label><input type="number" value={proposta.basesFinanciamento.prazoMeses || ''} onChange={(e) => updateBasesFinanciamento({ prazoMeses: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Carência (meses)</label><input type="number" value={proposta.basesFinanciamento.carenciaMeses || ''} onChange={(e) => updateBasesFinanciamento({ carenciaMeses: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Juros (% a.a.)</label><input type="number" value={proposta.basesFinanciamento.jurosPctAa || ''} onChange={(e) => updateBasesFinanciamento({ jurosPctAa: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Rebate (% a.a.)</label><input type="number" value={proposta.basesFinanciamento.rebatePctAa || ''} onChange={(e) => updateBasesFinanciamento({ rebatePctAa: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Del Credere (% a.a.)</label><input type="number" value={proposta.basesFinanciamento.delCrederePctAa || ''} onChange={(e) => updateBasesFinanciamento({ delCrederePctAa: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Periodicidade do Reembolso</label><select value={proposta.basesFinanciamento.periodicidadeReembolso} onChange={(e) => updateBasesFinanciamento({ periodicidadeReembolso: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">{PERIODICIDADE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Periodicidade Juros (Carência)</label><select value={proposta.basesFinanciamento.periodicidadeJurosCarencia} onChange={(e) => updateBasesFinanciamento({ periodicidadeJurosCarencia: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">{PERIODICIDADE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Periodicidade Juros (Prestação)</label><select value={proposta.basesFinanciamento.periodicidadeJurosPrestacao} onChange={(e) => updateBasesFinanciamento({ periodicidadeJurosPrestacao: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">{PERIODICIDADE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Método de Cálculo</label><select value={proposta.basesFinanciamento.metodoCalculo} onChange={(e) => updateBasesFinanciamento({ metodoCalculo: e.target.value })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white">{METODO_CALCULO_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                  </div>
                </SectionAccordion>

                {/* Seção 5 - Financiamentos Existentes */}
                <SectionAccordion id="financ-existentes" expanded={expandedPropostaSection === 'financ-existentes'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'financ-existentes' ? null : 'financ-existentes')} icon={<AlertCircle className="w-4 h-4 text-emerald-600" />} title="Seção 5 · Financiamentos Existentes">
                  <div className="flex flex-col gap-1.5">
                    {proposta.financiamentosExistentes.map((f, i) => (
                      <div key={f.id} className="rounded-lg border border-slate-200 p-2.5 bg-slate-50">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">Financiamento {i + 1}</span>
                          <button type="button" onClick={() => removeFinanciamentoExistente(i)} disabled={proposta.financiamentosExistentes.length <= 1} className="text-slate-300 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                          <input value={f.denominacao} onChange={(e) => updateFinanciamentoExistente(i, { denominacao: e.target.value })} placeholder="Denominação" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <select value={f.agenteFinanceiro} onChange={(e) => updateFinanciamentoExistente(i, { agenteFinanceiro: e.target.value as 'BNB' | 'Outros' })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white"><option value="BNB">BNB</option><option value="Outros">Outros</option></select>
                          <input type="number" value={f.saldoDevedor || ''} onChange={(e) => updateFinanciamentoExistente(i, { saldoDevedor: Number(e.target.value) })} placeholder="Saldo Devedor (R$)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={f.jurosPctAa || ''} onChange={(e) => updateFinanciamentoExistente(i, { jurosPctAa: Number(e.target.value) })} placeholder="Juros % a.a." className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={f.carenciaMeses || ''} onChange={(e) => updateFinanciamentoExistente(i, { carenciaMeses: Number(e.target.value) })} placeholder="Carência (meses)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={f.prazoRestanteMeses || ''} onChange={(e) => updateFinanciamentoExistente(i, { prazoRestanteMeses: Number(e.target.value) })} placeholder="Prazo Restante (meses)" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="date" value={f.dataContratacao} onChange={(e) => updateFinanciamentoExistente(i, { dataContratacao: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={f.mesmaAtividadeConjuge} onChange={(e) => updateFinanciamentoExistente(i, { mesmaAtividadeConjuge: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Mesma Ativ. do Cônjuge?</label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={f.pertenceTitular} onChange={(e) => updateFinanciamentoExistente(i, { pertenceTitular: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" /> Pertence ao Titular?</label>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={addFinanciamentoExistente} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar financiamento</button>
                  </div>
                </SectionAccordion>

                {/* Seção 6 - Garantias Fidejussórias */}
                <SectionAccordion id="fidejussorias" expanded={expandedPropostaSection === 'fidejussorias'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'fidejussorias' ? null : 'fidejussorias')} icon={<Users className="w-4 h-4 text-emerald-600" />} title="Seção 6 · Garantias Fidejussórias">
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
                          <input value={proposta.avalistas[i].cpfCnpj} onChange={(e) => updateAvalista(i, { cpfCnpj: formatCPF(e.target.value) })} placeholder="CPF/CNPJ" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={proposta.avalistas[i].conjugeNome} onChange={(e) => updateAvalista(i, { conjugeNome: e.target.value })} placeholder="Cônjuge - Nome" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={proposta.avalistas[i].conjugeCpf} onChange={(e) => updateAvalista(i, { conjugeCpf: formatCPF(e.target.value) })} placeholder="Cônjuge - CPF" className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionAccordion>

                {/* Seção 7 - Outras Garantias (reais) */}
                <SectionAccordion id="garantias-reais" expanded={expandedPropostaSection === 'garantias-reais'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'garantias-reais' ? null : 'garantias-reais')} icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />} title="Seção 7 · Outras Garantias (Reais)" badge={formatCurrency(resumoGar.total)}>
                  <div className="flex flex-col gap-1.5">
                    {proposta.garantiasReaisExtras.length === 0 && <p className="text-xs text-slate-400 italic">Nenhuma garantia real adicionada ainda.</p>}
                    {proposta.garantiasReaisExtras.map((g, i) => (
                      <div key={g.id} className="grid grid-cols-12 gap-1.5 items-center bg-slate-50 rounded-lg p-1.5">
                        <input value={g.denominacao} onChange={(e) => updateGarantiaExtra(i, { denominacao: e.target.value })} placeholder="Denominação" className="col-span-4 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <select value={g.tipo} onChange={(e) => updateGarantiaExtra(i, { tipo: e.target.value })} className="col-span-3 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                          {TIPOS_GARANTIA_REAL.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span className="col-span-2 text-[10px] text-slate-400 truncate">{MODALIDADE_POR_TIPO[g.tipo]}</span>
                        <input type="number" value={g.valor || ''} onChange={(e) => updateGarantiaExtra(i, { valor: Number(e.target.value) })} placeholder="Valor" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <button type="button" onClick={() => removeGarantiaExtra(i)} className="col-span-1 flex justify-center text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={addGarantiaExtra} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar outra garantia</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 mt-2 text-xs">
                    <span>Garantias Fidejussórias: <strong>{formatCurrency(resumoGar.fidejussorias)}</strong></span>
                    <span>Garantias Reais Pré-existentes: <strong>{formatCurrency(resumoGar.reaisPreExistentes)}</strong></span>
                    <span>Garantias Reais Evolutivas: <strong>{formatCurrency(resumoGar.reaisEvolutivas)}</strong></span>
                    <span>Total de Garantias: <strong className="text-emerald-700">{formatCurrency(resumoGar.total)}</strong></span>
                    <span className="col-span-2">% Garantias/Financiamento: <strong>{(resumoGar.pctGarantias * 100).toFixed(2)}%</strong></span>
                  </div>
                </SectionAccordion>

                {/* Seção 8 - Indicadores Econômicos e Sociais */}
                <SectionAccordion id="indicadores" expanded={expandedPropostaSection === 'indicadores'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'indicadores' ? null : 'indicadores')} icon={<Coins className="w-4 h-4 text-emerald-600" />} title="Seção 8 · Indicadores Econômicos e Sociais">
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Nº de Empregados - Atual</label><input type="number" value={proposta.indicadores.empregadosAtual || ''} onChange={(e) => updateIndicadores({ empregadosAtual: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                    <div><label className="text-[10px] font-medium text-slate-500 block mb-0.5">Nº de Empregados - Ano de Estabilização</label><input type="number" value={proposta.indicadores.empregadosEstabilizacao || ''} onChange={(e) => updateIndicadores({ empregadosEstabilizacao: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" /></div>
                  </div>
                  <div className="flex justify-between mt-2 text-xs bg-emerald-50 rounded-lg p-2.5">
                    <span>Investimento Total: <strong>{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                    <span>Investimento/Empregado (Estabilização): <strong>{formatCurrency(calcInvestimentoPorEmpregado(proposta.indicadores, totalGeralInvest.investimentoTotal))}</strong></span>
                  </div>
                </SectionAccordion>

                {/* Seção 9 - Textos */}
                <SectionAccordion id="textos" expanded={expandedPropostaSection === 'textos'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'textos' ? null : 'textos')} icon={<ClipboardList className="w-4 h-4 text-emerald-600" />} title="Seção 9 · Textos">
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Comentários / Objetivos / Justificativas</label>
                    <textarea value={proposta.textos.comentarios} onChange={(e) => updateTextos({ comentarios: e.target.value })} rows={3} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Parecer Técnico</label>
                    <textarea value={proposta.textos.parecerTecnico} onChange={(e) => updateTextos({ parecerTecnico: e.target.value })} rows={4} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs" />
                  </div>
                </SectionAccordion>

                {/* Seção 10 - Declarações */}
                <SectionAccordion id="declaracoes" expanded={expandedPropostaSection === 'declaracoes'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'declaracoes' ? null : 'declaracoes')} icon={<FileCheck2 className="w-4 h-4 text-emerald-600" />} title="Seção 10 · Declarações">
                  <p className="text-xs font-semibold text-slate-600">Declaro, para todos os fins, e sob as penas da Lei:</p>

                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="respondePorOperacoes" checked={proposta.declaracoes.respondePorOperacoes === 'nao'} onChange={() => updateDeclaracoes({ respondePorOperacoes: 'nao' })} className="mt-0.5 accent-emerald-600" /> Não respondo(emos) por nenhuma operação de crédito em bancos ou cooperativas do País, inclusive o BNB, realizada com recursos controlados do crédito rural ou dos Fundos Constitucionais (FNO/FNE/FCO).</label>
                    <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="respondePorOperacoes" checked={proposta.declaracoes.respondePorOperacoes === 'sim'} onChange={() => updateDeclaracoes({ respondePorOperacoes: 'sim' })} className="mt-0.5 accent-emerald-600" /> Respondo(emos) pelas seguintes operações (autorizo o BNB a confirmar os dados):</label>
                  </div>
                  {proposta.declaracoes.respondePorOperacoes === 'sim' && (
                    <div className="flex flex-col gap-1.5 pl-5">
                      {proposta.declaracoes.operacoesExistentesBNB.map((op, i) => (
                        <div key={op.id} className="grid grid-cols-12 gap-1.5 items-center bg-slate-50 rounded-lg p-1.5">
                          <input value={op.bancoCooperativa} onChange={(e) => updateOperacaoBNB(i, { bancoCooperativa: e.target.value })} placeholder="Banco/Cooperativa" className="col-span-3 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="date" value={op.dataContratoOuRenovacao} onChange={(e) => updateOperacaoBNB(i, { dataContratoOuRenovacao: e.target.value })} className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input type="number" value={op.valorContrato || ''} onChange={(e) => updateOperacaoBNB(i, { valorContrato: Number(e.target.value) })} placeholder="Valor" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <input value={op.fonteRecursos} onChange={(e) => updateOperacaoBNB(i, { fonteRecursos: e.target.value })} placeholder="Fonte de Recursos" className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                          <label className="col-span-1 flex items-center gap-1 text-[10px] text-slate-600"><input type="checkbox" checked={op.bonus200} onChange={(e) => updateOperacaoBNB(i, { bonus200: e.target.checked })} className="w-3 h-3 accent-emerald-600" /> R$200</label>
                          <label className="col-span-1 flex items-center gap-1 text-[10px] text-slate-600"><input type="checkbox" checked={op.bonus700} onChange={(e) => updateOperacaoBNB(i, { bonus700: e.target.checked })} className="w-3 h-3 accent-emerald-600" /> R$700</label>
                          <button type="button" onClick={() => removeOperacaoBNB(i)} disabled={proposta.declaracoes.operacoesExistentesBNB.length <= 1} className="col-span-1 flex justify-center text-slate-300 hover:text-rose-500 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      {proposta.declaracoes.operacoesExistentesBNB.length < 10 && (
                        <button type="button" onClick={addOperacaoBNB} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar operação</button>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">Encontro-me quite e em situação de regularidade perante a Justiça Eleitoral.</p>

                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Bônus de R$ 700,00, se houver direito:</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="bonus700" checked={proposta.declaracoes.bonus700Situacao === 'primeira'} onChange={() => updateDeclaracoes({ bonus700Situacao: 'primeira' })} className="mt-0.5 accent-emerald-600" /> A operação proposta em {proposta.dados.dataProposta ? new Date(proposta.dados.dataProposta + 'T00:00:00').toLocaleDateString('pt-BR') : '[data]'} é a minha primeira operação de investimento no PRONAF-Grupo C e não recebi o bônus de R$ 700,00 anteriormente.</label>
                      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="bonus700" checked={proposta.declaracoes.bonus700Situacao === 'enesima_sem_bonus'} onChange={() => updateDeclaracoes({ bonus700Situacao: 'enesima_sem_bonus' })} className="mt-0.5 accent-emerald-600" /> É a minha {proposta.declaracoes.numeroOperacao}ª operação de investimento no PRONAF-Grupo C e não recebi o bônus de R$ 700,00 em operações anteriores.</label>
                      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="bonus700" checked={proposta.declaracoes.bonus700Situacao === 'enesima_com_bonus'} onChange={() => updateDeclaracoes({ bonus700Situacao: 'enesima_com_bonus' })} className="mt-0.5 accent-emerald-600" /> É a minha {proposta.declaracoes.numeroOperacao}ª operação de investimento e já recebi o bônus de R$ 700,00 em operações anteriores.</label>
                      {(proposta.declaracoes.bonus700Situacao === 'enesima_sem_bonus' || proposta.declaracoes.bonus700Situacao === 'enesima_com_bonus') && (
                        <input type="number" min={2} value={proposta.declaracoes.numeroOperacao} onChange={(e) => updateDeclaracoes({ numeroOperacao: Number(e.target.value) })} placeholder="Nº da operação" className="w-32 px-2 py-1.5 rounded-lg border border-slate-200 text-xs ml-6" />
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Renegociação (MP 432/2008 e Lei 11.775/2008, arts. 15, 29 ou 30):</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="renegociacao" checked={proposta.declaracoes.renegociacaoMp432 === 'nao'} onChange={() => updateDeclaracoes({ renegociacaoMp432: 'nao' })} className="mt-0.5 accent-emerald-600" /> Não respondo por operação de investimento renegociada nesses termos.</label>
                      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="radio" name="renegociacao" checked={proposta.declaracoes.renegociacaoMp432 === 'amortizou'} onChange={() => updateDeclaracoes({ renegociacaoMp432: 'amortizou' })} className="mt-0.5 accent-emerald-600" /> Já amortizei integralmente as prestações vencidas no ano de {proposta.declaracoes.anoRenegociacao} da operação renegociada nesses termos.</label>
                      {proposta.declaracoes.renegociacaoMp432 === 'amortizou' && (
                        <input type="number" value={proposta.declaracoes.anoRenegociacao} onChange={(e) => updateDeclaracoes({ anoRenegociacao: Number(e.target.value) })} placeholder="Ano" className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 text-xs ml-6" />
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Circular BACEN 3.339 — Pessoa Politicamente Exposta:</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="radio" name="ppe" checked={proposta.declaracoes.ppe === 'enquadro'} onChange={() => updateDeclaracoes({ ppe: 'enquadro' })} className="accent-emerald-600" /> ENQUADRO-ME</label>
                      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="radio" name="ppe" checked={proposta.declaracoes.ppe === 'nao_enquadro'} onChange={() => updateDeclaracoes({ ppe: 'nao_enquadro' })} className="accent-emerald-600" /> NÃO ME ENQUADRO — em nenhuma das situações listadas na lei, atualmente ou nos últimos 5 anos</label>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Metodologia de Cálculo da Taxa de Juros (Res. CMN 4.673/2018 e 4.664/2018):</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="radio" name="metodologiaJuros" checked={proposta.declaracoes.metodologiaJuros === 'prefixada'} onChange={() => updateDeclaracoes({ metodologiaJuros: 'prefixada' })} className="accent-emerald-600" /> Taxa de Juros Prefixada</label>
                      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="radio" name="metodologiaJuros" checked={proposta.declaracoes.metodologiaJuros === 'posfixada'} onChange={() => updateDeclaracoes({ metodologiaJuros: 'posfixada' })} className="accent-emerald-600" /> Taxa de Juros Pós-fixada</label>
                    </div>
                  </div>
                </SectionAccordion>

                {/* Seção 11 - Autorizações e Assinaturas */}
                <SectionAccordion id="assinaturas" expanded={expandedPropostaSection === 'assinaturas'} onToggle={() => setExpandedPropostaSection(expandedPropostaSection === 'assinaturas' ? null : 'assinaturas')} icon={<Percent className="w-4 h-4 text-emerald-600" />} title="Seção 11 · Autorizações e Assinaturas (somente leitura)">
                  <div className="text-[11px] text-slate-500 flex flex-col gap-2">
                    <p>Autorizo o BNB a consultar o SCR/SISBACEN (Central de Risco de Crédito) sobre meus dados.</p>
                    <p>Declaro sob as penas da lei (art. 299 do Código Penal) que as informações acima correspondem à verdade.</p>
                    <p>Local: {foundClient?.address?.city || '—'} · Data: {new Date().toLocaleDateString('pt-BR')}</p>
                    <div className="border-t border-slate-100 pt-2 mt-1">
                      <p className="font-semibold text-slate-600">Cliente: {foundClient?.name || '—'}</p>
                      <p>CPF nº {foundClient?.cpf || '—'}</p>
                    </div>
                    {proposta.dados.elaborador.elaborador.trim() && (
                      <div className="border-t border-slate-100 pt-2">
                        <p className="font-semibold text-slate-600">Elaborador: {proposta.dados.elaborador.elaborador}</p>
                        <p>CPF nº {proposta.dados.elaborador.cpfElaborador || '—'}</p>
                      </div>
                    )}
                  </div>
                </SectionAccordion>
              </div>
            )}

            {step === 3 && (
              <div id="pronaf-print-area" className="flex flex-col gap-4">
                <div className="flex flex-col items-center text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 print:hidden"><CheckCircle2 className="w-8 h-8" /></div>
                  <h3 className="font-semibold text-slate-800 text-lg">Resumo da Proposta PRONAF</h3>
                  <p className="text-sm text-slate-500 mt-1">Cliente: <strong>{foundClient?.name || '—'}</strong> · CPF: {foundClient?.cpf || '—'}</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-slate-50 rounded-xl p-3">
                  <span>Banco: <strong>{proposta.dados.banco || '—'}</strong></span>
                  <span>Data da Proposta: <strong>{proposta.dados.dataProposta ? new Date(proposta.dados.dataProposta + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</strong></span>
                  <span>Objetivo: <strong>{proposta.dados.objetivoCredito || '—'}</strong></span>
                  <span>Programa: <strong>{PROGRAMAS_PRONAF.find(p => p.code === proposta.dados.programa)?.label || proposta.dados.programa || '—'}</strong></span>
                  <span>Agência: <strong>{proposta.dados.agencia || '—'}</strong></span>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Imóveis Vinculados</p>
                  <div className="flex flex-col gap-1 text-xs">
                    {linhasImovelInversao.length === 0 && <p className="text-slate-400 italic">Nenhum imóvel informado.</p>}
                    {linhasImovelInversao.map(row => (
                      <div key={row.n} className="flex justify-between bg-slate-50 rounded-lg px-2 py-1.5">
                        <span>Imóvel {row.n} · {row.denominacao}</span>
                        <span className="text-slate-500">{row.municipioUf} {row.regiao ? `· ${row.regiao}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Programa de Investimentos</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span>Rec. Próprios: <strong>{formatCurrency(totalGeralInvest.recProprios)}</strong></span>
                    <span>Financiamento: <strong>{formatCurrency(totalGeralInvest.financiamento)}</strong></span>
                    <span>Investimento Total: <strong className="text-emerald-700">{formatCurrency(totalGeralInvest.investimentoTotal)}</strong></span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Bases do Financiamento</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <span>Prazo: <strong>{proposta.basesFinanciamento.prazoMeses} meses</strong></span>
                    <span>Carência: <strong>{proposta.basesFinanciamento.carenciaMeses} meses</strong></span>
                    <span>Juros: <strong>{proposta.basesFinanciamento.jurosPctAa}% a.a.</strong></span>
                    <span>Método: <strong>{proposta.basesFinanciamento.metodoCalculo}</strong></span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Garantias</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>Fidejussórias: <strong>{formatCurrency(resumoGar.fidejussorias)}</strong></span>
                    <span>Reais: <strong>{formatCurrency(resumoGar.reaisPreExistentes)}</strong></span>
                    <span>Evolutivas: <strong>{formatCurrency(resumoGar.reaisEvolutivas)}</strong></span>
                    <span>Total: <strong className="text-emerald-700">{formatCurrency(resumoGar.total)}</strong></span>
                    <span className="col-span-2">% Garantias/Financiamento: <strong>{(resumoGar.pctGarantias * 100).toFixed(2)}%</strong></span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Indicadores</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>Empregados (atual → estabilização): <strong>{proposta.indicadores.empregadosAtual} → {proposta.indicadores.empregadosEstabilizacao}</strong></span>
                    <span>Investimento/Empregado: <strong>{formatCurrency(calcInvestimentoPorEmpregado(proposta.indicadores, totalGeralInvest.investimentoTotal))}</strong></span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                  <p>Declaro sob as penas da lei (art. 299 do Código Penal) que as informações acima correspondem à verdade.</p>
                  <p className="mt-1">Local: {foundClient?.address?.city || '—'} · Data: {new Date().toLocaleDateString('pt-BR')}</p>
                  <div className="border-t border-slate-100 pt-2 mt-2">
                    <p className="font-semibold text-slate-600">Cliente: {foundClient?.name || '—'} · CPF nº {foundClient?.cpf || '—'}</p>
                    {proposta.dados.elaborador.elaborador.trim() && (
                      <p className="font-semibold text-slate-600 mt-1">Elaborador: {proposta.dados.elaborador.elaborador} · CPF nº {proposta.dados.elaborador.cpfElaborador || '—'}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <style>{`
            @media print {
              body * { visibility: hidden; }
              #pronaf-print-area, #pronaf-print-area * { visibility: visible; }
              #pronaf-print-area { position: absolute; left: 0; top: 0; width: 100%; }
            }
          `}</style>

          {/* Footer */}
          <div className="px-6 pb-6 pt-2 flex items-center justify-between shrink-0 border-t border-slate-100 print:hidden">
            {step === 1 && (
              <>
                <button onClick={resetAndClose} className="text-sm text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                <button onClick={() => runExclusive('PronafWizard.handleConfirmClient', () => handleConfirmClient())} disabled={!foundClient || saving || (!projectId && !proposta.dados.banco)} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all", foundClient && !saving && (projectId || proposta.dados.banco) ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm" : "bg-slate-100 text-slate-400 cursor-not-allowed")}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Confirmar e Continuar <ArrowRight className="w-4 h-4" /></>}
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <button onClick={() => runExclusive('PronafWizard.handleSaveProposta', () => handleSaveProposta())} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Salvar e Continuar <ArrowRight className="w-4 h-4" /></>}
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <div className="flex items-center gap-2">
                  <button onClick={handlePrint} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                    <FileCheck2 className="w-4 h-4" /> Imprimir
                  </button>
                  <button onClick={resetAndClose} className="px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm">Fechar</button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
