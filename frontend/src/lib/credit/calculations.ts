// Cálculos da Proposta — regras convertidas das fórmulas da aba " Proposta"
// das planilhas (as referências de célula estão nos comentários).
// Funções puras: sem tela, sem banco de dados (testadas em calculations.test.ts).

import { CostLineKind, CreditProposal, OwnResourcesMode, ProposalInvestment, ProposalTotals } from './types';
import { CreditProgramConfig, GUARANTEE_TYPES } from './programs';

export const round2 = (n: number) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
/** ROUNDDOWN(x; 2) do Excel. */
export const floor2 = (n: number) => Math.floor(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** Investimento total do item = quantidade × valor unitário (planilhas: O = ROUND(J×F; 2)). */
export function calculateInvestmentTotal(item: Pick<ProposalInvestment, 'quantity' | 'unitValue'>): number {
  return round2((Number(item.quantity) || 0) * (Number(item.unitValue) || 0));
}

/**
 * Recursos próprios do item.
 *  - Investimento Rural: informado como TOTAL do item (coluna L "Rec. Próprios Total").
 *  - PRONAF / PRONAF A: informado POR UNIDADE (coluna L "Unitário"; R = L × F).
 */
export function calculateOwnResources(item: Pick<ProposalInvestment, 'quantity' | 'ownResourcesUnit' | 'ownResourcesTotal'>, mode: OwnResourcesMode): number {
  return mode === 'unit'
    ? round2((Number(item.ownResourcesUnit) || 0) * (Number(item.quantity) || 0))
    : round2(Number(item.ownResourcesTotal) || 0);
}

/**
 * Valor financiado do item = investimento total − recursos próprios
 * (Investimento Rural: N = ROUND(J×F;2) − L; PRONAF: N = ROUND(J×F;2) − ROUND(L×F;2)).
 * Pode ficar negativo se o usuário digitar recurso próprio maior que o total —
 * validateProposal() impede salvar nesse caso.
 */
export function calculateFinancedAmount(item: ProposalInvestment, mode: OwnResourcesMode): number {
  return round2(calculateInvestmentTotal(item) - calculateOwnResources(item, mode));
}

/**
 * Custo de Assessoria Empresarial e Técnica (linha 69 das planilhas).
 *  - Em %: ROUNDDOWN(subtotal × % / 100; 2), com teto de 2%.
 *    Investimento Rural: % acima de 2 zera o valor (J69 = 0) → aqui é bloqueado na validação.
 *    PRONAF: aplica o teto de 2%.
 *    PRONAF A: além do %, teto de R$ 2.500,00 (célula S201 "FORMULA PRONAF A").
 *  - Em valor fixo (R$): o próprio valor (respeitando o teto em reais, quando houver).
 * TODO: confirmar regra financeira — teto do PRONAF A (planilha R$ 2.500 × Plano Safra 26/27 R$ 3.000).
 */
export function calculateAdvisoryValue(base: number, cost: CreditProposal['costs']['assessoria'], program: CreditProgramConfig): number {
  const rule = program.advisory;
  let value: number;
  if (cost.mode === 'percent') {
    const pct = Number(cost.amount) || 0;
    if (pct > rule.maxPercent && rule.overLimit === 'block') return 0;
    value = floor2((Number(base) || 0) * Math.min(pct, rule.maxPercent) / 100);
  } else {
    value = floor2(Number(cost.amount) || 0);
  }
  return rule.maxValue ? Math.min(value, rule.maxValue) : value;
}

const COST_LABELS: Record<CostLineKind, string> = {
  custeioAgricola: 'Custeio agrícola vinculado ao investimento',
  custeioPecuario: 'Custeio pecuário vinculado ao investimento',
  seguroRural: 'Seguro rural',
  seguroPrestamista: 'Seguro prestamista',
  assessoria: 'Custo de assessoria empresarial e técnica',
  taxaIrrigacao: 'Tx. elaboração + assistência técnica (itens de irrigação)',
};
export const costLineLabel = (k: CostLineKind) => COST_LABELS[k];

const isRealGuarantee = (type: string) => GUARANTEE_TYPES.find(g => g.type === type)?.kind === 'Real';

/**
 * Todos os totais da proposta.
 * Ordem das planilhas: SUBTOTAL do investimento → linhas de custeio/seguro →
 * SUBTOTAL do financiamento (base da assessoria) → assessoria / tx. irrigação → TOTAL.
 */
export function calculateProposalTotals(proposal: CreditProposal, program: CreditProgramConfig): ProposalTotals {
  const mode = program.ownResourcesMode;
  let investmentsTotal = 0, investmentsOwn = 0, irrigationBase = 0, evolvingCollateral = 0;
  for (const it of proposal.investments) {
    const total = calculateInvestmentTotal(it);
    investmentsTotal += total;
    investmentsOwn += calculateOwnResources(it, mode);
    if (it.irrigation === 'Sim') irrigationBase += total;            // S = SE(K="Sim"; O; 0)
    if (it.isCollateral === 'Sim') evolvingCollateral += total;       // Y = SE(ESQUERDA(E;1)="S"; O; 0)
  }
  investmentsTotal = round2(investmentsTotal);
  investmentsOwn = round2(investmentsOwn);

  const lines: ProposalTotals['costLines'] = [];
  const addLine = (kind: CostLineKind, total: number, own: number) => {
    total = round2(total); own = round2(own);
    if (total || own) lines.push({ kind, label: COST_LABELS[kind], total, own, financed: round2(total - own) });
  };
  // Linhas que entram na base da assessoria (SUBTOTAL do financiamento, O66)
  for (const kind of ['custeioAgricola', 'custeioPecuario', 'seguroRural', 'seguroPrestamista'] as const) {
    if (!program.costLines.includes(kind)) continue;
    const c = proposal.costs[kind];
    addLine(kind, Number(c.value) || 0, Number(c.ownResources) || 0);
  }
  const subtotalFinancing = round2(investmentsTotal + lines.reduce((a, l) => a + l.total, 0));

  if (program.costLines.includes('assessoria')) {
    const c = proposal.costs.assessoria;
    addLine('assessoria', calculateAdvisoryValue(subtotalFinancing, c, program), Number(c.ownResources) || 0);
  }
  if (program.costLines.includes('taxaIrrigacao')) {
    const c = proposal.costs.taxaIrrigacao;                          // J70 = H70 × S66 / 100
    addLine('taxaIrrigacao', (Number(c.percent) || 0) * irrigationBase / 100, Number(c.ownResources) || 0);
  }

  const total = round2(investmentsTotal + lines.reduce((a, l) => a + l.total, 0));
  const ownResources = round2(investmentsOwn + lines.reduce((a, l) => a + l.own, 0));
  const financed = round2(total - ownResources);
  const realGuaranteesTotal = round2(proposal.realGuarantees.filter(g => isRealGuarantee(g.type)).reduce((a, g) => a + (Number(g.value) || 0), 0));
  const guaranteesTotal = round2(realGuaranteesTotal + evolvingCollateral);   // J151 = D151 + E151 + H151

  return {
    investmentsTotal,
    investmentsOwn,
    investmentsFinanced: round2(investmentsTotal - investmentsOwn),
    irrigationBase: round2(irrigationBase),
    evolvingCollateral: round2(evolvingCollateral),
    costLines: lines,
    total,
    ownResources,
    financed,
    ownPct: total > 0 ? round2(ownResources * 100 / total) : 0,            // AB = L × 100 / O
    financedPct: total > 0 ? round2(100 - ownResources * 100 / total) : 0, // AC = 100 − AB
    realGuaranteesTotal,
    guaranteesTotal,
    guaranteesPct: financed > 0 ? round2(guaranteesTotal * 100 / financed) : 0, // M151 = J151 / N72
  };
}

/** Previsão do contrato = data da proposta + 30 dias (PRONAF: R5 = E5 + 30). */
export function expectedContractDate(proposalDate: string): string {
  if (!proposalDate) return '';
  const d = new Date(proposalDate + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 30);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
