import test from 'node:test';
import assert from 'node:assert/strict';
import { stockAfterMovement, cancelPendingInstallments, parseMoneySource } from './integrity';

test('valores de origem preservam centavos nos formatos numérico, decimal e brasileiro', () => {
  assert.equal(parseMoneySource(100.50), 100.50);
  assert.equal(parseMoneySource('100.50'), 100.50);
  assert.equal(parseMoneySource('1.234,56'), 1234.56);
  assert.equal(parseMoneySource('100,50'), 100.50);
  assert.throws(() => parseMoneySource('inválido'));
  assert.throws(() => parseMoneySource(Infinity));
  assert.throws(() => parseMoneySource(-1));
});
test('retirada considera saldo atual e recusa saldo insuficiente', () => {
  assert.equal(stockAfterMovement(10, 7, 'out'), 3);
  assert.throws(() => stockAfterMovement(3, 7, 'out'));
  assert.equal(stockAfterMovement(0.3, 0.1, 'out'), 0.2);
  assert.equal(stockAfterMovement(3, 7, 'in'), 10);
});
test('movimentos inválidos não alteram saldo', () => {
  for (const quantity of [0, -1, Infinity, NaN]) assert.throws(() => stockAfterMovement(10, quantity, 'out'));
  assert.throws(() => stockAfterMovement(-1, 2, 'in'));
});
test('cancelamento preserva parcelas pagas e comprovantes, sem mutar a leitura', () => {
  const original = [{ status: 'paid', paidAmount: 50, paymentId: 'p1' }, { status: 'pending', paidAmount: 0 }];
  const cancelled = cancelPendingInstallments(original);
  assert.deepEqual(cancelled[0], original[0]);
  assert.equal(cancelled[1].status, 'cancelled');
  assert.equal(original[1].status, 'pending');
});
