import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { FileSpreadsheet, FileDown, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { cn, todayLocalDateString } from '../../lib/utils';
import { exportToExcel } from '../../lib/exportExcel';
import { drawBrandBanner, drawBrandFooter } from '../../lib/pdfBranding';
import { formatBRL } from '../service/ServiceKpiCards';
import { computeBillingStatus } from '../../lib/billing/calc';
import { useBillings, useFiscalDocuments } from '../../lib/billing/service';
import { BILLING_SOURCES, SERVICE_CATEGORIES } from '../../lib/billing/sources';
import { BILLING_STATUS_LABELS, FISCAL_DOC_LABELS, FISCAL_STATUS_LABELS, OPERATION_LABELS } from '../../lib/billing/types';

type ReportId = 'period' | 'client' | 'service' | 'professional' | 'receivables' | 'default' | 'issued' | 'cancelled' | 'coverage';
const REPORTS: { id: ReportId; label: string; perm: 'fin' | 'fiscal' }[] = [
  { id: 'period', label: 'Faturamento por período', perm: 'fin' },
  { id: 'client', label: 'Faturamento por cliente', perm: 'fin' },
  { id: 'service', label: 'Faturamento por serviço', perm: 'fin' },
  { id: 'professional', label: 'Faturamento por profissional', perm: 'fin' },
  { id: 'receivables', label: 'Contas a receber', perm: 'fin' },
  { id: 'default', label: 'Inadimplência', perm: 'fin' },
  { id: 'issued', label: 'Notas emitidas', perm: 'fiscal' },
  { id: 'cancelled', label: 'Notas canceladas', perm: 'fiscal' },
  { id: 'coverage', label: 'Serviços faturados x não faturados', perm: 'fin' },
];
const br = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5);

/** Relatórios de faturamento e fiscais (Gerente/Administrador), com Excel e PDF. */
export default function BillingReports() {
  const { data: billings } = useBillings();
  const { data: docs } = useFiscalDocuments();
  const [report, setReport] = useState<ReportId>('period');
  const today = todayLocalDateString();
  const monthStart = today.slice(0, 8) + '01';
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sources, setSources] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (report !== 'coverage' || Object.keys(sources).length) return;
    (async () => {
      const out: Record<string, any[]> = {};
      for (const col of Object.keys(BILLING_SOURCES).filter(c => c !== 'appointments')) {
        try { out[col] = (await getDocs(collection(db, col))).docs.map(d => ({ id: d.id, ...d.data() })); } catch { out[col] = []; }
      }
      setSources(out);
    })();
  }, [report, sources]);

  const inPeriod = (d?: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const active = useMemo(() => billings.filter(b => b.status !== 'cancelled' && b.status !== 'draft').map(b => ({ ...b, status: computeBillingStatus(b, today) })), [billings, today]);
  const catLabel = (id?: string) => SERVICE_CATEGORIES.find(c => c.id === id)?.label || 'Outros / manual';

  const rows = useMemo((): Record<string, any>[] => {
    const period = active.filter(b => inPeriod(b.issueDate));
    const group = (key: (b: any) => string, name: string) => {
      const m = new Map<string, { qtd: number; total: number; recebido: number }>();
      for (const b of period) {
        const k = key(b) || '—';
        const g = m.get(k) || { qtd: 0, total: 0, recebido: 0 };
        g.qtd++; g.total += b.total; g.recebido += b.paidTotal || 0; m.set(k, g);
      }
      return [...m.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, g]) => ({ [name]: k, 'Faturamentos': g.qtd, 'Total (R$)': Math.round(g.total * 100) / 100, 'Recebido (R$)': Math.round(g.recebido * 100) / 100, 'Em aberto (R$)': Math.round((g.total - g.recebido) * 100) / 100 }));
    };
    switch (report) {
      case 'period': return period.map(b => ({ 'Número': b.number, 'Emissão': br(b.issueDate), 'Cliente': b.clientName, 'Operação': OPERATION_LABELS[b.operationType], 'Total (R$)': b.total, 'Recebido (R$)': b.paidTotal || 0, 'Situação': BILLING_STATUS_LABELS[b.status] }));
      case 'client': return group(b => b.clientName, 'Cliente');
      case 'service': return group(b => catLabel(b.source?.serviceCategory || b.items?.[0]?.serviceCategory), 'Serviço');
      case 'professional': return group(b => b.responsibleName, 'Profissional');
      case 'receivables': return active.flatMap(b => b.installments.filter(p => p.status === 'pending' && inPeriod(p.dueDate)).map(p => ({ 'Faturamento': b.number, 'Cliente': b.clientName, 'Parcela': `${p.number}/${b.installments.length}`, 'Vencimento': br(p.dueDate), 'Valor (R$)': p.value, 'Situação': p.dueDate < today ? 'Vencida' : 'A vencer' })));
      case 'default': return active.flatMap(b => b.installments.filter(p => p.status === 'pending' && p.dueDate < today).map(p => ({ 'Cliente': b.clientName, 'Faturamento': b.number, 'Parcela': `${p.number}/${b.installments.length}`, 'Vencimento': br(p.dueDate), 'Dias em atraso': daysBetween(p.dueDate, today), 'Valor (R$)': p.value }))).sort((a, b) => b['Dias em atraso'] - a['Dias em atraso']);
      case 'issued': return docs.filter(d => d.status === 'issued' && inPeriod(d.issuedAt || d.createdAt)).map(d => ({ 'Número': d.number || '', 'Série': d.series || '', 'Tipo': FISCAL_DOC_LABELS[d.docType], 'Emissão': br(d.issuedAt), 'Cliente': d.clientName, 'Faturamento': d.billingNumber, 'Valor (R$)': d.amount, 'Chave/Cód.': d.verificationCode || '' }));
      case 'cancelled': return docs.filter(d => d.status === 'cancelled' && inPeriod(d.cancelledAt || d.updatedAt)).map(d => ({ 'Número': d.number || '', 'Tipo': FISCAL_DOC_LABELS[d.docType], 'Cliente': d.clientName, 'Faturamento': d.billingNumber, 'Valor (R$)': d.amount, 'Cancelada em': br(d.cancelledAt), 'Motivo': d.cancelReason || '' }));
      case 'coverage': {
        const billed = new Set(billings.filter(b => b.status !== 'cancelled' && b.source?.id).map(b => `${b.source.collection}/${b.source.id}`));
        return (Object.entries(sources) as [string, any[]][]).map(([col, list]) => {
          const def = BILLING_SOURCES[col];
          const done = list.filter(d => def.isDone(d));
          const faturados = list.filter(d => billed.has(`${col}/${d.id}`)).length;
          const concluidosSemFatura = done.filter(d => !billed.has(`${col}/${d.id}`));
          return { 'Serviço': def.label, 'Cadastrados': list.length, 'Concluídos': done.length, 'Faturados': faturados, 'Concluídos sem faturamento': concluidosSemFatura.length, 'Valor não faturado (R$)': Math.round(concluidosSemFatura.reduce((s, d) => s + def.value(d), 0) * 100) / 100 };
        });
      }
    }
    return [];
  }, [report, active, docs, billings, sources, from, to, today]);

  const title = REPORTS.find(r => r.id === report)!.label;
  const periodText = report === 'default' || report === 'coverage' ? `posição em ${br(today)}` : `período ${br(from)} a ${br(to)}`;

  const toExcel = () => {
    if (!rows.length) { toast.error('Não há dados para exportar.'); return; }
    exportToExcel(rows, `${title.replace(/\s+/g, '_')}_${today}`, 'Relatório');
    toast.success('Planilha exportada.');
  };
  const toPdf = async () => {
    if (!rows.length) { toast.error('Não há dados para exportar.'); return; }
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: Object.keys(rows[0]).length > 6 ? 'landscape' : 'portrait' });
    const w = doc.internal.pageSize.getWidth();
    let y = drawBrandBanner(doc, { height: 28 }) + 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30, 41, 59);
    doc.text(title.toUpperCase(), w / 2, y, { align: 'center' }); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text(periodText, w / 2, y, { align: 'center' }); y += 6;
    const cols = Object.keys(rows[0]);
    autoTable(doc, {
      startY: y, head: [cols],
      body: rows.map(r => cols.map(c => (typeof r[c] === 'number' && /R\$/.test(c) ? formatBRL(r[c]) : String(r[c] ?? '')))),
      theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [5, 150, 105], textColor: 255 }, margin: { left: 12, right: 12, bottom: 20 },
    });
    const totalCol = cols.find(c => /^(Total|Valor) \(R\$\)$/.test(c));
    if (totalCol) {
      const sum = rows.reduce((s, r) => s + (Number(r[totalCol]) || 0), 0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(4, 120, 87);
      doc.text(`Total: ${formatBRL(sum)}`, w - 12, (doc as any).lastAutoTable.finalY + 7, { align: 'right' });
    }
    drawBrandFooter(doc);
    doc.save(`${title.replace(/\s+/g, '_')}_${today}.pdf`);
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4" data-billing-reports>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h3 className="font-display font-bold text-slate-800 flex items-center gap-2"><Receipt className="w-4 h-4 text-emerald-600" /> Faturamento e documentos fiscais</h3>
        <div className="flex gap-2">
          <button onClick={toExcel} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 rounded-xl text-xs font-bold flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
          <button onClick={toPdf} className="px-3 py-2 bg-slate-800 text-white hover:bg-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5"><FileDown className="w-4 h-4 text-emerald-400" /> PDF</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setReport(r.id)} data-billing-report={r.id}
            className={cn('px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all', report === r.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50')}>{r.label}</button>
        ))}
      </div>
      {!['default', 'coverage'].includes(report) && (
        <div className="flex gap-3 items-end">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase block">De</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="glass-input text-xs" /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase block">Até</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="glass-input text-xs" /></div>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-x-auto max-h-[420px]">
        {rows.length ? (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0"><tr>{Object.keys(rows[0]).map(c => <th key={c} className="p-2 text-left whitespace-nowrap">{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{Object.entries(r).map(([c, v]) => <td key={c} className="p-2 whitespace-nowrap">{typeof v === 'number' && /R\$/.test(c) ? formatBRL(v) : String(v)}</td>)}</tr>)}</tbody>
          </table>
        ) : <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest" data-billing-report-empty>Nenhum dado no {periodText}</div>}
      </div>
    </div>
  );
}
