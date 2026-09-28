import React, { useState, useMemo } from 'react';
import { runExclusive } from '../../lib/submitGuard';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { KeyRound, ShieldAlert, Eye, EyeOff, Check, X } from 'lucide-react';
import { toast } from 'sonner';

interface PasswordCheck {
  label: string;
  passed: boolean;
}

interface PasswordStrength {
  score: number; // 0 to 4
  label: string;
  color: string;
  checks: PasswordCheck[];
}

export function getPasswordStrength(pass: string): PasswordStrength {
  const checks: PasswordCheck[] = [
    { label: 'Mínimo 8 caracteres', passed: pass.length >= 8 },
    { label: 'Letra maiúscula (A-Z)', passed: /[A-Z]/.test(pass) },
    { label: 'Letra minúscula (a-z)', passed: /[a-z]/.test(pass) },
    { label: 'Número (0-9)', passed: /\d/.test(pass) },
    { label: 'Caractere especial (!@#$%...)', passed: /[^A-Za-z0-9]/.test(pass) }
  ];

  const passedCount = checks.filter(c => c.passed).length;

  if (!pass) {
    return { score: 0, label: 'Não informada', color: 'bg-slate-200', checks };
  }

  if (passedCount <= 2) {
    return { score: 1, label: 'Muito fraca', color: 'bg-rose-500', checks };
  }
  if (passedCount === 3) {
    return { score: 2, label: 'Fraca', color: 'bg-amber-500', checks };
  }
  if (passedCount === 4) {
    return { score: 3, label: 'Média', color: 'bg-amber-500', checks };
  }
  return { score: 4, label: 'Forte', color: 'bg-emerald-500', checks };
}

export default function ResetPasswordRequired() {
  const { updateUserPassword, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isSubmitDisabled = loading || strength.score < 3 || !passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (strength.score < 3) {
      setError('A nova senha deve atender aos critérios de segurança (mínimo força média).');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await updateUserPassword(newPassword);
      toast.success('Senha atualizada com sucesso! Seu acesso foi liberado.');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao redefinir sua senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center p-6 bg-slate-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full p-8 bg-white rounded-3xl border border-slate-100 shadow-2xl flex flex-col gap-6"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 border border-amber-100/50 shadow-sm">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-display font-bold text-slate-800">Alteração de Senha Obrigatória</h1>
          <p className="text-slate-500 text-xs max-w-sm mt-1 leading-relaxed">
            Como este é seu primeiro acesso ou suas credenciais foram redefinidas administrativamente, você precisa configurar uma nova senha forte para proteger sua conta.
          </p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); runExclusive('ResetPasswordRequired.handleSubmit', () => handleSubmit(e)); }} className="space-y-4">
          <div className="space-y-1.5 relative">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nova Senha Forte</label>
              {newPassword && (
                <span className={`text-[10px] font-bold ${
                  strength.score === 1 ? 'text-rose-600' :
                  strength.score === 2 ? 'text-amber-600' :
                  strength.score === 3 ? 'text-amber-600' :
                  'text-emerald-600'
                }`}>
                  Força: {strength.label}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite a nova senha segura"
                className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-sans"
                required
                disabled={loading}
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Password Strength Progress Bar (4 segments) */}
            <div className="pt-2">
              <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
                {[1, 2, 3, 4].map(seg => (
                  <div
                    key={seg}
                    className={`h-full rounded-full transition-all duration-300 ${
                      strength.score >= seg ? strength.color : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Criteria Checklist */}
            <div className="pt-2 space-y-1 bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Critérios de Segurança:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {strength.checks.map((chk, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-[11px]">
                    {chk.passed ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                        <X className="w-2.5 h-2.5" />
                      </div>
                    )}
                    <span className={chk.passed ? 'text-emerald-800 font-medium' : 'text-slate-500'}>
                      {chk.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Confirmar Nova Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirme a senha idêntica acima"
                className="w-full pl-10 pr-3 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-sans"
                required
                disabled={loading}
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
            {confirmPassword && !passwordsMatch && (
              <p className="text-[11px] text-rose-500 font-medium pl-1">As senhas não coincidem.</p>
            )}
            {confirmPassword && passwordsMatch && (
              <p className="text-[11px] text-emerald-600 font-medium pl-1 flex items-center gap-1">
                <Check className="w-3 h-3" /> As senhas conferem!
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-100 text-[11px] text-rose-600 leading-relaxed font-sans">
              ⚠️ {error}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
            >
              {loading ? 'Salvando Nova Senha...' : 'Salvar Nova Senha'}
            </button>

            <button
              type="button"
              onClick={logout}
              className="w-full py-2.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors text-xs font-semibold"
            >
              Cancelar e Sair
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
