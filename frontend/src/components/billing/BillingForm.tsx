import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Receipt, Plus, Trash2, Save, CheckCircle2, X, Link2, Package, Wrench, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatCPF } from '../../lib/utils';
import { WizardSteps } from '../service/ServiceFormParts';
import { formatBRL } from '../service/ServiceKpiCards';
import { runExclusive } from '../../lib/submitGuard';
import { billingTotals, fiscalDocForOperation, itemTotal, operationFromItems, round2, splitInstallments } from '../../lib/billing/calc';
import { BillingDraft, newItem, validateDraft } from '../../lib/billing/service';
import { SERVICE_CATEGORIES } from '../../lib/billing/sources';
import {
  BillingItem, FISCAL_DOC_LABELS, FiscalDocType, FiscalSettings, OPERATION_LABELS, PAYMENT_METHOD_LABELS, PaymentMethod, SOURCE_KIND_LABELS,
} from '../../lib/billing/types';

const STEPS = ['Cliente e origem', 'Itens', 'Pagamento', 'Documento fiscal'];

interface Props {
  initial: BillingDraft;
  editing: boolean;                      // editando rascunho existente (cliente fixo)
  clients: any[];
  products: any[];
  fiscalSettings: Partial<FiscalSettings> | null;
  onClose: () => void;
  onSave: (draft: BillingDraft, confirm: boolean) => Promise<void>;
}

const label = 'text-[10px] font-bold text-slate-500 uppercase';

export default function BillingForm({ initial, editing, clients, products, fiscalSettings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<BillingDraft>(initial);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const set = (patch: Partial<BillingDraft>) => setDraft(d => ({ ...d, ...patch }));

  const items = draft.items;
  const totals = useMemo(() => billingTotals(items), [items]);
  const operation = operationFromItems(items.filter(i => i.description.trim()));
  const fromSource = !!draft.source.collection;

  // Parcelas: recalculadas quando muda total, quantidade ou 1º vencimento
  // (o usuário ainda pode ajustar valores/datas de cada parcela depois).
  useEffect(() => {
    setDraft(d => {
      const current = d.installments;
      const sameShape = current.length === d.installmentCount && Math.abs(round2(current.reduce((s, p) => s + p.value, 0)) - totals.total) < 0.01
        && current[0]?.dueDate === d.dueDate;
      if (sameShape) return d;
      return { ...d, installments: totals.total > 0 ? splitInstallments(totals.total, d.installmentCount, d.dueDate) : [] };
    });
  }, [totals.total, draft.installmentCount, draft.dueDate]);

  // Documento fiscal sugerido pela natureza da operação (misto: o usuário escolhe)
  useEffect(() => {
    const suggested = fiscalDocForOperation(operation);
    if (suggested && draft.fiscalDocType !== suggested) set({ fiscalDocType: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const list = q ? clients.filter(c => (c.name || '').toLowerCase().includes(q) || (c.cpf || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§')) : clients;
    return list.slice(0, 30);
  }, [clients, clientSearch]);

  const setItem = (id: string, patch: Partial<BillingItem>) =>
    set({ items: items.map(i => (i.id === id ? { ...i, ...patch, total: itemTotal({ ...i, ...patch }) } : i)) });

  const pickProduct = (itemId: string, productId: string) => {
    const p = products.find(x => x.id === productId);
    if (!p) return setItem(itemId, { productId: undefined });
    setItem(itemId, { productId, description: p.name || '', unitPrice: Number(p.salePrice ?? p.unitCost ?? 0) || 0, unit: p.unit || 'UN' });
  };

  const stepError = (i: number): string | null => {
    if (i === 0) {
      if (!draft.clientId) return 'Escolha o cliente.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.issueDate)) return 'Informe a data de emissão.';
    }
    if (i === 1) {
      const valid = items.filter(it => it.description.trim() && Number(it.quantity) > 0);
      if (!valid.length) return 'Inclua pelo menos um item com descrição e quantidade.';
      if (items.some(it => Number(it.unitPrice) < 0 || Number(it.discount) < 0)) return 'Valores e descontos não podem ser negativos.';
      if (totals.total <= 0) return 'O valor total precisa ser maior que zero.';
    }
    if (i === 2) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return 'Informe o vencimento da 1ª parcela.';
      if (draft.dueDate < draft.issueDate) return 'O vencimento não pode ser antes da emissão.';
    }
    return null;
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) { toast.error(err); return; }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = (confirm: boolean) => runExclusive('Billing.save', async () => {
    for (let i = 0; i < STEPS.length; i++) { const e = stepError(i); if (e) { setStep(i); toast.error(e); return; } }
    const err = validateDraft(draft);
    if (err) { toast.error(err); return; }
    if (operation === 'mixed' && !draft.fiscalDocType) { setStep(3); toast.error('Serviço + produto: escolha qual documento fiscal este faturamento vai gerar.'); return; }
    setSaving(true);
    try { await onSave(draft, confirm); } finally { setSaving(false); }
  });

  const serviceFiscal = (cat?: string) => (cat && fiscalSettings?.serviceTypes?.[cat]) || null;

  const renderStep = () => {
    if (step === 0) return (
      <div className="space-y-5">
        {fromSource && (
          <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-xs text-emerald-800 flex gap-2">
            <Link2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div><strong>Origem:</strong> {draft.source.label}. Cliente, CPF/CNPJ, serviço e valor vieram do cadastro — não precisa digitar de novo.</div>
          </div>
        )}
        <div className="space-y-1">
          <label className={label}>Cliente</label>
          {draft.clientId ? (
            <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-emerald-200 bg-emerald-50/50">
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-800 truncate">{draft.clientName}</div>
                <div className="text-[11px] text-slate-500">{draft.clientDoc ? `CPF/CNPJ ${formatCPF(draft.clientDoc)}` : 'Sem CPF/CNPJ no cadastro'}</div>
              </div>
              {!editing && !fromSource && (
                <button type="button" onClick={() => set({ clientId: '', clientName: '', clientDoc: '' })} className="text-[10px] font-bold uppercase text-slate-500 hover:text-rose-600">Trocar</button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Buscar por nome ou CPF/CNPJ..." className="w-full glass-input" data-billing-client-search />
              <div className="max-h-48 overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-100 bg-white/60">
                {filteredClients.map(c => (
                  <button key={c.id} type="button" onClick={() => set({ clientId: c.id, clientName: c.name, clientDoc: c.cpf || '' })}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-xs flex justify-between gap-3" data-billing-client-option>
                    <span className="font-bold text-slate-700 truncate">{c.name}</span>
                    <span className="text-slate-400 font-mono shrink-0">{c.cpf ? formatCPF(c.cpf) : '—'}</span>
                  </button>
                ))}
                {!filteredClients.length && <div className="p-3 text-xs text-slate-400">Nenhum cliente encontrado.</div>}
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className={label}>Origem do faturamento</label>
            <div className="glass-input text-xs bg-slate-50/80">{SOURCE_KIND_LABELS[draft.source.kind]}</div>
          </div>
          <div className="space-y-1">
            <label className={label}>Data de emissão</label>
            <input type="date" value={draft.issueDate} onChange={e => set({ issueDate: e.target.value })} className="w-full glass-input" />
          </div>
        </div>
        <div className="space-y-1">
          <label className={label}>Descrição</label>
          <input value={draft.description} onChange={e => set({ description: e.target.value })} maxLength={2000} className="w-full glass-input" placeholder="Ex.: Elaboração de projeto de irrigação — Fazenda Boa Vista" />
        </div>
      </div>
    );

    if (step === 1) return (
      <div className="space-y-4">
        {items.map((it, idx) => {
          const cfg = it.kind === 'service' ? serviceFiscal(it.serviceCategory) : null;
          return (
            <div key={it.id} className="p-4 rounded-2xl border border-slate-100 bg-white/60 space-y-3" data-billing-item>
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  {(['service', 'product'] as const).map(k => (
                    <button key={k} type="button" onClick={() => setItem(it.id, { kind: k, productId: undefined })}
                      className={cn('px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1', it.kind === k ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>
                      {k === 'service' ? <Wrench className="w-3 h-3" /> : <Package className="w-3 h-3" />} {k === 'service' ? 'Serviço' : 'Produto'}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] font-bold text-slate-400">Item {idx + 1}</span>
                <button type="button" onClick={() => set({ items: items.length > 1 ? items.filter(x => x.id !== it.id) : [newItem()] })} className="text-slate-300 hover:text-rose-500" title="Remover item"><Trash2 className="w-4 h-4" /></button>
              </div>
              {it.kind === 'product' ? (
                <div className="space-y-1">
                  <label className={label}>Produto (Estoque)</label>
                  <select value={it.productId || ''} onChange={e => pickProduct(it.id, e.target.value)} className="w-full glass-input text-xs">
                    <option value="">— digitar manualmente —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className={label}>Tipo de serviço (liga à configuração fiscal)</label>
                  <select value={it.serviceCategory || ''} onChange={e => setItem(it.id, { serviceCategory: e.target.value || undefined })} className="w-full glass-input text-xs">
                    <option value="">— não informado —</option>
                    {SERVICE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className={label}>Descrição</label>
                <input value={it.description} onChange={e => setItem(it.id, { description: e.target.value })} maxLength={300} className="w-full glass-input" placeholder="O que está sendo cobrado" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1"><label className={label}>Quantidade</label>
                  <input type="number" min={0} step="0.01" value={it.quantity || ''} onChange={e => setItem(it.id, { quantity: Number(e.target.value) })} className="w-full glass-input" /></div>
                <div className="space-y-1"><label className={label}>Valor unitário (R$)</label>
                  <input type="number" min={0} step="0.01" value={it.unitPrice || ''} onChange={e => setItem(it.id, { unitPrice: Number(e.target.value) })} className="w-full glass-input" /></div>
                <div className="space-y-1"><label className={label}>Desconto (R$)</label>
                  <input type="number" min={0} step="0.01" value={it.discount || ''} onChange={e => setItem(it.id, { discount: Number(e.target.value) })} className="w-full glass-input" /></div>
                <div className="space-y-1"><label className={label}>Total</label>
                  <div className="glass-input bg-slate-50/80 font-bold text-slate-800">{formatBRL(itemTotal(it))}</div></div>
              </div>
              {cfg && (
                <p className="text-[10px] text-slate-500">Config. fiscal do serviço: código {cfg.fiscalCode || '—'} · alíquota {cfg.aliquota ? cfg.aliquota + '%' : '—'} · {FISCAL_DOC_LABELS[cfg.defaultDoc] || '—'}</p>
              )}
            </div>
          );
        })}
        <div className="flex gap-2">
          <button type="button" onClick={() => set({ items: [...items, newItem('service')] })} className="px-3 py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 text-xs font-bold flex items-center gap-1 hover:bg-emerald-50"><Plus className="w-3.5 h-3.5" /> Serviço</button>
          <button type="button" onClick={() => set({ items: [...items, newItem('product')] })} className="px-3 py-2 rounded-xl border border-dashed border-slate-300 text-slate-600 text-xs font-bold flex items-center gap-1 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /> Produto</button>
        </div>
        <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-xs space-y-1">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">{formatBRL(totals.subtotal)}</span></div>
          {totals.discountTotal > 0 && <div className="flex justify-between text-slate-600"><span>Descontos</span><span className="font-mono">- {formatBRL(totals.discountTotal)}</span></div>}
          <div className="flex justify-between pt-1 border-t border-emerald-200 font-extrabold text-emerald-800 text-sm"><span>TOTAL DO FATURAMENTO</span><span className="font-mono" data-billing-total>{formatBRL(totals.total)}</span></div>
          <div className="text-[10px] text-slate-500">Tipo de operação: <strong>{OPERATION_LABELS[operation]}</strong></div>
        </div>
      </div>
    );

    if (step === 2) return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className={label}>Forma de pagamento</label>
            <select value={draft.paymentMethod} onChange={e => set({ paymentMethod: e.target.value as PaymentMethod })} className="w-full glass-input text-xs">
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className={label}>Parcelamento</label>
            <select value={[1, 2, 3].includes(draft.installmentCount) ? String(draft.installmentCount) : 'custom'}
              onChange={e => set({ installmentCount: e.target.value === 'custom' ? 4 : Number(e.target.value) })} className="w-full glass-input text-xs" data-billing-installments-select>
              <option value="1">À vista (1 parcela)</option>
              <option value="2">2 parcelas</option>
              <option value="3">3 parcelas</option>
              <option value="custom">Outra quantidade...</option>
            </select>
          </div>
          {![1, 2, 3].includes(draft.installmentCount) ? (
            <div className="space-y-1">
              <label className={label}>Quantidade de parcelas</label>
              <input type="number" min={1} max={120} value={draft.installmentCount} onChange={e => set({ installmentCount: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })} className="w-full glass-input" />
            </div>
          ) : (
            <div className="space-y-1">
              <label className={label}>1º vencimento</label>
              <input type="date" value={draft.dueDate} onChange={e => set({ dueDate: e.target.value })} className="w-full glass-input" />
            </div>
          )}
        </div>
        {![1, 2, 3].includes(draft.installmentCount) && (
          <div className="space-y-1 sm:w-1/3">
            <label className={label}>1º vencimento</label>
            <input type="date" value={draft.dueDate} onChange={e => set({ dueDate: e.target.value })} className="w-full glass-input" />
          </div>
        )}
        <div className="rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-2 text-left">Parcela</th><th className="p-2 text-left">Vencimento</th><th className="p-2 text-right">Valor (R$)</th></tr></thead>
            <tbody>
              {draft.installments.map((p, i) => (
                <tr key={p.number} className="border-t border-slate-100" data-billing-installment>
                  <td className="p-2 font-bold text-slate-600">{p.number}/{draft.installments.length}</td>
                  <td className="p-2"><input type="date" value={p.dueDate} onChange={e => set({ installments: draft.installments.map((x, k) => (k === i ? { ...x, dueDate: e.target.value } : x)) })} className="glass-input text-xs py-1" /></td>
                  <td className="p-2 text-right"><input type="number" min={0} step="0.01" value={p.value} onChange={e => set({ installments: draft.installments.map((x, k) => (k === i ? { ...x, value: round2(Number(e.target.value)) } : x)) })} className="glass-input text-xs py-1 w-28 text-right" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            const sum = round2(draft.installments.reduce((s, p) => s + (Number(p.value) || 0), 0));
            const diff = round2(sum - totals.total);
            return (
              <div className={cn('px-3 py-2 text-[11px] flex justify-between', Math.abs(diff) > 0.009 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                <span>Soma das parcelas: <strong>{formatBRL(sum)}</strong></span>
                <span>{Math.abs(diff) > 0.009 ? `Diferença de ${formatBRL(diff)} — ajuste as parcelas` : 'Confere com o total'}</span>
              </div>
            );
          })()}
        </div>
      </div>
    );

    // Etapa 4 — documento fiscal e revisão
    const docTypeSuggested = fiscalDocForOperation(operation);
    return (
      <div className="space-y-5">
        <div className="space-y-1">
          <label className={label}>Documento fiscal previsto</label>
          <div className="grid grid-cols-2 gap-3">
            {(['NFSE', 'NFE'] as FiscalDocType[]).map(t => (
              <button key={t} type="button" disabled={!!docTypeSuggested && docTypeSuggested !== t} onClick={() => set({ fiscalDocType: t })}
                className={cn('p-3 rounded-2xl border-2 text-left transition-all disabled:opacity-40',
                  draft.fiscalDocType === t ? 'bg-emerald-50 border-emerald-500' : 'bg-white/50 border-slate-100 hover:border-emerald-200')}>
                <div className="font-bold text-sm text-slate-700">{FISCAL_DOC_LABELS[t]}</div>
                <div className="text-[10px] text-slate-500">{t === 'NFSE' ? 'Prestação de serviços (prefeitura)' : 'Venda de produtos (SEFAZ)'}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            {docTypeSuggested ? `Definido pela natureza da operação (${OPERATION_LABELS[operation].toLowerCase()}).`
              : 'Serviço + produto: escolha qual documento este faturamento vai gerar (a outra parte pode ser faturada separadamente).'}
            {' '}A nota só é emitida quando você clicar em “Emitir documento fiscal” — faturar não emite nota.
          </p>
        </div>
        <div className="space-y-1">
          <label className={label}>Observações</label>
          <textarea value={draft.notes} onChange={e => set({ notes: e.target.value })} rows={3} maxLength={5000} className="w-full glass-input" placeholder="Informações para o cliente ou uso interno" />
        </div>
        <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs space-y-1.5">
          <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Resumo</div>
          <div className="flex justify-between"><span className="text-slate-500">Cliente</span><span className="font-bold">{draft.clientName || '—'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Operação</span><span>{OPERATION_LABELS[operation]}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Total</span><span className="font-bold">{formatBRL(totals.total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Pagamento</span><span>{PAYMENT_METHOD_LABELS[draft.paymentMethod]} · {draft.installments.length}x</span></div>
          <div className="flex justify-between"><span className="text-slate-500">1º vencimento</span><span>{draft.installments[0]?.dueDate?.split('-').reverse().join('/') || '—'}</span></div>
        </div>
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-[11px] text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>Salvar rascunho</strong> não gera cobrança. <strong>Faturar</strong> cria as contas a receber no Financeiro (uma por parcela).</span>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" data-billing-form>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-[2rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="p-6 border-b border-slate-100 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600"><Receipt className="w-5 h-5" /></div>
              <div>
                <h3 className="text-lg font-display font-bold text-slate-800">{editing ? 'Editar Rascunho de Faturamento' : 'Novo Faturamento'}</h3>
                <p className="text-[11px] text-slate-500">Etapa {step + 1} de {STEPS.length} · {STEPS[step]}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl" title="Fechar"><X className="w-5 h-5 text-slate-400" /></button>
          </div>
          <WizardSteps steps={STEPS} current={step} onGo={(i) => { if (i <= step) setStep(i); }} />
        </div>
        <div className="p-6 overflow-y-auto flex-1">{renderStep()}</div>
        <div className="p-5 border-t border-slate-100 flex justify-between gap-3 bg-slate-50/60">
          <button onClick={() => (step === 0 ? onClose() : setStep(s => s - 1))} className="px-5 py-2.5 border border-slate-200 rounded-2xl text-xs font-bold text-slate-500 hover:bg-white flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={goNext} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20" data-billing-next>
              Avançar <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => submit(false)} disabled={saving} className="px-5 py-2.5 border border-slate-200 bg-white rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50" data-billing-save-draft>
                <Save className="w-4 h-4" /> Salvar rascunho
              </button>
              <button onClick={() => submit(true)} disabled={saving} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50" data-billing-confirm>
                <CheckCircle2 className="w-4 h-4" /> {saving ? 'Salvando...' : 'Faturar'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
