// Cálculos do faturamento — funções puras (sem banco), testadas em billing.test.ts.
import type { Billing, BillingItem, BillingStatus, FiscalDocType, Installment, OperationType } from './types';

export const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** Total do item = quantidade × valor unitário − desconto (nunca negativo). */
export function itemTotal(it: Pick<BillingItem, 'quantity' | 'unitPrice' | 'discount'>): number {
  const gross = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  return Math.max(0, round2(gross - (Number(it.discount) || 0)));
}

export function billingTotals(items: Pick<BillingItem, 'quantity' | 'unitPrice' | 'discount'>[]) {
  let subtotal = 0;
  let discountTotal = 0;
  for (const it of items) {
    subtotal += (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    discountTotal += Number(it.discount) || 0;
  }
  subtotal = round2(subtotal);
  discountTotal = round2(Math.min(discountTotal, subtotal));
  return { subtotal, discountTotal, total: round2(subtotal - discountTotal) };
}

/** Soma dias a uma data AAAA-MM-DD (fuso local, sem pular por horário de verão). */
export function addMonthsYMD(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay)); // 31/01 + 1 mês = 28 ou 29/02
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

/**
 * Divide o total em N parcelas mensais a partir do 1º vencimento.
 * Centavos que sobram da divisão vão para a 1ª parcela (a soma sempre bate).
 */
export function splitInstallments(total: number, count: number, firstDueDate: string): Installment[] {
  const n = Math.max(1, Math.min(120, Math.floor(Number(count) || 1)));
  const cents = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    value: (base + (i === 0 ? remainder : 0)) / 100,
    dueDate: addMonthsYMD(firstDueDate, i),
    status: 'pending' as const,
  }));
}

/** Tipo de operação a partir dos itens (natureza da operação — nunca assumido). */
export function operationFromItems(items: Pick<BillingItem, 'kind'>[]): OperationType {
  const hasService = items.some(i => i.kind === 'service');
  const hasProduct = items.some(i => i.kind === 'product');
  if (hasService && hasProduct) return 'mixed';
  return hasProduct ? 'product' : 'service';
}

/**
 * Documento fiscal conforme a natureza: serviço → NFS-e; produto → NF-e.
 * Serviço + produto: cada parte tem documento próprio; aqui devolve null para o
 * usuário escolher (não assumimos por ele).
 */
export function fiscalDocForOperation(op: OperationType): FiscalDocType | null {
  if (op === 'service') return 'NFSE';
  if (op === 'product') return 'NFE';
  return null;
}

export const paidTotalOf = (installments: Installment[]) =>
  round2(installments.filter(p => p.status === 'paid').reduce((s, p) => s + (Number(p.paidAmount ?? p.value) || 0), 0));

/**
 * Status do faturamento a partir das parcelas (recalculado sempre):
 * cancelado e rascunho mandam; senão pago / vencido / parcialmente pago / faturado.
 * "Vencido" = alguma parcela em aberto com vencimento ANTES de hoje (mesma regra
 * do Financeiro: vence no dia e só fica vencido no dia seguinte).
 */
export function computeBillingStatus(b: Pick<Billing, 'status' | 'installments'>, todayYMD: string): BillingStatus {
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'draft') return 'draft';
  const active = (b.installments || []).filter(p => p.status !== 'cancelled');
  if (!active.length) return 'billed';
  const paid = active.filter(p => p.status === 'paid');
  if (paid.length === active.length) return 'paid';
  if (active.some(p => p.status === 'pending' && p.dueDate < todayYMD)) return 'overdue';
  if (paid.length > 0) return 'partial';
  return 'billed';
}

/** Número do próximo faturamento do ano (FAT-AAAA-NNNN), a partir dos existentes. */
export function nextBillingSeq(existingIds: string[], year: number): number {
  const prefix = `FAT-${year}-`;
  let max = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) max = Math.max(max, Number(id.slice(prefix.length)) || 0);
  }
  return max + 1;
}
export const billingNumberFor = (year: number, seq: number) => `FAT-${year}-${String(seq).padStart(4, '0')}`;

/** Id do lançamento no Financeiro de cada parcela — fixo, para nunca duplicar. */
export const receivableIdFor = (billingId: string, installmentNumber: number) => `${billingId}-P${installmentNumber}`;
