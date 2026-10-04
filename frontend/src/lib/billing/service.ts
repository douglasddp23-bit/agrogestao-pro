import { cancelPendingInstallments } from '../integrity';
// Operações do Faturamento no Firestore. Tudo vai para o banco (sincroniza em
// tempo real entre os computadores via onSnapshot) — nada fica só na memória.
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, where, writeBatch,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { logAudit } from '../audit';
import { getAuthToken, todayLocalDateString } from '../utils';
import {
  billingNumberFor, billingTotals, computeBillingStatus, fiscalDocForOperation, itemTotal, nextBillingSeq,
  operationFromItems, paidTotalOf, receivableIdFor, round2,
} from './calc';
import { BILLING_SOURCES, financialCategoryFor } from './sources';
import type {
  Billing, BillingItem, FiscalDocument, FiscalEvent, FiscalSettings, Installment, Payment, PaymentMethod,
} from './types';

export interface Actor { uid: string; displayName?: string | null; email?: string | null }
const actorName = (u: Actor) => u.displayName || u.email || 'Usuário';

// ─── Leitura em tempo real ──────────────────────────────────────────────────
function useCollection<T>(build: () => any, deps: any[], enabled = true): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const unsub = onSnapshot(build(), (snap: any) => {
      setData(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as T));
      setLoading(false);
    }, (err: any) => { console.warn('[Faturamento] leitura:', err?.code || err); setLoading(false); });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return { data, loading };
}

export const useBillings = (enabled = true) =>
  useCollection<Billing>(() => query(collection(db, 'billings'), orderBy('createdAt', 'desc')), [], enabled);
export const usePayments = (enabled = true) =>
  useCollection<Payment>(() => query(collection(db, 'payments'), orderBy('createdAt', 'desc')), [], enabled);
export const useFiscalDocuments = (enabled = true) =>
  useCollection<FiscalDocument>(() => query(collection(db, 'fiscal_documents'), orderBy('createdAt', 'desc')), [], enabled);
export const useFiscalEvents = (billingId: string | undefined) =>
  useCollection<FiscalEvent>(() => query(collection(db, 'fiscal_events'), where('billingId', '==', billingId || '-')), [billingId], !!billingId);

export function useFiscalSettings(enabled = true) {
  const [settings, setSettings] = useState<Partial<FiscalSettings> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(doc(db, 'fiscal_settings', 'company'),
      (s) => setSettings(s.exists() ? (s.data() as FiscalSettings) : {}),
      () => setSettings({}));
  }, [enabled]);
  return settings;
}

// Uma única escuta de faturamentos compartilhada por todos os botões "Faturar
// serviço" de uma página (em vez de uma escuta por cartão).
type Listener = (list: Billing[]) => void;
let shared: { list: Billing[]; unsub: (() => void) | null; listeners: Set<Listener> } = { list: [], unsub: null, listeners: new Set() };
export function subscribeBillingsShared(fn: Listener): () => void {
  shared.listeners.add(fn);
  fn(shared.list);
  if (!shared.unsub) {
    shared.unsub = onSnapshot(query(collection(db, 'billings'), orderBy('createdAt', 'desc')), (snap) => {
      shared.list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Billing);
      shared.listeners.forEach(l => l(shared.list));
    }, () => { /* sem permissão: nenhum botão de faturamento aparece */ });
  }
  return () => {
    shared.listeners.delete(fn);
    if (!shared.listeners.size && shared.unsub) { shared.unsub(); shared.unsub = null; shared.list = []; }
  };
}

// ─── Pré-preenchimento a partir da origem ───────────────────────────────────
export interface BillingDraft {
  clientId: string;
  clientName: string;
  clientDoc: string;
  source: Billing['source'];
  issueDate: string;
  dueDate: string;
  description: string;
  items: BillingItem[];
  paymentMethod: PaymentMethod;
  installmentCount: number;
  installments: Installment[];
  notes: string;
  fiscalDocType: Billing['fiscalDocType'];
  responsibleId?: string;
  responsibleName?: string;
}

export const newItem = (kind: BillingItem['kind'] = 'service'): BillingItem => ({
  id: Math.random().toString(36).slice(2, 10), kind, description: '', quantity: 1, unitPrice: 0, discount: 0, total: 0,
});

export function emptyDraft(): BillingDraft {
  const today = todayLocalDateString();
  return {
    clientId: '', clientName: '', clientDoc: '', source: { kind: 'manual' },
    issueDate: today, dueDate: today, description: '', items: [newItem()], paymentMethod: 'pix',
    installmentCount: 1, installments: [], notes: '', fiscalDocType: 'NFSE',
  };
}

/** Monta o faturamento a partir de um serviço/agendamento já cadastrado. */
export async function draftFromSource(collectionName: string, id: string): Promise<BillingDraft> {
  const def = BILLING_SOURCES[collectionName];
  if (!def) throw new Error('Origem de faturamento desconhecida.');
  const snap = await getDoc(doc(db, collectionName, id));
  if (!snap.exists()) throw new Error('O serviço de origem não foi encontrado (pode ter sido excluído).');
  const d: any = snap.data();
  const category = collectionName === 'analyses' && d.type === 'credit' ? 'credit' : def.category;
  let clientDoc = '';
  let clientName = d.clientName || d.requerido || '';
  if (d.clientId) {
    try {
      const c = await getDoc(doc(db, 'clients', d.clientId));
      if (c.exists()) { clientDoc = (c.data() as any).cpf || ''; clientName = clientName || (c.data() as any).name || ''; }
    } catch { /* sem acesso ao cadastro: fica em branco */ }
  }
  const value = def.value(d);
  const item: BillingItem = { ...newItem('service'), description: def.describe(d), unitPrice: value, total: value, serviceCategory: category };
  const draft = emptyDraft();
  return {
    ...draft,
    clientId: d.clientId || '',
    clientName,
    clientDoc,
    source: { kind: def.kind, collection: collectionName, id, label: `${def.label} — ${def.describe(d)}`, serviceCategory: category },
    description: def.describe(d),
    items: [item],
    responsibleId: d.assignedTo || d.createdBy || d.technicianId || '',
    responsibleName: d.responsibleTechnician || d.technicalResponsible || d.responsibleTech?.name || d.responsible || d.technicianName || '',
  };
}

// ─── Gravação ───────────────────────────────────────────────────────────────
function normalizeItems(items: BillingItem[]): BillingItem[] {
  return items
    .filter(i => i.description.trim() && Number(i.quantity) > 0)
    .map(i => ({
      ...i,
      description: i.description.trim().slice(0, 300),
      quantity: round2(i.quantity), unitPrice: round2(i.unitPrice), discount: round2(i.discount), total: itemTotal(i),
    }));
}

function buildBillingDoc(draft: BillingDraft, actor: Actor, id: string, confirm: boolean): Billing {
  const items = normalizeItems(draft.items);
  const totals = billingTotals(items);
  const now = new Date().toISOString();
  const operationType = operationFromItems(items);
  const installments = (draft.installments.length ? draft.installments : []).map(p => ({ ...p, status: 'pending' as const }));
  const base: Billing = {
    id, number: id, status: confirm ? 'billed' : 'draft', operationType,
    clientId: draft.clientId, clientName: draft.clientName.slice(0, 200), clientDoc: draft.clientDoc || '',
    source: draft.source, issueDate: draft.issueDate, dueDate: installments[0]?.dueDate || draft.dueDate,
    description: draft.description.trim().slice(0, 2000), items, ...totals,
    paymentMethod: draft.paymentMethod, installments, paidTotal: 0, notes: draft.notes.slice(0, 5000),
    fiscalDocType: draft.fiscalDocType ?? fiscalDocForOperation(operationType),
    responsibleId: draft.responsibleId || actor.uid, responsibleName: draft.responsibleName || actorName(actor),
    createdBy: actor.uid, createdByName: actorName(actor), createdAt: now, updatedAt: now,
    ...(confirm ? { confirmedAt: now } : {}),
  };
  return JSON.parse(JSON.stringify(base)); // tira "undefined" (o Firestore não aceita)
}

/** Valida o rascunho antes de gravar — devolve a 1ª mensagem de erro ou null. */
export function validateDraft(draft: BillingDraft): string | null {
  if (!draft.clientId) return 'Escolha o cliente.';
  const items = normalizeItems(draft.items);
  if (!items.length) return 'Inclua pelo menos um item com descrição e quantidade.';
  if (operationFromItems(items) === 'mixed') return 'Separe produtos e serviços em faturamentos próprios antes de confirmar.';
  if (items.some(i => i.unitPrice < 0 || i.discount < 0)) return 'Valores e descontos não podem ser negativos.';
  const { total } = billingTotals(items);
  if (total <= 0) return 'O valor total do faturamento precisa ser maior que zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.issueDate)) return 'Informe a data de emissão.';
  if (!draft.installments.length) return 'Defina o parcelamento (à vista = 1 parcela).';
  const sum = round2(draft.installments.reduce((s, p) => s + Number(p.value || 0), 0));
  if (Math.abs(sum - total) > 0.009) return `A soma das parcelas (${sum.toFixed(2)}) é diferente do total (${total.toFixed(2)}).`;
  if (draft.installments.some(p => !(Number(p.value) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate))) return 'Cada parcela precisa de valor e vencimento.';
  if (draft.installments.some(p => p.dueDate < draft.issueDate)) return 'Nenhum vencimento pode ser antes da data de emissão.';
  return null;
}

/** Cria o faturamento com número FAT-AAAA-NNNN único (mesmo com dois computadores). */
export async function createBilling(draft: BillingDraft, actor: Actor, confirm: boolean, existingIds: string[]): Promise<Billing> {
  const err = validateDraft(draft);
  if (err) throw new Error(err);
  const year = Number(draft.issueDate.slice(0, 4)) || new Date().getFullYear();
  let seq = nextBillingSeq(existingIds, year);
  let saved: Billing | null = null;
  for (let attempt = 0; attempt < 50 && !saved; attempt++, seq++) {
    const id = billingNumberFor(year, seq);
    const ref = doc(db, 'billings', id);
    const data = buildBillingDoc(draft, actor, id, false);
    const origin = draft.source.collection && draft.source.id ? doc(db, 'billing_origins', `${draft.source.collection}_${draft.source.id}`) : null;
    const ok = await runTransaction(db, async (tx) => {
      if (origin) {
        const reservation = await tx.get(origin);
        if (reservation.exists()) {
          const previous = await tx.get(doc(db, 'billings', reservation.data().billingId));
          if (previous.exists() && previous.data().status !== 'cancelled') throw new Error('Este serviço já possui faturamento ativo. Abra o faturamento existente.');
        }
      }
      if ((await tx.get(ref)).exists()) return false; // número já usado no outro computador
      const { id: _id, ...payload } = data;
      tx.set(ref, payload);
      if (origin) tx.set(origin, { billingId: id, sourceCollection: draft.source.collection, sourceId: draft.source.id });
      return true;
    });
    if (ok) saved = data;
  }
  if (!saved) throw new Error('Não foi possível gerar o número do faturamento. Tente de novo.');
  await logAudit({
    userId: actor.uid, userName: actorName(actor), action: 'created', collection: 'billings', recordId: saved.id,
    recordName: `${saved.number} — ${saved.clientName}`,
    details: `Faturamento criado (${saved.source.label || 'lançamento manual'}), total R$ ${saved.total.toFixed(2)}, ${saved.installments.length} parcela(s).`,
    newValues: { total: saved.total, parcelas: saved.installments.length, origem: saved.source.collection || 'manual' },
  });
  if (confirm) return confirmBilling(saved.id, actor);
  return saved;
}

export async function updateDraft(billing: Billing, draft: BillingDraft, actor: Actor): Promise<void> {
  if (billing.status !== 'draft') throw new Error('Só rascunhos podem ser editados por completo.');
  if (draft.source.id !== billing.source.id || draft.source.collection !== billing.source.collection) throw new Error('A origem do faturamento não pode ser trocada. Cancele o rascunho e crie outro.');
  const err = validateDraft(draft);
  if (err) throw new Error(err);
  const data = buildBillingDoc(draft, actor, billing.id, false);
  const { id: _i, createdAt: _c, createdBy: _b, createdByName: _n, number: _num, clientId: _cl, source: _source, ...patch } = data;
  const batch = writeBatch(db);
  batch.update(doc(db, 'billings', billing.id), { ...patch, clientName: data.clientName, updatedAt: new Date().toISOString() });
  await batch.commit();
  await logAudit({ userId: actor.uid, userName: actorName(actor), action: 'updated', collection: 'billings', recordId: billing.id,
    recordName: `${billing.number} — ${billing.clientName}`, details: 'Rascunho de faturamento editado.',
    previousValues: { total: billing.total }, newValues: { total: data.total } });
}

/**
 * Confirma (fatura): cria UMA conta a receber por parcela no Financeiro já
 * existente. O id da conta é fixo (FAT-…-P1, -P2…) e a transação só cria o que
 * ainda não existe — clicar duas vezes ou confirmar nos dois computadores ao
 * mesmo tempo nunca lança a mesma conta duas vezes.
 */
export async function confirmBilling(billingId: string, actor: Actor): Promise<Billing> {
  const ref = doc(db, 'billings', billingId);
  const preview = await getDoc(ref);
  const source = preview.data()?.source;
  if (source?.collection === 'analyses' && source.id) {
    const legacy = await getDocs(query(collection(db, 'financials'), where('linkedServiceId', '==', source.id)));
    if (legacy.docs.some(d => d.data().status !== 'cancelled' && d.data().billingId !== billingId)) {
      throw new Error('Já existe cobrança financeira antiga desta análise. Concilie/cancele essa cobrança antes de confirmar o faturamento.');
    }
  }
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Faturamento não encontrado.');
    const b = { id: snap.id, ...snap.data() } as Billing;
    if (b.status === 'cancelled') throw new Error('Faturamento cancelado não pode ser confirmado.');
    const recRefs = b.installments.map(p => doc(db, 'financials', receivableIdFor(b.id, p.number)));
    const recSnaps = await Promise.all(recRefs.map(r => tx.get(r)));
    const now = new Date().toISOString();
    const category = financialCategoryFor(b.source?.serviceCategory);
    const installments = b.installments.map((p, i) => {
      if (!recSnaps[i].exists()) {
        tx.set(recRefs[i], {
          clientId: b.clientId, clientName: b.clientName,
          description: `${b.number} — parcela ${p.number}/${b.installments.length}: ${b.description || b.items?.[0]?.description || b.source?.label || 'Faturamento'}`.slice(0, 1000),
          value: p.value, status: 'pending', dueDate: p.dueDate, category, isExpense: false,
          billingId: b.id, billingNumber: b.number, installmentNumber: p.number,
          ...(b.source?.id ? { serviceId: b.source.id } : {}),
          competencia: b.issueDate.slice(0, 7),
          createdBy: actor.uid, createdAt: now, updatedAt: now,
        });
      }
      return { ...p, receivableId: recRefs[i].id };
    });
    const next: Billing = { ...b, installments, status: 'billed', confirmedAt: b.confirmedAt || now, updatedAt: now };
    next.status = computeBillingStatus(next, todayLocalDateString());
    tx.update(ref, { installments, status: next.status, confirmedAt: next.confirmedAt, updatedAt: now });
    return { next, created: recSnaps.filter(s => !s.exists()).length, wasDraft: b.status === 'draft' };
  });
  if (result.wasDraft || result.created) {
    await logAudit({ userId: actor.uid, userName: actorName(actor), action: 'status_changed', collection: 'billings', recordId: billingId,
      recordName: `${result.next.number} — ${result.next.clientName}`,
      details: `Faturamento confirmado: ${result.created} conta(s) a receber criada(s) no Financeiro.`,
      previousValues: { status: 'draft' }, newValues: { status: result.next.status } });
  }
  return result.next;
}

/**
 * Registra o pagamento de uma parcela: grava o pagamento (permanente), baixa a
 * conta a receber no Financeiro (entra no fluxo de caixa) e recalcula o status
 * do faturamento. Pagamento NÃO emite nota fiscal.
 */
export async function registerPayment(
  billingId: string, installmentNumber: number,
  data: { method: PaymentMethod; paidAt: string; notes?: string }, actor: Actor,
): Promise<Billing> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.paidAt)) throw new Error('Informe a data do pagamento.');
  const ref = doc(db, 'billings', billingId);
  const payRef = doc(collection(db, 'payments'));
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Faturamento não encontrado.');
    const b = { id: snap.id, ...snap.data() } as Billing;
    if (b.status === 'cancelled') throw new Error('Faturamento cancelado: não recebe pagamentos.');
    if (b.status === 'draft') throw new Error('Confirme o faturamento antes de registrar pagamentos.');
    const p = b.installments.find(x => x.number === installmentNumber);
    if (!p) throw new Error('Parcela não encontrada.');
    if (p.status === 'paid') throw new Error(`A parcela ${installmentNumber} já está paga.`);
    const recRef = doc(db, 'financials', p.receivableId || receivableIdFor(b.id, p.number));
    const recSnap = await tx.get(recRef);
    if (!recSnap.exists() || recSnap.data().status === 'paid' || recSnap.data().status === 'cancelled') {
      throw new Error('Conta a receber ausente ou já processada. Concilie o faturamento.');
    }
    const now = new Date().toISOString();
    const payment: Omit<Payment, 'id'> = {
      billingId: b.id, billingNumber: b.number, installmentNumber, receivableId: recRef.id,
      amount: p.value, method: data.method, paidAt: data.paidAt, notes: (data.notes || '').slice(0, 1000),
      userId: actor.uid, userName: actorName(actor), createdAt: now, clientId: b.clientId, clientName: b.clientName,
    };
    tx.set(payRef, payment);
    if (recSnap.exists()) {
      tx.update(recRef, { status: 'paid', paymentDate: data.paidAt, paymentMethod: data.method, paymentId: payRef.id, updatedAt: now });
    }
    const installments = b.installments.map(x => x.number === installmentNumber
      ? { ...x, status: 'paid' as const, paidAt: data.paidAt, paidAmount: x.value, paymentMethod: data.method, paymentId: payRef.id }
      : x);
    const next: Billing = { ...b, installments, paidTotal: paidTotalOf(installments), updatedAt: now };
    next.status = computeBillingStatus(next, todayLocalDateString());
    tx.update(ref, { installments, paidTotal: next.paidTotal, status: next.status, updatedAt: now });
    return { next, previous: b.status, value: p.value };
  });
  await logAudit({ userId: actor.uid, userName: actorName(actor), action: 'payment', collection: 'billings', recordId: billingId,
    recordName: `${result.next.number} — ${result.next.clientName}`,
    details: `Pagamento da parcela ${installmentNumber}: R$ ${result.value.toFixed(2)} (${data.method}) em ${data.paidAt.split('-').reverse().join('/')}.${data.notes ? ' Obs.: ' + data.notes : ''}`,
    previousValues: { status: result.previous }, newValues: { status: result.next.status, pago: result.next.paidTotal } });
  return result.next;
}

/**
 * Cancela o faturamento: parcelas em aberto e as contas a receber delas ficam
 * "cancelado"; o que já foi pago, os pagamentos e a nota fiscal (se houver)
 * continuam no histórico. Cancelar o faturamento NÃO cancela a nota fiscal.
 */
export async function cancelBilling(billing: Billing, reason: string, actor: Actor): Promise<void> {
  if (!reason.trim()) throw new Error('Informe o motivo do cancelamento.');
  const ref = doc(db, 'billings', billing.id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Faturamento não encontrado.');
    const current = snap.data() as Billing;
    if (current.status === 'cancelled') throw new Error('Faturamento já cancelado.');
    const pending = current.installments.filter(p => p.status === 'pending' && p.receivableId);
    const receivables = await Promise.all(pending.map(p => tx.get(doc(db, 'financials', p.receivableId!))));
    if (receivables.some(x => !x.exists() || x.data().status === 'paid')) {
      throw new Error('As contas a receber divergem do faturamento. Concilie os pagamentos antes de cancelar.');
    }
    const now = new Date().toISOString();
    receivables.forEach(x => tx.update(x.ref, { status: 'cancelled', updatedAt: now }));
    tx.update(ref, { status: 'cancelled', installments: cancelPendingInstallments(current.installments),
      cancelReason: reason.trim().slice(0, 1000), cancelledAt: now, cancelledBy: actor.uid, updatedAt: now });
  });
  await logAudit({ userId: actor.uid, userName: actorName(actor), action: 'status_changed', collection: 'billings', recordId: billing.id,
    recordName: `${billing.number} — ${billing.clientName}`, details: `Faturamento cancelado. Motivo: ${reason.trim()}`,
    previousValues: { status: billing.status }, newValues: { status: 'cancelled' } });
}

/** Faturamentos cujo status mudou só pela passagem do tempo (vencido) — grava o status atual. */
export async function refreshOverdueStatuses(_list: Billing[]) {
  // Atraso é derivado por computeBillingStatus na leitura. Nunca sobrescreve
  // pagamentos/cancelamentos concorrentes com a cópia antiga de uma tela.
}

// ─── Documento fiscal (via servidor — o navegador nunca fala com o provedor) ──
async function fiscalCall<T = any>(path: string, body?: any, method = 'POST'): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`/api/fiscal/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e: any = new Error(data.error || 'Não foi possível concluir a operação fiscal.');
    e.code = data.code; e.technical = data.technical; e.documentId = data.documentId;
    throw e;
  }
  return data as T;
}

export const fiscalStatus = () => fiscalCall<{ configured: boolean; provider: string; environment: string }>('status', undefined, 'GET');
export const emitFiscalDocument = (billingId: string, docType?: string) => fiscalCall<{ document: FiscalDocument }>('emit', { billingId, docType });
export const consultFiscalDocument = (documentId: string) => fiscalCall<{ document: FiscalDocument }>('consult', { documentId });
export const retryFiscalDocument = (documentId: string) => fiscalCall<{ document: FiscalDocument }>('retry', { documentId });
export const cancelFiscalDocument = (documentId: string, reason: string) => fiscalCall<{ document: FiscalDocument }>('cancel', { documentId, reason });

/** Clientes que ainda não têm serviço faturado (para relatórios). */
export async function loadSourceDocs(collectionName: string) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
