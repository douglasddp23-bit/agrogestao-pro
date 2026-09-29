import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { exportToExcel } from '../../lib/exportExcel';
import { todayLocalDateString } from '../../lib/utils';

// Botão padrão "Exportar Excel" das páginas de serviço/cadastro.
// getRows devolve as linhas já com cabeçalhos em português.
export default function ExportExcelButton({ getRows, fileName, sheetName = 'Dados' }: {
  getRows: () => Record<string, any>[];
  fileName: string;
  sheetName?: string;
}) {
  const handle = () => {
    try {
      const rows = getRows();
      if (!rows.length) { toast.error('Não há registros para exportar.'); return; }
      exportToExcel(rows, `${fileName}_${todayLocalDateString()}`, sheetName);
      toast.success(`Planilha exportada (${rows.length} registro${rows.length > 1 ? 's' : ''}).`);
    } catch (err) {
      console.error('Erro ao exportar planilha:', err);
      toast.error('Não foi possível exportar a planilha.');
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      title="Exportar a lista para Excel"
      className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-2xl text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-all"
    >
      <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
    </button>
  );
}
