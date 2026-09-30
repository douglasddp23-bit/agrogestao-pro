// Validações antes de salvar a proposta (mensagens em português simples).

import { CreditProposal } from './types';
import { CreditProgramConfig, loadCreditProgram } from './programs';
import { loadBank } from './banks';
import { calculateFinancedAmount, calculateInvestmentTotal, calculateOwnResources, calculateProposalTotals } from './calculations';

export interface ValidationIssue { field: string; message: string; }

const filledItems = (p: CreditProposal) => p.investments.filter(i => (i.description || '').trim() || i.quantity || i.unitValue);

export function validateProposal(proposal: CreditProposal, programArg?: CreditProgramConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const program = programArg || loadCreditProgram(proposal.programId);

  if (!proposal.clientId) add('clientId', 'Selecione um cliente para continuar.');
  if (!loadBank(proposal.bankId)) add('bankId', 'Selecione o banco.');
  if (!program) { add('programId', 'Selecione o programa / linha de crédito.'); return issues; }
  if (program.lineRequired && !program.lines.some(l => l.id === proposal.lineId)) add('lineId', 'Selecione a linha do programa.');
  if (!proposal.proposalDate) add('proposalDate', 'Informe a data da proposta.');
  if (!(proposal.purpose || '').trim()) add('purpose', 'Informe a finalidade do crédito.');
  if (program.objectiveRequired && !(proposal.objective || '').trim()) add('objective', 'Informe o objetivo do crédito.');
  if (!program.allowsPJ && proposal.clientType === 'PJ') add('clientDoc', `O programa ${program.name} é só para pessoa física (CPF).`);

  // Imóveis
  const props = proposal.properties.filter(p => (p.name || '').trim());
  if (program.propertyRequired && props.length === 0) add('properties', 'Informe o imóvel onde serão realizadas as inversões.');
  if (props.length > program.maxProperties) add('properties', `Este programa aceita até ${program.maxProperties} imóvel(is).`);
  props.forEach(p => { if (!(p.city || '').trim()) add(`properties.${p.number}`, `Informe o município do imóvel ${p.number} (${p.name}).`); });

  // Investimentos
  const items = filledItems(proposal);
  if (program.investmentRequired && items.length === 0) add('investments', 'Informe pelo menos um item de investimento.');
  items.forEach((it, idx) => {
    const n = idx + 1;
    const label = (it.description || '').trim() || `item ${n}`;
    if (!(it.description || '').trim()) add(`investments.${it.id}.description`, `Informe a discriminação do item ${n}.`);
    if (!(Number(it.quantity) > 0)) add(`investments.${it.id}.quantity`, `Quantidade inválida em "${label}".`);
    if (!(Number(it.unitValue) > 0)) add(`investments.${it.id}.unitValue`, `Valor unitário inválido em "${label}".`);
    if (Number(it.ownResourcesUnit) < 0 || Number(it.ownResourcesTotal) < 0) add(`investments.${it.id}.own`, `Recursos próprios não podem ser negativos em "${label}".`);
    if (calculateFinancedAmount(it, program.ownResourcesMode) < 0) {
      add(`investments.${it.id}.own`, `O valor financiado não pode ser negativo: em "${label}" os recursos próprios (${fmt(calculateOwnResources(it, program.ownResourcesMode))}) passam do investimento (${fmt(calculateInvestmentTotal(it))}).`);
    }
    if (program.propertyRequired && props.length && !props.some(p => p.number === Number(it.propertyNumber))) add(`investments.${it.id}.property`, `Escolha um imóvel válido para "${label}".`);
  });

  // Custos
  const a = proposal.costs.assessoria;
  if (program.costLines.includes('assessoria') && a.mode === 'percent' && Number(a.amount) > program.advisory.maxPercent && program.advisory.overLimit === 'block') {
    add('costs.assessoria', `O custo de assessoria não pode passar de ${program.advisory.maxPercent}% (acima disso a planilha zera o valor).`);
  }
  const totals = calculateProposalTotals(proposal, program);
  totals.costLines.forEach(l => { if (l.financed < 0) add(`costs.${l.kind}`, `O valor financiado não pode ser negativo em "${l.label}".`); });
  if (totals.financed < 0) add('totals', 'O valor financiado não pode ser negativo.');
  return issues;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
