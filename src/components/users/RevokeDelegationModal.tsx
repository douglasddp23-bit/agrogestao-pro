import React, { useState } from 'react';
import { X, AlertTriangle, ShieldX, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { TemporaryDelegation } from '../../types';
import { ROLE_LABELS } from '../../lib/permissions';
import { logAudit } from '../../lib/audit';
import { createNotification } from '../../lib/notifications';
import { useAuth } from '../../contexts/AuthContext';

interface RevokeDelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  delegation: TemporaryDelegation | null;
  onSuccess?: () => void;
}

export default function RevokeDelegationModal({
  isOpen,
  onClose,
  delegation,
  onSuccess
}: RevokeDelegationModalProps) {
  const { user: currentUser } = useAuth();
  const [isRevoking, setIsRevoking] = useState(false);

  if (!isOpen || !delegation) return null;

  const handleRevoke = async () => {
    setIsRevoking(true);
    try {
      const delegationRef = doc(db, 'delegations', delegation.id);
      const revokedAt = new Date().toISOString();

      await updateDoc(delegationRef, {
        active: false,
        revokedAt,
        revokedBy: currentUser?.uid || 'admin'
      });

      // Audit Log
      await logAudit({
        recordId: delegation.id,
        collection: 'delegations',
        userId: currentUser?.uid || 'admin',
        userName: currentUser?.displayName || 'Administrador',
        action: 'delegation_revoked',
        recordName: `Revogação de Delegação: ${delegation.absentUserName} -> ${delegation.delegateUserName}`,
        details: `Delegação revogada manualmente pelo Administrador. Substituto: ${delegation.delegateUserName}, Delegante: ${delegation.absentUserName}.`
      });

      // Notify the delegate user
      await createNotification(
        delegation.delegateUserId,
        '🛡️ Delegação de Permissões Encerrada',
        `Sua substituição temporária de ${delegation.absentUserName} foi encerrada pelo Administrador. Suas permissões retornaram ao nível original (${ROLE_LABELS[delegation.delegateOriginalRole] || delegation.delegateOriginalRole}).`,
        'alert'
      );

      toast.success('Delegação revogada com sucesso!');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Erro ao revogar delegação:', err);
      toast.error('Erro ao revogar delegação: ' + err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 text-left"
      >
        <div className="flex items-center gap-3 text-rose-600 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center">
            <ShieldX className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">Revogar Delegação</h3>
            <p className="text-xs text-slate-500">Desativar permissões temporárias</p>
          </div>
        </div>

        <div className="space-y-3 my-4 bg-rose-50/50 p-4 rounded-2xl border border-rose-100 text-xs">
          <p className="text-slate-700 leading-relaxed">
            Tem certeza de que deseja encerrar a delegação temporária de{' '}
            <strong className="text-slate-900">{delegation.absentUserName}</strong> para{' '}
            <strong className="text-slate-900">{delegation.delegateUserName}</strong>?
          </p>

          <div className="pt-2 border-t border-rose-200/60 space-y-1 text-[11px] text-slate-600">
            <div>• Substituto retornará ao cargo base: <strong className="uppercase">{ROLE_LABELS[delegation.delegateOriginalRole] || delegation.delegateOriginalRole}</strong></div>
            <div>• O colaborador receberá uma notificação instantânea em seu painel.</div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isRevoking}
            className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={isRevoking}
            className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 disabled:bg-slate-300 transition-all shadow-md shadow-rose-200 cursor-pointer"
          >
            {isRevoking ? 'Revogando...' : 'Confirmar Revogação'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
