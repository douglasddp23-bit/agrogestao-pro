// Modelos da Proposta de Crédito Rural.
//
// Persistência: a proposta é gravada no documento do projeto de crédito que a
// página "Crédito Rural" já lista (coleção "analyses", type "credit"), no campo
// `creditProposal`. Cliente e propriedades continuam vindo do cadastro de
// clientes ("clients") — nada é duplicado. Bancos e programas são CONFIGURAÇÃO
// (banks.ts / programs.ts), não tabelas: somar um banco ou uma linha nova é só
// acrescentar um item lá.

/** Status da proposta (independe do status do "projeto" na lista). */
export const PROPOSAL_STATUSES = [
  'Rascunho', 'Em elaboração', 'Revisão', 'Pronta para envio', 'Enviada ao banco',
  'Em análise', 'Aprovada', 'Reprovada', 'Contratada', 'Cancelada',
] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];

export type SimNao = 'Sim' | 'Não';

/** Como a planilha pede o recurso próprio de cada item. */
export type OwnResourcesMode = 'total' | 'unit';

/** Linhas de custo que ficam abaixo da tabela de investimentos (variam por planilha). */
export type CostLineKind =
  | 'custeioAgricola'     // PRONAF: "Custeio Agrícola vinculado ao investimento"
  | 'custeioPecuario'     // PRONAF: "Custeio Pecuário vinculado ao investimento"
  | 'seguroRural'         // Investimento Rural: "Seguro Rural"
  | 'seguroPrestamista'   // Investimento Rural: "Seguro Prestamista"
  | 'assessoria'          // todas: "Custo de Assessoria Empresarial e Técnica"
  | 'taxaIrrigacao';      // PRONAF: "Tx. Elaboração + Assistência Técnica (Ref. Itens de Irrigação)"

/** Um item do "Programa de Investimentos". */
export interface ProposalInvestment {
  id: string;
  description: string;            // Discriminação
  isCollateral: SimNao;           // Compõe garantia?
  quantity: number;
  unit: string;
  use: string;                    // Uso (lista da planilha)
  propertyNumber: number;         // Nº do imóvel
  unitValue: number;              // Valor unitário
  ownResourcesUnit: number;       // Rec. próprios por unidade (planilhas PRONAF)
  ownResourcesTotal: number;      // Rec. próprios do item (planilha Investimento Rural)
  irrigation: SimNao;             // Irrigação?
}

/** Imóvel onde serão realizadas as inversões (cópia do cadastro + dados que só a proposta pede). */
export interface ProposalProperty {
  number: number;                 // Nº do imóvel na proposta (1, 2, ...)
  sourceIndex: number | null;     // posição em client.properties (null = digitado na proposta)
  name: string;                   // Denominação
  city: string;
  state: string;
  region: string;                 // Semi-árido / Fora do Semi-árido
  areaHa: number;
  car: string;
  nirf: string;
  cei: string;
  sncr: string;
  ownerType: 'PF' | 'PJ';
  ownerName: string;
  ownerDoc: string;
}

export interface CostLine { value: number; ownResources: number; }
export interface AdvisoryCost { mode: 'percent' | 'value'; amount: number; ownResources: number; }
export interface IrrigationFee { percent: number; ownResources: number; }

export interface Guarantor { type: '' | 'Aval' | 'Fiança'; name: string; doc: string; spouseName: string; spouseDoc: string; }
export interface RealGuarantee { id: string; description: string; type: string; value: number; }

export interface CreditProposal {
  schemaVersion: 2;
  proposalId: string;             // ID único e legível (ex.: PROP-2026-0007)
  status: ProposalStatus;
  // Identificação
  bankId: string;
  programId: string;
  lineId: string;                 // linha / taxa dentro do programa (quando houver)
  clientId: string;
  clientName: string;
  clientDoc: string;
  clientType: 'PF' | 'PJ';
  proposalDate: string;           // AAAA-MM-DD
  expectedContractDate: string;   // AAAA-MM-DD (planilha: data da proposta + 30 dias)
  branch: string;                 // Agência
  region: string;
  mainActivity: string;
  objective: string;
  purpose: string;                // Finalidade (lista do programa)
  flags: Record<string, SimNao | ''>;  // perguntas específicas do programa
  preparer: { company: string; companyDoc: string; name: string; doc: string };
  // Conteúdo
  properties: ProposalProperty[];
  investments: ProposalInvestment[];
  costs: {
    custeioAgricola: CostLine;
    custeioPecuario: CostLine;
    seguroRural: CostLine;
    seguroPrestamista: CostLine;
    assessoria: AdvisoryCost;
    taxaIrrigacao: IrrigationFee;
  };
  guarantors: [Guarantor, Guarantor];
  realGuarantees: RealGuarantee[];
  notes: string;
  // Controle
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

/** Totais calculados (nunca digitados). */
export interface ProposalTotals {
  investmentsTotal: number;        // SUBTOTAL do Investimento (total)
  investmentsOwn: number;
  investmentsFinanced: number;
  irrigationBase: number;          // soma dos itens marcados "Irrigação"
  evolvingCollateral: number;      // soma dos itens que compõem garantia
  costLines: { kind: CostLineKind; label: string; total: number; own: number; financed: number }[];
  total: number;                   // TOTAL (investimento + linhas de custo)
  ownResources: number;
  financed: number;
  ownPct: number;                  // % recursos próprios
  financedPct: number;             // % financiado
  realGuaranteesTotal: number;
  guaranteesTotal: number;
  guaranteesPct: number;           // garantias / financiado
}
