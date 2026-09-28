import React, { useMemo, useState } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { getPasswordStrength } from '../auth/ResetPasswordRequired';

/**
 * Troca voluntária de senha (Meu Perfil → Alterar Minha Senha).
 * Antes o botão mandava um e-mail de redefinição do Firebase, que alterava só
 * a senha interna do Firebase — não a senha que o login do sistema confere —
 * e os e-mails automáticos dos colaboradores (@agrogestao.com.br) nem existem.
 */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { updateUserPassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = useMemo(() => getPasswordStrength(next), [next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!current) return setError('Digite sua senha atual.');
    if (strength.score < 3) return setError('A nova senha precisa ter pelo menos 8 caracteres e combinar maiúsculas, minúsculas, números ou símbolos.');
    if (next !== confirm) return setError('A confirmação não é igual à nova senha.');
    setBusy(true);
    setError(null);
    try {
      await updateUserPassword(next, current);
      toast.success('Senha alterada com sucesso!');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'w-full py-2.5 px-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-emerald-500 focus:bg-white outline-none';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-sm">
      <form onSubmit={submit} id="change-password-form" className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl border border-slate-100 text-left">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-slate-800 flex items-center gap-2"><KeyRound className="w-5 h-5 text-emerald-600" /> Alterar Minha Senha</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-1">
          <label htmlFor="cp-current" className="text-[10px] font-bold text-slate-400 uppercase">Senha atual</label>
          <input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={inputClass} disabled={busy} autoFocus />
        </div>
        <div className="space-y-1">
          <label htmlFor="cp-new" className="text-[10px] font-bold text-slate-400 uppercase flex justify-between">
            Nova senha {next && <span className="normal-case">Força: {strength.label}</span>}
          </label>
          <input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1">
          <label htmlFor="cp-confirm" className="text-[10px] font-bold text-slate-400 uppercase">Confirmar nova senha</label>
          <input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} disabled={busy} />
        </div>
        {error && <p role="alert" className="text-xs text-rose-600 font-semibold">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {busy ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>
    </div>
  );
}
