import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemTotal, billingTotals, splitInstallments, addMonthsYMD, computeBillingStatus,
  operationFromItems, fiscalDocForOperation, nextBillingSeq, billingNumberFor, receivableIdFor, paidTotalOf,
} from './calc';

test('total do item e do faturamento (quantidade × unitário − desconto)', () => {
  assert.equal(itemTotal({ quantity: 3, unitPrice: 150.5, discount: 10 }), 441.5);
  assert.equal(itemTotal({ quantity: 1, unitPrice: 50, discount: 80 }), 0); // nunca negativo
  const t = billingTotals([{ quantity: 2, unitPrice: 1000, discount: 100 }, { quantity: 1, unitPrice: 250.25, discount: 0 }]);
  assert.deepEqual(t, { subtotal: 2250.25, discountTotal: 100, total: 2150.25 });
});

test('parcelas: soma sempre bate e vencimentos mensais', () => {
  const p = splitInstallments(1000, 3, '2026-10-10');
  assert.deepEqual(p.map(x => x.value), [333.34, 333.33, 333.33]);
  assert.equal(p.reduce((s, x) => s + Math.round(x.value * 100), 0), 100000);
  assert.deepEqual(p.map(x => x.dueDate), ['2026-10-10', '2026-11-10', '2026-12-10']);
  assert.equal(splitInstallments(500, 1, '2026-10-01').length, 1); // à vista
  assert.equal(addMonthsYMD('2026-01-31', 1), '2026-02-28');       // fim de mês
  assert.equal(addMonthsYMD('2026-11-15', 2), '2027-01-15');       // virada de ano
});

test('status do faturamento acompanha as parcelas', () => {
  const inst = splitInstallments(900, 3, '2026-10-01');
  const today = '2026-10-15';
  assert.equal(computeBillingStatus({ status: 'draft', installments: inst }, today), 'draft');
  assert.equal(computeBillingStatus({ status: 'cancelled', installments: inst }, today), 'cancelled');
  assert.equal(computeBillingStatus({ status: 'billed', installments: inst }, '2026-09-30'), 'billed');
  assert.equal(computeBillingStatus({ status: 'billed', installments: inst }, '2026-10-01'), 'billed'); // vence hoje: ainda não vencido
  assert.equal(computeBillingStatus({ status: 'billed', installments: inst }, today), 'overdue');
  const onePaid = inst.map((p, i) => (i === 0 ? { ...p, status: 'paid' as const, paidAmount: p.value } : p));
  assert.equal(computeBillingStatus({ status: 'billed', installments: onePaid }, '2026-10-20'), 'partial');
  assert.equal(paidTotalOf(onePaid), 300);
  const allPaid = inst.map(p => ({ ...p, status: 'paid' as const }));
  assert.equal(computeBillingStatus({ status: 'overdue', installments: allPaid }, '2027-05-01'), 'paid');
});

test('natureza da operação define o documento fiscal (sem assumir no misto)', () => {
  assert.equal(operationFromItems([{ kind: 'service' }]), 'service');
  assert.equal(operationFromItems([{ kind: 'product' }, { kind: 'product' }]), 'product');
  assert.equal(operationFromItems([{ kind: 'service' }, { kind: 'product' }]), 'mixed');
  assert.equal(fiscalDocForOperation('service'), 'NFSE');
  assert.equal(fiscalDocForOperation('product'), 'NFE');
  assert.equal(fiscalDocForOperation('mixed'), null);
});

test('numeração FAT-AAAA-NNNN e id fixo da conta a receber', () => {
  assert.equal(nextBillingSeq(['FAT-2026-0001', 'FAT-2026-0007', 'FAT-2025-0099'], 2026), 8);
  assert.equal(nextBillingSeq([], 2027), 1);
  assert.equal(billingNumberFor(2026, 12), 'FAT-2026-0012');
  assert.equal(receivableIdFor('FAT-2026-0012', 2), 'FAT-2026-0012-P2');
});
