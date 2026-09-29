import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { Loader2, ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';

function Spinner() {
  return <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />;
}

export default function LoginPage() {
  const {
    signInWithCredentials,
    verifySecondFactor,
    authError,
    clearAuthError
  } = useAuth();

  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2ª etapa (conta com verificação em duas etapas ligada)
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mfaTicket) codeInputRef.current?.focus();
  }, [mfaTicket, useRecovery]);

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!id.trim() || !password) {
      setError('Por favor, preencha o e-mail e a senha.');
      return;
    }
    setLoading(true);
    setError(null);
    clearAuthError();
    try {
      const result = await signInWithCredentials(id.trim(), password);
      if (result.mfaRequired) {
        setMfaTicket(result.ticket);
        setCode('');
        setUseRecovery(false);
        setLoading(false);
      }
      // Sucesso sem 2FA: o spinner continua até o sistema abrir.
    } catch (err: any) {
      setError(err?.message || 'E-mail ou senha incorretos.');
      setPassword('');
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !mfaTicket) return;
    const clean = useRecovery ? code.trim() : code.replace(/\D/g, '');
    if ((!useRecovery && clean.length !== 6) || (useRecovery && clean.replace(/[^A-Za-z0-9]/g, '').length !== 10)) {
      setError(useRecovery ? 'O código de recuperação tem 10 letras/números (ex.: ABCDE-FGH23).' : 'Digite os 6 números do aplicativo autenticador.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await verifySecondFactor(mfaTicket, clean);
    } catch (err: any) {
      setError(err?.message || 'Código incorreto.');
      setCode('');
      if (err?.restart) {
        setMfaTicket(null);
        setPassword('');
      }
      setLoading(false);
    }
  };

  const backToPassword = () => {
    setMfaTicket(null);
    setPassword('');
    setCode('');
    setError(null);
  };

  const finalError = error || authError;

  const errorBox = finalError && (
    <div role="alert" id="login-error" className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
      <span>{finalError}</span>
    </div>
  );

  const inputClass = "w-full glass-input py-3 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div className="h-screen w-full flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
      {/* Background gradients for visual depth */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-60 -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-slate-50 rounded-full blur-3xl opacity-60 translate-x-1/2 translate-y-1/2" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card max-w-md w-full p-8 flex flex-col items-center gap-6 shadow-2xl bg-white/80 backdrop-blur-md border border-slate-100 relative z-10"
      >
        <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white font-bold text-3xl shadow-lg shadow-emerald-200">A</div>
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-slate-800">AgroGestão Pro</h1>
          <p className="text-slate-500 text-sm mt-1">{mfaTicket ? 'Verificação em duas etapas' : 'Acesso ao Sistema'}</p>
        </div>

        {!mfaTicket ? (
          /* Etapa 1: E-mail/Matrícula & Senha */
          <form onSubmit={handleManualLogin} className="w-full space-y-4" aria-busy={loading}>
            <div className="space-y-1.5">
              <label htmlFor="login-id" className="text-[10px] font-bold text-slate-400 uppercase ml-1">E-mail ou Matrícula</label>
              <input
                id="login-id"
                type="text"
                autoComplete="username"
                value={id}
                onChange={(e) => { setId(e.target.value); if (error) setError(null); }}
                placeholder="Ex: d.silva@agro.com ou MAT1234"
                className={inputClass}
                disabled={loading}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-pass" className="text-[10px] font-bold text-slate-400 uppercase ml-1">Senha</label>
              <input
                id="login-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                placeholder="••••••••"
                className={inputClass}
                disabled={loading}
                required
              />
            </div>
            {errorBox}
            <button
              type="submit"
              id="login-submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-70 disabled:cursor-wait cursor-pointer text-sm flex items-center justify-center gap-2"
            >
              {loading ? <><Spinner /> Validando acesso...</> : 'Entrar'}
            </button>
          </form>
        ) : (
          /* Etapa 2: código do aplicativo autenticador */
          <form onSubmit={handleVerifyCode} className="w-full space-y-4" aria-busy={loading}>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs leading-relaxed">
              <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-600" />
              <span>
                {useRecovery
                  ? 'Digite um dos códigos de recuperação que você guardou ao ativar a verificação. Cada código só funciona uma vez.'
                  : 'Senha confirmada. Abra o aplicativo autenticador no celular e digite o código de 6 números do AgroGestão Pro.'}
              </span>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-2fa-code" className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                {useRecovery ? 'Código de recuperação' : 'Código de verificação'}
              </label>
              <input
                id="login-2fa-code"
                ref={codeInputRef}
                type="text"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={useRecovery ? 11 : 6}
                value={code}
                onChange={(e) => {
                  setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''));
                  if (error) setError(null);
                }}
                placeholder={useRecovery ? 'ABCDE-FGH23' : '000000'}
                className={`${inputClass} text-center tracking-[0.4em] font-mono text-lg`}
                disabled={loading}
                required
              />
            </div>
            {errorBox}
            <button
              type="submit"
              id="login-2fa-submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-70 disabled:cursor-wait cursor-pointer text-sm flex items-center justify-center gap-2"
            >
              {loading ? <><Spinner /> Verificando código...</> : 'Confirmar'}
            </button>
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <button type="button" onClick={backToPassword} disabled={loading} className="flex items-center gap-1 text-slate-500 hover:text-slate-700">
                <ArrowLeft className="w-3 h-3" /> Voltar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(null); }}
                className="text-emerald-700 hover:underline"
              >
                {useRecovery ? 'Usar o aplicativo autenticador' : 'Perdi o celular — usar código de recuperação'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
