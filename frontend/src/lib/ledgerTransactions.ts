import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { Actor } from './billing/service';

/** A permanent key per contract/installment prevents concurrent duplicate payments. */
export async function payContractInstallmentTransaction(db: Firestore, contractId: string, installmentId: string, actor: Actor) {
  const ref = doc(db, 'contracts', contractId);
  const recRef = doc(db, 'financials', `contract_${contractId}_${installmentId}`);
  return runTransaction(db, async tx => {
    const [snapshot, existing] = await Promise.all([tx.get(ref), tx.get(recRef)]);
    if (!snapshot.exists()) throw new Error('Contrato não encontrado.');
    const contract = snapshot.data();
    if (['cancelled', 'cancelado', 'suspenso'].includes(contract.status)) throw new Error('Contrato cancelado.');
    const target = contract.installments?.find((p: any) => p.id === installmentId);
    if (!target) throw new Error('Parcela não encontrada.');
    if (target.status === 'paid' || existing.exists()) throw new Error('Esta parcela já foi paga.');
    if (!Number.isFinite(target.value) || target.value <= 0) throw new Error('Valor da parcela inválido.');
    const now = new Date().toISOString();
    const day = new Date();
    const paymentDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const installments = contract.installments.map((p: any) => p.id === installmentId ? { ...p, status: 'paid', paymentDate } : p);
    tx.update(ref, { installments, updatedAt: now });
    tx.set(recRef, {
      clientId: contract.clientId, clientName: contract.clientName, category: 'contract',
      description: `Parcela ${target.installmentNumber}/${contract.installmentsCount} do Contrato ${contract.contractNumber}`,
      value: target.value, dueDate: target.dueDate, paymentDate, status: 'paid', isExpense: false,
      contractId, installmentId, createdBy: actor.uid, createdAt: now, updatedAt: now,
      notes: 'Baixa transacional do contrato.',
    });
    return { installments, value: target.value };
  });
}

/** Approval creates a payable; it does not claim that money has already left the bank. */
export async function approveExpenseReportTransaction(db: Firestore, reportId: string, notes: string, actor: Actor) {
  const ref = doc(db, 'expense_reports', reportId);
  const recRef = doc(db, 'financials', `expense_${reportId}`);
  return runTransaction(db, async tx => {
    const [snapshot, existing] = await Promise.all([tx.get(ref), tx.get(recRef)]);
    if (!snapshot.exists()) throw new Error('Solicitação não encontrada.');
    const report = snapshot.data();
    if (report.createdBy === actor.uid) throw new Error('Você não pode aprovar sua própria despesa.');
    if (report.status !== 'pending_approval' || existing.exists()) throw new Error('Solicitação já processada.');
    if (!Number.isFinite(report.value) || report.value <= 0) throw new Error('Valor da despesa inválido.');
    const now = new Date().toISOString();
    tx.update(ref, { status: 'approved', approvedBy: actor.displayName || actor.email || actor.uid, approvedAt: now, approvalNotes: notes, updatedAt: now, financialId: recRef.id });
    tx.set(recRef, {
      clientId: 'empresa-interna', clientName: 'AgroGestão Pro (Gasto Interno)', category: 'expense_report',
      description: `[Despesa Aprovada] ${report.description} (${report.createdByName || ''})`.slice(0, 1000),
      value: report.value, dueDate: report.dueDate, status: 'pending', isExpense: true,
      serviceId: reportId, serviceType: 'expense_report', createdBy: actor.uid, createdAt: now, updatedAt: now,
      notes: notes.slice(0, 5000),
    });
    return recRef.id;
  });
}
