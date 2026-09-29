import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Calendar, 
  ShieldCheck, 
  XCircle} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { UserProfile, TemporaryDelegation } from '../../types';
import { ROLE_LABELS } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import NewDelegationModal from './NewDelegationModal';
import RevokeDelegationModal from './RevokeDelegationModal';
import { cn, todayLocalDateString } from '../../lib/utils';

interface DelegationsTabProps {
  user: UserProfile;
  team: UserProfile[];
}

export default function DelegationsTab({ user, team }: DelegationsTabProps) {
  const { user: currentUser } = useAuth();
  const isAdmin = (currentUser?.effectiveRole ?? currentUser?.role) === 'admin';
  const today = todayLocalDateString();

  const [delegations, setDelegations] = useState<TemporaryDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [delegationToRevoke, setDelegationToRevoke] = useState<TemporaryDelegation | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'delegations'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as TemporaryDelegation)
        );
        // Filter delegations where this user is absent (delegante) or delegate (substituto)
        const userDelegations = list.filter(
          (d) => d.absentUserId === user.uid || d.delegateUserId === user.uid
        );
        setDelegations(userDelegations);
        setLoading(false);
      },
      (err) => {
        console.warn('Erro ao carregar delegações:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

  const getDelegationStatus = (d: TemporaryDelegation) => {
    if (!d.active) {
      if (d.revokedAt) {
        return {
          type: 'revoked' as const,
          label: 'Revogada',
          badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
          subtext: `Revogada em ${new Date(d.revokedAt).toLocaleDateString('pt-BR')}`
        };
      }
      return {
        type: 'expired' as const,
        label: 'Expirada',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
        subtext: 'Prazo expirado'
      };
    }

    if (d.startDate > today) {
      return {
        type: 'future' as const,
        label: 'Futura',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
        subtext: `Inicia em ${new Date(d.startDate + 'T12:00:00').toLocaleDateString('pt-BR')}`
      };
    }

    if (d.endDate && d.endDate < today) {
      return {
        type: 'expired' as const,
        label: 'Expirada',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
        subtext: 'Período encerrado'
      };
    }

    // Active delegation
    let daysRemainingText = 'Prazo indeterminado';
    if (d.endDate) {
      const end = new Date(d.endDate + 'T23:59:59').getTime();
      const now = new Date().getTime();
      const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      daysRemainingText = diffDays <= 0 ? 'Vence hoje' : `${diffDays} dia(s) restante(s)`;
    }

    return {
      type: 'active' as const,
      label: 'Ativa',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 animate-pulse font-bold',
      subtext: daysRemainingText
    };
  };

  return (
    <div className="space-y-6 text-left">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold shadow-xs">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-800">Histórico e Gestão de Delegações</h4>
            <p className="text-xs text-slate-500">Delegações onde {user.displayName} é delegante ausente ou substituto</p>
          </div>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova Delegação
          </button>
        )}
      </div>

      {/* Delegations List */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-400 font-bold uppercase tracking-widest animate-pulse">
          Carregando registros de delegação...
        </div>
      ) : delegations.length === 0 ? (
        <div className="p-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          <ShieldCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <h5 className="text-sm font-bold text-slate-700">Nenhuma delegação registrada</h5>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Este colaborador não possui delegações temporárias ativas, agendadas ou anteriores vinculadas à sua matrícula.
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="mt-4 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Criar Delegação Agora
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {delegations.map((d) => {
            const status = getDelegationStatus(d);
            const isUserAbsent = d.absentUserId === user.uid;
            const isUserDelegate = d.delegateUserId === user.uid;
            const canRevoke = isAdmin && d.active && (status.type === 'active' || status.type === 'future');

            return (
              <div
                key={d.id}
                className={cn(
                  "p-5 rounded-2xl border transition-all relative bg-white shadow-xs",
                  status.type === 'active' 
                    ? "border-emerald-200 bg-emerald-50/20 ring-1 ring-emerald-500/20" 
                    : status.type === 'future'
                    ? "border-slate-200 bg-slate-50/20"
                    : "border-slate-200 opacity-80"
                )}
              >
                {/* Top status bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border", status.badgeClass)}>
                      {status.label}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      • {status.subtext}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {new Date(d.startDate + 'T12:00:00').toLocaleDateString('pt-BR')} 
                      {d.endDate ? ` até ${new Date(d.endDate + 'T12:00:00').toLocaleDateString('pt-BR')}` : ' (Indeterminado)'}
                    </span>
                  </div>
                </div>

                {/* Main Card Content */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                  {/* Absent User (Delegante) */}
                  <div className={cn("p-3 rounded-xl border", isUserAbsent ? "bg-amber-50/60 border-amber-200" : "bg-slate-50 border-slate-100")}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Colaborador Ausente (Delegante) {isUserAbsent && '— (Este Usuário)'}
                    </div>
                    <div className="text-sm font-bold text-slate-800 mt-1">
                      {d.absentUserName}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Cargo: <strong className="uppercase">{ROLE_LABELS[d.absentUserRole] || d.absentUserRole}</strong>
                    </div>
                  </div>

                  {/* Delegate User (Substituto) */}
                  <div className={cn("p-3 rounded-xl border", isUserDelegate ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-50 border-slate-100")}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Substituto Designado (Delegado) {isUserDelegate && '— (Este Usuário)'}
                    </div>
                    <div className="text-sm font-bold text-slate-800 mt-1">
                      {d.delegateUserName}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Cargo Original: <strong className="uppercase">{ROLE_LABELS[d.delegateOriginalRole] || d.delegateOriginalRole}</strong>
                      <span className="text-emerald-700 font-bold ml-2">→ Atuando como: {ROLE_LABELS[d.absentUserRole] || d.absentUserRole}</span>
                    </div>
                  </div>
                </div>

                {/* Reason & Notes */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                  <div className="text-xs text-slate-600">
                    <span className="font-bold text-slate-700">Motivo:</span> {d.reason}
                    {d.notes && <span className="text-slate-500 italic ml-2">— "{d.notes}"</span>}
                  </div>

                  {canRevoke && (
                    <button
                      type="button"
                      onClick={() => setDelegationToRevoke(d)}
                      className="px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Revogar Delegação
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Delegation Modal */}
      <NewDelegationModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        team={team}
        initialAbsentUser={user}
      />

      {/* Revoke Delegation Modal */}
      <RevokeDelegationModal
        isOpen={!!delegationToRevoke}
        onClose={() => setDelegationToRevoke(null)}
        delegation={delegationToRevoke}
      />
    </div>
  );
}
