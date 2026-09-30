// Testes das regras da Proposta de Crédito (rodar: npm test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateInvestmentTotal, calculateOwnResources, calculateFinancedAmount,
  calculateProposalTotals, calculateAdvisoryValue, expectedContractDate,
} from './calculations';
import { loadCreditProgram } from './programs';
import { loadBankPrograms, BANKS } from './banks';
import { createEmptyProposal, switchProgram, regionOfMunicipality, newInvestment, loadClientProperties } from './proposal';
import { validateProposal } from './validation';

const client: any = {
  id: 'cli1', name: 'João da Silva', cpf: '111.222.333-44',
  address: { city: 'Almenara', state: 'MG' },
  properties: [{ name: 'Fazenda Boa Esperança', areaHectares: 120, city: 'Almenara', state: 'MG' }, { name: 'Sítio BH', city: 'Belo Horizonte', state: 'MG' }],
};
const IR = loadCreditProgram('bnb-investimento-rural')!;
const PF = loadCreditProgram('bnb-pronaf')!;
const PA2 = loadCreditProgram('bnb-pronaf-a2')!;

const item = (over: any = {}) => ({ ...newInvestment(1), description: 'Construção de cerca', quantity: 1500, unit: 'M', unitValue: 10, ...over });

test('investimento total = quantidade × valor unitário', () => {
  assert.equal(calculateInvestmentTotal(item()), 15000);
  assert.equal(calculateInvestmentTotal({ quantity: 3, unitValue: 0.333 }), 1); // arredonda a 2 casas como a planilha
});

test('recursos próprios: total (Investimento Rural) e por unidade (PRONAF)', () => {
  assert.equal(calculateOwnResources(item({ ownResourcesTotal: 3000 }), 'total'), 3000);
  assert.equal(calculateOwnResources(item({ ownResourcesUnit: 2 }), 'unit'), 3000);
});

test('valor financiado = investimento total − recursos próprios (exemplo da especificação)', () => {
  assert.equal(calculateFinancedAmount(item({ ownResourcesTotal: 3000 }), 'total'), 12000);
  assert.equal(calculateFinancedAmount(item({ ownResourcesUnit: 2 }), 'unit'), 12000);
});

test('alterar quantidade, valor unitário ou recurso próprio recalcula', () => {
  const p = createEmptyProposal({ bankId: 'bnb', programId: IR.id, lineId: '219', client });
  p.investments = [item({ ownResourcesTotal: 3000 })];
  assert.equal(calculateProposalTotals(p, IR).investmentsTotal, 15000);
  p.investments[0].quantity = 2000;
  assert.equal(calculateProposalTotals(p, IR).investmentsTotal, 20000);
  p.investments[0].unitValue = 12;
  assert.equal(calculateProposalTotals(p, IR).investmentsTotal, 24000);
  p.investments[0].ownResourcesTotal = 4000;
  assert.equal(calculateProposalTotals(p, IR).investmentsFinanced, 20000);
});

test('totais, percentuais, irrigação e garantias (PRONAF)', () => {
  const p = createEmptyProposal({ bankId: 'bnb', programId: PF.id, lineId: '434', client });
  p.investments = [
    item({ ownResourcesUnit: 2, isCollateral: 'Sim' }),                                        // 15.000 (3.000 próprio)
    item({ description: 'Kit irrigação', quantity: 1, unitValue: 20000, ownResourcesUnit: 0, irrigation: 'Sim' }), // 20.000
  ];
  p.costs.custeioAgricola = { value: 5000, ownResources: 0 };
  p.costs.assessoria = { mode: 'percent', amount: 2, ownResources: 0 };
  p.costs.taxaIrrigacao = { percent: 3, ownResources: 0 };
  p.realGuarantees = [{ id: 'g', description: 'Fazenda', type: 'Hipoteca', value: 50000 }, { id: 'a', description: 'Aval', type: 'Aval', value: 999 }];
  const t = calculateProposalTotals(p, PF);
  assert.equal(t.investmentsTotal, 35000);
  assert.equal(t.irrigationBase, 20000);
  const assessoria = t.costLines.find(l => l.kind === 'assessoria')!;
  assert.equal(assessoria.total, 800);            // 2% de (35.000 + 5.000)
  assert.equal(t.costLines.find(l => l.kind === 'taxaIrrigacao')!.total, 600); // 3% de 20.000
  assert.equal(t.total, 41400);
  assert.equal(t.ownResources, 3000);
  assert.equal(t.financed, 38400);
  assert.equal(t.ownPct, 7.25);
  assert.equal(t.financedPct, 92.75);
  assert.equal(t.evolvingCollateral, 15000);
  assert.equal(t.realGuaranteesTotal, 50000);     // aval não conta como garantia real
  assert.equal(t.guaranteesTotal, 65000);
});

test('assessoria: teto de 2% (PRONAF aplica o teto; Investimento Rural zera e bloqueia)', () => {
  assert.equal(calculateAdvisoryValue(100000, { mode: 'percent', amount: 3, ownResources: 0 }, PF), 2000);
  assert.equal(calculateAdvisoryValue(100000, { mode: 'percent', amount: 3, ownResources: 0 }, IR), 0);
  const p = createEmptyProposal({ bankId: 'bnb', programId: IR.id, lineId: '219', client });
  p.objective = 'Implantação'; p.purpose = IR.purposes[0]; p.investments = [item()];
  p.costs.assessoria = { mode: 'percent', amount: 3, ownResources: 0 };
  assert.ok(validateProposal(p).some(i => i.field === 'costs.assessoria'));
});

test('assessoria PRONAF A: teto de R$ 2.500 (planilha)', () => {
  assert.equal(calculateAdvisoryValue(200000, { mode: 'percent', amount: 2, ownResources: 0 }, PA2), 2500);
  assert.equal(calculateAdvisoryValue(50000, { mode: 'percent', amount: 2, ownResources: 0 }, PA2), 1000);
});

test('validações com mensagens claras', () => {
  const p = createEmptyProposal({ bankId: 'bnb', programId: PF.id, client });
  p.clientId = '';
  p.investments = [newInvestment(1)];
  const msgs = validateProposal(p).map(i => i.message);
  assert.ok(msgs.includes('Selecione um cliente para continuar.'));
  assert.ok(msgs.includes('Informe pelo menos um item de investimento.'));
  assert.ok(msgs.includes('Informe a finalidade do crédito.'));
  assert.ok(msgs.includes('Informe o objetivo do crédito.'));
  assert.ok(msgs.includes('Selecione a linha do programa.'));
  p.clientId = 'cli1'; p.lineId = '434'; p.objective = 'Implantação'; p.purpose = PF.purposes[0];
  p.investments = [item({ ownResourcesUnit: 20 })];      // próprio 30.000 > total 15.000
  assert.ok(validateProposal(p).some(i => /não pode ser negativo/.test(i.message)));
  p.investments = [item({ ownResourcesUnit: 2 })];
  assert.deepEqual(validateProposal(p), []);
});

test('trocar programa mantém dados comuns e converte o recurso próprio', () => {
  const p = createEmptyProposal({ bankId: 'bnb', programId: IR.id, lineId: '219', client });
  p.branch = '1234'; p.objective = 'Relocalização'; p.investments = [item({ ownResourcesTotal: 3000 })];
  const q = switchProgram(p, PF.id);
  assert.equal(q.programId, PF.id);
  assert.equal(q.branch, '1234');
  assert.equal(q.clientName, 'João da Silva');
  assert.equal(q.properties[0].name, 'Fazenda Boa Esperança');
  assert.equal(q.investments[0].ownResourcesUnit, 2);     // 3.000 / 1.500
  assert.equal(q.objective, '');                          // "Relocalização" não existe no PRONAF
  assert.equal(q.lineId, '');
  assert.equal(calculateFinancedAmount(q.investments[0], PF.ownResourcesMode), 12000);
});

test('região automática pelo município (tabela da planilha)', () => {
  assert.equal(regionOfMunicipality('Almenara', 'MG'), 'Semi-árido');
  assert.equal(regionOfMunicipality('Belo Horizonte', 'MG'), 'Fora do Semi-árido');
  const props = loadClientProperties(client);
  assert.equal(props[0].region, 'Semi-árido');
  assert.equal(props[0].ownerName, 'João da Silva');
  assert.equal(props[1].region, 'Fora do Semi-árido');
});

test('previsão do contrato = data + 30 dias; bancos e programas configuráveis', () => {
  assert.equal(expectedContractDate('2026-09-30'), '2026-10-30');
  const bnb = loadBankPrograms('bnb').map(p => p.name);
  for (const n of ['Investimento Rural', 'PRONAF', 'PRONAF A', 'PRONAF A2']) assert.ok(bnb.includes(n), n);
  for (const b of ['bb', 'caixa', 'sicoob']) assert.ok(BANKS.find(x => x.id === b) && loadBankPrograms(b).length > 0, b);
});
