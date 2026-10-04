import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, writeBatch } from 'firebase/firestore';
let env: RulesTestEnvironment;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-agrogestao', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await Promise.all(['admin', 'manager', 'consultant'].map(uid => setDoc(doc(db, 'users', uid), { uid, role: uid, displayName: uid })));
    await setDoc(doc(db, 'inventory_items', 'seed'), { currentQuantity: 10 });
    await setDoc(doc(db, 'channel_messages', 'msg'), { senderId: 'admin', content: 'Olá' });
    await setDoc(doc(db, 'vehicles', 'car'), { currentKm: 100, status: 'available' });
    await setDoc(doc(db, 'expense_reports', 'expense'), { createdBy: 'manager', status: 'pending_approval', value: 10 });
  });
});
const dbFor = (uid: string, extra = {}) => env.authenticatedContext(uid, { role: uid, auth_time: Math.floor(Date.now() / 1000), ...extra }).firestore();
test('hashes de senha e flag MFA não podem ser gravados no perfil pelo cliente', async () => {
  const db = dbFor('admin');
  await assertFails(updateDoc(doc(db, 'users', 'consultant'), { passwordHash: 'hash' }));
  await assertFails(updateDoc(doc(db, 'users', 'admin'), { twoFactorEnabled: false }));
  await assertFails(getDoc(doc(db, 'user_credentials', 'admin')));
});
test('perfil bloqueado corta acesso mesmo com token de administrador ainda válido', async () => {
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'users', 'admin'), { blocked: true }));
  await assertFails(getDoc(doc(dbFor('admin'), 'inventory_items', 'seed')));
  await assertFails(getDoc(doc(dbFor('admin'), 'users', 'admin')));
});
test('conta com MFA exige claim comprovada pelo servidor', async () => {
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'users', 'admin'), { twoFactorEnabled: true }));
  await assertFails(getDoc(doc(dbFor('admin'), 'inventory_items', 'seed')));
  await assertSucceeds(getDoc(doc(dbFor('admin', { mfaVerified: true }), 'inventory_items', 'seed')));
});
test('estoque negativo é rejeitado inclusive para administrador', async () => {
  await assertFails(updateDoc(doc(dbFor('admin'), 'inventory_items', 'seed'), { currentQuantity: -1 }));
  await assertSucceeds(updateDoc(doc(dbFor('consultant'), 'inventory_items', 'seed'), { currentQuantity: 3 }));
});
test('colaborador reage à mensagem de outro sem editar conteúdo ou reações alheias', async () => {
  const ref = doc(dbFor('consultant'), 'channel_messages', 'msg');
  await assertSucceeds(updateDoc(ref, { 'reactionByUser.consultant': ['👍'] }));
  await assertFails(updateDoc(ref, { content: 'alterado' }));
  await assertFails(updateDoc(ref, { 'reactionByUser.admin': ['👍'] }));
});
test('viagem e odômetro podem ser gravados juntos pelo motorista', async () => {
  const db = dbFor('consultant');
  await assertFails(updateDoc(doc(db, 'vehicles', 'car'), { currentKm: 120 }));
  const batch = writeBatch(db);
  batch.set(doc(db, 'vehicle_trips', 'trip'), { driverId: 'consultant', vehicleId: 'car', endKm: 120 });
  batch.update(doc(db, 'vehicles', 'car'), { currentKm: 120, lastTripId: 'trip', status: 'available' });
  await assertSucceeds(batch.commit());
});
test('gestor não aprova a própria despesa', async () => {
  await assertFails(updateDoc(doc(dbFor('manager'), 'expense_reports', 'expense'), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(dbFor('admin'), 'expense_reports', 'expense'), { status: 'approved' }));
});

test('pagamentos concorrentes produzem apenas uma baixa de parcela', async () => {
  const { payContractInstallmentTransaction } = await import('../frontend/src/lib/ledgerTransactions');
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'contracts', 'contract'), {
    clientId: 'client', clientName: 'Cliente', status: 'active', contractNumber: '1', installmentsCount: 1,
    installments: [{ id: 'p1', status: 'pending', value: 100, dueDate: '2026-10-10', installmentNumber: 1 }],
  }));
  const db = dbFor('manager');
  const actor = { uid: 'manager', displayName: 'Gestor' };
  const results = await Promise.allSettled([1, 2].map(() => payContractInstallmentTransaction(db as any, 'contract', 'p1', actor)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const paid = await getDoc(doc(db, 'financials', 'contract_contract_p1'));
  assert.equal(paid.data()?.value, 100);
  assert.equal((await getDoc(doc(db, 'contracts', 'contract'))).data()?.installments[0].status, 'paid');
});

test('aprovações concorrentes geram somente uma conta a pagar pendente', async () => {
  const { approveExpenseReportTransaction } = await import('../frontend/src/lib/ledgerTransactions');
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'expense_reports', 'expense'), {
    description: 'Viagem', dueDate: '2026-10-10', createdByName: 'Gestor',
  }));
  const db = dbFor('admin');
  const actor = { uid: 'admin', displayName: 'Administrador' };
  const results = await Promise.allSettled([1, 2].map(() => approveExpenseReportTransaction(db as any, 'expense', '', actor)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await getDoc(doc(db, 'financials', 'expense_expense'))).data()?.status, 'pending');
});

test('reserva de origem não pode ser redirecionada enquanto faturamento estiver ativo', async () => {
  const db = dbFor('manager');
  const source = { id: 'analysis1', collection: 'analyses' };
  const billing = { number: 'FAT-2026-0001', status: 'draft', clientId: 'client', clientName: 'Cliente', items: [], total: 100, installments: [{}], createdBy: 'manager', source };
  const batch = writeBatch(db);
  batch.set(doc(db, 'billings', billing.number), billing);
  batch.set(doc(db, 'billing_origins', 'analyses_analysis1'), { billingId: billing.number, sourceId: source.id, sourceCollection: source.collection });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(db, 'billings', billing.number), { source: { id: 'another', collection: 'analyses' } }));
  const second = writeBatch(db);
  second.set(doc(db, 'billings', 'FAT-2026-0002'), { ...billing, number: 'FAT-2026-0002' });
  second.update(doc(db, 'billing_origins', 'analyses_analysis1'), { billingId: 'FAT-2026-0002' });
  await assertFails(second.commit());
});

test('documentos preservam cliente e proprietário e recusam alteração por outro consultor', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'documents', 'pdf'), { clientId: 'client', name: 'Laudo', type: 'application/pdf', url: '', uploadedBy: 'admin', uploadedAt: '2026-10-04' }));
  await assertFails(updateDoc(doc(dbFor('consultant'), 'documents', 'pdf'), { url: 'https://example.com/alterado.pdf' }));
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'documents', 'pdf'), { url: 'https://example.com/laudo.pdf' }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'documents', 'pdf'), { uploadedBy: 'manager' }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'documents', 'pdf'), { clientId: 'other' }));
});
