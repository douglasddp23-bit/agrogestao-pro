import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { Receipt, Plus, Search, FileText, Wallet, AlertTriangle, CheckCircle2, ChevronRight, Link2, Filter, Download, FileCode2, Ban, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { cn, todayLocalDateString } from '../lib/utils';
import { can } from '../lib/permissions';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import ServiceKpiCards, { formatBRL, isThisMonth } from '../components/service/ServiceKpiCards';
import ExportExcelButton from '../components/service/ExportExcelButton';
import BillingForm from '../components/billing/BillingForm';
import BillingDetail, { BILLING_STATUS_STYLE, FISCAL_STATUS_STYLE } from '../components/billing/BillingDetail';
import { openStoredFile } from '../lib/fileStore';
import { runExclusive } from '../lib/submitGuard';
import { computeBillingStatus } from '../lib/billing/calc';
import {
  BillingDraft, cancelFiscalDocument, consultFiscalDocument, createBilling, draftFromSource, emptyDraft, refreshOverdueStatuses,
  updateDraft, useBillings, useFiscalDocuments, useFiscalSettings, usePayments,
} from '../lib/billing/service';
import { SERVICE_CATEGORIES } from '../lib/billing/sources';
import {
  Billing, BILLING_STATUS_LABELS, BillingStatus, FISCAL_DOC_LABELS, FISCAL_STATUS_LABELS, FiscalDocument, OPERATION_LABELS, SOURCE_KIND_LABELS,
} from '../lib/billing/types';

type Tab = 'open' | 'paid' | 'overdue' | 'cancelled' | 'history' | 'fiscal';
const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Em aberto' },
  { id: 'paid', label: 'Pagos' },
  { id: 'overdue', label: 'Vencidos' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'history', label: 'Histórico' },
  { id: 'fiscal', label: 'Documentos Fiscais' },
];
const br = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

function toDraft(b: Billing): BillingDraft {
  return {
    clientId: b.clientId, clientName: b.clientName, clientDoc: b.clientDoc || '', source: b.source, issueDate: b.issueDate,
    dueDate: b.installments[0]?.dueDate || b.dueDate, description: b.description, items: b.items, paymentMethod: b.paymentMethod,
    installmentCount: b.installments.length, installments: b.installments, notes: b.notes || '', fiscalDocType: b.fiscalDocType,
    responsibleId: b.responsibleId, responsibleName: b.responsibleName,
  };
}

export default function BillingPage() {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const allowed = can(role, 'faturamento.visualizar');

  const { data: billings, loading } = useBillings(allowed);
  const { data: payments } = usePayments(allowed);
  const { data: fiscalDocs } = useFiscalDocuments(can(role, 'fiscal.visualizar'));
  const fiscalSettings = useFiscalSettings(allowed);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [typeF, setTypeF] = useState('all');
  const [serviceF, setServiceF] = useState('all');
  const [respF, setRespF] = useState('all');
  const [fiscalF, setFiscalF] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const [formDraft, setFormDraft] = useState<BillingDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [fiscalCancel, setFiscalCancel] = useState<FiscalDocument | null>(null);
  const [fiscalReason, setFiscalReason] = useState('');

  const actor = { uid: user?.uid || '', displayName: user?.displayName, email: user?.email };
  const today = todayLocalDateString();

  useEffect(() => {
    if (!allowed) return;
    const u1 = onSnapshot(collection(db, 'clients'), s => setClients(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))));
    const u2 = onSnapshot(collection(db, 'inventory_items'), s => setProducts(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setProducts([]));
    return () => { u1(); u2(); };
  }, [allowed]);

  // Vencimento muda com o tempo: grava o status atual dos faturamentos atrasados
  useEffect(() => { if (billings.length) refreshOverdueStatuses(billings); }, [billings.length]);

  // Aberto a partir de outra tela: /billing?novo=1&origem=<coleção>&id=<id>  ou  /billing?abrir=<FAT-...>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const origem = params.get('origem'); const id = params.get('id'); const abrir = params.get('abrir');
    if (abrir) { setViewingId(abrir); setTab('history'); }
    if (params.get('novo') && origem && id && can(role, 'faturamento.criar')) {
      draftFromSource(origem, id).then(d => { setEditingId(null); setFormDraft(d); }).catch(e => toast.error(e.message));
    }
    if (abrir || params.get('novo')) navigate('/billing', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const withStatus = useMemo(() => billings.map(b => ({ ...b, status: computeBillingStatus(b, today) as BillingStatus })), [billings, today]);
  const responsibles = useMemo(() => Array.from(new Set(billings.map(b => b.responsibleName).filter(Boolean))) as string[], [billings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withStatus.filter(b => {
      if (tab === 'open' && !['draft', 'billed', 'partial', 'overdue'].includes(b.status)) return false;
      if (tab === 'paid' && b.status !== 'paid') return false;
      if (tab === 'overdue' && b.status !== 'overdue') return false;
      if (tab === 'cancelled' && b.status !== 'cancelled') return false;
      if (q && !`${b.number} ${b.clientName} ${b.description} ${b.source?.label || ''} ${b.clientDoc || ''}`.toLowerCase().includes(q)) return false;
      if (from && b.issueDate < from) return false;
      if (to && b.issueDate > to) return false;
      if (statusF !== 'all' && b.status !== statusF) return false;
      if (typeF !== 'all' && b.operationType !== typeF) return false;
      if (serviceF !== 'all' && (b.source?.serviceCategory || 'other') !== serviceF && !b.items.some(i => i.serviceCategory === serviceF)) return false;
      if (respF !== 'all' && b.responsibleName !== respF) return false;
      if (fiscalF !== 'all' && (b.fiscal?.status || 'not_issued') !== fiscalF) return false;
      return true;
    });
  }, [withStatus, tab, search, from, to, statusF, typeF, serviceF, respF, fiscalF]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fiscalDocs.filter(d => {
      if (q && !`${d.number || ''} ${d.clientName} ${d.billingNumber} ${d.sourceLabel || ''}`.toLowerCase().includes(q)) return false;
      const day = (d.issuedAt || d.createdAt || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (fiscalF !== 'all' && d.status !== fiscalF) return false;
      if (typeF !== 'all' && ((typeF === 'product') !== (d.docType === 'NFE'))) return false;
      if (serviceF !== 'all' && !(d.sourceCollection || '').length && serviceF !== 'other') return false;
      return true;
    });
  }, [fiscalDocs, search, from, to, fiscalF, typeF, serviceF]);

  const active = withStatus.filter(b => b.status !== 'cancelled' && b.status !== 'draft');
  const kpis = [
    { label: 'Faturado no mês', value: formatBRL(active.filter(b => isThisMonth(b.issueDate)).reduce((s, b) => s + b.total, 0)), hint: `${active.filter(b => isThisMonth(b.issueDate)).length} faturamento(s)`, icon: Receipt, tone: 'emerald' as const },
    { label: 'Recebido no mês', value: formatBRL(payments.filter(p => isThisMonth(p.paidAt)).reduce((s, p) => s + p.amount, 0)), hint: `${payments.filter(p => isThisMonth(p.paidAt)).length} pagamento(s)`, icon: CheckCircle2, tone: 'slate' as const },
    { label: 'Em aberto', value: formatBRL(active.reduce((s, b) => s + Math.max(0, b.total - (b.paidTotal || 0)), 0)), hint: 'a receber', icon: Wallet, tone: 'amber' as const },
    { label: 'Vencido', value: formatBRL(active.flatMap(b => b.installments).filter(p => p.status === 'pending' && p.dueDate < today).reduce((s, p) => s + p.value, 0)), hint: `${active.filter(b => b.status === 'overdue').length} faturamento(s)`, icon: AlertTriangle, tone: 'rose' as const },
  ];

  const handleSave = async (draft: BillingDraft, confirm: boolean) => {
    try {
      if (editingId) {
        const b = billings.find(x => x.id === editingId);
        if (!b) throw new Error('Faturamento não encontrado.');
        await updateDraft(b, draft, actor);
        if (confirm) {
          const { confirmBilling } = await import('../lib/billing/service');
          await confirmBilling(b.id, actor);
        }
        toast.success(confirm ? 'Faturado! Contas a receber criadas no Financeiro.' : 'Rascunho atualizado.');
        setViewingId(b.id);
      } else {
        const saved = await createBilling(draft, actor, confirm, billings.map(b => b.id));
        toast.success(confirm ? `${saved.number} faturado! Contas a receber criadas no Financeiro.` : `Rascunho ${saved.number} salvo.`);
        setViewingId(saved.id);
      }
      setFormDraft(null); setEditingId(null);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível salvar o faturamento.');
    }
  };

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white rounded-3xl border border-slate-200">
        <h3 className="text-xl font-display font-bold text-rose-500">Acesso Restrito</h3>
        <p className="text-sm text-slate-500 mt-2">O faturamento é restrito a Gerente e Administrador.</p>
      </div>
    );
  }

  const viewing = viewingId ? withStatus.find(b => b.id === viewingId) || billings.find(b => b.id === viewingId) : null;
  const fiscalRows = () => filteredDocs.map(d => ({
    'Número': d.number || '', 'Série': d.series || '', 'Tipo': FISCAL_DOC_LABELS[d.docType], 'Situação': FISCAL_STATUS_LABELS[d.status],
    'Cliente': d.clientName, 'Faturamento': d.billingNumber, 'Origem': d.sourceLabel || '', 'Valor (R$)': d.amount,
    'Emissão': br(d.issuedAt), 'Protocolo': d.protocol || '', 'Chave/Cód. verificação': d.verificationCode || '',
  }));
  const billingRows = () => filtered.map(b => ({
    'Número': b.number, 'Cliente': b.clientName, 'CPF/CNPJ': b.clientDoc || '', 'Origem': b.source?.label || SOURCE_KIND_LABELS[b.source?.kind || 'manual'],
    'Operação': OPERATION_LABELS[b.operationType], 'Emissão': br(b.issueDate), 'Vencimento': br(b.dueDate), 'Parcelas': b.installments.length,
    'Total (R$)': b.total, 'Recebido (R$)': b.paidTotal || 0, 'Situação': BILLING_STATUS_LABELS[b.status],
    'Documento fiscal': FISCAL_STATUS_LABELS[b.fiscal?.status || 'not_issued'], 'Nº nota': b.fiscal?.number || '', 'Responsável': b.responsibleName || '',
  }));

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10 custom-scrollbar" data-billing-page>
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={Receipt} title="Faturamento" subtitle="Faturas de serviços e vendas, contas a receber, pagamentos e documentos fiscais" />
        <div className="flex items-center gap-3">
          <ExportExcelButton fileName={tab === 'fiscal' ? 'Documentos_Fiscais' : 'Faturamentos'} getRows={tab === 'fiscal' ? fiscalRows : billingRows} />
          {can(role, 'faturamento.criar') && (
            <button onClick={() => { setEditingId(null); setFormDraft(emptyDraft()); }} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all" data-billing-new>
              <Plus className="w-4 h-4" /> Novo Faturamento
            </button>
          )}
        </div>
      </header>

      <ServiceKpiCards items={kpis} />

      <div className="glass-card p-4 rounded-3xl border border-white/40 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} data-billing-tab={t.id}
                className={cn('px-3.5 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all', tab === t.id ? 'bg-emerald-600 text-white shadow' : 'bg-white/60 text-slate-500 hover:bg-emerald-50')}>
                {t.label}
                {t.id === 'overdue' && withStatus.some(b => b.status === 'overdue') && <span className="ml-1.5 px-1.5 rounded-full bg-rose-500 text-white text-[9px]">{withStatus.filter(b => b.status === 'overdue').length}</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Número, cliente, serviço..." className="w-full glass-input pl-10 text-xs" />
            </div>
            <button onClick={() => setShowFilters(v => !v)} className={cn('px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5', showFilters ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600')}>
              <Filter className="w-4 h-4" /> Filtros
            </button>
          </div>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">De</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full glass-input text-xs" /></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Até</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full glass-input text-xs" /></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Status</label>
              <select value={statusF} onChange={e => setStatusF(e.target.value)} className="w-full glass-input text-xs"><option value="all">Todos</option>{Object.entries(BILLING_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Tipo</label>
              <select value={typeF} onChange={e => setTypeF(e.target.value)} className="w-full glass-input text-xs"><option value="all">Todos</option>{Object.entries(OPERATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Serviço</label>
              <select value={serviceF} onChange={e => setServiceF(e.target.value)} className="w-full glass-input text-xs"><option value="all">Todos</option>{SERVICE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Responsável</label>
              <select value={respF} onChange={e => setRespF(e.target.value)} className="w-full glass-input text-xs"><option value="all">Todos</option>{responsibles.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase">Documento fiscal</label>
              <select value={fiscalF} onChange={e => setFiscalF(e.target.value)} className="w-full glass-input text-xs"><option value="all">Todos</option>{Object.entries(FISCAL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
        )}
      </div>

      {tab === 'fiscal' ? (
        <div className="glass-card rounded-3xl overflow-hidden border border-white/40" data-fiscal-list>
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white text-[10px] uppercase"><tr>
              <th className="p-3 text-left">Número</th><th className="p-3 text-left">Cliente</th><th className="p-3 text-left">Tipo</th><th className="p-3 text-left">Origem</th>
              <th className="p-3 text-right">Valor</th><th className="p-3 text-left">Data</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {filteredDocs.map(d => (
                <tr key={d.id} className="border-t border-slate-100 bg-white/60" data-fiscal-row={d.id}>
                  <td className="p-3 font-bold">{d.number || '—'}{d.series ? <span className="text-slate-400 font-normal"> / série {d.series}</span> : null}</td>
                  <td className="p-3">{d.clientName}<div className="text-[10px] text-slate-400">{d.billingNumber}</div></td>
                  <td className="p-3">{FISCAL_DOC_LABELS[d.docType]}</td>
                  <td className="p-3 max-w-[180px] truncate" title={d.sourceLabel}>{d.sourceLabel || 'Manual'}</td>
                  <td className="p-3 text-right font-mono">{formatBRL(d.amount)}</td>
                  <td className="p-3">{br(d.issuedAt || d.createdAt)}</td>
                  <td className="p-3"><span className={cn('px-2 py-0.5 rounded-full text-[9px] font-black uppercase', FISCAL_STATUS_STYLE[d.status])}>{FISCAL_STATUS_LABELS[d.status]}</span></td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <button title="Visualizar faturamento" onClick={() => setViewingId(d.billingId)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight className="w-4 h-4" /></button>
                      {d.pdfFileUrl && <button title="Baixar PDF" onClick={() => openStoredFile(d.pdfFileUrl!, `nota-${d.number || d.id}.pdf`)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><Download className="w-4 h-4" /></button>}
                      {d.xmlFileUrl && <button title="Baixar XML" onClick={() => openStoredFile(d.xmlFileUrl!, `nota-${d.number || d.id}.xml`)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><FileCode2 className="w-4 h-4" /></button>}
                      <button title="Consultar situação" onClick={() => runExclusive('Fiscal.consult.' + d.id, () => consultFiscalDocument(d.id).then(() => toast.success('Situação consultada.')).catch(e => toast.error(e.message)))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><RefreshCw className="w-4 h-4" /></button>
                      {d.status === 'issued' && can(role, 'fiscal.cancelar') && (
                        <button title="Cancelar nota" onClick={() => { setFiscalReason(''); setFiscalCancel(d); }} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"><Ban className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredDocs.length && <tr><td colSpan={8} className="p-10 text-center text-slate-400 font-bold uppercase text-[11px] tracking-widest">Nenhum documento fiscal</td></tr>}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">{[1, 2, 3].map(i => <div key={i} className="glass-card h-48 rounded-3xl animate-pulse bg-slate-100/50" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl text-center flex flex-col items-center gap-3 text-slate-400">
          <Receipt className="w-12 h-12 opacity-20" />
          <p className="text-xs font-bold uppercase tracking-widest">Nenhum faturamento encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(b => (
            <motion.div key={b.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 rounded-3xl flex flex-col gap-3 hover:border-emerald-500/40 transition-all" data-billing-card={b.id}>
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">{b.number}</div>
                  <h3 className="font-display font-bold text-slate-800 truncate">{b.clientName}</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-1 truncate"><Link2 className="w-3 h-3 shrink-0" /> {b.source?.label || SOURCE_KIND_LABELS[b.source?.kind || 'manual']}</p>
                </div>
                <span className={cn('px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap', BILLING_STATUS_STYLE[b.status])}>{BILLING_STATUS_LABELS[b.status]}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Valor</div><div className="text-[11px] font-bold text-slate-700">{formatBRL(b.total)}</div></div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Vencimento</div><div className="text-[11px] font-bold text-slate-700">{br(b.installments.find(p => p.status === 'pending')?.dueDate || b.dueDate)}</div></div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Parcelas</div><div className="text-[11px] font-bold text-slate-700">{b.installments.filter(p => p.status === 'paid').length}/{b.installments.length} pagas</div></div>
              </div>
              <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-black uppercase flex items-center gap-1', FISCAL_STATUS_STYLE[b.fiscal?.status || 'not_issued'])}>
                  <FileText className="w-3 h-3" /> {b.fiscalDocType ? b.fiscalDocType.replace('NFSE', 'NFS-e').replace('NFE', 'NF-e') : 'Nota'}: {FISCAL_STATUS_LABELS[b.fiscal?.status || 'not_issued']}
                </span>
                <button onClick={() => setViewingId(b.id)} className="text-emerald-600 hover:text-emerald-700 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1" data-billing-open={b.id}>
                  Ver Detalhes <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {formDraft && (
          <BillingForm initial={formDraft} editing={!!editingId} clients={clients} products={products} fiscalSettings={fiscalSettings}
            onClose={() => { setFormDraft(null); setEditingId(null); }} onSave={handleSave} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewing && !formDraft && (
          <BillingDetail billing={viewing} payments={payments} fiscalDocs={fiscalDocs} actor={actor}
            canReceive={can(role, 'faturamento.receber')} canCancel={can(role, 'faturamento.cancelar')} canEdit={can(role, 'faturamento.editar')}
            canEmit={can(role, 'fiscal.emitir')} canCancelFiscal={can(role, 'fiscal.cancelar')} showTechnical={role === 'admin' || role === 'manager'}
            onClose={() => setViewingId(null)} onEdit={() => { setEditingId(viewing.id); setFormDraft(toDraft(viewing)); }} />
        )}
      </AnimatePresence>

      {fiscalCancel && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl text-center">
            <h4 className="font-display font-bold text-slate-800">Cancelar nota nº {fiscalCancel.number}</h4>
            <p className="text-xs text-slate-500">A nota continua guardada no histórico (número, XML e PDF). O faturamento não é cancelado.</p>
            <textarea value={fiscalReason} onChange={e => setFiscalReason(e.target.value)} rows={3} className="w-full glass-input text-left" placeholder="Motivo (obrigatório)" />
            <div className="flex gap-2">
              <button onClick={() => setFiscalCancel(null)} className="flex-1 py-3 glass rounded-xl font-bold text-slate-600 text-xs uppercase">Voltar</button>
              <button disabled={fiscalReason.trim().length < 5} onClick={() => runExclusive('Fiscal.cancel.list', async () => {
                try { await cancelFiscalDocument(fiscalCancel.id, fiscalReason); toast.success('Nota cancelada (mantida no histórico).'); setFiscalCancel(null); }
                catch (e: any) { toast.error(e.message); }
              })} className="flex-1 py-3 rounded-xl font-bold text-white text-xs uppercase bg-rose-600 disabled:opacity-40">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
