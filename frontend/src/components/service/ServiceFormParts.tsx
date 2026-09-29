import React from 'react';
import { cn } from '../../lib/utils';
import { formatBRL } from './ServiceKpiCards';

// Partes reaproveitadas pelos formulários em etapas (Irrigação e Topografia):
// valor do serviço com memória de cálculo e engenheiro responsável (CREA/CFTA).

// ─── Valor do serviço ───────────────────────────────────────────────────────
export interface ServicePricing {
  ratePerHa: number;     // R$ por hectare
  fixedFee: number;      // taxa fixa do projeto / elaboração
  travelCost: number;    // deslocamento / visitas
  artFee: number;        // ART (CREA) ou TRT (CFTA)
  otherCosts: number;    // outros custos
  otherLabel: string;
  discountPct: number;   // desconto (%)
}

export const emptyPricing = (): ServicePricing => ({
  ratePerHa: 0, fixedFee: 0, travelCost: 0, artFee: 0, otherCosts: 0, otherLabel: '', discountPct: 0,
});

export function computePricing(p: ServicePricing | undefined, areaHa: number) {
  const pr = { ...emptyPricing(), ...(p || {}) };
  const area = Number(areaHa) || 0;
  const byArea = (Number(pr.ratePerHa) || 0) * area;
  const subtotal = byArea + (Number(pr.fixedFee) || 0) + (Number(pr.travelCost) || 0) + (Number(pr.artFee) || 0) + (Number(pr.otherCosts) || 0);
  const discount = subtotal * Math.min(100, Math.max(0, Number(pr.discountPct) || 0)) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const rows: [string, string][] = [];
  if (byArea) rows.push([`Área: ${area.toLocaleString('pt-BR')} ha × ${formatBRL(pr.ratePerHa)}/ha`, formatBRL(byArea)]);
  if (pr.fixedFee) rows.push(['Taxa fixa de elaboração do projeto', formatBRL(pr.fixedFee)]);
  if (pr.travelCost) rows.push(['Deslocamento / visitas técnicas', formatBRL(pr.travelCost)]);
  if (pr.artFee) rows.push(['ART / TRT (anotação de responsabilidade)', formatBRL(pr.artFee)]);
  if (pr.otherCosts) rows.push([pr.otherLabel || 'Outros custos', formatBRL(pr.otherCosts)]);
  rows.push(['Subtotal', formatBRL(subtotal)]);
  if (discount) rows.push([`Desconto (${pr.discountPct}%)`, '- ' + formatBRL(discount)]);
  rows.push(['VALOR TOTAL DO SERVIÇO', formatBRL(total)]);
  return { byArea, subtotal, discount, total, rows };
}

const num = (v: string) => (v === '' ? 0 : Number(v));

export function PricingFields({ value, onChange, areaHa, areaLabel = 'Área do projeto' }: {
  value: ServicePricing;
  onChange: (v: ServicePricing) => void;
  areaHa: number;
  areaLabel?: string;
}) {
  const set = (patch: Partial<ServicePricing>) => onChange({ ...value, ...patch });
  const calc = computePricing(value, areaHa);
  const field = (label: string, key: keyof ServicePricing, ph: string, step = '0.01') => (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">{label}</label>
      <input
        type="number"
        min={0}
        step={step}
        value={(value[key] as number) || ''}
        onChange={(e) => set({ [key]: num(e.target.value) } as any)}
        className="w-full glass-input"
        placeholder={ph}
      />
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field(`Valor por hectare (R$/ha) — ${areaLabel}: ${Number(areaHa || 0).toLocaleString('pt-BR')} ha`, 'ratePerHa', 'Ex: 150')}
        {field('Taxa fixa de elaboração (R$)', 'fixedFee', 'Ex: 800')}
        {field('Deslocamento / visitas (R$)', 'travelCost', 'Ex: 300')}
        {field('ART / TRT (R$)', 'artFee', 'Ex: 99.64')}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Outros custos (descrição)</label>
          <input
            type="text"
            value={value.otherLabel}
            onChange={(e) => set({ otherLabel: e.target.value })}
            className="w-full glass-input"
            placeholder="Ex: Análise de solo, topografia..."
          />
        </div>
        {field('Outros custos (R$)', 'otherCosts', 'Ex: 250')}
        {field('Desconto (%)', 'discountPct', 'Ex: 5', '0.1')}
      </div>
      <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl">
        <div className="text-[10px] font-bold text-emerald-700 uppercase mb-2">Como o valor foi calculado</div>
        <div className="space-y-1 text-xs">
          {calc.rows.map(([k, v], i) => (
            <div
              key={k + i}
              className={cn(
                'flex justify-between gap-4',
                i === calc.rows.length - 1 ? 'pt-2 mt-1 border-t border-emerald-200 font-extrabold text-emerald-800 text-sm' : 'text-slate-600'
              )}
            >
              <span>{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Engenheiro / técnico responsável ────────────────────────────────────────
export type RegistryType = 'CREA' | 'CFTA';

export interface ResponsibleTech {
  name: string;
  registryType: RegistryType;
  registryNumber: string;
}

/** Tenta aproveitar o registro já salvo no perfil (ex.: "CREA-MG 123456/D"). */
export function responsibleFromProfile(user: any): ResponsibleTech {
  const cert: string = user?.professionalCertification || '';
  const isCfta = /cfta|crt|trt/i.test(cert);
  return {
    name: user?.displayName || '',
    registryType: isCfta ? 'CFTA' : 'CREA',
    registryNumber: cert.replace(/^\s*(CREA|CFTA|CRT)[\s:-]*/i, '').trim(),
  };
}

export const registryLabel = (r?: Partial<ResponsibleTech>) =>
  r?.registryNumber ? `${r.registryType || 'CREA'} ${r.registryNumber}` : '';

export function ResponsibleFields({ value, onChange }: { value: ResponsibleTech; onChange: (v: ResponsibleTech) => void }) {
  const set = (patch: Partial<ResponsibleTech>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-500 uppercase">Nome do engenheiro / técnico responsável</label>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className="w-full glass-input"
          placeholder="Nome completo"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-500 uppercase">Conselho do registro profissional</label>
        <div className="grid grid-cols-2 gap-3">
          {(['CREA', 'CFTA'] as RegistryType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ registryType: t })}
              className={cn(
                'p-3 rounded-2xl border-2 text-left transition-all',
                value.registryType === t ? 'bg-emerald-50 border-emerald-500' : 'bg-white/50 border-slate-100 hover:border-emerald-200'
              )}
            >
              <div className={cn('font-bold text-sm', value.registryType === t ? 'text-emerald-800' : 'text-slate-700')}>{t}</div>
              <div className="text-[10px] text-slate-500">
                {t === 'CREA' ? 'Engenheiro(a) — emite ART' : 'Técnico(a) agrícola — emite TRT'}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-500 uppercase">Número do registro no {value.registryType}</label>
        <input
          type="text"
          value={value.registryNumber}
          onChange={(e) => set({ registryNumber: e.target.value })}
          className="w-full glass-input"
          placeholder={value.registryType === 'CREA' ? 'Ex: MG-123456/D' : 'Ex: 12345678901'}
        />
      </div>
    </div>
  );
}

// ─── Barra de etapas do formulário ───────────────────────────────────────────
export function WizardSteps({ steps, current, onGo }: { steps: string[]; current: number; onGo?: (i: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <button
            type="button"
            onClick={() => onGo?.(i)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all',
              i === current ? 'bg-emerald-600 text-white shadow' : i < current ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
            )}
          >
            <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', i === current ? 'bg-white/25' : 'bg-white')}>{i + 1}</span>
            {s}
          </button>
          {i < steps.length - 1 && <div className="w-3 h-px bg-slate-200 shrink-0" />}
        </React.Fragment>
      ))}
    </div>
  );
}
