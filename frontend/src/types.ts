export type UserRole = 'consultant' | 'hr' | 'manager' | 'admin';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  effectiveRole?: UserRole; // role efetiva considerando delegações ativas
  activeDelegationInfo?: {
    absentUserName: string;
    absentUserRole: UserRole;
    endDate?: string;
    reason?: string;
  };
  registrationNumber?: string;
  photoURL?: string;
  status?: string;
  department?: string;
  lastClockIn?: string;
  blocked?: boolean;
  createdAt?: string;
  temporaryPassword?: string;
  mustChangePassword?: boolean;
  passwordExpired?: boolean; // troca obrigatória porque a senha passou de 30 dias
  professionalCertification?: string;
  emailSignature?: string;
  emailSignaturePhoto?: string;
  adminId?: string;
  adminName?: string;
  adminEmail?: string;
  createdBy?: string;
  darkMode?: boolean;
  allowedPages?: string[];
  assignedAreas?: string[];
  isVacationReplacement?: boolean;
  replacementForId?: string;
  replacementForName?: string;
  replacementStartDate?: string;
  replacementEndDate?: string;
}

export interface Property {
  name: string;
  areaHectares?: number;
  latitude?: number;
  longitude?: number;
  cep?: string;
  street?: string;
  number?: string;
  noNumber?: boolean;
  neighborhood?: string;
  noNeighborhood?: boolean;
  city?: string;
  state?: string;
  // Dados pedidos pela Proposta de Crédito (planilhas do BNB). Opcionais: quando o
  // Gerente/Administrador salva uma proposta, o que foi preenchido volta para cá.
  car?: string;
  nirf?: string;
  cei?: string;
  sncr?: string;
  ownerType?: 'PF' | 'PJ';
  ownerName?: string;
  ownerDoc?: string;
}

export interface Client {
  id: string;
  name: string;
  cpf: string;
  ownerEmail: string;
  phone: string;
  address: {
    cep: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
  };
  properties: Property[];
  clientType: 'pronaf' | 'rural_producer';
  createdAt: string;
  createdBy: string;
  registrationExpiredAt?: string;
  lastRegistrationUpdateAt?: string;
  clientCode?: string;
  registrationType?: 'simplified' | 'complete';
}

export interface ClientDocument {
  id: string;
  clientId: string;
  name: string;
  type: string;
  category: string;
  url: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  serviceId?: string;
  serviceName?: string;
}

export type AnalysisType = 'soil' | 'water' | 'foliar' | 'topography' | 'irrigation' | 'documentation' | 'credit' | 'environmental_xray';

/** Unidade em que a colheita foi medida; todas convertem para sacas de 60 kg. */
export type HarvestUnit = 'sc' | 'kg' | 't' | 'arroba';

/**
 * Colheita REAL de um talhão/área (coleção "harvests"). É o que alimenta o
 * Relatório de Eficiência — nada ali é mais estimado por fórmula.
 */
export interface Harvest {
  id: string;
  clientId: string;
  clientName: string;
  propertyName: string;
  plot?: string;          // talhão / gleba (opcional)
  crop: string;
  season: string;         // safra, ex.: "2025/2026"
  harvestDate: string;    // AAAA-MM-DD
  quantity: number;       // quantidade colhida, na unidade abaixo
  unit: HarvestUnit;
  areaHa: number;         // área colhida (ha)
  analysisId?: string;    // análise de solo daquela área (opcional)
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ServiceAnalysis {
  id: string;
  clientId: string;
  clientName: string;
  propertyName?: string;
  type: AnalysisType;
  status: string;
  description: string;
  collectionDate?: string;
  scheduledDate?: string;
  responsibleTechnician?: string;
  latitude?: number;
  longitude?: number;
  results?: Record<string, any>;
  waivedFields?: string[];
  resultUrl?: string;
  assignedTo: string;
  value?: number;
  cost?: number;
  bank?: string;
  financingType?: string;
  category?: 'Agricultura' | 'Pecuária';
  pronafData?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaEvent {
  id: string;
  title: string;
  type: 'reuniao' | 'visita' | 'ligacao' | 'entrega' | 'outro';
  date: string;
  clientId?: string;
  clientName?: string;
  responsibleId?: string;
  responsibleName?: string;
  externalLink?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  recordId: string;          // ID do contrato ou registro financeiro
  collection: string;        // 'contracts' | 'financials' | others
  userId: string;
  userName: string;
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'approved' | 'rejected' | 'read';
  changedFields?: string[];  // Campos que foram alterados
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  recordName?: string;
  details?: string;
  timestamp: string;
}

export interface ScheduledService {
  id: string;
  clientId: string;
  clientName: string;
  propertyName?: string;
  type: string;
  scheduledDate: string;
  status: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'alert' | 'update';
  read: boolean;
  createdAt: string;
  link?: string;
}

export interface MessageAttachment {
  name: string;
  type: string;
  size: string;
  url: string; // Base64 or Object Url
  isImage: boolean;
}

export interface InternalMessage {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  subject: string;
  content: string;
  isRead: boolean;
  isDraft?: boolean;
  trashBy?: string[]; // users who deleted it
  createdAt: string;
  reactions?: Record<string, string[]>; // emoji -> [userIds]
  senderSignaturePhoto?: string;
  cc?: string;
  bcc?: string;
  attachments?: MessageAttachment[];
  starredBy?: string[];
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert';
  isRead: boolean;
  createdAt: string;
  recipientId: string;
}

export interface EmailTemplate {
  id: string;
  title: string;
  subject: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  type: 'in' | 'out';
  timestamp: string;
  location?: string;
}

export interface VacationRequest {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: string;
  daysRequested?: number;
  admissionDate?: string;
  periodStart?: string;            // início do período aquisitivo (12 meses)
  periodEnd?: string;              // fim do período aquisitivo
}

export interface SystemLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  type: 'admin' | 'staff' | 'hr';
  ip: string;
  timestamp: string;
}

// ─── VISITAS DE CAMPO ────────────────────────────────────────────────
export type VisitStatus = 'pending_sync' | 'synced' | 'draft';

export interface FieldVisitPhoto {
  id: string;
  url: string;              // URL Firebase Storage (vazio se offline)
  localUri?: string;        // URI local (preenchido pelo app mobile)
  caption?: string;
  takenAt: string;          // ISO timestamp do momento da foto
  uploadedAt?: string;
  syncStatus: 'pending' | 'uploaded';
}

export interface FieldVisitCrop {
  name: string;             // Cultura: soja, milho, café etc.
  stage: string;            // Estágio fenológico
  estimatedArea: number;    // Hectares
  observations: string;
}

export interface FieldVisit {
  id: string;
  clientId: string;
  clientName: string;
  propertyName: string;
  technicianId: string;
  technicianName: string;
  visitDate: string;        // Data da visita (pode ser diferente de createdAt)
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;  // Precisão do GPS no momento do registro
  objective: string;        // Objetivo da visita
  generalObservations: string;
  crops: FieldVisitCrop[];
  photos: FieldVisitPhoto[];
  recommendations: string;
  nextVisitDate?: string;
  linkedServiceId?: string; // Análise/serviço vinculado
  linkedAppointmentId?: string; // Agendamento que originou a visita (Agenda → Registrar Visita)
  syncStatus: VisitStatus;  // 'pending_sync' = registrado offline, aguardando sync
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  createdByName?: string;
  createdByDevice?: string; // 'web' | 'mobile' — origem do registro
}

// ─── FINANCEIRO ──────────────────────────────────────────────────────
export type FinancialStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';
export type PaymentMethod = 'pix' | 'boleto' | 'transferencia' | 'dinheiro' | 'cheque';
export type FinancialCategory = 'analysis' | 'irrigation' | 'topography' | 'credit' | 'regularization' | 'field_visit' | 'contract' | 'expense_report' | 'other';

export interface FinancialRecord {
  id: string;
  clientId: string;
  clientName: string;
  serviceId?: string;
  serviceType?: AnalysisType | 'field_visit' | 'contract' | 'expense_report' | 'other';
  description: string;
  value: number;
  status: FinancialStatus;
  dueDate: string;
  paymentDate?: string;
  paymentMethod?: PaymentMethod;
  category: FinancialCategory;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  competencia?: string;            // mês de competência (YYYY-MM)
  nfse?: string;                   // número da NF-Se
  isExpense?: boolean;             // indica se é uma despesa/saída
  approvedByAdmin?: boolean;       // indica se foi aprovado pelo admin
}

// ─── RELATÓRIO DE DESPESAS ──────────────────────────────────────────
export interface ExpenseReport {
  id: string;
  description: string;
  value: number;
  dueDate: string;
  category: 'combustivel' | 'alimentacao' | 'hospedagem' | 'equipamentos' | 'outros';
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdByRole: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
}

// ─── CONTRATOS ───────────────────────────────────────────────────────
export type ContractStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'completed' | 'cancelled';

export interface ContractPayment {
  id?: string;
  installmentNumber?: number;
  dueDate: string;
  value: number;
  status: 'pending' | 'paid' | 'overdue' | 'open';
  paymentDate?: string;
}

export interface ContractAdendum {
  id: string;
  contractId?: string;
  title: string;
  value?: number;
  valueAdjustment?: number;
  date?: string;
  description: string;
  createdAt?: string;
}

export interface Contract {
  id: string;
  clientId: string;
  clientName: string;
  propertyName?: string;
  title?: string;
  description?: string;
  serviceTypes?: AnalysisType[];   // Serviços contratados
  value?: number;
  startDate: string;
  endDate?: string;
  status: ContractStatus;
  fileUrl?: string;               // PDF assinado no Storage
  responsibleTechnicianId?: string;
  responsibleTechnicianName?: string;
  notes?: string;
  createdBy?: string;
  createdByRole?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  
  // Expanded fields
  contractNumber: string;
  category: string;
  totalValue: number;
  installmentsCount: number;
  installments: ContractPayment[];
  adendums: ContractAdendum[];
  clauses?: string[] | string;
  revisions?: ContractRevision[];
  signatureBase64?: string;
  signedAt?: string;
  signedByName?: string;
  approvalNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  contractorCompany?: string; // nome da empresa contratada (Configurar Marca) no momento da criação
}

export interface ContractRevision {
  id: string;
  version: number;
  text: string;
  editedBy: string;
  editedAt: string;
  changeReason?: string;
}

export interface ContractTemplateVersion {
  id: string;
  version: string;
  text: string;
  authorName: string;
  changeLog: string;
  createdAt: string;
}

export interface ContractTemplate {
  id: string;
  category: string;
  activeVersion: string;
  versions: ContractTemplateVersion[];
  updatedAt: string;
}

// ─── ESTOQUE / INSUMOS ───────────────────────────────────────────────
export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;                   // kg, L, unidade, m, m², saco
  currentQuantity: number;
  minQuantity: number;
  supplier?: string;
  unitCost: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  expiryDate?: string;            // validade do produto (agrotóxico)
  lastRestockDate?: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out';
  quantity: number;
  reason: string;
  serviceId?: string;
  clientId?: string;
  clientName?: string;
  responsibleId: string;
  responsibleName: string;
  unitCostAtTime: number;         // Custo unitário no momento da movimentação
  createdAt: string;
}

// ─── VEÍCULOS ────────────────────────────────────────────────────────
export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  brand: string;
  year: number;
  currentKm: number;
  status: 'available' | 'in_use' | 'maintenance';
  fuelType?: 'flex' | 'diesel' | 'gasolina' | 'eletrico';
  lastMaintenanceKm?: number;
  maintenanceIntervalKm?: number;
  createdAt: string;
  insuranceExpiry?: string;        // vencimento do seguro (ISO date)
  ipvaExpiry?: string;             // vencimento do IPVA
  crlvExpiry?: string;             // vencimento do CRLV
  nextMaintenanceDate?: string;    // data prevista da próxima revisão
  fuelConsumption?: number;        // km/litro médio
  responsibleId?: string;          // motorista responsável fixo
  responsibleName?: string;
}

export interface VehicleTrip {
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  driverId: string;
  driverName: string;
  clientId?: string;
  clientName?: string;
  purpose: string;
  destination: string;
  startKm: number;
  endKm?: number;
  startedAt: string;
  endedAt?: string;
  linkedVisitId?: string;         // Visita de campo vinculada
  notes?: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  technicianId: string;
  technicianName: string;
  serviceType: string;
  date: string;         // ISO date: '2026-06-15'
  time: string;         // '09:00'
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  createdBy: string;
  createdAt: string;
  notifiedEmail: boolean;
  notifiedWhatsapp: boolean;
  whatsappSimulated?: boolean;
  // Criado automaticamente a partir da data/prazo de um serviço (lib/serviceAppointments.ts)
  autoGenerated?: boolean;
  source?: { collection: string; id: string; kind: string };
  isVirtual?: boolean;
  meetingPlatform?: 'meet' | 'teams';
  meetingLink?: string;
  participantIds?: string[];
  participantNames?: string[];
  routeOrder?: number;
  checkInLocation?: {
    latitude: number;
    longitude: number;
    timestamp: string;
    address?: string;
  };
  checkOutLocation?: {
    latitude: number;
    longitude: number;
    timestamp: string;
    address?: string;
  };
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  type: 'project' | 'department' | 'general';
  projectId?: string;
  projectName?: string;
  department?: string;
  createdBy: string;
  createdAt: any;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  content: string;
  attachments?: MessageAttachment[];
  reactions?: Record<string, string[]>;
  createdAt: any;
}

export interface JudicialExpertise {
  id: string;
  // Dados do processo
  processNumber: string;       // ex: 5000630-52.2026.8.13.0347
  comarca: string;             // ex: Jacinto/MG
  vara: string;                // ex: 1ª Vara Cível
  juiz?: string;               // nome do juiz
  tribunalLink?: string;       // Link direto ao processo no tribunal (PJe, Projudi, e-SAJ)
  expertiseType:
    | 'servidao_administrativa'
    | 'reintegracao_posse'
    | 'avaliacao_judicial'
    | 'dano_ambiental'
    | 'divisao_partilha'
    | 'usucapiao'
    | 'desapropriacao'
    | 'outro';
  // Partes
  requerente: string;          // ex: CEMIG
  requerido: string;           // ex: Silvio Ferraz Santos
  // Propriedade
  propertyName: string;        // nome da fazenda/sítio
  propertyCity: string;        // município
  propertyState: string;       // ex: MG
  propertyArea: number;        // área total (ha)
  registrationNumber?: string; // matrícula do imóvel
  car?: string;                // código CAR
  // Vistoria
  visitaDate?: string;         // data da vistoria (ISO date)
  visitaDateEnd?: string;      // se mais de 1 dia
  // Honorários
  honorariosPropostos: number; // valor proposto pelo perito
  honorariosAprovados?: number;// valor aprovado pelo juiz
  honorariosStatus:
    | 'aguardando_nomeacao'
    | 'nomeado'
    | 'proposta_enviada'
    | 'aprovado'
    | 'alvara_emitido'
    | 'pago';
  alvaraNumber?: string;       // número do alvará de pagamento
  // Laudo
  laudoStatus: 'nao_iniciado' | 'em_elaboracao' | 'concluido' | 'entregue';
  laudoDeadline?: string;      // prazo para entrega do laudo (ISO date)
  laudoNotes?: string;         // observações técnicas internas
  // Norma e método
  normaAplicada: string;       // ex: ABNT NBR 14.653-3
  metodologia: string;         // ex: Comparativo Direto / Renda / Philipe Westin
  // Meta
  clientId?: string;           // vínculo com cliente (parte) se cadastrado
  status: 'ativo' | 'concluido' | 'arquivado';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuralPropertyValuation {
  id: string;
  // Identificação
  clientId?: string;
  clientName: string;
  purpose:
    | 'compra_venda'
    | 'garantia_bancaria'
    | 'partilha_heranca'
    | 'judicial'
    | 'seguro_rural'
    | 'desapropriacao'
    | 'permuta'
    | 'outro';
  // Imóvel
  propertyName: string;
  propertyCity: string;
  propertyState: string;
  totalArea: number;              // área total (ha)
  agriculturalArea?: number;      // área agrícola (ha)
  pastureArea?: number;           // pastagem (ha)
  forestArea?: number;            // reserva/mata (ha)
  appArea?: number;               // APP (ha)
  registrationNumber?: string;    // matrícula
  car?: string;
  ccir?: string;
  itr?: string;
  // Localização e acesso
  distanceToCity: number;         // km até sede municipal
  roadType: 'asfalto' | 'terra' | 'misto';
  // Características produtivas
  mainActivity: string;           // ex: pecuária, café, soja
  soilClass?: string;             // classe de solo predominante
  irrigation: boolean;
  irrigationSystem?: string;
  electricPower: boolean;
  waterSource?: string;           // nascente, rio, poço
  // Benfeitorias
  improvements: {
    houses: number;               // casas sede (quantidade)
    workers: number;              // casas de trabalhador
    silos: boolean;
    barn: boolean;                // galpão
    corral: boolean;              // curral
    others?: string;
  };
  // Avaliação — Método Comparativo
  comparativeData: {
    reference1?: { description: string; area: number; value: number; source: string };
    reference2?: { description: string; area: number; value: number; source: string };
    reference3?: { description: string; area: number; value: number; source: string };
  };
  // Resultado
  landValuePerHa?: number;        // valor da terra nua (R$/ha)
  improvementsValue?: number;     // valor das benfeitorias (R$)
  totalValue?: number;            // valor total do imóvel (R$)
  // Grau de fundamentação NBR 14.653
  fundamentationDegree?: 'I' | 'II' | 'III';
  // Status
  status: 'em_elaboracao' | 'concluido' | 'entregue' | 'arquivado';
  visitaDate?: string;
  reportDate?: string;
  laudoNotes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryDelegation {
  id: string;
  // Quem está ausente (delegante)
  absentUserId: string;
  absentUserName: string;
  absentUserRole: UserRole;
  // Quem substitui (delegado)
  delegateUserId: string;
  delegateUserName: string;
  delegateOriginalRole: UserRole;
  // Período
  startDate: string;           // ISO date YYYY-MM-DD
  endDate?: string;            // opcional — se ausente, prazo aberto
  // Status
  active: boolean;
  reason?: string;             // ex: "Férias", "Licença médica"
  // Meta
  createdBy: string;
  createdAt: string;
  revokedAt?: string;
  revokedBy?: string;
}
