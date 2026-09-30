// Módulo FATURAMENTO — modelo de dados (Firestore, coleções sincronizadas em tempo real).
//
// Fluxo: CLIENTE → SERVIÇO/VENDA → FATURAMENTO (billings) → CONTAS A RECEBER
// (lançamentos no Financeiro já existente: coleção "financials") → PAGAMENTOS
// (payments) e, separado, DOCUMENTO FISCAL (fiscal_documents + fiscal_events).
//
// Serviço prestado, faturamento, pagamento e documento fiscal são coisas
// DIFERENTES: cada uma tem o próprio status e nenhuma implica a outra.
// Nada de regra tributária fixa aqui — códigos, alíquotas e séries vêm da
// Configuração Fiscal (fiscal_settings), preenchida pelo Administrador.

export type OperationType = 'service' | 'product' | 'mixed';
export const OPERATION_LABELS: Record<OperationType, string> = {
  service: 'Prestação de serviços',
  product: 'Venda de produtos',
  mixed: 'Serviço + produto',
};

export type BillingStatus = 'draft' | 'billed' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  draft: 'Rascunho',
  billed: 'Faturado',
  partial: 'Parcialmente pago',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
};

export type SourceKind = 'service' | 'appointment' | 'proposal' | 'sale' | 'manual';
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  service: 'Serviço concluído',
  appointment: 'Ordem de serviço / agendamento',
  proposal: 'Proposta aprovada',
  sale: 'Venda (PDV)',
  manual: 'Lançamento manual',
};

export interface BillingSource {
  kind: SourceKind;
  /** Coleção de origem (ex.: irrigation_projects) — vazio no lançamento manual. */
  collection?: string;
  id?: string;
  /** Texto para exibir (ex.: "Irrigação — Fazenda Boa Vista"). */
  label?: string;
  /** Categoria do serviço (irrigation, topography...) — liga à configuração fiscal do serviço. */
  serviceCategory?: string;
}

export type ItemKind = 'service' | 'product';

export interface BillingItem {
  id: string;
  kind: ItemKind;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Desconto em R$ no item. */
  discount: number;
  total: number;
  serviceCategory?: string;   // serviço: categoria (liga à config fiscal do serviço)
  productId?: string;         // produto: item do Estoque (inventory_items)
  unit?: string;
}

export type PaymentMethod = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'transferencia' | 'boleto' | 'outros';
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  outros: 'Outros',
};

export type InstallmentStatus = 'pending' | 'paid' | 'cancelled';

export interface Installment {
  number: number;
  value: number;
  dueDate: string;               // AAAA-MM-DD
  status: InstallmentStatus;
  paidAt?: string;               // AAAA-MM-DD
  paidAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentId?: string;
  /** Id do lançamento no Financeiro (financials) — conta a receber desta parcela. */
  receivableId?: string;
}

export type FiscalDocType = 'NFSE' | 'NFE';
export const FISCAL_DOC_LABELS: Record<FiscalDocType, string> = { NFSE: 'NFS-e (serviço)', NFE: 'NF-e (produto)' };

export type FiscalStatus = 'not_issued' | 'processing' | 'issued' | 'rejected' | 'cancelled';
export const FISCAL_STATUS_LABELS: Record<FiscalStatus, string> = {
  not_issued: 'Não emitido',
  processing: 'Em processamento',
  issued: 'Emitido',
  rejected: 'Rejeitado',
  cancelled: 'Cancelado',
};

/** Resumo do documento fiscal gravado no faturamento — SÓ o servidor altera. */
export interface BillingFiscalSummary {
  docType: FiscalDocType | null;
  status: FiscalStatus;
  documentId?: string;
  number?: string;
  updatedAt?: string;
}

export interface Billing {
  id: string;                    // = number (FAT-AAAA-NNNN)
  number: string;
  status: BillingStatus;
  operationType: OperationType;
  clientId: string;
  clientName: string;
  clientDoc?: string;            // CPF/CNPJ copiado do cadastro
  source: BillingSource;
  issueDate: string;             // AAAA-MM-DD
  dueDate: string;               // vencimento (1ª parcela)
  description: string;
  items: BillingItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  installments: Installment[];
  paidTotal: number;
  notes?: string;
  /** Tipo de documento fiscal pretendido (definido pela natureza da operação). */
  fiscalDocType: FiscalDocType | null;
  fiscal?: BillingFiscalSummary;
  responsibleId?: string;
  responsibleName?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export interface Payment {
  id: string;
  billingId: string;
  billingNumber: string;
  installmentNumber: number;
  receivableId?: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;                // AAAA-MM-DD
  notes?: string;
  userId: string;
  userName: string;
  createdAt: string;
  clientId: string;
  clientName: string;
}

export interface FiscalDocument {
  id: string;
  billingId: string;
  billingNumber: string;
  clientId: string;
  clientName: string;
  docType: FiscalDocType;
  status: FiscalStatus;
  number?: string;
  series?: string;
  verificationCode?: string;     // código de verificação (NFS-e) ou chave de acesso (NF-e)
  issuedAt?: string;
  protocol?: string;
  link?: string;
  pdfFileUrl?: string;           // fsfile://… (guardado no próprio sistema)
  xmlFileUrl?: string;
  providerMessage?: string;      // mensagem amigável
  providerTechnical?: string;    // detalhe técnico (só gestão vê)
  providerRef?: string;          // identificador no provedor (para consultar/cancelar)
  provider: string;
  environment: string;
  amount: number;
  sourceLabel?: string;
  sourceCollection?: string;
  sourceId?: string;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface FiscalEvent {
  id: string;
  documentId: string;
  billingId: string;
  type: 'emit_request' | 'authorized' | 'processing' | 'rejected' | 'consulted' | 'cancel_request' | 'cancelled' | 'cancel_rejected' | 'retry';
  previousStatus?: FiscalStatus;
  newStatus?: FiscalStatus;
  message?: string;
  technicalMessage?: string;
  userId: string;
  userName: string;
  createdAt: string;
}

/** Configuração fiscal de cada TIPO de serviço (tudo configurável). */
export interface ServiceFiscalConfig {
  label: string;
  category: string;
  fiscalCode: string;            // código do serviço (lista da prefeitura / LC 116)
  aliquota: string;              // alíquota em % (texto: o escritório informa)
  kind: ItemKind;
  defaultDoc: FiscalDocType;
}

export interface FiscalSettings {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoMunicipal: string;
  inscricaoEstadual: string;
  endereco: string;
  numero: string;
  bairro: string;
  municipio: string;
  codigoMunicipioIbge: string;
  uf: string;
  cep: string;
  email: string;
  telefone: string;
  regimeTributario: string;      // texto livre / lista configurável — não fixamos regra
  ambiente: 'homologacao' | 'producao';
  serieNfse: string;
  serieNfe: string;
  proximoNumeroNfse: string;
  proximoNumeroNfe: string;
  naturezaOperacao: string;
  codigoServicoPadrao: string;
  aliquotaPadrao: string;
  retencoes: string;             // descrição das retenções aplicáveis (ISS retido, IR, PIS/COFINS/CSLL...)
  municipioIncidencia: string;
  cfopPadrao: string;
  provedorObservacoes: string;   // configurações específicas do provedor (sem senhas!)
  serviceTypes: Record<string, ServiceFiscalConfig>;
  updatedAt?: string;
  updatedBy?: string;
}
