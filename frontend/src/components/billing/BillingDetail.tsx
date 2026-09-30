import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  X, Receipt, CheckCircle2, Edit3, Ban, Wallet, FileText, Download, RefreshCw, Search, AlertTriangle, Link2, History, FileCode2, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatCPF, todayLocalDateString } from '../../lib/utils';
import { formatBRL } from '../service/ServiceKpiCards';
import { runExclusive } from '../../lib/submitGuard';
import { openStoredFile } from '../../lib/fileStore';
import { computeBillingStatus } from '../../lib/billing/calc';
import { BILLING_SOURCES } from '../../lib/billing/sources';
import {
  Actor, cancelBilling, cancelFiscalDocument, confirmBilling, consultFiscalDocument, emitFiscalDocument, registerPayment,
  retryFiscalDocument, useFiscalEvents,
} from '../../lib/billing/service';
import {
  Billing, BILLING_STATUS_LABELS, FISCAL_DOC_LABELS, FISCAL_STATUS_LABELS, FiscalDocument, OPERATION_LABELS,
  PAYMENT_METHOD_LABELS, Payment, PaymentMethod, SOURCE_KIND_LABELS,
} from '../../lib/billing/types';

export const BILLING_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  billed: 'bg-sky-100 text-sky-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-200 text-slate-500 line-through',
};
export const FISCAL_STATUS_STYLE: Record<string, string> = {
  not_issued: 'bg-slate-100 text-slate-500',
  processing: 'bg-amber-100 text-amber-700',
  issued: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-200 text-slate-500',
};
const br = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

interface Props {
  billing: Billing;
  payments: Payment[];
  fiscalDocs: FiscalDocument[];
  actor: Actor;
  canReceive: boolean;
  canCancel: boolean;
  canEdit: boolean;
  canEmit: boolean;
  canCancelFiscal: boolean;
  showTechnical: boolean;
  onClose: () => void;
  onEdit: () => void;
}

function Section({ icon: Icon, title, children, right }: { icon: any; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-emerald-600" /> {title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function BillingDetail({ billing, payments, fiscalDocs, actor, canReceive, canCancel, canEdit, canEmit, canCancelFiscal, showTechnical, onClose, onEdit }: Props) {
  const navigate = useNavigate();
  const status = computeBillingStatus(billing, todayLocalDateString());
  const { data: events } = useFiscalEvents(billing.id);
  const [payFor, setPayFor] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(billing.paymentMethod || 'pix');
  const [payDate, setPayDate] = useState(todayLocalDateString());
  const [payNotes, setPayNotes] = useState('');
  const [cancelOpen, setCancelOpen] = useState<'billing' | 'fiscal' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dupWarning, setDupWarning] = useState(false);

  const fiscal = billing.fiscal;
  const currentDoc = fiscal?.documentId ? fiscalDocs.find(d => d.id === fiscal.documentId) : undefined;
  const billingDocs = fiscalDocs.filter(d => d.billingId === billing.id);
  const myPayments = payments.filter(p => p.billingId === billing.id);
  const source = billing.source?.collection ? BILLING_SOURCES[billing.source.collection] : undefined;
  const hasActiveDoc = fiscal?.status === 'issued' || fiscal?.status === 'processing';

  const act = (key: string, fn: () => Promise<any>, ok?: string) => runExclusive(key, async () => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); }
    catch (e: any) {
      toast.error(e?.message || 'Não foi possível concluir.', showTechnical && e?.technical ? { description: String(e.technical).slice(0, 300), duration: 9000 } : undefined);
    }
    finally { setBusy(false); }
  });

  const emit = () => {
    if (hasActiveDoc) { setDupWarning(true); return; } // nunca emite de novo automaticamente
    act('Fiscal.emit.' + billing.id, async () => {
      const r = await emitFiscalDocument(billing.id, billing.fiscalDocType || undefined);
      const st = r.document?.status;
      if (st === 'issued') toast.success(`Documento fiscal emitido: nº ${r.document.number}.`);
      else if (st === 'processing') toast.info('Enviado ao provedor — em processamento. Use “Consultar situação” em instantes.');
      else if (st === 'rejected') toast.error(r.document.providerMessage || 'O provedor rejeitou o documento. Veja a mensagem na seção Documento Fiscal.');
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" data-billing-detail>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-[2rem] shadow-2xl p-7 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        {/* Cabeçalho */}
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-2xl font-display font-bold text-slate-800" data-billing-number>{billing.number}</h3>
              <span className={cn('px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest', BILLING_STATUS_STYLE[status])} data-billing-status>{BILLING_STATUS_LABELS[status]}</span>
            </div>
            <p className="text-sm text-slate-600 font-bold truncate">{billing.clientName}{billing.clientDoc ? <span className="font-normal text-slate-400"> · {formatCPF(billing.clientDoc)}</span> : null}</p>
            <p className="text-xs text-slate-500">{OPERATION_LABELS[billing.operationType]} · emissão {br(billing.issueDate)}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[['Valor', formatBRL(billing.total)], ['Recebido', formatBRL(billing.paidTotal || 0)], ['Em aberto', formatBRL(Math.max(0, billing.total - (billing.paidTotal || 0)))], ['Vencimento', br(billing.installments.find(p => p.status === 'pending')?.dueDate || billing.dueDate)]]
            .map(([k, v]) => (
              <div key={k} className="bg-slate-50 p-3 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">{k}</div><div className="text-sm font-bold text-slate-800">{v}</div></div>
            ))}
        </div>

        {billing.status === 'cancelled' && (
          <div className="p-3 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-600">
            <strong>Faturamento cancelado</strong> em {br(billing.cancelledAt)}. Motivo: {billing.cancelReason || '—'}. O histórico financeiro e fiscal foi mantido.
          </div>
        )}

        {/* Origem */}
        <Section icon={Link2} title="Origem" right={source && billing.source.id ? (
          <button onClick={() => navigate(source.route)} className="text-[10px] font-bold uppercase text-emerald-700 hover:underline">Abrir {source.label}</button>
        ) : undefined}>
          <div className="text-xs text-slate-700" data-billing-source>
            <strong>{SOURCE_KIND_LABELS[billing.source?.kind || 'manual']}</strong>{billing.source?.label ? ` — ${billing.source.label}` : ''}
          </div>
          {billing.description && <div className="text-xs text-slate-500">{billing.description}</div>}
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><User className="w-3 h-3" /> Responsável: {billing.responsibleName || '—'} · criado por {billing.createdByName || '—'}</div>
        </Section>

        {/* Itens */}
        <Section icon={Receipt} title="Itens">
          <div className="text-xs divide-y divide-slate-100">
            {billing.items.map(it => (
              <div key={it.id} className="py-1.5 flex justify-between gap-3">
                <span className="text-slate-700"><span className="text-[9px] font-bold uppercase text-slate-400 mr-1">{it.kind === 'product' ? 'Produto' : 'Serviço'}</span>{it.description} <span className="text-slate-400">({it.quantity} × {formatBRL(it.unitPrice)}{it.discount ? ` − ${formatBRL(it.discount)}` : ''})</span></span>
                <span className="font-mono font-bold text-slate-800 shrink-0">{formatBRL(it.total)}</span>
              </div>
            ))}
            <div className="pt-2 flex justify-between font-extrabold text-emerald-800"><span>Total</span><span className="font-mono">{formatBRL(billing.total)}</span></div>
          </div>
        </Section>

        {/* Documento fiscal */}
        <Section icon={FileText} title="Documento Fiscal" right={
          <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-black uppercase', FISCAL_STATUS_STYLE[fiscal?.status || 'not_issued'])} data-fiscal-status>
            {FISCAL_STATUS_LABELS[fiscal?.status || 'not_issued']}
          </span>}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div><span className="text-slate-400">Tipo:</span> <strong>{billing.fiscalDocType ? FISCAL_DOC_LABELS[billing.fiscalDocType] : 'A definir'}</strong></div>
            <div><span className="text-slate-400">Número:</span> <strong data-fiscal-number>{currentDoc?.number || '—'}</strong></div>
            <div><span className="text-slate-400">Série:</span> {currentDoc?.series || '—'}</div>
            <div className="col-span-2 truncate"><span className="text-slate-400">Cód. verificação/chave:</span> {currentDoc?.verificationCode || '—'}</div>
            <div><span className="text-slate-400">Emissão:</span> {br(currentDoc?.issuedAt)}</div>
            <div className="col-span-2"><span className="text-slate-400">Protocolo:</span> {currentDoc?.protocol || '—'}</div>
            <div className="truncate"><span className="text-slate-400">Link:</span> {currentDoc?.link ? <a href={currentDoc.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">abrir</a> : '—'}</div>
          </div>
          {currentDoc?.providerMessage && (
            <div className={cn('p-3 rounded-xl text-xs', currentDoc.status === 'rejected' ? 'bg-rose-50 text-rose-800 border border-rose-100' : 'bg-slate-50 text-slate-700 border border-slate-100')} data-fiscal-message>
              <strong>Retorno do provedor:</strong> {currentDoc.providerMessage}
              {showTechnical && currentDoc.providerTechnical && (
                <pre className="mt-2 whitespace-pre-wrap text-[10px] font-mono text-slate-500 max-h-32 overflow-y-auto">{currentDoc.providerTechnical}</pre>
              )}
            </div>
          )}
          {dupWarning && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-2" data-fiscal-duplicate>
              <div className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /><strong>Este faturamento já possui documento fiscal.</strong></div>
              <div className="flex gap-2">
                <button onClick={() => { setDupWarning(false); currentDoc?.pdfFileUrl ? openStoredFile(currentDoc.pdfFileUrl, `${billing.number}.pdf`) : toast.info(`Documento nº ${currentDoc?.number || fiscal?.number || '—'} — ${FISCAL_STATUS_LABELS[fiscal?.status || 'not_issued']}.`); }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 font-bold">Visualizar documento</button>
                <button onClick={() => { setDupWarning(false); if (fiscal?.documentId) act('Fiscal.consult', () => consultFiscalDocument(fiscal.documentId!), 'Situação atualizada.'); }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 font-bold">Consultar situação</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {canEmit && billing.status !== 'draft' && billing.status !== 'cancelled' && fiscal?.status !== 'rejected' && (
              <button disabled={busy} onClick={emit} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50" data-fiscal-emit>
                <FileText className="w-3.5 h-3.5" /> Emitir documento fiscal
              </button>
            )}
            {canEmit && fiscal?.status === 'rejected' && fiscal.documentId && (
              <button disabled={busy} onClick={() => act('Fiscal.retry', () => retryFiscalDocument(fiscal.documentId!), 'Nova tentativa enviada (consultado antes no provedor).')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50" data-fiscal-retry>
                <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
              </button>
            )}
            {fiscal?.documentId && (
              <button disabled={busy} onClick={() => act('Fiscal.consult', () => consultFiscalDocument(fiscal.documentId!), 'Situação consultada no provedor.')}
                className="px-3 py-2 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5" data-fiscal-consult>
                <Search className="w-3.5 h-3.5" /> Consultar situação
              </button>
            )}
            {currentDoc?.pdfFileUrl && (
              <button onClick={() => openStoredFile(currentDoc.pdfFileUrl!, `${billing.number}-nota.pdf`)} className="px-3 py-2 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> PDF</button>
            )}
            {currentDoc?.xmlFileUrl && (
              <button onClick={() => openStoredFile(currentDoc.xmlFileUrl!, `${billing.number}-nota.xml`)} className="px-3 py-2 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><FileCode2 className="w-3.5 h-3.5" /> XML</button>
            )}
            {canCancelFiscal && fiscal?.status === 'issued' && (
              <button disabled={busy} onClick={() => { setReason(''); setCancelOpen('fiscal'); }} className="px-3 py-2 border border-rose-200 text-rose-600 rounded-xl text-[11px] font-bold hover:bg-rose-50 flex items-center gap-1.5" data-fiscal-cancel>
                <Ban className="w-3.5 h-3.5" /> Cancelar nota
              </button>
            )}
          </div>
          {billing.status === 'draft' && <p className="text-[10px] text-slate-500">Confirme o faturamento antes de emitir o documento fiscal.</p>}
          {billingDocs.length > 1 && (
            <p className="text-[10px] text-slate-500">Documentos anteriores deste faturamento: {billingDocs.filter(d => d.id !== fiscal?.documentId).map(d => `nº ${d.number || '—'} (${FISCAL_STATUS_LABELS[d.status]})`).join(', ')}.</p>
          )}
        </Section>

        {/* Financeiro */}
        <Section icon={Wallet} title="Financeiro — parcelas (contas a receber)">
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-2 text-left">Parcela</th><th className="p-2 text-left">Vencimento</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Situação</th><th className="p-2"></th></tr></thead>
              <tbody>
                {billing.installments.map(p => {
                  const late = p.status === 'pending' && p.dueDate < todayLocalDateString();
                  return (
                    <tr key={p.number} className="border-t border-slate-100" data-installment-row={p.number}>
                      <td className="p-2 font-bold">{p.number}/{billing.installments.length}</td>
                      <td className={cn('p-2', late && 'text-rose-600 font-bold')}>{br(p.dueDate)}</td>
                      <td className="p-2 text-right font-mono">{formatBRL(p.value)}</td>
                      <td className="p-2">
                        {p.status === 'paid' ? <span className="text-emerald-700 font-bold">Pago em {br(p.paidAt)} ({PAYMENT_METHOD_LABELS[p.paymentMethod as PaymentMethod] || p.paymentMethod})</span>
                          : p.status === 'cancelled' ? <span className="text-slate-400">Cancelada</span>
                          : <span className={late ? 'text-rose-600 font-bold' : 'text-amber-600 font-bold'}>{late ? 'Vencida' : 'Em aberto'}</span>}
                      </td>
                      <td className="p-2 text-right">
                        {canReceive && p.status === 'pending' && billing.status !== 'draft' && billing.status !== 'cancelled' && (
                          <button onClick={() => { setPayFor(p.number); setPayMethod(billing.paymentMethod || 'pix'); setPayDate(todayLocalDateString()); setPayNotes(''); }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] uppercase hover:bg-emerald-100" data-pay-installment={p.number}>
                            Registrar pagamento
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {myPayments.length > 0 && (
            <div className="text-[11px] text-slate-500 space-y-0.5">
              <div className="font-bold text-slate-600">Pagamentos registrados</div>
              {myPayments.map(p => <div key={p.id}>Parcela {p.installmentNumber}: {formatBRL(p.amount)} · {PAYMENT_METHOD_LABELS[p.method]} · {br(p.paidAt)} · por {p.userName}{p.notes ? ` · ${p.notes}` : ''}</div>)}
            </div>
          )}
        </Section>

        {/* Histórico fiscal */}
        {events.length > 0 && (
          <Section icon={History} title="Histórico fiscal">
            <div className="text-[11px] text-slate-600 space-y-1 max-h-40 overflow-y-auto" data-fiscal-events>
              {[...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(e => (
                <div key={e.id}>
                  <span className="text-slate-400">{new Date(e.createdAt).toLocaleString('pt-BR')}</span> · <strong>{e.userName}</strong> · {e.message}
                  {e.previousStatus && e.newStatus && e.previousStatus !== e.newStatus ? ` (${FISCAL_STATUS_LABELS[e.previousStatus]} → ${FISCAL_STATUS_LABELS[e.newStatus]})` : ''}
                  {showTechnical && e.technicalMessage ? <span className="text-slate-400"> — {e.technicalMessage.slice(0, 200)}</span> : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Ações */}
        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
          {canEdit && billing.status === 'draft' && (
            <>
              <button onClick={onEdit} className="px-4 py-2.5 border border-slate-200 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Editar</button>
              <button disabled={busy} onClick={() => act('Billing.confirm.' + billing.id, () => confirmBilling(billing.id, actor), 'Faturado! Contas a receber criadas no Financeiro.')}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center gap-2 disabled:opacity-50" data-billing-confirm-draft>
                <CheckCircle2 className="w-4 h-4" /> Faturar
              </button>
            </>
          )}
          {canCancel && billing.status !== 'cancelled' && (
            <button onClick={() => { setReason(''); setCancelOpen('billing'); }} className="px-4 py-2.5 border border-rose-200 text-rose-600 rounded-2xl text-xs font-bold hover:bg-rose-50 flex items-center gap-2" data-billing-cancel>
              <Ban className="w-4 h-4" /> Cancelar faturamento
            </button>
          )}
        </div>
      </motion.div>

      {/* Registrar pagamento */}
      {payFor !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/50" data-payment-dialog>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <h4 className="font-display font-bold text-slate-800">Registrar pagamento — parcela {payFor}</h4>
            <p className="text-xs text-slate-500">Valor: <strong>{formatBRL(billing.installments.find(p => p.number === payFor)?.value || 0)}</strong>. O Financeiro e o fluxo de caixa são atualizados. Pagamento não emite nota fiscal.</p>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-500 uppercase">Forma de pagamento</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)} className="w-full glass-input text-xs">
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-500 uppercase">Data do pagamento</label>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full glass-input" /></div>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-500 uppercase">Observação</label>
              <input value={payNotes} onChange={e => setPayNotes(e.target.value)} maxLength={1000} className="w-full glass-input" placeholder="Opcional" /></div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPayFor(null)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500">Voltar</button>
              <button disabled={busy} onClick={() => act('Billing.pay.' + billing.id, async () => { await registerPayment(billing.id, payFor, { method: payMethod, paidAt: payDate, notes: payNotes }, actor); setPayFor(null); }, 'Pagamento registrado.')}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50" data-payment-confirm>Confirmar pagamento</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancelamento (faturamento ou nota) — sempre com motivo */}
      {cancelOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/50" data-cancel-dialog>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center"><AlertTriangle className="w-7 h-7" /></div>
            <h4 className="font-display font-bold text-slate-800">{cancelOpen === 'billing' ? 'Cancelar faturamento' : 'Cancelar documento fiscal'}</h4>
            <p className="text-xs text-slate-500">
              {cancelOpen === 'billing'
                ? 'As parcelas em aberto e as contas a receber delas serão canceladas. Pagamentos já feitos e a nota fiscal (se houver) continuam no histórico.'
                : 'A nota é cancelada no provedor e continua guardada no histórico (número, XML e PDF). O faturamento NÃO é cancelado.'}
            </p>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} className="w-full glass-input text-left" placeholder="Motivo do cancelamento (obrigatório)" data-cancel-reason />
            <div className="flex gap-2">
              <button onClick={() => setCancelOpen(null)} className="flex-1 py-3 glass rounded-xl font-bold text-slate-600 text-xs uppercase">Voltar</button>
              <button disabled={busy || reason.trim().length < 5} onClick={() => {
                if (cancelOpen === 'billing') act('Billing.cancel.' + billing.id, async () => { await cancelBilling(billing, reason, actor); setCancelOpen(null); }, 'Faturamento cancelado.');
                else if (fiscal?.documentId) act('Fiscal.cancel.' + billing.id, async () => { await cancelFiscalDocument(fiscal.documentId!, reason); setCancelOpen(null); }, 'Documento fiscal cancelado (mantido no histórico).');
              }} className="flex-1 py-3 rounded-xl font-bold text-white text-xs uppercase bg-rose-600 hover:bg-rose-700 disabled:opacity-40" data-cancel-confirm>Confirmar</button>
            </div>
            <p className="text-[10px] text-slate-400">Mínimo de 5 caracteres no motivo.</p>
          </div>
        </div>
      )}
    </div>
  );
}
