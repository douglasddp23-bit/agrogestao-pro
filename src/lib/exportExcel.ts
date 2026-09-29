import * as XLSX from 'xlsx';

export function exportToExcel(data: Record<string, any>[], filename: string, sheetName = 'Dados') {
  const ws = XLSX.utils.json_to_sheet(data);
  // Largura das colunas pelo maior conteúdo (limite 60), para a planilha abrir legível
  const headers = Object.keys(data[0] || {});
  ws['!cols'] = headers.map(h => ({
    wch: Math.min(60, Math.max(h.length, ...data.map(r => String(r[h] ?? '').length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
