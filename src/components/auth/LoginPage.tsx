import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';

export default function LoginPage() {
  const {
    signInWithCredentials,
    authError,
    clearAuthError
  } = useAuth();

  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !password) {
      setError('Por favor, preencha todos os campos.');
      return;
    }
    setLoading(true);
    setError(null);
    clearAuthError();
    try {
      await signInWithCredentials(id, password);
    } catch (err: any) {
      setError(err.message || 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  };

  const finalError = error || authError;

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
          <p className="text-slate-500 text-sm mt-1">Acesso ao Sistema</p>
        </div>

        {/* Form: E-mail/Matrícula & Senha */}
        <form onSubmit={handleManualLogin} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-id" className="text-[10px] font-bold text-slate-400 uppercase ml-1">E-mail ou Matrícula</label>
            <input 
              id="login-id"
              type="text" 
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Ex: d.silva@agro.com ou MAT1234"
              className="w-full glass-input py-3 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="login-pass" className="text-[10px] font-bold text-slate-400 uppercase ml-1">Senha</label>
            <input 
              id="login-pass"
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full glass-input py-3 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              required
            />
          </div>
          {finalError && <p className="text-[10px] text-rose-500 font-bold text-center uppercase tracking-wider">{finalError}</p>}
          <button 
            type="submit"
            id="login-submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50 cursor-pointer text-sm"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
