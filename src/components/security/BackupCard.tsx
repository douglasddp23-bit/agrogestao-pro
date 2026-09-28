import React, { useEffect, useState } from 'react';
import { DatabaseBackup, Loader2, CheckCircle2, AlertTriangle, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthToken } from '../../lib/utils';

interface BackupInfo {
  available: boolean;
  running: boolean;
  folder: string;
  keep: number;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastDocs: number;
  lastBytes: number;
  lastError: string | null;
  lastErrorAt: string | null;
  totalFiles: number;
}

async function call(path: string, method: 'GET' | 'POST') {
  const token = await getAuthToken();
  const res = await fetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
  let data: any = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error(data.error || 'Falha ao consultar o backup.');
  return data;
}

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Cartão "Backup do banco de dados" (tela Meu Perfil — só Administrador). */
export default function BackupCard() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setInfo(await call('/api/admin/backup/status', 'GET'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await call('/api/admin/backup/run', 'POST');
      toast.success(`Backup concluído: ${r.lastDocs} registros salvos.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="glass-card p-8 text-left" id="backup-card">
      <h3 className="font-display font-bold text-lg mb-2 flex items-center gap-2">
        <DatabaseBackup className="w-5 h-5 text-emerald-600" /> Backup do Banco de Dados
      </h3>
      <p className="text-xs text-slate-500 mb-5 font-medium leading-relaxed">
        Uma cópia completa dos dados é salva automaticamente uma vez por dia neste computador (enquanto o
        AgroGestão estiver aberto). São guardadas as {info?.keep ?? 30} cópias mais recentes.
      </p>

      {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
      {!info && !error && (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
      )}

      {info && (
        <div className="space-y-3">
          {!info.available && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Backup indisponível neste computador: falta a chave de administrador do Firebase (service-account.json).
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-50/60 border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Último backup</div>
              <div id="backup-last" className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mt-0.5">
                {info.lastSuccessAt ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {new Date(info.lastSuccessAt).toLocaleString('pt-BR')}</>
                ) : 'Nenhum ainda'}
              </div>
              {info.lastSuccessAt && (
                <div className="text-[11px] text-slate-500 mt-0.5">{info.lastDocs} registros · {fmtSize(info.lastBytes)} · {info.totalFiles} cópia(s) guardada(s)</div>
              )}
            </div>
            <div className="p-3 rounded-xl bg-slate-50/60 border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><FolderOpen className="w-3 h-3" /> Pasta</div>
              <div className="text-[11px] font-mono text-slate-600 break-all mt-0.5 select-all">{info.folder}</div>
            </div>
          </div>
          {info.lastError && (!info.lastSuccessAt || (info.lastErrorAt && info.lastErrorAt > info.lastSuccessAt)) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Última tentativa falhou ({info.lastErrorAt ? new Date(info.lastErrorAt).toLocaleString('pt-BR') : ''}): {info.lastError}
            </div>
          )}
          <div className="flex justify-end">
            <button
              id="backup-run-btn"
              onClick={runNow}
              disabled={busy || info.running || !info.available}
              className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
            >
              {(busy || info.running) && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy || info.running ? 'Fazendo backup...' : 'Fazer backup agora'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
