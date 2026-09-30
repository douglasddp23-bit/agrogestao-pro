// Configuração dos programas / linhas de crédito da Proposta.
//
// Fonte das regras dos programas do Banco do Nordeste: as planilhas usadas no
// escritório (analisadas em 30/09/2026, só leitura):
//   - PlanilhaInvestimentoRural.xlsm  → modelo "investimento_rural"
//   - PlanilhaPRONAF.xlsm             → modelo "pronaf"
//   - PlanilhaPRONAF-A2.xlsm          → modelo "pronaf_a" ("PLANILHA PRONAF A - Versão 2.0")
// As listas abaixo (objetivos, finalidades, usos, linhas com prazo e carência)
// foram copiadas das abas ocultas VISAO/Tabelas dessas planilhas.
//
// Os outros bancos usam o catálogo do Plano Safra (creditPrograms.ts), que já
// alimentava a proposta. Para acrescentar um programa: criar um item em
// CREDIT_PROGRAM_CONFIGS e colocar o id dele no banco (banks.ts).

import { CREDIT_PROGRAMS, CreditProgram as CatalogProgram } from '../creditPrograms';
import { CostLineKind, OwnResourcesMode } from './types';

export type ProposalModel = 'investimento_rural' | 'pronaf' | 'pronaf_a' | 'padrao';

export interface ProgramLine {
  id: string;
  name: string;
  code?: string;              // código do programa no banco (ex.: 434)
  interest?: string;          // juros (texto) — só quando a fonte é confiável
  maxTermMonths?: number;     // prazo máximo (meses)
  maxGrace?: string;          // carência máxima (texto, com a unidade)
  limit?: string;
  note?: string;              // aviso (ex.: TODO de confirmação)
}

export interface ProgramFlag { key: string; label: string; }

export interface AdvisoryRule {
  /** Teto em % do subtotal (planilhas: 2%). */
  maxPercent: number;
  /** Planilha PRONAF A: além do %, teto em reais. */
  maxValue?: number;
  /** Investimento Rural: % acima do teto zera o valor; PRONAF: aplica o teto. */
  overLimit: 'block' | 'cap';
}

export interface CreditProgramConfig {
  id: string;
  name: string;
  group: string;                         // agrupador na lista de seleção
  model: ProposalModel;
  purposeKind: 'Investimento' | 'Custeio' | 'Custeio e investimento';
  objectives: string[];
  objectiveRequired: boolean;
  purposes: string[];
  lines: ProgramLine[];
  lineRequired: boolean;
  ownResourcesMode: OwnResourcesMode;
  costLines: CostLineKind[];
  advisory: AdvisoryRule;
  flags: ProgramFlag[];                  // perguntas Sim/Não específicas
  maxProperties: number;
  propertyRequired: boolean;
  investmentRequired: boolean;
  allowsPJ: boolean;                     // aceita CNPJ (Investimento Rural aceita)
  /** Condições exibidas quando não há linha escolhida. */
  conditions?: { interest?: string; limit?: string; term?: string; grace?: string; audience?: string; bonus?: string };
  documents: string[];
  /** Regra financeira ainda não confirmada — aparece como aviso na tela. */
  pendingRules?: string[];
}

// ---------------------------------------------------------------- listas das planilhas
const OBJETIVOS_PRONAF = ['Ampliação', 'Expansão', 'Implantação', 'Modernização'];           // visaoOBJ_COD (PRONAF / PRONAF A)
const OBJETIVOS_IR = [...OBJETIVOS_PRONAF, 'Relocalização'];                                   // visaoOBJ_COD (Investimento Rural)
const OBJETIVOS_GERAIS = ['Implantação', 'Ampliação', 'Modernização', 'Recuperação', 'Aquisição', 'Outros'];

/** Usos do item de investimento (visaoUSO_COD — igual nas três planilhas). */
export const INVESTMENT_USES = [
  'Aquis/Desenv. Software', 'Capital de Giro', 'Cobertura do Solo', 'Construções Civis', 'Estudos e Projetos',
  'Instalações', 'Juros de Implantação', 'Máq./Equip. Estrangeiros', 'Máq./Equip. Nacionais', 'Móveis e Utensílios',
  'Obras Preliminares', 'Outras Desp. Implantação', 'Outras Inv. Financeiras', 'Outras Inversões', 'Ração e Volumoso',
  'Sais Minerais', 'Semoventes', 'Terrenos', 'Treinamento de Pessoal', 'Vacinas e Medicamentos', 'Veículos/Embarcações',
];
export const INVESTMENT_UNITS = ['UN', 'HA', 'CAB', 'M', 'M2', 'M3', 'KG', 'CX', 'DOSE', 'H/TE', 'DÚZIA', 'VERBA'];

/** Tipos de garantia (visaoGAR_COD). */
export const GUARANTEE_TYPES: { type: string; kind: 'Real' | 'Fidejussória' }[] = [
  { type: 'Alienação Fiduciária', kind: 'Real' }, { type: 'Aval', kind: 'Fidejussória' }, { type: 'Fiança', kind: 'Fidejussória' },
  { type: 'Fundo de Aval', kind: 'Fidejussória' }, { type: 'Hipoteca', kind: 'Real' }, { type: 'Penhor - Agrícola', kind: 'Real' },
  { type: 'Penhor - Outros', kind: 'Real' }, { type: 'Penhor - Pecuário', kind: 'Real' }, { type: 'Garantia FGO', kind: 'Fidejussória' },
];

/** Finalidades da PlanilhaInvestimentoRural (visaoFINALIDADE_APLICACAO_RECURSOS). */
const FINALIDADES_IR = [
  'Investimentos fixos (1)', 'Investimentos semifixos (21)', 'Inv. fixos e semifixos (24)', 'Aquis. isol. de máq., veíc. e/ou equip. (20)',
  'Aquisição isolada de veículos (130)', 'Aquis. isol. matrizes / reprod. (60)', 'Agroind. diversif. agreg. valor (71)',
  'Ampl./mod./reform./const. nov. armazém (109)', 'Aq. isol. sist. conect. rural (135)', 'Aquisição isolada FNE Sol (91)',
  'Capt./armaz./distrib. água/irrig. (80)', 'Construção de silos (136)', 'Correção de solo (116)', 'Cultivos protegidos (82)',
  'Financ. integrado FNE Sol (44)', 'Reconversão sistema irrigação (134)', 'Recup./fort. cultiv. alim. region. (69)',
  'Recup./fort. pecuária/peq. criaç. (70)', 'Recuperação de pastagens degradadas (159)', 'Renovação de canaviais (131)',
  'Sist. prod. reserv. alim. animais (68)', 'Sistemas florestais (160)', 'Sist. fotovolt. — agr. irrig. semiárido (107)',
  'Sist. fotovolt. — agroind. div. agr. vl. (106)', 'Sist. fotovolt. — rec. cult. alim. reg. (104)', 'Sist. fotovolt. — rec. pec. peq. criaç. (105)',
  'Sist. fotovolt. — sis. prd. rsv. al. ani. (103)', 'Sist. fotovolt. — sis. prod. resv. água (102)', 'P.Saf 23/24 — atv. e tx. prio. (156)',
  'Crédito emergenc. Res. 4.798/20 (122)', 'Crédito emergenc. Res. 4.798/20 — capital de giro (123)', 'Crédito emergenc. Res. 4.987/22 ops. inv. (140)',
];

/** Finalidades das planilhas PRONAF e PRONAF A (listaFINALIDADE — iguais nas duas). */
const FINALIDADES_PRONAF = [
  'Investimentos fixos (1)', 'Agroamigo Água (151)', 'Aquis. equip./prog. melh. gest. emp. (129)', 'Aquis. iso. de máq., veí. e/ou equi. (20)',
  'Aquisição isolada de veículos (130)', 'Aquisição isolada FNE Sol (91)', 'Aquis. de trator e implementos (172)', 'Aquis. de máq., equip. e impl. (173)',
  'Construção de silos (136)', 'Regularização fundiária (293)', 'Moradia rural (294)', 'Sêmen/embriões pecuária de corte (295)',
  'Financ. integrado FNE Sol (44)', 'P.Saf 23/24 — atv. e tx. prio. (156)', 'PRONAF Floresta — S. agrofloresta (89)',
  'PRONAF inv. suíno/avi/fruticult. (66)', 'PRONAF Safra 16/17 — fin. prioriz. (92)', 'PRONAF Safra 16/17 — silvicultura (94)',
  'Reconversão sistema irrigação (134)', 'Ampl./mod./reform./const. nov. armazém (109)', 'Cultivos protegidos (82)',
  'Aq. isol. sist. conect. rural (135)', 'Sêmen/embriões pecuária de leite (29)', 'Equipamento de mobilidade rural (289)',
  'Agric. irrigada semiárido (72)', 'Capt./armaz./distrib. água/irrig. (80)', 'Sist. prod. agroecol. ou orgânico (145)',
  'Suin.-avi.-frut.-aqui.-car. / fin. pri. (96)',
];

/** Finalidades para os programas dos outros bancos (lista geral pedida pelo escritório). */
const FINALIDADES_INVESTIMENTO = [
  'Investimentos fixos', 'Máquinas e equipamentos', 'Construções', 'Irrigação', 'Formação de pastagem',
  'Implantação de culturas', 'Aquisição de animais', 'Melhorias na propriedade', 'Outros',
];
const FINALIDADES_CUSTEIO = ['Custeio agrícola', 'Custeio pecuário', 'Custeio de beneficiamento/industrialização', 'Outros'];

// ---------------------------------------------------------------- documentos
const DOCS_PRONAF = [
  'CAF — Cadastro Nacional da Agricultura Familiar ativo', 'Documento de identidade e CPF (titular e cônjuge)',
  'Comprovante de residência atualizado', 'Documento do imóvel (matrícula, CCIR, ITR) ou contrato de arrendamento/comodato',
  'Cadastro Ambiental Rural (CAR)', 'Orçamentos dos itens a financiar', 'Projeto técnico (elaborado pela empresa)',
];
const DOCS_IR = [
  'Documento de identidade e CPF (ou contrato social e CNPJ)', 'Comprovante de residência / sede', 'Comprovação de renda (IR, notas de venda)',
  'Documento do imóvel (matrícula, CCIR, ITR, NIRF)', 'Cadastro Ambiental Rural (CAR)', 'Outorga d’água e licença ambiental, quando exigidas',
  'Orçamentos dos itens a financiar', 'Projeto técnico (elaborado pela empresa)',
];

// ---------------------------------------------------------------- linhas do BNB (das planilhas)
// visaoPRG_COD da PlanilhaPRONAF: nome | código | fonte | prazo máx. (meses) | ... | carência | juros.
// Os juros da planilha (3% / 8%) são de Plano Safra anterior — por isso NÃO são
// exibidos aqui; valem os da tabela do Plano Safra vigente.
// TODO: confirmar regra financeira — unidade da carência na planilha PRONAF (3, 5, 8, 12) parece ser em anos.
const LINHAS_PRONAF_BNB: ProgramLine[] = [
  { id: '434', code: '434', name: 'FNE/PRONAF Mais Alimentos (434)', maxTermMonths: 120, maxGrace: '3 anos' },
  { id: '406', code: '406', name: 'FNE/PRONAF Mulher (406)', maxTermMonths: 120, maxGrace: '3 anos' },
  { id: '407', code: '407', name: 'FNE/PRONAF Jovem (407)', maxTermMonths: 120, maxGrace: '5 anos' },
  { id: '417', code: '417', name: 'FNE/PRONAF Agroecologia (417)', maxTermMonths: 120, maxGrace: '3 anos' },
  { id: '427', code: '427', name: 'FNE/PRONAF ECO (427)', maxTermMonths: 240, maxGrace: '8 anos' },
  { id: '377', code: '377', name: 'FNE/PRONAF Floresta (377)', maxTermMonths: 240, maxGrace: '12 anos' },
  { id: '405', code: '405', name: 'FNE/PRONAF Semiárido (405)', maxTermMonths: 120, maxGrace: '5 anos' },
  { id: '398', code: '398', name: 'FNE/PRONAF Agroindústria (398)', maxTermMonths: 120, maxGrace: '3 anos' },
  { id: '698', code: '698', name: 'FNE/PRONAF Cotas-Partes (698)', maxTermMonths: 72, maxGrace: '3 anos' },
  { id: '615', code: '615', name: 'PRONAF Produtivo Orientado (615)', maxTermMonths: 120, maxGrace: '3 anos' },
];
// visaoPRG_COD da PlanilhaPRONAF-A2 (juros 0,5% conferem com o Plano Safra 2026/2027).
const LINHAS_PRONAF_A_BNB: ProgramLine[] = [
  { id: '368', code: '368', name: 'FNE/PRONAF Grupo "A" — FNE (368)', interest: '0,5% ao ano', maxTermMonths: 120, maxGrace: '36 meses' },
  { id: '699', code: '699', name: 'FNE/PRONAF Grupo "A" — Res. 5.183-24 (699)', interest: '0,5% ao ano', maxTermMonths: 120, maxGrace: '36 meses' },
];
// A planilha Investimento Rural traz 84 programas do BNB; aqui ficam os de uso
// rural mais comuns (prazo máximo da própria planilha). Os demais: "Outro programa".
const LINHAS_IR_BNB: ProgramLine[] = [
  { id: '219', code: '219', name: 'FNE Verde — Rural (219)', maxTermMonths: 240 },
  { id: '679', code: '679', name: 'FNE Verde Rural ABC (679)', maxTermMonths: 144 },
  { id: '508', code: '508', name: 'FNE Verde — Irrigação (508)', maxTermMonths: 240 },
  { id: '496', code: '496', name: 'FNE Verde — Recuperação Ambiental (496)', maxTermMonths: 240 },
  { id: '506', code: '506', name: 'Irrigação (506)', maxTermMonths: 240 },
  { id: '471', code: '471', name: 'Inovação — Rural (471)', maxTermMonths: 180 },
  { id: '507', code: '507', name: 'Inovação — Irrigação (507)', maxTermMonths: 180 },
  { id: '440', code: '440', name: 'FNE-MPE — Agroindústria (440)', maxTermMonths: 144 },
  { id: '140', code: '140', name: 'Recursos Livres (140)', maxTermMonths: 144 },
  { id: '141', code: '141', name: 'Recursos Obrigatórios (141)', maxTermMonths: 144 },
  { id: 'outro', name: 'Outro programa (informar nas observações)' },
];

const PRONAF_FLAGS: ProgramFlag[] = [
  { key: 'decretoEmergencia', label: 'Município com Decreto de Emergência?' },
  { key: 'agroecologica', label: 'Produção de base agroecológica/orgânica?' },
  { key: 'planoTerritorial', label: 'Proposta com origem nos planos de ação territorial?' },
];
const IR_FLAGS: ProgramFlag[] = [
  { key: 'agroecologica', label: 'Produção de base agroecológica/orgânica?' },
  { key: 'planoTerritorial', label: 'Proposta com origem nos planos de ação territorial?' },
  { key: 'inovacao', label: 'O pleito se enquadra em financiamento para inovação e pesquisa?' },
];

// ---------------------------------------------------------------- programas do BNB
const BNB_PROGRAMS: CreditProgramConfig[] = [
  {
    id: 'bnb-investimento-rural', name: 'Investimento Rural', group: 'Banco do Nordeste', model: 'investimento_rural',
    purposeKind: 'Investimento', objectives: OBJETIVOS_IR, objectiveRequired: true, purposes: FINALIDADES_IR,
    lines: LINHAS_IR_BNB, lineRequired: true, ownResourcesMode: 'total',
    costLines: ['seguroRural', 'seguroPrestamista', 'assessoria'],
    advisory: { maxPercent: 2, overLimit: 'block' },
    flags: IR_FLAGS, maxProperties: 11, propertyRequired: true, investmentRequired: true, allowsPJ: true,
    documents: DOCS_IR,
    pendingRules: [
      'Seguro Rural e Seguro Prestamista: na planilha vêm da aba Cronograma (cálculo do financiamento). Aqui são informados manualmente.',
      'Previsão do contrato: a planilha usa o menor entre (data + 30 dias) e o fim do mês do 1º vencimento do cronograma. Aqui: data + 30 dias.',
    ],
  },
  {
    id: 'bnb-pronaf', name: 'PRONAF', group: 'Banco do Nordeste', model: 'pronaf',
    purposeKind: 'Investimento', objectives: OBJETIVOS_PRONAF, objectiveRequired: true, purposes: FINALIDADES_PRONAF,
    lines: LINHAS_PRONAF_BNB, lineRequired: true, ownResourcesMode: 'unit',
    costLines: ['custeioAgricola', 'custeioPecuario', 'assessoria', 'taxaIrrigacao'],
    advisory: { maxPercent: 2, overLimit: 'cap' },
    flags: PRONAF_FLAGS, maxProperties: 4, propertyRequired: true, investmentRequired: true, allowsPJ: false,
    conditions: { audience: 'Agricultor familiar com CAF (Grupo V), renda bruta anual até R$ 500.000,00', interest: 'Conforme a linha no Plano Safra vigente' },
    documents: DOCS_PRONAF,
    pendingRules: ['Juros por linha: a planilha traz 3% / 8% (Plano Safra anterior). Confirme a taxa vigente da linha no banco.'],
  },
  {
    id: 'bnb-pronaf-a', name: 'PRONAF A', group: 'Banco do Nordeste', model: 'pronaf_a',
    purposeKind: 'Investimento', objectives: OBJETIVOS_PRONAF, objectiveRequired: true, purposes: FINALIDADES_PRONAF,
    lines: LINHAS_PRONAF_A_BNB.slice(0, 1), lineRequired: true, ownResourcesMode: 'unit',
    costLines: ['custeioAgricola', 'custeioPecuario', 'assessoria', 'taxaIrrigacao'],
    advisory: { maxPercent: 2, maxValue: 2500, overLimit: 'cap' },
    flags: PRONAF_FLAGS, maxProperties: 4, propertyRequired: true, investmentRequired: true, allowsPJ: false,
    conditions: { audience: 'Assentados da reforma agrária, crédito fundiário, indígenas e quilombolas (CAF Grupo A)', interest: '0,5% ao ano', bonus: '40% de bônus de adimplência' },
    documents: [...DOCS_PRONAF, 'Declaração/relação de beneficiário do INCRA ou do crédito fundiário'],
    pendingRules: ['Assessoria técnica PRONAF A: a planilha limita a R$ 2.500,00; o Plano Safra 2026/2027 fala em até R$ 3.000,00 para ATER. Confirme com o banco.'],
  },
  {
    id: 'bnb-pronaf-a2', name: 'PRONAF A2', group: 'Banco do Nordeste', model: 'pronaf_a',
    purposeKind: 'Investimento', objectives: OBJETIVOS_PRONAF, objectiveRequired: true, purposes: FINALIDADES_PRONAF,
    lines: LINHAS_PRONAF_A_BNB, lineRequired: true, ownResourcesMode: 'unit',
    costLines: ['custeioAgricola', 'custeioPecuario', 'assessoria', 'taxaIrrigacao'],
    advisory: { maxPercent: 2, maxValue: 2500, overLimit: 'cap' },
    flags: PRONAF_FLAGS, maxProperties: 4, propertyRequired: true, investmentRequired: true, allowsPJ: false,
    conditions: { audience: 'Assentados da reforma agrária, crédito fundiário, indígenas e quilombolas (CAF Grupo A)', interest: '0,5% ao ano', bonus: '40% de bônus de adimplência' },
    documents: [...DOCS_PRONAF, 'Declaração/relação de beneficiário do INCRA ou do crédito fundiário'],
    pendingRules: [
      'PRONAF A2 segue a "Planilha PRONAF A — Versão 2.0" (linhas 368 e 699). Confirme se "PRONAF A" e "PRONAF A2" devem ter alguma diferença além das linhas.',
      'Assessoria técnica PRONAF A: a planilha limita a R$ 2.500,00; o Plano Safra 2026/2027 fala em até R$ 3.000,00 para ATER. Confirme com o banco.',
    ],
  },
];

// ---------------------------------------------------------------- demais bancos (catálogo Plano Safra)
function fromCatalog(p: CatalogProgram): CreditProgramConfig {
  const isCusteio = p.finalidade === 'Custeio';
  const isPronaf = p.grupo === 'Pronaf';
  return {
    id: p.id, name: p.nome, group: p.grupo, model: 'padrao', purposeKind: p.finalidade,
    objectives: OBJETIVOS_GERAIS, objectiveRequired: !isCusteio,
    purposes: isCusteio ? FINALIDADES_CUSTEIO : p.finalidade === 'Investimento' ? FINALIDADES_INVESTIMENTO : [...FINALIDADES_INVESTIMENTO.slice(0, -1), ...FINALIDADES_CUSTEIO],
    lines: (p.faixas || []).map(f => ({ id: f.id, name: f.nome, interest: f.juros, limit: f.limite, maxGrace: f.carencia, note: f.prazo ? `Prazo: ${f.prazo}` : undefined })),
    lineRequired: !!p.faixas?.length, ownResourcesMode: 'total',
    costLines: isPronaf ? ['custeioAgricola', 'custeioPecuario', 'assessoria'] : ['assessoria'],
    advisory: { maxPercent: 2, overLimit: 'cap' },
    flags: isPronaf ? PRONAF_FLAGS : [], maxProperties: 4, propertyRequired: true,
    investmentRequired: !isCusteio, allowsPJ: !isPronaf,
    conditions: { audience: p.publico, interest: p.juros, limit: p.limite, term: p.prazo, grace: p.carencia, bonus: p.bonus },
    documents: p.documentos,
  };
}

export const CREDIT_PROGRAM_CONFIGS: CreditProgramConfig[] = [...BNB_PROGRAMS, ...CREDIT_PROGRAMS.map(fromCatalog)];

/** Programa pelo id (aceita ids antigos da primeira versão do catálogo). */
export function loadCreditProgram(id?: string): CreditProgramConfig | undefined {
  if (!id) return undefined;
  const legacy: Record<string, string> = { 'pronaf-v-custeio': 'pronaf-custeio', 'pronaf-v-investimento': 'pronaf-mais-alimentos' };
  const real = legacy[id] || id;
  return CREDIT_PROGRAM_CONFIGS.find(p => p.id === real);
}

export function findProgramLine(program?: CreditProgramConfig, lineId?: string): ProgramLine | undefined {
  return program?.lines.find(l => l.id === lineId);
}

/** Condições para exibir (a linha escolhida tem prioridade sobre o programa). */
export function programConditions(program: CreditProgramConfig, lineId?: string) {
  const line = findProgramLine(program, lineId);
  return {
    audience: program.conditions?.audience,
    interest: line?.interest || program.conditions?.interest,
    limit: line?.limit || program.conditions?.limit,
    term: line?.maxTermMonths ? `Até ${line.maxTermMonths} meses` : line?.note?.replace(/^Prazo: /, '') || program.conditions?.term,
    grace: line?.maxGrace ? `Até ${line.maxGrace}` : program.conditions?.grace,
    bonus: program.conditions?.bonus,
  };
}
