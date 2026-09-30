import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../lib/permissions';
import { cn, todayLocalDateString } from '../../lib/utils';
import { subscribeBillingsShared } from '../../lib/billing/service';
import { computeBillingStatus } from '../../lib/billing/calc';
import { Billing, BILLING_STATUS_LABELS } from '../../lib/billing/types';

/**
 * Botão "Faturar serviço" das páginas de serviço. Se o serviço já tem um
 * faturamento (não cancelado), mostra o número e abre o faturamento em vez de
 * criar outro — evita faturar o mesmo serviço duas vezes.
 * Só aparece para quem pode faturar (Gerente/Administrador).
 */
export default function BillServiceButton({ collection, id, className }: { collection: string; id: string; className?: string }) {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string | undefined;
  const allowed = can(role, 'faturamento.visualizar');
  const navigate = useNavigate();
  const [billing, setBilling] = useState<Billing | null>(null);

  useEffect(() => {
    if (!allowed || !id) return;
    return subscribeBillingsShared(list => {
      setBilling(list.find(b => b.source?.collection === collection && b.source?.id === id && b.status !== 'cancelled') || null);
    });
  }, [allowed, collection, id]);

  if (!allowed) return null;
  if (billing) {
    const st = computeBillingStatus(billing, todayLocalDateString());
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/billing?abrir=${billing.id}`); }}
        title={`Faturado em ${billing.number} — ${BILLING_STATUS_LABELS[st]}`}
        className={cn('px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 border whitespace-nowrap',
          st === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : st === 'overdue' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-sky-50 text-sky-700 border-sky-200', className)}
        data-billed-service={billing.id}>
        <Receipt className="w-3 h-3" /> {billing.number} · {BILLING_STATUS_LABELS[st]}
      </button>
    );
  }
  if (!can(role, 'faturamento.criar')) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/billing?novo=1&origem=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`); }}
      title="Faturar serviço (abre o faturamento já preenchido)"
      className={cn('px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 whitespace-nowrap', className)}
      data-bill-service={id}>
      <Receipt className="w-3 h-3" /> Faturar serviço
    </button>
  );
}
