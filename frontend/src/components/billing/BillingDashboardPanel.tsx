import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, CalendarCheck2, CheckCircle2, Wallet, AlertTriangle, FileCheck2, FileClock, Wrench, Package, ChevronRight } from 'lucide-react';
import ServiceKpiCards, { formatBRL, isThisMonth } from '../service/ServiceKpiCards';
import { todayLocalDateString } from '../../lib/utils';
import { computeBillingStatus } from '../../lib/billing/calc';
import { useBillings, useFiscalDocuments, usePayments } from '../../lib/billing/service';

/** Indicadores de faturamento no Dashboard (Gerente/Administrador) — tempo real. */
export default function BillingDashboardPanel() {
  const navigate = useNavigate();
  const { data: billings } = useBillings();
  const { data: payments } = usePayments();
  const { data: docs } = useFiscalDocuments();
  const today = todayLocalDateString();

  const k = useMemo(() => {
    const active = billings.filter(b => b.status !== 'cancelled' && b.status !== 'draft');
    const month = active.filter(b => isThisMonth(b.issueDate));
    const itemsOfMonth = month.flatMap(b => b.items || []);
    const openInst = active.flatMap(b => b.installments.filter(p => p.status === 'pending'));
    return {
      today: active.filter(b => b.issueDate === today).reduce((s, b) => s + b.total, 0),
      month: month.reduce((s, b) => s + b.total, 0),
      received: payments.filter(p => isThisMonth(p.paidAt)).reduce((s, p) => s + p.amount, 0),
      open: openInst.reduce((s, p) => s + p.value, 0),
      overdue: openInst.filter(p => p.dueDate < today).reduce((s, p) => s + p.value, 0),
      overdueCount: active.filter(b => computeBillingStatus(b, today) === 'overdue').length,
      issued: docs.filter(d => d.status === 'issued' && isThisMonth(d.issuedAt || d.createdAt)).length,
      pending: active.filter(b => !b.fiscal || ['not_issued', 'processing', 'rejected'].includes(b.fiscal.status)).length,
      services: itemsOfMonth.filter(i => i.kind !== 'product').reduce((s, i) => s + (i.total || 0), 0),
      products: itemsOfMonth.filter(i => i.kind === 'product').reduce((s, i) => s + (i.total || 0), 0),
    };
  }, [billings, payments, docs, today]);

  return (
    <div className="space-y-3" data-dashboard-billing>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Receipt className="w-4 h-4 text-emerald-600" /> Faturamento</h2>
        <button onClick={() => navigate('/billing')} className="text-emerald-600 hover:text-emerald-700 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1">Abrir Faturamento <ChevronRight className="w-3 h-3" /></button>
      </div>
      <ServiceKpiCards items={[
        { label: 'Faturado hoje', value: formatBRL(k.today), icon: CalendarCheck2, tone: 'emerald' },
        { label: 'Faturado no mês', value: formatBRL(k.month), icon: Receipt, tone: 'emerald' },
        { label: 'Recebido no mês', value: formatBRL(k.received), icon: CheckCircle2, tone: 'slate' },
        { label: 'Em aberto', value: formatBRL(k.open), hint: 'parcelas a receber', icon: Wallet, tone: 'amber' },
      ]} />
      <ServiceKpiCards items={[
        { label: 'Vencido', value: formatBRL(k.overdue), hint: `${k.overdueCount} faturamento(s)`, icon: AlertTriangle, tone: 'rose' },
        { label: 'Notas emitidas (mês)', value: k.issued, icon: FileCheck2, tone: 'slate' },
        { label: 'Notas pendentes', value: k.pending, hint: 'faturados sem nota emitida', icon: FileClock, tone: 'amber' },
        { label: 'Serviços / vendas (mês)', value: formatBRL(k.services), hint: `vendas: ${formatBRL(k.products)}`, icon: k.products > k.services ? Package : Wrench, tone: 'slate' },
      ]} />
    </div>
  );
}
