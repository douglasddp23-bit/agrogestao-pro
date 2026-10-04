/** Shared rules for transactional operations. No network or UI dependencies. */
export function stockAfterMovement(current: number, quantity: number, type: 'in' | 'out'): number {
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Saldo ou quantidade inválidos.');
  }
  const next = current + (type === 'in' ? quantity : -quantity);
  if (next < 0) throw new Error(`Estoque indisponível. Saldo atual: ${current}.`);
  return Math.round(next * 1e6) / 1e6;
}

export function cancelPendingInstallments<T extends { status: string }>(installments: T[]): T[] {
  return installments.map(p => p.status === 'pending' ? { ...p, status: 'cancelled' } : { ...p });
}

export function parseMoneySource(value: unknown): number {
  if (value == null || value === '') return 0;
  const raw = String(value).trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = typeof value === 'number' ? value : Number(normalized);
  if (!Number.isFinite(n) || n < 0) throw new Error('Valor inválido no serviço de origem. Revise o cadastro.');
  return n;
}
