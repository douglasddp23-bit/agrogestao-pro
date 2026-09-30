// Montagem da proposta a partir do cadastro (cliente + propriedades), troca de
// programa sem perder dados e leitura de propostas no formato antigo.
// Funções puras (testadas em proposal.test.ts).

import { Client } from '../../types';
import { CreditProposal, ProposalInvestment, ProposalProperty } from './types';
import { CreditProgramConfig, loadCreditProgram } from './programs';
import { bankFromName } from './banks';
import { expectedContractDate } from './calculations';
import { SEMIARIDO_MUNICIPIOS } from './semiarido';

const newId = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const digits = (s?: string) => (s || '').replace(/\D/g, '');

/** Região do município pela tabela da planilha PRONAF (Semi-árido / Fora do Semi-árido). */
export function regionOfMunicipality(city?: string, state?: string): string {
  if (!city || !state) return '';
  const key = `${city}-${state}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  return SEMIARIDO_MUNICIPIOS.has(key) ? 'Semi-árido' : 'Fora do Semi-árido';
}

export function newInvestment(propertyNumber = 1): ProposalInvestment {
  return {
    id: newId(), description: '', isCollateral: 'Não', quantity: 0, unit: 'UN', use: '', propertyNumber,
    unitValue: 0, ownResourcesUnit: 0, ownResourcesTotal: 0, irrigation: 'Não',
  };
}

/** Imóvel da proposta a partir de uma propriedade do cadastro do cliente. */
export function loadClientProperty(client: Client, index: number, number: number): ProposalProperty {
  const p: any = client.properties?.[index] || {};
  const city = p.city || client.address?.city || '';
  const state = p.state || client.address?.state || '';
  const docDigits = digits(client.cpf);
  return {
    number, sourceIndex: index,
    name: p.name || '', city, state,
    region: regionOfMunicipality(city, state),
    areaHa: Number(p.areaHectares) || 0,
    car: p.car || '', nirf: p.nirf || '', cei: p.cei || '', sncr: p.sncr || '',
    ownerType: p.ownerType || (docDigits.length > 11 ? 'PJ' : 'PF'),
    ownerName: p.ownerName || client.name || '',
    ownerDoc: p.ownerDoc || client.cpf || '',
  };
}

/** Todos os imóveis do cliente, prontos para a proposta. */
export function loadClientProperties(client: Client): ProposalProperty[] {
  return (client.properties || []).map((_, i) => loadClientProperty(client, i, i + 1));
}

export function emptyProperty(number: number): ProposalProperty {
  return { number, sourceIndex: null, name: '', city: '', state: '', region: '', areaHa: 0, car: '', nirf: '', cei: '', sncr: '', ownerType: 'PF', ownerName: '', ownerDoc: '' };
}

/** Proposta nova já preenchida com banco, programa e o que existe no cadastro do cliente. */
export function createEmptyProposal(args: { bankId: string; programId: string; lineId?: string; client: Client; preparer?: CreditProposal['preparer'] }): CreditProposal {
  const { client } = args;
  const program = loadCreditProgram(args.programId);
  const firstProperty = client.properties?.length ? [loadClientProperty(client, 0, 1)] : [];
  const date = today();
  return {
    schemaVersion: 2,
    proposalId: '',
    status: 'Rascunho',
    bankId: args.bankId,
    programId: args.programId,
    lineId: args.lineId || '',
    clientId: client.id,
    clientName: client.name,
    clientDoc: client.cpf || '',
    clientType: digits(client.cpf).length > 11 ? 'PJ' : 'PF',
    proposalDate: date,
    expectedContractDate: expectedContractDate(date),
    branch: '',
    region: firstProperty[0]?.region || regionOfMunicipality(client.address?.city, client.address?.state),
    mainActivity: '',
    objective: '',
    purpose: program?.purposes.length === 1 ? program.purposes[0] : '',
    flags: Object.fromEntries((program?.flags || []).map(f => [f.key, ''])),
    preparer: args.preparer || { company: '', companyDoc: '', name: '', doc: '' },
    properties: firstProperty,
    investments: [newInvestment(1)],
    costs: {
      custeioAgricola: { value: 0, ownResources: 0 },
      custeioPecuario: { value: 0, ownResources: 0 },
      seguroRural: { value: 0, ownResources: 0 },
      seguroPrestamista: { value: 0, ownResources: 0 },
      assessoria: { mode: 'percent', amount: 2, ownResources: 0 },
      taxaIrrigacao: { percent: 0, ownResources: 0 },
    },
    guarantors: [
      { type: '', name: '', doc: '', spouseName: '', spouseDoc: '' },
      { type: '', name: '', doc: '', spouseName: '', spouseDoc: '' },
    ],
    realGuarantees: [],
    notes: '',
  };
}

/**
 * Troca de programa: mantém cliente, datas, imóveis, investimentos, garantias e
 * textos; limpa só o que não existe no programa novo (linha, objetivo/finalidade
 * fora da lista, perguntas específicas). Converte o recurso próprio entre
 * "por unidade" e "total" quando os programas usam formas diferentes.
 */
export function switchProgram(proposal: CreditProposal, newProgramId: string): CreditProposal {
  const from = loadCreditProgram(proposal.programId);
  const to = loadCreditProgram(newProgramId);
  if (!to) return proposal;
  const investments = proposal.investments.map(it => {
    if (!from || from.ownResourcesMode === to.ownResourcesMode) return it;
    const q = Number(it.quantity) || 0;
    return to.ownResourcesMode === 'total'
      ? { ...it, ownResourcesTotal: Math.round(it.ownResourcesUnit * q * 100) / 100 }
      : { ...it, ownResourcesUnit: q > 0 ? Math.round(it.ownResourcesTotal / q * 100) / 100 : 0 };
  });
  const flags: CreditProposal['flags'] = {};
  for (const f of to.flags) flags[f.key] = proposal.flags?.[f.key] ?? '';
  return {
    ...proposal,
    programId: to.id,
    lineId: to.lines.some(l => l.id === proposal.lineId) ? proposal.lineId : '',
    objective: to.objectives.includes(proposal.objective) ? proposal.objective : '',
    purpose: to.purposes.includes(proposal.purpose) ? proposal.purpose : '',
    flags,
    investments,
    properties: proposal.properties.slice(0, to.maxProperties),
  };
}

/** Garante que uma proposta lida do banco tem todos os campos (versões anteriores). */
export function normalizeProposal(raw: any, fallback: CreditProposal): CreditProposal {
  if (!raw || raw.schemaVersion !== 2) return fallback;
  return {
    ...fallback, ...raw,
    flags: { ...fallback.flags, ...(raw.flags || {}) },
    preparer: { ...fallback.preparer, ...(raw.preparer || {}) },
    costs: { ...fallback.costs, ...(raw.costs || {}) },
    guarantors: Array.isArray(raw.guarantors) && raw.guarantors.length === 2 ? raw.guarantors : fallback.guarantors,
    properties: Array.isArray(raw.properties) ? raw.properties : [],
    investments: Array.isArray(raw.investments) && raw.investments.length ? raw.investments : fallback.investments,
    realGuarantees: Array.isArray(raw.realGuarantees) ? raw.realGuarantees : [],
  };
}

/**
 * Proposta gravada pelo assistente anterior (campo pronafData.proposta, 29/09/2026):
 * aproveita banco, programa/linha, dados, imóveis, itens, custos e garantias.
 */
export function fromLegacyPronafData(project: any, client: Client | undefined, programFallback?: CreditProgramConfig): CreditProposal | null {
  const old = project?.pronafData?.proposta;
  if (!old && !project?.pronafData?.cliente) return null;
  const bank = bankFromName(old?.dados?.banco || project.bank) || bankFromName('Outro')!;
  const programId = loadCreditProgram(old?.dados?.programaId || project.creditProgramId)?.id || programFallback?.id || '';
  const fakeClient: Client = client || ({ id: project.clientId, name: project.clientName, cpf: project.pronafData?.cliente?.cpfCnpj || '', properties: [], address: {} } as any);
  const base = createEmptyProposal({ bankId: bank.id, programId, lineId: old?.dados?.faixaId, client: fakeClient });
  if (!old) return base;
  const program = loadCreditProgram(programId);
  const unitMode = program?.ownResourcesMode === 'unit';
  const pi = old.programaInvestimentos || {};
  return {
    ...base,
    proposalDate: old.dados?.dataProposta || base.proposalDate,
    expectedContractDate: expectedContractDate(old.dados?.dataProposta || base.proposalDate),
    branch: old.dados?.agencia || '',
    mainActivity: old.dados?.atividadePrincipal || '',
    objective: old.dados?.objetivoCredito || '',
    preparer: {
      company: old.dados?.elaborador?.empresa || '', companyDoc: old.dados?.elaborador?.cnpj || '',
      name: old.dados?.elaborador?.elaborador || '', doc: old.dados?.elaborador?.cpfElaborador || '',
    },
    properties: (old.imoveisVinculados || []).filter((i: any) => i?.denominacao).map((i: any, n: number) => ({
      ...emptyProperty(n + 1), name: i.denominacao, city: i.municipio || '', state: i.uf || '',
      region: i.regiao || regionOfMunicipality(i.municipio, i.uf), areaHa: Number(i.areaHa) || 0,
      ownerName: fakeClient.name || '', ownerDoc: fakeClient.cpf || '',
    })),
    investments: (pi.itens || []).length ? pi.itens.map((i: any) => ({
      id: i.id || newId(), description: i.discriminacao || '', isCollateral: i.componeGarantia ? 'Sim' : 'Não',
      quantity: Number(i.quantidade) || 0, unit: i.unidade || 'UN', use: i.uso || '', propertyNumber: Number(i.numImovel) || 1,
      unitValue: Number(i.valorUnitario) || 0,
      ownResourcesUnit: Number(i.recProprioUnitario) || 0,
      ownResourcesTotal: unitMode ? 0 : Math.round((Number(i.recProprioUnitario) || 0) * (Number(i.quantidade) || 0) * 100) / 100,
      irrigation: 'Não',
    })) : base.investments,
    costs: {
      ...base.costs,
      custeioAgricola: { value: Number(pi.custeioAgricola?.valor) || 0, ownResources: Number(pi.custeioAgricola?.recProprios) || 0 },
      custeioPecuario: { value: Number(pi.custeioPecuario?.valor) || 0, ownResources: Number(pi.custeioPecuario?.recProprios) || 0 },
      assessoria: pi.custoAssessoria
        ? { mode: pi.custoAssessoria.tipo === 'valor' ? 'value' : 'percent', amount: Number(pi.custoAssessoria.percentualOuValor) || 0, ownResources: Number(pi.custoAssessoria.recProprios) || 0 }
        : base.costs.assessoria,
      taxaIrrigacao: { percent: Number(pi.taxaElaboracaoIrrigacao?.percentual) || 0, ownResources: 0 },
    },
    guarantors: Array.isArray(old.avalistas) && old.avalistas.length === 2
      ? old.avalistas.map((a: any) => ({ type: a.tipo || '', name: a.nome || '', doc: a.cpfCnpj || '', spouseName: a.conjugeNome || '', spouseDoc: a.conjugeCpf || '' })) as any
      : base.guarantors,
    realGuarantees: (old.garantiasReaisExtras || []).map((g: any) => ({ id: g.id || newId(), description: g.denominacao || '', type: g.tipo || 'Hipoteca', value: Number(g.valor) || 0 })),
  };
}
