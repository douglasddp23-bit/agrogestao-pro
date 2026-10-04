import { db } from './firebase';
import { payContractInstallmentTransaction, approveExpenseReportTransaction } from './ledgerTransactions';
import type { Actor } from './billing/service';

export const payContractInstallment = (contractId: string, installmentId: string, actor: Actor) => payContractInstallmentTransaction(db, contractId, installmentId, actor);
export const approveExpenseReport = (reportId: string, notes: string, actor: Actor) => approveExpenseReportTransaction(db, reportId, notes, actor);
