import React from 'react';
import { cn } from '../../lib/utils';

// Mini painel de indicadores das páginas de serviço — mesmo visual do painel
// da Perícia Judicial (4 cartões com número grande, legenda e ícone).
export type KpiTone = 'emerald' | 'slate' | 'amber' | 'rose';

export interface KpiItem {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: KpiTone;
}

const TONES: Record<KpiTone, { value: string; hint: string; box: string }> = {
  emerald: {
    value: 'text-slate-800 dark:text-slate-100',
    hint: 'text-emerald-600 dark:text-emerald-400',
    box: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
  },
  slate: {
    value: 'text-slate-800 dark:text-slate-100',
    hint: 'text-slate-500 dark:text-slate-400',
    box: 'bg-slate-50 dark:bg-emerald-950/40 text-slate-600 dark:text-slate-400',
  },
  amber: {
    value: 'text-amber-600 dark:text-amber-400',
    hint: 'text-amber-600 dark:text-amber-400',
    box: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  },
  rose: {
    value: 'text-rose-600 dark:text-rose-400',
    hint: 'text-rose-600 dark:text-rose-400',
    box: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400',
  },
};

export default function ServiceKpiCards({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-kpi-cards>
      {items.map((it) => {
        const tone = TONES[it.tone || 'slate'];
        const Icon = it.icon;
        return (
          <div
            key={it.label}
            className="glass-card p-5 rounded-3xl border border-white/40 dark:border-slate-800 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{it.label}</p>
              <h3 className={cn('text-2xl font-display font-extrabold mt-1 truncate', tone.value)}>{it.value}</h3>
              {it.hint && <span className={cn('text-[10px] font-medium mt-0.5 block', tone.hint)}>{it.hint}</span>}
            </div>
            <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', tone.box)}>
              <Icon className="w-6 h-6" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const formatBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

/** Converte datas do Firestore (Timestamp, {seconds}, ISO ou YYYY-MM-DD) em Date. */
export function toDateAny(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function isThisMonth(v: any) {
  const d = toDateAny(v);
  const now = new Date();
  return !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
