// Marca da empresa (logo, nome e frase) em TODOS os PDFs de serviço.
//
// O menu lateral já acompanha em tempo real o documento settings/branding
// (tela "Configurar Marca"). Ele repassa os dados para cá com
// updatePdfBranding(); os geradores de PDF usam getPdfBranding() na hora,
// sem precisar esperar o banco. A logo é convertida para PNG/JPEG em base64,
// que é o que a biblioteca de PDF (jsPDF) aceita.
import type { jsPDF } from 'jspdf';

export interface PdfBranding {
  companyName: string;
  companyPhrase: string;
  logoDataUrl: string; // '' = sem logo (usa a inicial)
  logoFormat: 'PNG' | 'JPEG';
  logoRatio: number;   // largura / altura
}

let current: PdfBranding = { companyName: 'AgroGestão', companyPhrase: '', logoDataUrl: '', logoFormat: 'PNG', logoRatio: 1 };
let lastRawLogo = '';

export function getPdfBranding(): PdfBranding {
  return current;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Converte qualquer imagem (URL, SVG, WEBP...) em PNG base64 para o PDF. */
async function toPdfImage(raw: string): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG'; ratio: number } | null> {
  if (!raw) return null;
  try {
    const img = await loadImage(raw);
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    if (/^data:image\/(png|jpe?g);/i.test(raw)) {
      return { dataUrl: raw, format: /jpe?g/i.test(raw.slice(0, 20)) ? 'JPEG' : 'PNG', ratio };
    }
    const max = 400;
    const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || max) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || max) * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG', ratio };
  } catch {
    return null; // logo de outro site que não permite cópia, arquivo inválido etc.
  }
}

/** Chamado pelo menu lateral sempre que a marca muda no banco. */
export async function updatePdfBranding(raw: { companyName?: string; companyPhrase?: string; companyLogo?: string }) {
  const base = {
    companyName: (raw.companyName || 'AgroGestão').trim(),
    companyPhrase: (raw.companyPhrase || '').trim(),
  };
  if ((raw.companyLogo || '') === lastRawLogo) {
    current = { ...current, ...base };
    return;
  }
  lastRawLogo = raw.companyLogo || '';
  const img = await toPdfImage(lastRawLogo);
  current = img
    ? { ...base, logoDataUrl: img.dataUrl, logoFormat: img.format, logoRatio: img.ratio }
    : { ...base, logoDataUrl: '', logoFormat: 'PNG', logoRatio: 1 };
}

const EMERALD: [number, number, number] = [16, 185, 129];

/** Logo (ou a inicial da empresa) dentro de um quadrado branco. */
export function drawBrandLogo(doc: jsPDF, x: number, y: number, size: number) {
  const b = current;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, size, size, 1.5, 1.5, 'F');
  if (b.logoDataUrl) {
    const pad = size * 0.08;
    const box = size - pad * 2;
    const w = b.logoRatio >= 1 ? box : box * b.logoRatio;
    const h = b.logoRatio >= 1 ? box / b.logoRatio : box;
    try {
      doc.addImage(b.logoDataUrl, b.logoFormat, x + (size - w) / 2, y + (size - h) / 2, w, h);
      return;
    } catch { /* cai para a inicial */ }
  }
  doc.setTextColor(...EMERALD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size * 1.6);
  doc.text((b.companyName[0] || 'A').toUpperCase(), x + size / 2, y + size * 0.7, { align: 'center' });
}

/**
 * Faixa verde do topo com logo + nome da empresa + frase.
 * height 40 = cabeçalho alto (memoriais); 22 = cabeçalho compacto (laudos).
 * `subtitle` substitui a frase da empresa quando informado. Devolve o Y livre abaixo.
 */
export function drawBrandBanner(doc: jsPDF, opts: { height?: number; subtitle?: string } = {}): number {
  const b = current;
  const pageWidth = doc.internal.pageSize.getWidth();
  const h = opts.height ?? 32;
  doc.setFillColor(...EMERALD);
  doc.rect(0, 0, pageWidth, h, 'F');
  const logoSize = Math.min(h - 8, 24);
  drawBrandLogo(doc, 14, (h - logoSize) / 2, logoSize);
  const textX = 14 + logoSize + 6;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(h >= 30 ? 16 : 12);
  const name = doc.splitTextToSize(b.companyName.toUpperCase(), pageWidth - textX - 14)[0];
  doc.text(name, textX, h / 2 - (h >= 30 ? 1 : 0));
  const sub = opts.subtitle || b.companyPhrase;
  if (sub) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(h >= 30 ? 9.5 : 8);
    doc.text(doc.splitTextToSize(sub, pageWidth - textX - 14)[0], textX, h / 2 + (h >= 30 ? 6 : 5));
  }
  doc.setTextColor(30, 41, 59);
  return h;
}

/** Rodapé em todas as páginas: empresa • data • página x de y. */
export function drawBrandFooter(doc: jsPDF) {
  const b = current;
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const hgt = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, hgt - 14, w - 14, hgt - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 130, 145);
    doc.text(`${b.companyName}${b.companyPhrase ? ' — ' + b.companyPhrase : ''}`, 14, hgt - 9);
    doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')} • Página ${i} de ${pages}`, w - 14, hgt - 9, { align: 'right' });
  }
}

export interface ServiceReportSection {
  title: string;
  rows?: [string, string][];
  text?: string;
}

/**
 * Relatório final padrão de serviço (usado por Topografia e Crédito Rural,
 * que não tinham PDF): marca da empresa, cliente, dados do serviço,
 * resultados/conclusões e assinatura do responsável técnico.
 */
export async function buildServiceReportPDF(opts: {
  documentTitle: string;
  serviceName: string;
  client: { name: string; cpf?: string; property?: string; city?: string };
  sections: ServiceReportSection[];
  responsible?: string;
  certification?: string;
}): Promise<jsPDF> {
  // Import sob demanda: o menu lateral usa este arquivo e não deve carregar a biblioteca de PDF.
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  let y = drawBrandBanner(doc, { height: 32 }) + 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.text(opts.documentTitle.toUpperCase(), w / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(opts.serviceName, w / 2, y, { align: 'center' });
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Cliente', '']],
    body: [
      ['Nome', opts.client.name || '—'],
      ...(opts.client.cpf ? [['CPF/CNPJ', opts.client.cpf] as [string, string]] : []),
      ...(opts.client.property ? [['Propriedade', opts.client.property] as [string, string]] : []),
      ...(opts.client.city ? [['Município', opts.client.city] as [string, string]] : []),
    ],
    theme: 'grid',
    headStyles: { fillColor: EMERALD, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold', textColor: [71, 85, 105] } },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  for (const s of opts.sections) {
    if (y > 250) { doc.addPage(); y = 20; }
    if (s.rows && s.rows.length) {
      autoTable(doc, {
        startY: y,
        head: [[s.title, '']],
        body: s.rows.map(([k, v]) => [k, v || '—']),
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold', textColor: [71, 85, 105] } },
        styles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    if (s.text) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      if (!s.rows) { doc.text(s.title.toUpperCase(), 14, y); y += 6; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(s.text, w - 28);
      for (const line of lines) {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, 14, y);
        y += 5;
      }
      y += 4;
    }
  }

  // Assinatura do responsável técnico
  if (y > 240) { doc.addPage(); y = 40; } else { y += 16; }
  doc.setDrawColor(100, 116, 139);
  doc.line(w / 2 - 45, y, w / 2 + 45, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(opts.responsible || 'Responsável Técnico', w / 2, y + 5, { align: 'center' });
  if (opts.certification) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(opts.certification, w / 2, y + 10, { align: 'center' });
  }

  drawBrandFooter(doc);
  return doc;
}
