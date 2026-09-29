import React, { useState } from 'react';
import { runExclusive } from '../../lib/submitGuard';
import { X, Calendar, Sparkles, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { UserProfile, UserRole } from '../../types';
import { ROLE_LABELS } from '../../lib/permissions';
import { logAudit } from '../../lib/audit';
import { createNotification } from '../../lib/notifications';
import { useAuth } from '../../contexts/AuthContext';
import { cn, todayLocalDateString } from '../../lib/utils';

interface NewDelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: UserProfile[];
  initialAbsentUser?: UserProfile | null;
  onSuccess?: () => void;
}

export default function NewDelegationModal({
  isOpen,
  onClose,
  team,
  initialAbsentUser,
  onSuccess
}: NewDelegationModalProps) {
  const { user: currentUser } = useAuth();
  const today = todayLocalDateString();

  const [absentUserId, setAbsentUserId] = useState(initialAbsentUser?.uid || '');
  const [delegateUserId, setDelegateUserId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState<'Férias' | 'Licença Médica' | 'Treinamento' | 'Outro'>('Férias');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync absent user when initialAbsentUser changes
  React.useEffect(() => {
    if (initialAbsentUser?.uid) {
      setAbsentUserId(initialAbsentUser.uid);
    }
  }, [initialAbsentUser]);

  if (!isOpen) return null;

  const absentUser = team.find(u => u.uid === absentUserId);
  const delegateUser = team.find(u => u.uid === delegateUserId);

  const getTransferredPermissionsInfo = (role?: UserRole) => {
    switch (role) {
      case 'admin':
        return {
          title: 'Permissões Plenas de Administrador',
          description: 'O substituto receberá acesso irrestrito a todas as áreas: Gerenciamento de Usuários, Auditoria Global, Configurações, Exclusão de Registros e Aprovações Financeiras.',
          color: 'text-rose-700 bg-rose-50 border-rose-200'
        };
      case 'manager':
        return {
          title: 'Permissões Gerenciais de Negócios e Operações',
          description: 'O substituto receberá acesso ao Fluxo Financeiro, Gestão de Contratos, Estoque, Relatórios Executivos, Veículos, Documentos e Aprovação de Laudos Técnicos.',
          color: 'text-slate-700 bg-slate-50 border-slate-200'
        };
      case 'hr':
        return {
          title: 'Permissões de Recursos Humanos',
          description: 'O substituto receberá acesso ao Ponto Eletrônico, Quadro de Colaboradores e Emissão de Matrículas/Credenciais.',
          color: 'text-slate-700 bg-slate-50 border-slate-200'
        };
      case 'consultant':
        return {
          title: 'Permissões Operacionais de Campo',
          description: 'O substituto terá acesso às Visitas de Campo, Cadastro de Produtores, Agendamentos e Laudos Técnicos.',
          color: 'text-emerald-700 bg-emerald-50 border-emerald-200'
        };
      default:
        return {
          title: 'Selecione o colaborador ausente',
          description: 'As permissões transferidas dependerão do cargo do colaborador ausente selecionado.',
          color: 'text-slate-600 bg-slate-50 border-slate-200'
        };
    }
  };

  const handleCreateDelegation = async () => {
    if (!absentUserId) {
      toast.error('Selecione o colaborador que estará ausente.');
      return;
    }
    if (!delegateUserId) {
      toast.error('Selecione o colaborador substituto (delegado).');
      return;
    }
    if (absentUserId === delegateUserId) {
      toast.error('O colaborador ausente e o substituto não podem ser a mesma pessoa.');
      return;
    }
    if (!startDate) {
      toast.error('Informe a data de início da delegação.');
      return;
    }
    if (endDate && endDate < startDate) {
      toast.error('A data de término não pode ser anterior à data de início.');
      return;
    }

    if (!absentUser || !delegateUser) {
      toast.error('Dados de usuário incompletos.');
      return;
    }

    setIsSubmitting(true);
    try {
      const delegationDoc = {
        absentUserId: absentUser.uid,
        absentUserName: absentUser.displayName,
        absentUserRole: absentUser.role as UserRole,
        delegateUserId: delegateUser.uid,
        delegateUserName: delegateUser.displayName,
        delegateOriginalRole: delegateUser.role as UserRole,
        startDate,
        endDate: endDate ? endDate : null,
        reason,
        notes: notes.trim(),
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.uid || 'admin'
      };

      const docRef = await addDoc(collection(db, 'delegations'), delegationDoc);

      // Audit Log
      await logAudit({
        recordId: docRef.id,
        collection: 'delegations',
        userId: currentUser?.uid || 'admin',
        userName: currentUser?.displayName || 'Administrador',
        action: 'delegation_created',
        recordName: `Delegação de ${absentUser.displayName} para ${delegateUser.displayName}`,
        details: `Delegação temporária criada: ${absentUser.displayName} (${ROLE_LABELS[absentUser.role as UserRole] || absentUser.role}) substituído por ${delegateUser.displayName} (${ROLE_LABELS[delegateUser.role as UserRole] || delegateUser.role}) de ${startDate} até ${endDate || 'indeterminado'}. Motivo: ${reason}.`
      });

      // Send Notification to the Delegate User
      await createNotification(
        delegateUser.uid,
        '🛡️ Nova Delegação de Permissões',
        `Você foi designado como substituto temporário de ${absentUser.displayName} (${ROLE_LABELS[absentUser.role as UserRole] || absentUser.role}). Suas permissões no sistema foram elevadas temporariamente.`,
        'info'
      );

      toast.success(`Delegação temporária atribuída a ${delegateUser.displayName} com sucesso!`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Erro ao criar delegação:', err);
      toast.error('Erro ao registrar delegação: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const permInfo = getTransferredPermissionsInfo(absentUser?.role as UserRole);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="glass-card w-full max-w-xl bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-left"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center shadow-xs">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-display font-bold text-slate-800">Nova Delegação de Permissões</h3>
              <p className="text-xs text-slate-500">Transfira temporariamente acessos gerenciais para um colaborador substituto</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body (No <form> tag) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* 1. Colaborador Ausente (Delegante) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              1. Colaborador Ausente (Delegante)
            </label>
            <select
              value={absentUserId}
              onChange={(e) => setAbsentUserId(e.target.value)}
              className="w-full glass-input bg-white text-xs font-bold text-slate-700"
            >
              <option value="">Selecione o colaborador ausente...</option>
              {team.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName} — {ROLE_LABELS[u.role as UserRole] || u.role} ({u.email})
                </option>
              ))}
            </select>
            {absentUser && (
              <div className="text-[11px] text-slate-500 font-medium ml-1">
                Cargo atual: <strong className="text-slate-700 uppercase">{ROLE_LABELS[absentUser.role as UserRole] || absentUser.role}</strong>
              </div>
            )}
          </div>

          {/* 2. Colaborador Substituto (Delegado) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              2. Substituto Designado (Delegado)
            </label>
            <select
              value={delegateUserId}
              onChange={(e) => setDelegateUserId(e.target.value)}
              className="w-full glass-input bg-white text-xs font-bold text-slate-700"
            >
              <option value="">Selecione quem irá substituir...</option>
              {team
                .filter((u) => u.uid !== absentUserId)
                .map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName} — Cargo Base: {ROLE_LABELS[u.role as UserRole] || u.role}
                  </option>
                ))}
            </select>
            {delegateUser && (
              <div className="text-[11px] text-slate-500 font-medium ml-1">
                Cargo base atual do substituto: <strong className="text-slate-700 uppercase">{ROLE_LABELS[delegateUser.role as UserRole] || delegateUser.role}</strong>
              </div>
            )}
          </div>

          {/* 3. Permissões Transferidas (Informativo) */}
          <div className={cn("p-4 rounded-2xl border transition-all", permInfo.color)}>
            <div className="flex items-center gap-2 font-bold text-xs">
              <Sparkles className="w-4 h-4" />
              <span>{permInfo.title}</span>
            </div>
            <p className="text-xs mt-1 leading-relaxed opacity-90">
              {permInfo.description}
            </p>
          </div>

          {/* 4. Período da Delegação */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Data de Início
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full glass-input bg-white pl-9 text-xs font-medium"
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Data de Término <span className="text-slate-400 font-normal lowercase">(opcional)</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full glass-input bg-white pl-9 text-xs font-medium"
                  placeholder="Prazo indeterminado"
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              </div>
              <div className="text-[10px] text-slate-400">Deixe em branco para prazo indeterminado</div>
            </div>
          </div>

          {/* 5. Motivo e Justificativa */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Motivo da Ausência
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full glass-input bg-white text-xs font-bold text-slate-700"
              >
                <option value="Férias">Férias Regulamentares</option>
                <option value="Licença Médica">Licença Médica / Tratamento de Saúde</option>
                <option value="Treinamento">Treinamento / Capacitação Externa</option>
                <option value="Outro">Outro Motivo Operacional</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Justificativa / Observações Internas
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes adicionais sobre a cobertura e responsabilidades atribuídas..."
                rows={3}
                className="w-full glass-input bg-white text-xs resize-none"
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-100 flex gap-3 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => runExclusive('NewDelegationModal.handleCreateDelegation', () => handleCreateDelegation())}
            disabled={isSubmitting || !absentUserId || !delegateUserId}
            className="flex-1 py-3 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all shadow-md shadow-amber-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? 'Salvando Delegação...' : 'Confirmar e Atribuir'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
