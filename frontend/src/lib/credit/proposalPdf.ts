// PDF da proposta em 2 vias (cliente / empresa), com campo de assinatura.

import { getPdfBranding, drawBrandBanner, drawBrandFooter } from '../pdfBranding';
import { formatCurrency } from '../utils';
import { CreditProposal, ProposalTotals } from './types';
import { CreditProgramConfig, findProgramLine, programConditions } from './programs';
import { calculateFinancedAmount, calculateInvestmentTotal, calculateOwnResources } from './calculations';
import { loadBank } from './banks';

const fmtDate = (iso?: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—');

export async function generateProposalPdf(p: CreditProposal, program: CreditProgramConfig, t: ProposalTotals): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = pdf.internal.pageSize.getWidth();
  const empresa = p.preparer.company || getPdfBranding().companyName || 'a empresa';
  const bank = loadBank(p.bankId)?.name || '';
  const line = findProgramLine(program, p.lineId);
  const cond = programConditions(program, p.lineId);
  const EMERALD: [number, number, number] = [5, 150, 105];
  const DARK: [number, number, number] = [30, 41, 59];
  const mode = program.ownResourcesMode;

  const table = (y: number, head: any[][], body: any[][], extra: any = {}) => {
    autoTable(pdf, {
      startY: y, head, body, theme: 'grid',
      headStyles: { fillColor: extra.headColor || DARK, textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 1.2 },
      margin: { left: 14, right: 14, top: 16, bottom: 20 },
      ...extra.opts,
    });
    return (pdf as any).lastAutoTable.finalY + 4;
  };
  // "rótulo | valor | rótulo | valor"; rótulo com "!" ocupa a linha toda
  const kv4 = (y: number, title: string, pairs: [string, string | undefined][], headColor = DARK) => {
    const body: any[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i], b = pairs[i + 1];
      if (a[0].startsWith('!') || !b || b[0].startsWith('!')) body.push([a[0].replace(/^!/, ''), { content: a[1] || '—', colSpan: 3 }]);
      else { body.push([a[0], a[1] || '—', b[0], b[1] || '—']); i++; }
    }
    return table(y, [[{ content: title, colSpan: 4 }]], body, {
      headColor, opts: { columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold', textColor: [71, 85, 105] }, 2: { cellWidth: 30, fontStyle: 'bold', textColor: [71, 85, 105] } } },
    });
  };
  const ensure = (y: number, need: number) => (y + need > 275 ? (pdf.addPage(), 18) : y);

  const renderVia = (via: string) => {
    let y = drawBrandBanner(pdf, { height: 26 }) + 9;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...DARK);
    pdf.text('PROPOSTA DE CRÉDITO RURAL — RESUMO', w / 2, y, { align: 'center' });
    y += 5.5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139);
    pdf.text(`${via} · ${p.proposalId || 'sem número'} · ${program.name} · ${bank}`, w / 2, y, { align: 'center' });
    y += 6;

    y = kv4(y, 'Cliente', [['Nome', p.clientName], ['CPF/CNPJ', p.clientDoc]], EMERALD);
    y = kv4(y, 'Dados da proposta — condições de referência, confirmadas pelo banco na contratação', [
      ['Banco', bank], ['Agência', p.branch],
      ['Programa', program.name], ['Status', p.status],
      ...(line ? [['!Linha', line.name] as [string, string]] : []),
      ['Objetivo', p.objective], ['Região', p.region],
      ['!Finalidade', p.purpose],
      ['Juros', cond.interest], ['Limite', cond.limit],
      ['Prazo', cond.term], ['Carência', cond.grace],
      ['Data da proposta', fmtDate(p.proposalDate)], ['Previsão contrato', fmtDate(p.expectedContractDate)],
      ['Atividade', p.mainActivity], ['Técnico', p.preparer.name],
      ['!Empresa', [p.preparer.company, p.preparer.companyDoc].filter(Boolean).join(' · CNPJ ')],
    ]);

    const props = p.properties.filter(x => x.name);
    if (props.length) {
      y = ensure(y, 20);
      y = table(y, [['Nº', 'Imóvel onde serão feitas as inversões', 'Município/UF', 'Região', 'Área', 'CAR']],
        props.map(x => [String(x.number), x.name, [x.city, x.state].filter(Boolean).join('/') || '—', x.region || '—', x.areaHa ? `${x.areaHa} ha` : '—', x.car || '—']),
        { opts: { columnStyles: { 0: { cellWidth: 9 }, 4: { halign: 'right' } } } });
    }

    const items = p.investments.filter(i => (i.description || '').trim());
    y = ensure(y, 30);
    y = table(y, [['Programa de investimentos', 'Quantidade', 'Rec. próprios', 'Financiado', 'Total']], [
      ...items.map(i => [i.description, `${i.quantity} ${i.unit} × ${formatCurrency(i.unitValue)}`, formatCurrency(calculateOwnResources(i, mode)), formatCurrency(calculateFinancedAmount(i, mode)), formatCurrency(calculateInvestmentTotal(i))]),
      ...t.costLines.map(l => [l.label, '', formatCurrency(l.own), formatCurrency(l.financed), formatCurrency(l.total)]),
    ], {
      opts: {
        columnStyles: { 0: { cellWidth: 62 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        foot: [['TOTAL', `Próprios ${t.ownPct.toLocaleString('pt-BR')}% · financiado ${t.financedPct.toLocaleString('pt-BR')}%`, formatCurrency(t.ownResources), formatCurrency(t.financed), formatCurrency(t.total)]],
        footStyles: { fillColor: EMERALD, textColor: 255, fontStyle: 'bold', halign: 'right' },
      },
    });

    const gRows: any[][] = [
      ...p.guarantors.filter(g => g.name).map(g => [g.type || 'Aval/Fiança', `${g.name}${g.doc ? ' · CPF ' + g.doc : ''}${g.spouseName ? ' · Cônjuge: ' + g.spouseName : ''}`]),
      ...p.realGuarantees.filter(g => g.description || g.value).map(g => [g.type, `${g.description || '—'} · ${formatCurrency(g.value)}`]),
      ...(t.evolvingCollateral ? [['Garantias evolutivas (itens)', formatCurrency(t.evolvingCollateral)]] : []),
      ['Total de garantias', `${formatCurrency(t.guaranteesTotal)} (${t.guaranteesPct.toLocaleString('pt-BR')}% do financiado)`],
    ];
    y = ensure(y, 20);
    y = table(y, [[{ content: 'Garantias', colSpan: 2 }]], gRows, { opts: { columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: [71, 85, 105] } } } });

    y = ensure(y, 25);
    const docs = program.documents;
    const half = Math.ceil(docs.length / 2);
    y = table(y, [[{ content: 'Documentos que o cliente deve providenciar', colSpan: 2 }]],
      Array.from({ length: half }, (_, i) => [`[  ] ${docs[i]}`, docs[i + half] ? `[  ] ${docs[i + half]}` : '']),
      { opts: { columnStyles: { 0: { cellWidth: (w - 28) / 2 } }, styles: { fontSize: 7.2, cellPadding: 1 } } });

    if (y + 44 > 280) { pdf.addPage(); y = 18; }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(51, 65, 85);
    const decl = `Declaro que as informações acima são verdadeiras e autorizo ${empresa} a iniciar a elaboração do projeto de crédito rural (${program.name}${line ? ' — ' + line.name : ''}) junto ao ${bank}. Estou ciente de que a aprovação, o valor e as condições finais do financiamento dependem da análise do banco.`;
    const lines = pdf.splitTextToSize(decl, w - 28);
    pdf.text(lines, 14, y);
    y += lines.length * 3.9 + 2;
    const cidade = props[0]?.city || '____________________';
    pdf.text(`${cidade}, ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`, 14, y);
    y += 15;
    pdf.setDrawColor(100, 116, 139);
    pdf.line(18, y, 92, y); pdf.line(w - 92, y, w - 18, y);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...DARK);
    pdf.text(p.clientName || 'Cliente', 55, y + 5, { align: 'center' });
    pdf.text(p.preparer.name || empresa, w - 55, y + 5, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    pdf.text(`CPF/CNPJ ${p.clientDoc || '—'}`, 55, y + 9.5, { align: 'center' });
    pdf.text(empresa, w - 55, y + 9.5, { align: 'center' });
  };

  renderVia('VIA DO CLIENTE');
  pdf.addPage();
  renderVia('VIA DA EMPRESA');
  drawBrandFooter(pdf);
  pdf.save(`Proposta_${p.proposalId || 'Credito'}_${(p.clientName || 'Cliente').replace(/\s+/g, '_')}.pdf`);
}
