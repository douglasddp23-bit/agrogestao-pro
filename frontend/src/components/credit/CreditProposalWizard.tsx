import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, User, CheckCircle2, ArrowRight, ArrowLeft, AlertCircle, Loader2, MapPin, Landmark, Home,
  ChevronDown, ChevronUp, Tractor, Plus, Trash2, Users, ShieldCheck, FileDown, Info, Save, ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { runExclusive } from '../../lib/submitGuard';
import { Client, ServiceAnalysis } from '../../types';
import { cn, formatCPF, formatCurrency } from '../../lib/utils';
import { getPdfBranding } from '../../lib/pdfBranding';
import { isManagementRole } from '../../lib/permissions';
import { BANKS, loadBank, loadBankPrograms } from '../../lib/credit/banks';
import { loadCreditProgram, findProgramLine, programConditions, INVESTMENT_USES, INVESTMENT_UNITS, GUARANTEE_TYPES, CreditProgramConfig } from '../../lib/credit/programs';
import { CreditProposal, PROPOSAL_STATUSES, ProposalInvestment, ProposalProperty, SimNao } from '../../lib/credit/types';
import { calculateFinancedAmount, calculateInvestmentTotal, calculateOwnResources, calculateProposalTotals, costLineLabel, expectedContractDate } from '../../lib/credit/calculations';
import { createEmptyProposal, emptyProperty, fromLegacyPronafData, loadClientProperty, newInvestment, normalizeProposal, regionOfMunicipality, switchProgram } from '../../lib/credit/proposal';
import { validateProposal, ValidationIssue } from '../../lib/credit/validation';
import { createProposal, loadClient, syncPropertiesToClient, updateProposal } from '../../lib/credit/proposalService';
import { generateProposalPdf } from '../../lib/credit/proposalPdf';

// Proposta de Crédito Rural — fluxo BANCO → PROGRAMA/LINHA → CLIENTE → PROPOSTA →
// RESUMO → SALVAR. Esta tela só cuida da interface: cálculos, validações,
// configuração dos programas e gravação ficam em lib/credit/.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  existingProject?: ServiceAnalysis | null;
  onSaved?: () => void;
}

const STEP_LABELS = ['Banco, programa e cliente', 'Proposta', 'Resumo e PDF'];
const normalize = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtDate = (iso?: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—');
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

function SectionAccordion({ expanded, onToggle, icon, title, badge, children, hasError }: { expanded: boolean; onToggle: () => void; icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode; hasError?: boolean }) {
  return (
    <div className={cn('border rounded-2xl overflow-hidden', hasError ? 'border-rose-300' : 'border-slate-200')}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">{icon}{title}{hasError && <AlertCircle className="w-4 h-4 text-rose-500" />}</span>
        <div className="flex items-center gap-3">
          {badge && <span className="text-xs text-slate-500 font-medium">{badge}</span>}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>
      {expanded && <div className="p-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

function ProgramConditions({ program, lineId, compact }: { program: CreditProgramConfig; lineId?: string; compact?: boolean }) {
  const c = programConditions(program, lineId);
  const line = findProgramLine(program, lineId);
  const rows: [string, string | undefined][] = [
    ['Quem pode', c.audience], ['Linha', line?.name], ['Juros', c.interest], ['Limite', c.limit], ['Prazo', c.term], ['Carência', c.grace], ['Bônus', c.bonus],
  ];
  return (
    <div className={cn('rounded-xl border border-emerald-200 bg-emerald-50/60', compact ? 'p-3' : 'p-4')}>
      <p className="text-xs font-bold text-emerald-800 mb-2">{program.name} · {program.purposeKind}</p>
      <div className="grid grid-cols-1 gap-1">
        {rows.filter(([, v]) => v).map(([k, v]) => <p key={k} className="text-[11px] text-slate-700"><span className="font-semibold text-slate-500">{k}:</span> {v}</p>)}
      </div>
      {!!program.pendingRules?.length && (
        <div className="mt-2 flex flex-col gap-1">
          {program.pendingRules.map(r => <p key={r} className="text-[10px] text-amber-700 flex items-start gap-1"><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> A confirmar: {r}</p>)}
        </div>
      )}
      <p className="text-[10px] text-emerald-700 mt-2 flex items-start gap-1"><Info className="w-3 h-3 shrink-0 mt-0.5" /> Condições de referência; as finais são confirmadas pelo banco na contratação.</p>
    </div>
  );
}

export default function CreditProposalWizard({ isOpen, onClose, clients, existingProject, onSaved }: Props) {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string;
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | undefined>();
  const [bankId, setBankId] = useState('');
  const [programId, setProgramId] = useState('');
  const [lineId, setLineId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [client, setClient] = useState<Client | null>(null);
  const [proposal, setProposal] = useState<CreditProposal | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [expanded, setExpanded] = useState<string | null>('identificacao');
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const program = loadCreditProgram(proposal?.programId || programId);
  // Proposta antiga com programa que saiu da lista do banco: ele continua aparecendo nela
  const bankPrograms = useMemo(() => {
    const list = loadBankPrograms(proposal?.bankId || bankId);
    return program && !list.some(p => p.id === program.id) ? [...list, program] : list;
  }, [proposal?.bankId, bankId, program]);
  const totals = useMemo(() => (proposal && program ? calculateProposalTotals(proposal, program) : null), [proposal, program]);

  const preparerDefaults = () => ({ company: getPdfBranding().companyName || '', companyDoc: '', name: user?.displayName || '', doc: '' });

  // Abrir: nova proposta (etapa 1) ou projeto existente (vai direto para a proposta).
  useEffect(() => {
    if (!isOpen) return;
    setIssues([]); setExpanded('identificacao');
    if (!existingProject) {
      setStep(1); setProjectId(null); setSavedStatus(undefined); setBankId(''); setProgramId(''); setLineId('');
      setClientQuery(''); setClient(null); setProposal(null);
      return;
    }
    const p: any = existingProject;
    setProjectId(existingProject.id);
    (async () => {
      const cli = await loadClient(p.creditProposal?.clientId || p.clientId, clients).catch(() => null);
      setClient(cli);
      setClientQuery(cli?.name || p.clientName || '');
      let loaded: CreditProposal | null = null;
      if (p.creditProposal) {
        const fallback = createEmptyProposal({ bankId: p.creditProposal.bankId, programId: p.creditProposal.programId, client: cli || ({ id: p.clientId, name: p.clientName, cpf: '', properties: [], address: {} } as any) });
        loaded = normalizeProposal(p.creditProposal, fallback);
      } else {
        loaded = fromLegacyPronafData(p, cli || undefined);
      }
      setProposal(loaded);
      setSavedStatus(loaded?.status);
      setBankId(loaded?.bankId || ''); setProgramId(loaded?.programId || ''); setLineId(loaded?.lineId || '');
      setStep(loaded && loadCreditProgram(loaded.programId) ? 2 : 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, existingProject?.id]);

  const close = () => { setProposal(null); onClose(); };

  // ---------------------------------------------------------------- etapa 1
  const clientResults = useMemo(() => {
    const q = clientQuery.trim();
    if (q.length < 2 || (client && q === client.name)) return [];
    const d = q.replace(/\D/g, '');
    const onlyDoc = /^[\d.\-/\s]+$/.test(q);
    return clients.filter(c => onlyDoc ? d.length >= 3 && (c.cpf || '').replace(/\D/g, '').includes(d) : normalize(c.name).includes(normalize(q))).slice(0, 8);
  }, [clientQuery, clients, client]);

  const onClientQuery = (v: string) => {
    const value = /^[\d.\-\s]+$/.test(v) && v.replace(/\D/g, '').length <= 11 ? formatCPF(v) : v;
    setClientQuery(value);
    if (client && value !== client.name) setClient(null);
    const d = value.replace(/\D/g, '');
    if (d.length === 11 || d.length === 14) {
      const m = clients.find(c => (c.cpf || '').replace(/\D/g, '') === d);
      if (m) { setClient(m); setClientQuery(m.name); }
    }
  };

  const step1Program = loadCreditProgram(programId);
  const canConfirm = !!bankId && !!step1Program && (!step1Program.lineRequired || !!lineId) && !!client;

  const confirmStep1 = () => {
    if (!client || !step1Program) return;
    if (proposal) {
      // Voltou para a etapa 1: troca banco/programa/cliente sem perder o resto.
      let next = proposal.programId !== step1Program.id ? switchProgram(proposal, step1Program.id) : proposal;
      next = { ...next, bankId, lineId };
      if (next.clientId !== client.id) {
        next = { ...next, clientId: client.id, clientName: client.name, clientDoc: client.cpf || '', properties: client.properties?.length ? [loadClientProperty(client, 0, 1)] : [] };
      }
      setProposal(next);
    } else {
      setProposal(createEmptyProposal({ bankId, programId: step1Program.id, lineId, client, preparer: preparerDefaults() }));
    }
    setStep(2);
  };

  // ---------------------------------------------------------------- edição
  const set = (patch: Partial<CreditProposal>) => setProposal(prev => (prev ? { ...prev, ...patch } : prev));
  const setItem = (id: string, patch: Partial<ProposalInvestment>) => setProposal(prev => prev ? { ...prev, investments: prev.investments.map(i => (i.id === id ? { ...i, ...patch } : i)) } : prev);
  const setProperty = (number: number, patch: Partial<ProposalProperty>) => setProposal(prev => prev ? { ...prev, properties: prev.properties.map(p => (p.number === number ? { ...p, ...patch } : p)) } : prev);
  const setCost = <K extends keyof CreditProposal['costs']>(k: K, patch: Partial<CreditProposal['costs'][K]>) => setProposal(prev => prev ? { ...prev, costs: { ...prev.costs, [k]: { ...prev.costs[k], ...patch } } } : prev);

  const changeProgram = (id: string) => { if (proposal) { setProposal(switchProgram(proposal, id)); setProgramId(id); setLineId(''); } };
  const changeBank = (id: string) => {
    if (!proposal) return;
    const available = loadBankPrograms(id);
    if (available.some(p => p.id === proposal.programId)) set({ bankId: id });
    else { const first = available[0]; setProposal({ ...switchProgram(proposal, first.id), bankId: id }); toast.info(`O programa anterior não existe em ${loadBank(id)?.name}; escolha o programa.`); }
  };

  const toggleClientProperty = (index: number) => {
    if (!proposal || !client || !program) return;
    const exists = proposal.properties.find(p => p.sourceIndex === index);
    if (exists) {
      const remaining = proposal.properties.filter(p => p.sourceIndex !== index).map((p, i) => ({ ...p, number: i + 1 }));
      set({ properties: remaining, investments: proposal.investments.map(it => ({ ...it, propertyNumber: Math.min(it.propertyNumber, Math.max(1, remaining.length)) })) });
    } else {
      if (proposal.properties.length >= program.maxProperties) { toast.error(`Este programa aceita até ${program.maxProperties} imóvel(is).`); return; }
      set({ properties: [...proposal.properties, loadClientProperty(client, index, proposal.properties.length + 1)] });
    }
  };
  const addManualProperty = () => {
    if (!proposal || !program) return;
    if (proposal.properties.length >= program.maxProperties) { toast.error(`Este programa aceita até ${program.maxProperties} imóvel(is).`); return; }
    set({ properties: [...proposal.properties, { ...emptyProperty(proposal.properties.length + 1), ownerName: proposal.clientName, ownerDoc: proposal.clientDoc }] });
  };
  const removeProperty = (number: number) => {
    if (!proposal) return;
    const remaining = proposal.properties.filter(p => p.number !== number).map((p, i) => ({ ...p, number: i + 1 }));
    set({ properties: remaining });
  };

  // ---------------------------------------------------------------- salvar
  const save = async (): Promise<boolean> => {
    if (!proposal || !program || !user || !totals) return false;
    const found = validateProposal(proposal, program);
    setIssues(found);
    if (found.length) {
      toast.error(found[0].message, { description: found.length > 1 ? `E mais ${found.length - 1} ponto(s) a corrigir — veja a lista no topo da proposta.` : undefined });
      if (found.some(i => i.field.startsWith('investments') || i.field.startsWith('costs'))) setExpanded('investimentos');
      else if (found.some(i => i.field.startsWith('properties'))) setExpanded('imoveis');
      else setExpanded('identificacao');
      return false;
    }
    setSaving(true);
    try {
      const ctx = { user, program, totals };
      let saved: CreditProposal;
      if (projectId) saved = await updateProposal(projectId, proposal, ctx, savedStatus);
      else { const r = await createProposal(proposal, ctx); setProjectId(r.id); saved = r.proposal; }
      setProposal(saved);
      setSavedStatus(saved.status);
      toast.success(`Proposta ${saved.proposalId} salva.`, { description: `Status: ${saved.status}` });
      if (client && isManagementRole(role)) {
        try { if (await syncPropertiesToClient(client, saved)) toast.info('Cadastro do cliente atualizado com os dados dos imóveis.'); }
        catch (e) { console.warn('Não foi possível atualizar o cadastro do cliente:', e); }
      }
      onSaved?.();
      return true;
    } catch (error: any) {
      console.error('Erro ao salvar proposta:', error);
      toast.error('Não foi possível salvar a proposta.', { description: error?.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const pdf = async () => {
    if (!proposal || !program || !totals) return;
    setGeneratingPdf(true);
    try { await generateProposalPdf(proposal, program, totals); toast.success('PDF gerado com 2 vias (cliente e empresa).'); }
    catch (e) { console.error(e); toast.error('Não foi possível gerar o PDF.'); }
    finally { setGeneratingPdf(false); }
  };

  if (!isOpen) return null;

  const hasIssue = (prefix: string) => issues.some(i => i.field === prefix || i.field.startsWith(prefix + '.'));
  const inputCls = 'w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs bg-white';
  const errCls = (field: string) => (hasIssue(field) ? 'border-rose-400 ring-2 ring-rose-100' : '');
  const labelCls = 'text-[10px] font-medium text-slate-500 block mb-0.5';
  const bigSelect = 'w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium bg-white';
  const toggle = (id: string) => setExpanded(expanded === id ? null : id);
  const sn = (value: SimNao, onChange: (v: SimNao) => void, cls = '') => (
    <select value={value} onChange={e => onChange(e.target.value as SimNao)} className={cn('px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white', cls)}>
      <option value="Não">Não</option><option value="Sim">Sim</option>
    </select>
  );
  const ownMode = program?.ownResourcesMode || 'total';
  const bankName = loadBank(proposal?.bankId || bankId)?.name;

  const summaryRows: [string, string][] = proposal && totals ? [
    ['Cliente', proposal.clientName || '—'],
    ['Banco', bankName || '—'],
    ['Programa', `${program?.name || '—'}${findProgramLine(program, proposal.lineId) ? ` · ${findProgramLine(program, proposal.lineId)!.name}` : ''}`],
    ['Objetivo', proposal.objective || '—'],
    ['Finalidade', proposal.purpose || '—'],
    ['Investimento total', formatCurrency(totals.total)],
    ['Recursos próprios', formatCurrency(totals.ownResources)],
    ['Valor solicitado', formatCurrency(totals.financed)],
    ['Imóvel', proposal.properties.find(p => p.name)?.name || '—'],
    ['Município', (() => { const p = proposal.properties.find(x => x.name); return p?.city ? `${p.city}/${p.state}` : '—'; })()],
  ] : [];

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={close} data-credit-proposal>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={e => e.stopPropagation()}
          className={cn('bg-white rounded-2xl shadow-2xl w-full overflow-hidden max-h-[92vh] flex flex-col transition-all', step === 1 ? 'max-w-2xl' : 'max-w-6xl')}
        >
          {/* Cabeçalho */}
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Landmark className="w-5 h-5" /></div>
              <div>
                <h2 className="font-semibold text-lg leading-tight">Proposta de Crédito Rural{proposal?.proposalId ? ` · ${proposal.proposalId}` : ''}</h2>
                <p className="text-emerald-100 text-xs">
                  Etapa {step} de 3 · {STEP_LABELS[step - 1]}
                  {step > 1 && program ? ` · ${program.name}` : ''}
                  {step > 1 && proposal ? ` · ${proposal.clientName.toUpperCase()} · ${proposal.status}` : ''}
                </p>
              </div>
            </div>
            <button onClick={close} className="text-white/80 hover:text-white transition-colors" aria-label="Fechar"><X className="w-5 h-5" /></button>
          </div>

          {/* Etapas */}
          <div className="px-6 pt-4 flex items-center gap-1.5 shrink-0">
            {STEP_LABELS.map((label, idx) => (
              <div key={label} className="flex-1">
                <div className={cn('h-1.5 rounded-full', idx < step ? 'bg-emerald-500' : 'bg-slate-200')} />
                <p className={cn('text-[10px] mt-1 text-center', idx < step ? 'text-emerald-700 font-medium' : 'text-slate-400')}>{label}</p>
              </div>
            ))}
          </div>

          <div className="p-6 overflow-y-auto custom-scrollbar">
            {/* ======================= ETAPA 1 ======================= */}
            {step === 1 && (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">1. Banco</label>
                      <select value={bankId} onChange={e => { setBankId(e.target.value); if (!loadBankPrograms(e.target.value).some(p => p.id === programId)) { setProgramId(''); setLineId(''); } }} className={bigSelect}>
                        <option value="">Selecione o banco...</option>
                        {BANKS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">2. Programa / linha de crédito</label>
                      <select value={programId} onChange={e => { setProgramId(e.target.value); setLineId(''); }} className={bigSelect} disabled={!bankId}>
                        <option value="">{bankId ? 'Selecione o programa...' : 'Escolha o banco primeiro'}</option>
                        {Array.from(new Set(loadBankPrograms(bankId).map(p => p.group))).map(g => (
                          <optgroup key={g} label={g}>
                            {loadBankPrograms(bankId).filter(p => p.group === g).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>
                  {step1Program && step1Program.lines.length > 0 && (
                    <div className="mt-3">
                      <label className="text-sm font-bold text-slate-700 mb-1.5 block">Linha</label>
                      <select value={lineId} onChange={e => setLineId(e.target.value)} className={bigSelect}>
                        <option value="">Selecione a linha...</option>
                        {step1Program.lines.map(l => <option key={l.id} value={l.id}>{l.interest ? `${l.interest.replace(' ao ano', ' a.a.')} — ` : ''}{l.name}</option>)}
                      </select>
                    </div>
                  )}
                  {step1Program && <div className="mt-3"><ProgramConditions program={step1Program} lineId={lineId} compact /></div>}
                </div>

                <div>
                  <p className="text-sm font-bold text-slate-700 mb-2">3. Cliente</p>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input type="text" value={clientQuery} onChange={e => onClientQuery(e.target.value)} placeholder="Pesquisar pelo nome ou CPF/CNPJ" className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-medium" />
                  </div>
                  {clientResults.length > 0 && (
                    <div className="mt-2 rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                      {clientResults.map(c => (
                        <button key={c.id} type="button" onClick={() => { setClient(c); setClientQuery(c.name); }} className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-700 truncate">{c.name}</span>
                          <span className="text-[11px] text-slate-400 shrink-0">{c.cpf || 'sem CPF'}{c.address?.city ? ` · ${c.address.city}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {client && (
                    <div className="mt-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><User className="w-5 h-5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 flex items-center gap-1.5">{client.name}<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /></p>
                        <p className="text-xs text-slate-500 mt-0.5">CPF/CNPJ: {client.cpf || '—'}{client.phone ? ` · Tel.: ${client.phone}` : ''}</p>
                        {client.address?.city && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {client.address.city}/{client.address.state} · {regionOfMunicipality(client.address.city, client.address.state)}</p>}
                        <p className="text-xs text-slate-500 mt-0.5">{client.properties?.length || 0} propriedade(s) cadastrada(s){client.properties?.[0]?.name ? `: ${client.properties.map(p => p.name).join(', ')}` : ''}</p>
                      </div>
                    </div>
                  )}
                  {!client && clientQuery.trim().length >= 3 && clientResults.length === 0 && (
                    <div className="mt-3 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div><p className="text-sm font-medium text-amber-800">Cliente não encontrado</p><p className="text-xs text-amber-700 mt-0.5">Cadastre o cliente na aba Clientes e volte aqui.</p></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ======================= ETAPA 2 ======================= */}
            {step === 2 && proposal && program && totals && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
                <div className="flex flex-col gap-4 min-w-0">
                  {issues.length > 0 && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4" data-proposal-issues>
                      <p className="text-sm font-bold text-rose-700 flex items-center gap-1.5 mb-1"><AlertCircle className="w-4 h-4" /> Corrija antes de salvar:</p>
                      <ul className="list-disc pl-5 text-xs text-rose-700 space-y-0.5">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
                    </div>
                  )}

                  {/* Seção 1 — Identificação */}
                  <SectionAccordion expanded={expanded === 'identificacao'} onToggle={() => toggle('identificacao')} icon={<Landmark className="w-4 h-4 text-emerald-600" />} title="Seção 1 · Identificação da Proposta" hasError={['bankId', 'programId', 'lineId', 'purpose', 'objective', 'proposalDate', 'clientDoc'].some(hasIssue)}>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2"><label className={labelCls}>Cliente</label><p className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-600 truncate">{proposal.clientName.toUpperCase()}</p></div>
                      <div><label className={labelCls}>CPF/CNPJ</label><p className={cn('px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-600', errCls('clientDoc'))}>{proposal.clientDoc || '—'}</p></div>
                      <div><label className={labelCls}>Status</label>
                        <select value={proposal.status} onChange={e => set({ status: e.target.value as any })} className={inputCls} data-field="status">
                          {PROPOSAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div><label className={labelCls}>Data da proposta</label><input type="date" value={proposal.proposalDate} onChange={e => set({ proposalDate: e.target.value, expectedContractDate: expectedContractDate(e.target.value) })} className={cn(inputCls, errCls('proposalDate'))} /></div>
                      <div><label className={labelCls}>Previsão do contrato</label><p className="px-2.5 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs font-semibold text-emerald-700">{fmtDate(proposal.expectedContractDate)}</p></div>
                      <div><label className={labelCls}>Banco</label>
                        <select value={proposal.bankId} onChange={e => changeBank(e.target.value)} className={cn(inputCls, errCls('bankId'))}>{BANKS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                      </div>
                      <div><label className={labelCls}>Agência</label><input value={proposal.branch} onChange={e => set({ branch: e.target.value })} placeholder="Ex.: 1234 — Almenara" className={inputCls} /></div>
                      <div className="col-span-2"><label className={labelCls}>Programa / linha de crédito</label>
                        <select value={proposal.programId} onChange={e => changeProgram(e.target.value)} className={cn(inputCls, errCls('programId'))} data-field="programId">
                          {Array.from(new Set(bankPrograms.map(p => p.group))).map(g => <optgroup key={g} label={g}>{bankPrograms.filter(p => p.group === g).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
                        </select>
                      </div>
                      {program.lines.length > 0 && (
                        <div className="col-span-2"><label className={labelCls}>Linha</label>
                          <select value={proposal.lineId} onChange={e => { set({ lineId: e.target.value }); setLineId(e.target.value); }} className={cn(inputCls, errCls('lineId'))} data-field="lineId">
                            <option value="">Selecione</option>
                            {program.lines.map(l => <option key={l.id} value={l.id}>{l.interest ? `${l.interest.replace(' ao ano', ' a.a.')} — ` : ''}{l.name}</option>)}
                          </select>
                        </div>
                      )}
                      <div><label className={labelCls}>Região</label>
                        <select value={proposal.region} onChange={e => set({ region: e.target.value })} className={inputCls}>
                          <option value="">—</option><option value="Semi-árido">Semi-árido</option><option value="Fora do Semi-árido">Fora do Semi-árido</option>
                        </select>
                      </div>
                      <div className={program.lines.length ? '' : 'col-span-2'}><label className={labelCls}>Atividade principal</label><input value={proposal.mainActivity} onChange={e => set({ mainActivity: e.target.value })} placeholder="Ex.: bovinocultura de leite" className={inputCls} /></div>
                      <div className="col-span-2"><label className={labelCls}>Objetivo do crédito{program.objectiveRequired ? ' *' : ''}</label>
                        <select value={proposal.objective} onChange={e => set({ objective: e.target.value })} className={cn(inputCls, errCls('objective'))} data-field="objective">
                          <option value="">Selecione</option>{program.objectives.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2"><label className={labelCls}>Finalidade do crédito *</label>
                        <select value={proposal.purpose} onChange={e => set({ purpose: e.target.value })} className={cn(inputCls, errCls('purpose'))} data-field="purpose">
                          <option value="">Selecione</option>{program.purposes.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    {program.flags.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {program.flags.map(f => (
                          <div key={f.key}><label className={labelCls}>{f.label}</label>
                            <select value={proposal.flags[f.key] || ''} onChange={e => set({ flags: { ...proposal.flags, [f.key]: e.target.value as any } })} className={inputCls}>
                              <option value="">—</option><option value="Sim">Sim</option><option value="Não">Não</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                    <ProgramConditions program={program} lineId={proposal.lineId} compact />
                    <p className="text-[11px] font-semibold text-slate-500 -mb-2">Empresa elaboradora</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <input value={proposal.preparer.company} onChange={e => set({ preparer: { ...proposal.preparer, company: e.target.value } })} placeholder="Empresa elaboradora" className={inputCls} />
                      <input value={proposal.preparer.companyDoc} onChange={e => set({ preparer: { ...proposal.preparer, companyDoc: e.target.value } })} placeholder="CNPJ" className={inputCls} />
                      <input value={proposal.preparer.name} onChange={e => set({ preparer: { ...proposal.preparer, name: e.target.value } })} placeholder="Técnico responsável" className={inputCls} />
                      <input value={proposal.preparer.doc} onChange={e => set({ preparer: { ...proposal.preparer, doc: formatCPF(e.target.value) } })} placeholder="CPF do técnico" className={inputCls} />
                    </div>
                    <div><label className={labelCls}>Observações</label><textarea value={proposal.notes} onChange={e => set({ notes: e.target.value })} rows={2} className={inputCls} placeholder="Ex.: programa não listado, justificativas..." /></div>
                  </SectionAccordion>

                  {/* Seção 2 — Imóveis */}
                  <SectionAccordion expanded={expanded === 'imoveis'} onToggle={() => toggle('imoveis')} icon={<Home className="w-4 h-4 text-emerald-600" />} title="Seção 2 · Imóvel onde Serão Realizadas as Inversões" badge={`${proposal.properties.length} de até ${program.maxProperties}`} hasError={hasIssue('properties')}>
                    {client?.properties?.length ? (
                      <div>
                        <p className="text-[11px] text-slate-500 mb-1.5">Imóveis do cadastro do cliente — marque os da operação:</p>
                        <div className="flex flex-wrap gap-2">
                          {client.properties.map((p, i) => {
                            const on = proposal.properties.some(x => x.sourceIndex === i);
                            return (
                              <button key={i} type="button" onClick={() => toggleClientProperty(i)} className={cn('px-3 py-1.5 rounded-lg border text-xs font-semibold', on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300')}>
                                {on ? '✓ ' : ''}{p.name}{p.areaHectares ? ` (${p.areaHectares} ha)` : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : <p className="text-[11px] text-amber-700">O cliente não tem propriedades no cadastro. Informe o imóvel abaixo{isManagementRole(role) ? ' — ao salvar, ele é incluído no cadastro do cliente' : ''}.</p>}
                    {proposal.properties.map(p => (
                      <div key={p.number} className="rounded-xl border border-slate-200 p-3" data-proposal-property>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-600">Imóvel nº {p.number}{p.sourceIndex != null ? ' · do cadastro' : ' · informado na proposta'}</p>
                          <button type="button" onClick={() => removeProperty(p.number)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /> Tirar da proposta</button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="col-span-2"><label className={labelCls}>Denominação</label><input value={p.name} onChange={e => setProperty(p.number, { name: e.target.value })} className={inputCls} /></div>
                          <div><label className={labelCls}>Município</label><input value={p.city} onChange={e => setProperty(p.number, { city: e.target.value, region: regionOfMunicipality(e.target.value, p.state) })} className={cn(inputCls, errCls(`properties.${p.number}`))} /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className={labelCls}>UF</label><input value={p.state} maxLength={2} onChange={e => setProperty(p.number, { state: e.target.value.toUpperCase(), region: regionOfMunicipality(p.city, e.target.value.toUpperCase()) })} className={cn(inputCls, 'uppercase')} /></div>
                            <div><label className={labelCls}>Área (ha)</label><input type="number" value={p.areaHa || ''} onChange={e => setProperty(p.number, { areaHa: num(e.target.value) })} className={inputCls} /></div>
                          </div>
                          <div><label className={labelCls}>Região</label>
                            <select value={p.region} onChange={e => setProperty(p.number, { region: e.target.value })} className={inputCls}><option value="">—</option><option>Semi-árido</option><option>Fora do Semi-árido</option></select>
                          </div>
                          <div><label className={labelCls}>CAR</label><input value={p.car} onChange={e => setProperty(p.number, { car: e.target.value })} placeholder="Nº do registro no CAR" className={inputCls} /></div>
                          <div><label className={labelCls}>NIRF</label><input value={p.nirf} onChange={e => setProperty(p.number, { nirf: e.target.value })} className={inputCls} /></div>
                          <div><label className={labelCls}>CEI</label><input value={p.cei} onChange={e => setProperty(p.number, { cei: e.target.value })} className={inputCls} /></div>
                          <div><label className={labelCls}>SNCR (CCIR)</label><input value={p.sncr} onChange={e => setProperty(p.number, { sncr: e.target.value })} className={inputCls} /></div>
                          <div><label className={labelCls}>Tipo de pessoa</label>
                            <select value={p.ownerType} onChange={e => setProperty(p.number, { ownerType: e.target.value as any })} className={inputCls}><option value="PF">Física</option><option value="PJ">Jurídica</option></select>
                          </div>
                          <div><label className={labelCls}>Proprietário</label><input value={p.ownerName} onChange={e => setProperty(p.number, { ownerName: e.target.value })} className={inputCls} /></div>
                          <div><label className={labelCls}>CPF/CNPJ do proprietário</label><input value={p.ownerDoc} onChange={e => setProperty(p.number, { ownerDoc: e.target.value })} className={inputCls} /></div>
                        </div>
                      </div>
                    ))}
                    {proposal.properties.length < program.maxProperties && (
                      <button type="button" onClick={addManualProperty} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Informar imóvel não cadastrado</button>
                    )}
                    <p className="text-[10px] text-slate-400">{isManagementRole(role) ? 'Ao salvar, CAR, NIRF, CEI, SNCR e proprietário voltam para o cadastro do cliente.' : 'Os dados ficam na proposta; o Gerente pode levá-los ao cadastro do cliente ao salvar.'}</p>
                  </SectionAccordion>

                  {/* Seção 3 — Programa de investimentos */}
                  <SectionAccordion expanded={expanded === 'investimentos'} onToggle={() => toggle('investimentos')} icon={<Tractor className="w-4 h-4 text-emerald-600" />} title="Seção 3 · Programa de Investimentos" badge={formatCurrency(totals.total)} hasError={hasIssue('investments') || hasIssue('costs') || hasIssue('totals')}>
                    <div className="flex flex-col gap-2">
                      {proposal.investments.map((it, i) => {
                        const total = calculateInvestmentTotal(it);
                        const own = calculateOwnResources(it, ownMode);
                        const fin = calculateFinancedAmount(it, ownMode);
                        return (
                          <div key={it.id} className={cn('rounded-lg border p-2.5 bg-slate-50', hasIssue(`investments.${it.id}`) ? 'border-rose-300' : 'border-slate-200')} data-proposal-item>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] font-semibold text-slate-500">Item {i + 1}</span>
                              <button type="button" onClick={() => set({ investments: proposal.investments.length > 1 ? proposal.investments.filter(x => x.id !== it.id) : [newInvestment(1)] })} className="text-slate-300 hover:text-rose-500" title="Remover item"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
                              <div className="col-span-2 md:col-span-3"><label className={labelCls}>Discriminação</label><input value={it.description} onChange={e => setItem(it.id, { description: e.target.value })} className={cn(inputCls, errCls(`investments.${it.id}.description`))} data-field="description" /></div>
                              <div><label className={labelCls}>Quantidade</label><input type="number" value={it.quantity || ''} onChange={e => setItem(it.id, { quantity: num(e.target.value) })} className={cn(inputCls, errCls(`investments.${it.id}.quantity`))} data-field="quantity" /></div>
                              <div><label className={labelCls}>Unidade</label><select value={it.unit} onChange={e => setItem(it.id, { unit: e.target.value })} className={inputCls}>{INVESTMENT_UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
                              <div><label className={labelCls}>Valor unitário (R$)</label><input type="number" value={it.unitValue || ''} onChange={e => setItem(it.id, { unitValue: num(e.target.value) })} className={cn(inputCls, errCls(`investments.${it.id}.unitValue`))} data-field="unitValue" /></div>
                              <div className="col-span-2"><label className={labelCls}>Uso</label><select value={it.use} onChange={e => setItem(it.id, { use: e.target.value })} className={inputCls}><option value="">Selecione</option>{INVESTMENT_USES.map(u => <option key={u}>{u}</option>)}</select></div>
                              <div><label className={labelCls}>Nº do imóvel</label>
                                <select value={it.propertyNumber} onChange={e => setItem(it.id, { propertyNumber: Number(e.target.value) })} className={cn(inputCls, errCls(`investments.${it.id}.property`))}>
                                  {(proposal.properties.length ? proposal.properties : [emptyProperty(1)]).map(p => <option key={p.number} value={p.number}>{p.number}{p.name ? ` · ${p.name}` : ''}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={labelCls}>{ownMode === 'unit' ? 'Rec. próprios por unidade (R$)' : 'Recursos próprios (R$)'}</label>
                                {ownMode === 'unit'
                                  ? <input type="number" value={it.ownResourcesUnit || ''} onChange={e => setItem(it.id, { ownResourcesUnit: num(e.target.value) })} className={cn(inputCls, errCls(`investments.${it.id}.own`))} data-field="own" />
                                  : <input type="number" value={it.ownResourcesTotal || ''} onChange={e => setItem(it.id, { ownResourcesTotal: num(e.target.value) })} className={cn(inputCls, errCls(`investments.${it.id}.own`))} data-field="own" />}
                              </div>
                              <div><label className={labelCls}>Compõe garantia?</label>{sn(it.isCollateral, v => setItem(it.id, { isCollateral: v }), 'w-full')}</div>
                              <div><label className={labelCls}>Irrigação?</label>{sn(it.irrigation, v => setItem(it.id, { irrigation: v }), 'w-full')}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-3 mt-1.5 text-[11px] text-slate-500" data-item-totals>
                              <span>Recursos próprios: <strong>{formatCurrency(own)}</strong></span>
                              <span>Valor financiado: <strong className={fin < 0 ? 'text-rose-600' : ''}>{formatCurrency(fin)}</strong></span>
                              <span>Investimento total: <strong className="text-emerald-700">{formatCurrency(total)}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" onClick={() => set({ investments: [...proposal.investments, newInvestment(proposal.properties[0]?.number || 1)] })} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar item</button>
                    </div>

                    {/* Linhas de custo do programa */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(['custeioAgricola', 'custeioPecuario', 'seguroRural', 'seguroPrestamista'] as const).filter(k => program.costLines.includes(k)).map(k => (
                        <div key={k} className="rounded-lg border border-slate-100 p-2.5">
                          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">{costLineLabel(k)}</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input type="number" value={proposal.costs[k].value || ''} onChange={e => setCost(k, { value: num(e.target.value) })} placeholder="Valor (R$)" className={inputCls} />
                            <input type="number" value={proposal.costs[k].ownResources || ''} onChange={e => setCost(k, { ownResources: num(e.target.value) })} placeholder="Rec. próprios (R$)" className={inputCls} />
                          </div>
                        </div>
                      ))}
                      {program.costLines.includes('assessoria') && (
                        <div className={cn('rounded-lg border p-2.5', hasIssue('costs.assessoria') ? 'border-rose-300' : 'border-slate-100')}>
                          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">{costLineLabel('assessoria')} (máx. {program.advisory.maxPercent}%{program.advisory.maxValue ? ` e ${formatCurrency(program.advisory.maxValue)}` : ''})</p>
                          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-1.5">
                            <select value={proposal.costs.assessoria.mode} onChange={e => setCost('assessoria', { mode: e.target.value as any })} className={inputCls}><option value="percent">Percentual (%)</option><option value="value">Valor fixo (R$)</option></select>
                            <input type="number" value={proposal.costs.assessoria.amount || ''} onChange={e => setCost('assessoria', { amount: num(e.target.value) })} placeholder={proposal.costs.assessoria.mode === 'percent' ? '%' : 'R$'} className={inputCls} data-field="advisory" />
                            <input type="number" value={proposal.costs.assessoria.ownResources || ''} onChange={e => setCost('assessoria', { ownResources: num(e.target.value) })} placeholder="Rec. próprios" className={inputCls} />
                          </div>
                          <p className="text-[11px] text-slate-500 text-right mt-1">Valor: <strong>{formatCurrency(totals.costLines.find(l => l.kind === 'assessoria')?.total || 0)}</strong></p>
                        </div>
                      )}
                      {program.costLines.includes('taxaIrrigacao') && (
                        <div className="rounded-lg border border-slate-100 p-2.5">
                          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">{costLineLabel('taxaIrrigacao')}</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input type="number" value={proposal.costs.taxaIrrigacao.percent || ''} onChange={e => setCost('taxaIrrigacao', { percent: num(e.target.value) })} placeholder="Percentual (%)" className={inputCls} />
                            <input type="number" value={proposal.costs.taxaIrrigacao.ownResources || ''} onChange={e => setCost('taxaIrrigacao', { ownResources: num(e.target.value) })} placeholder="Rec. próprios" className={inputCls} />
                          </div>
                          <p className="text-[11px] text-slate-500 text-right mt-1">Base (itens com irrigação): <strong>{formatCurrency(totals.irrigationBase)}</strong> · Valor: <strong>{formatCurrency(totals.costLines.find(l => l.kind === 'taxaIrrigacao')?.total || 0)}</strong></p>
                        </div>
                      )}
                    </div>

                    {/* Resumo financeiro */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-emerald-600 text-white rounded-xl p-3" data-financial-summary>
                      {([['Total do investimento', formatCurrency(totals.total)], ['Recursos próprios', formatCurrency(totals.ownResources)], ['Valor financiado', formatCurrency(totals.financed)], ['% recursos próprios', pct(totals.ownPct)], ['% financiado', pct(totals.financedPct)]] as const).map(([k, v]) => (
                        <div key={k}><p className="text-[10px] uppercase tracking-wide text-emerald-100">{k}</p><p className="text-sm font-bold">{v}</p></div>
                      ))}
                    </div>
                  </SectionAccordion>

                  {/* Seção 4 — Garantias */}
                  <SectionAccordion expanded={expanded === 'garantias'} onToggle={() => toggle('garantias')} icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />} title="Seção 4 · Garantias" badge={formatCurrency(totals.guaranteesTotal)}>
                    <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Garantias fidejussórias (aval / fiança)</p>
                    {([0, 1] as const).map(i => {
                      const g = proposal.guarantors[i];
                      const upd = (patch: any) => { const gs = [...proposal.guarantors] as CreditProposal['guarantors']; gs[i] = { ...gs[i], ...patch }; set({ guarantors: gs }); };
                      return (
                        <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                          <select value={g.type} onChange={e => upd({ type: e.target.value })} className={inputCls}><option value="">Tipo</option><option value="Aval">Aval</option><option value="Fiança">Fiança</option></select>
                          <input value={g.name} onChange={e => upd({ name: e.target.value })} placeholder={`Avalista/Fiador ${i + 1}`} className={inputCls} />
                          <input value={g.doc} onChange={e => upd({ doc: formatCPF(e.target.value) })} placeholder="CPF" className={inputCls} />
                          <input value={g.spouseName} onChange={e => upd({ spouseName: e.target.value })} placeholder="Cônjuge — nome" className={inputCls} />
                          <input value={g.spouseDoc} onChange={e => upd({ spouseDoc: formatCPF(e.target.value) })} placeholder="Cônjuge — CPF" className={inputCls} />
                        </div>
                      );
                    })}
                    <p className="text-[11px] font-semibold text-slate-500">Outras garantias</p>
                    {proposal.realGuarantees.map((g, i) => (
                      <div key={g.id} className="grid grid-cols-12 gap-1.5 items-center">
                        <input value={g.description} onChange={e => set({ realGuarantees: proposal.realGuarantees.map((x, k) => k === i ? { ...x, description: e.target.value } : x) })} placeholder="Denominação (ex.: Fazenda X, matrícula 123)" className={cn(inputCls, 'col-span-5')} />
                        <select value={g.type} onChange={e => set({ realGuarantees: proposal.realGuarantees.map((x, k) => k === i ? { ...x, type: e.target.value } : x) })} className={cn(inputCls, 'col-span-3')}>{GUARANTEE_TYPES.map(t => <option key={t.type} value={t.type}>{t.type} ({t.kind})</option>)}</select>
                        <input type="number" value={g.value || ''} onChange={e => set({ realGuarantees: proposal.realGuarantees.map((x, k) => k === i ? { ...x, value: num(e.target.value) } : x) })} placeholder="Valor (R$)" className={cn(inputCls, 'col-span-3')} />
                        <button type="button" onClick={() => set({ realGuarantees: proposal.realGuarantees.filter((_, k) => k !== i) })} className="col-span-1 flex justify-center text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => set({ realGuarantees: [...proposal.realGuarantees, { id: Math.random().toString(36).slice(2, 10), description: '', type: 'Hipoteca', value: 0 }] })} className="self-start flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"><Plus className="w-3.5 h-3.5" /> Adicionar garantia</button>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-slate-100 pt-2 text-xs">
                      <span>Reais: <strong>{formatCurrency(totals.realGuaranteesTotal)}</strong></span>
                      <span>Evolutivas (itens): <strong>{formatCurrency(totals.evolvingCollateral)}</strong></span>
                      <span>Total: <strong className="text-emerald-700">{formatCurrency(totals.guaranteesTotal)}</strong></span>
                      <span>Garantias / financiado: <strong>{pct(totals.guaranteesPct)}</strong></span>
                    </div>
                  </SectionAccordion>
                </div>

                {/* Resumo da proposta (atualiza sozinho) */}
                <aside className="lg:sticky lg:top-0 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 flex flex-col gap-2" data-proposal-summary>
                  <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Resumo da proposta</p>
                  {summaryRows.map(([k, v]) => (
                    <div key={k} className={cn('text-xs', ['Investimento total', 'Valor solicitado'].includes(k) && 'pt-1 border-t border-emerald-100')}>
                      <span className="block text-[10px] text-slate-500">{k}</span>
                      <span className={cn('font-semibold', k === 'Valor solicitado' ? 'text-emerald-700 text-sm' : 'text-slate-700')}>{v}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-500 pt-1 border-t border-emerald-100">Status: <strong>{proposal.status}</strong>{proposal.proposalId ? ` · ${proposal.proposalId}` : ' · ainda não salva'}</p>
                </aside>
              </div>
            )}

            {/* ======================= ETAPA 3 ======================= */}
            {step === 3 && proposal && program && totals && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3"><CheckCircle2 className="w-8 h-8" /></div>
                  <h3 className="font-semibold text-slate-800 text-lg">Proposta {proposal.proposalId || ''}</h3>
                  <p className="text-sm text-slate-500 mt-1">Gere o PDF: ele sai com <strong>2 vias</strong> — o cliente leva uma e assina a outra, que fica com a empresa.</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-slate-50 rounded-xl p-3">
                  {summaryRows.map(([k, v]) => <span key={k}>{k}: <strong>{v}</strong></span>)}
                  <span>Status: <strong>{proposal.status}</strong></span>
                  <span>% recursos próprios: <strong>{pct(totals.ownPct)}</strong></span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ProgramConditions program={program} lineId={proposal.lineId} compact />
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-bold text-slate-700 mb-2">Documentos que o cliente deve providenciar</p>
                    <ul className="flex flex-col gap-1">{program.documents.map(d => <li key={d} className="text-[11px] text-slate-600 flex gap-1.5"><span className="text-slate-300">☐</span>{d}</li>)}</ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="px-6 pb-6 pt-3 flex items-center justify-between shrink-0 border-t border-slate-100 gap-2 flex-wrap">
            {step === 1 && (
              <>
                <button onClick={close} className="text-sm text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                <button onClick={confirmStep1} disabled={!canConfirm} className={cn('flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all', canConfirm ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}
                  title={!bankId ? 'Escolha o banco' : !step1Program ? 'Escolha o programa' : step1Program.lineRequired && !lineId ? 'Escolha a linha' : !client ? 'Escolha o cliente' : ''}>
                  Abrir proposta <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button onClick={() => { setBankId(proposal?.bankId || ''); setProgramId(proposal?.programId || ''); setLineId(proposal?.lineId || ''); setStep(1); }} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Banco, programa e cliente</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => runExclusive('CreditProposal.save', () => save())} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar proposta
                  </button>
                  <button onClick={() => runExclusive('CreditProposal.saveNext', async () => { if (await save()) setStep(3); })} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-60">
                    Salvar e ver resumo <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar e editar</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => runExclusive('CreditProposal.pdf', () => pdf())} disabled={generatingPdf} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                    {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Gerar PDF (2 vias)
                  </button>
                  <button onClick={close} className="px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm">Concluir</button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
