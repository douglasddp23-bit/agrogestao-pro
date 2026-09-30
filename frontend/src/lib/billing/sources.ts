// De onde um faturamento pode nascer — e como cada origem pré-preenche o
// faturamento SEM pedir de novo o que já está cadastrado (cliente, CPF/CNPJ,
// serviço e valor).
import type { SourceKind } from './types';

export interface SourceDef {
  collection: string;
  kind: SourceKind;
  /** Categoria do serviço (liga à configuração fiscal de cada tipo de serviço). */
  category: string;
  label: string;
  /** Rota da página de origem (para "Abrir serviço"). */
  route: string;
  /** Descrição curta do item a faturar. */
  describe: (d: any) => string;
  /** Valor já combinado no serviço (0 = informar no faturamento). */
  value: (d: any) => number;
  /** Serviço concluído? (faturar é permitido em qualquer situação; só avisamos). */
  isDone: (d: any) => boolean;
}

const num = (v: any) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);
const done = (d: any) => /conclu|finaliz|entregue|completed/i.test(String(d?.status || ''));
const where = (d: any) => (d?.propertyName ? ` — ${d.propertyName}` : '');

const ANALYSIS_LABELS: Record<string, string> = {
  soil: 'Análise de Solo', water: 'Análise de Água', foliar: 'Análise Foliar', fertility: 'Análise de Fertilidade',
  credit: 'Projeto de Crédito Rural', documentation: 'Documentação', topography: 'Topografia', irrigation: 'Irrigação',
};

export const BILLING_SOURCES: Record<string, SourceDef> = {
  irrigation_projects: {
    collection: 'irrigation_projects', kind: 'service', category: 'irrigation', label: 'Irrigação', route: '/analysis_irrigation',
    describe: (d) => `Projeto de irrigação${where(d)}`, value: (d) => num(d.value), isDone: done,
  },
  topography_services: {
    collection: 'topography_services', kind: 'service', category: 'topography', label: 'Topografia', route: '/analysis_topography',
    describe: (d) => `${d.serviceLabel || 'Serviço de topografia'}${where(d)}`, value: (d) => num(d.value), isDone: done,
  },
  regularization_services: {
    collection: 'regularization_services', kind: 'service', category: 'regularization', label: 'Regularização Ambiental', route: '/analysis_documentation',
    describe: (d) => `Regularização ambiental — protocolo ${d.internalProtocol || ''}${where(d)}`.trim(), value: (d) => num(d.value), isDone: done,
  },
  analyses: {
    collection: 'analyses', kind: 'service', category: 'analysis', label: 'Análises / Crédito Rural', route: '/analysis',
    describe: (d) => `${ANALYSIS_LABELS[d.type] || 'Serviço técnico'}${where(d)}`, value: (d) => num(d.value), isDone: done,
  },
  judicial_expertises: {
    collection: 'judicial_expertises', kind: 'service', category: 'judicial_expertise', label: 'Perícia Judicial', route: '/judicial-expertise',
    describe: (d) => `Honorários periciais${d.processNumber ? ` — processo ${d.processNumber}` : ''}`,
    value: (d) => num(d.honorariosAprovados || d.honorariosPropostos), isDone: (d) => done(d) || /entregue/i.test(String(d?.laudoStatus || '')),
  },
  rural_valuations: {
    collection: 'rural_valuations', kind: 'service', category: 'rural_valuation', label: 'Avaliação de Imóveis', route: '/rural_valuation',
    describe: (d) => `Avaliação de imóvel rural${d.propertyName ? ` — ${d.propertyName}` : ''}`, value: (d) => num(d.fee || d.honorarios || 0), isDone: done,
  },
  appointments: {
    collection: 'appointments', kind: 'appointment', category: 'field_visit', label: 'Ordem de serviço / agendamento', route: '/scheduling',
    describe: (d) => `${d.serviceType || 'Atendimento'} — ${String(d.date || '').split('-').reverse().join('/')}`, value: () => 0,
    isDone: (d) => d?.status === 'completed',
  },
};

/** Categorias de serviço (para a configuração fiscal por tipo de serviço). */
export const SERVICE_CATEGORIES: { id: string; label: string }[] = [
  { id: 'irrigation', label: 'Irrigação' },
  { id: 'topography', label: 'Topografia' },
  { id: 'regularization', label: 'Regularização Ambiental' },
  { id: 'analysis', label: 'Análises Técnicas' },
  { id: 'credit', label: 'Crédito Rural' },
  { id: 'judicial_expertise', label: 'Perícia Judicial' },
  { id: 'rural_valuation', label: 'Avaliação de Imóveis' },
  { id: 'field_visit', label: 'Visita / Consultoria' },
  { id: 'other', label: 'Outros serviços' },
];

/** Categoria do Financeiro (financials.category) para a conta a receber. */
export function financialCategoryFor(serviceCategory?: string): string {
  const map: Record<string, string> = {
    irrigation: 'irrigation', topography: 'topography', regularization: 'regularization', analysis: 'analysis',
    credit: 'credit', field_visit: 'field_visit',
  };
  return map[serviceCategory || ''] || 'other';
}
