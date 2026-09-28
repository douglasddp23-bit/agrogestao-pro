import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Copy, Download, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthToken } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

async function api(path: string, body?: any) {
  const token = await getAuthToken();
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}

type Step = 'idle' | 'setup' | 'codes' | 'disable';

/**
 * Cartão "Verificação em duas etapas" (tela Meu Perfil — só Administrador).
 * Passo a passo: Ativar → escanear o QR Code com o aplicativo autenticador →
 * digitar senha atual + código → guardar os códigos de recuperação.
 */
export default function TwoFactorCard() {
  const { renewSession } = useAuth();
  const [status, setStatus] = useState<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const refresh = async () => {
    try {
      setStatus(await api('/api/2fa/status'));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const reset = () => {
    setStep('idle');
    setQr(null);
    setPassword('');
    setCode('');
    setError(null);
  };

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      setQr(await api('/api/2fa/setup', {}));
      setStep('setup');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) return setError('Digite sua senha atual.');
    if (code.replace(/\D/g, '').length !== 6) return setError('Digite os 6 números que aparecem no aplicativo.');
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/2fa/enable', { code: code.replace(/\D/g, ''), currentPassword: password });
      await renewSession(r.firebaseToken);
      setRecoveryCodes(r.recoveryCodes || []);
      setStep('codes');
      setPassword('');
      setCode('');
      toast.success('Verificação em duas etapas ativada!');
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!code.trim()) return setError('Digite o código do aplicativo (ou um código de recuperação).');
    setBusy(true);
    setError(null);
    try {
      await api('/api/2fa/disable', { code: code.trim() });
      toast.success('Verificação em duas etapas desativada.');
      reset();
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const codesText = () =>
    `AgroGestão Pro — códigos de recuperação da verificação em duas etapas\n` +
    `Gerados em ${new Date().toLocaleString('pt-BR')}\n` +
    `Cada código funciona UMA vez, caso você perca o celular.\n\n` +
    recoveryCodes.join('\n') + '\n';

  const downloadCodes = () => {
    const blob = new Blob([codesText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agrogestao-codigos-de-recuperacao.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const inputClass = 'w-full glass-input py-2.5 px-3 text-sm border border-slate-200 rounded-xl focus:border-emerald-500 outline-none bg-white';

  return (
    <div className="glass-card p-8 text-left" id="two-factor-card">
      <h3 className="font-display font-bold text-lg mb-2 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-emerald-600" /> Verificação em Duas Etapas
      </h3>
      <p className="text-xs text-slate-500 mb-5 font-medium leading-relaxed">
        Além da senha, o login pede um código de 6 números gerado pelo aplicativo autenticador do seu celular
        (Google Authenticator, Microsoft Authenticator ou Authy — todos gratuitos). Mesmo que alguém descubra
        sua senha, não consegue entrar sem o seu celular.
      </p>

      {loadError && <p className="text-xs text-rose-600 font-semibold">{loadError}</p>}
      {!status && !loadError && (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
      )}

      {status && step === 'idle' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            {status.enabled
              ? <span id="two-factor-status" className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">Ativada</span>
              : <span id="two-factor-status" className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">Desativada</span>}
            <span className="text-[11px] text-slate-500">
              {status.enabled
                ? `Desde ${status.enabledAt ? new Date(status.enabledAt).toLocaleDateString('pt-BR') : '—'} · ${status.recoveryCodesLeft} código(s) de recuperação restante(s)`
                : 'Recomendado para contas de Administrador.'}
            </span>
          </div>
          {status.enabled ? (
            <button
              onClick={() => { setStep('disable'); setCode(''); setError(null); }}
              className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center gap-2"
            >
              <ShieldOff className="w-4 h-4" /> Desativar
            </button>
          ) : (
            <button
              id="two-factor-enable-btn"
              onClick={startSetup}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Ativar
            </button>
          )}
        </div>
      )}

      {step === 'setup' && qr && (
        <form onSubmit={confirmEnable} className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-6 p-4 rounded-2xl border border-emerald-100 bg-emerald-50/30">
          <div className="flex flex-col items-center gap-2">
            <img id="two-factor-qr" src={qr.qrDataUrl} alt="QR Code para o aplicativo autenticador" className="w-44 h-44 rounded-xl bg-white p-2 border border-slate-200" />
            <span className="text-[10px] text-slate-400 text-center max-w-[11rem]">Não consegue ler? Digite esta chave no aplicativo:</span>
            <code id="two-factor-secret" className="text-[11px] font-mono font-bold text-slate-700 bg-white px-2 py-1 rounded border border-slate-200 select-all text-center break-all max-w-[11rem]">{qr.secret}</code>
          </div>
          <div className="space-y-3">
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal pl-4 leading-relaxed">
              <li>Instale no celular o <b>Google Authenticator</b> (ou Microsoft Authenticator / Authy).</li>
              <li>No aplicativo, toque em <b>+</b> e depois em <b>Ler código QR</b>. Aponte para o quadrado ao lado.</li>
              <li>Digite abaixo sua <b>senha atual</b> e o <b>código de 6 números</b> que apareceu no aplicativo.</li>
            </ol>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="two-factor-password" className="text-[10px] font-bold text-slate-400 uppercase">Senha atual</label>
                <input id="two-factor-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} disabled={busy} />
              </div>
              <div className="space-y-1">
                <label htmlFor="two-factor-code" className="text-[10px] font-bold text-slate-400 uppercase">Código do aplicativo</label>
                <input id="two-factor-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" className={`${inputClass} font-mono tracking-[0.3em] text-center`} disabled={busy} />
              </div>
            </div>
            {error && <p role="alert" className="text-xs text-rose-600 font-semibold">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={reset} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-600 hover:bg-slate-200">Cancelar</button>
              <button id="two-factor-confirm-btn" type="submit" disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar e ativar
              </button>
            </div>
          </div>
        </form>
      )}

      {step === 'codes' && (
        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/60 space-y-3">
          <p className="text-xs text-amber-900 font-semibold leading-relaxed">
            Guarde estes códigos de recuperação num lugar seguro (imprima ou salve fora deste computador).
            Se você perder o celular, cada código permite entrar <b>uma única vez</b>. Eles não serão mostrados de novo.
          </p>
          <div id="two-factor-recovery-codes" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {recoveryCodes.map(c => (
              <code key={c} className="text-xs font-mono font-bold text-slate-800 bg-white border border-amber-200 rounded-lg px-2 py-1.5 text-center">{c}</code>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => { navigator.clipboard?.writeText(codesText()); toast.success('Códigos copiados.'); }} className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" /> Copiar</button>
            <button onClick={downloadCodes} className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Baixar .txt</button>
            <button id="two-factor-done-btn" onClick={() => { setRecoveryCodes([]); reset(); }} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700">Já guardei</button>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <form onSubmit={confirmDisable} className="p-4 rounded-2xl border border-rose-100 bg-rose-50/40 space-y-3">
          <p className="text-xs text-slate-600 flex items-center gap-2"><Smartphone className="w-4 h-4 text-slate-400" /> Para desativar, digite o código atual do aplicativo (ou um código de recuperação).</p>
          <input id="two-factor-disable-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={11} placeholder="000000" className={`${inputClass} font-mono tracking-[0.2em] text-center max-w-xs`} disabled={busy} autoFocus />
          {error && <p role="alert" className="text-xs text-rose-600 font-semibold">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={reset} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-600 hover:bg-slate-200">Cancelar</button>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Desativar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
