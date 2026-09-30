// Bancos da Proposta e os programas que cada um oferece.
// Para acrescentar um banco: um item novo aqui, com os ids dos programas
// (programs.ts). Nenhuma outra parte do sistema precisa mudar.

import { CREDIT_PROGRAMS } from '../creditPrograms';
import { CREDIT_PROGRAM_CONFIGS, CreditProgramConfig } from './programs';

export interface Bank {
  id: string;
  name: string;
  programIds: string[];
}

/** Programas do Plano Safra usados pelos bancos que não têm planilha própria. */
const PLANO_SAFRA_IDS = CREDIT_PROGRAMS.map(p => p.id);

export const BANKS: Bank[] = [
  // Lista simplificada a pedido do escritório (30/09/2026): os três modelos completos
  // das planilhas (sem o PRONAF A — o A2 já traz as duas linhas) e, do Plano Safra,
  // só as linhas de CUSTEIO de Pronaf, Pronamp e demais produtores.
  // (Propostas antigas com outro programa continuam abrindo: a configuração não foi apagada.)
  { id: 'bnb', name: 'Banco do Nordeste (BNB)', programIds: ['bnb-investimento-rural', 'bnb-pronaf', 'bnb-pronaf-a2', 'pronaf-custeio', 'pronamp-custeio', 'custeio-demais'] },
  { id: 'bb', name: 'Banco do Brasil', programIds: PLANO_SAFRA_IDS },
  { id: 'caixa', name: 'Caixa Econômica Federal', programIds: PLANO_SAFRA_IDS },
  { id: 'sicoob', name: 'Sicoob', programIds: PLANO_SAFRA_IDS },
  { id: 'sicredi', name: 'Sicredi', programIds: PLANO_SAFRA_IDS },
  { id: 'cresol', name: 'Cresol', programIds: PLANO_SAFRA_IDS },
  { id: 'outro', name: 'Outro', programIds: PLANO_SAFRA_IDS },
];

export function loadBank(id?: string): Bank | undefined {
  return BANKS.find(b => b.id === id);
}

/** Banco pelo nome gravado nas propostas antigas (ex.: "Banco do Nordeste (BNB)"). */
export function bankFromName(name?: string): Bank | undefined {
  if (!name) return undefined;
  return BANKS.find(b => b.name === name) || BANKS.find(b => b.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 8)));
}

/** Programas disponíveis no banco, na ordem configurada. */
export function loadBankPrograms(bankId?: string): CreditProgramConfig[] {
  const bank = loadBank(bankId);
  if (!bank) return [];
  return bank.programIds
    .map(id => CREDIT_PROGRAM_CONFIGS.find(p => p.id === id))
    .filter((p): p is CreditProgramConfig => !!p);
}
