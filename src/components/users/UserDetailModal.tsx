import React, { useState, useEffect } from 'react';
import { runExclusive } from '../../lib/submitGuard';
import { 
  X, 
  Shield, 
  Users, 
  Lock, 
  KeyRound, 
  Ban, 
  Unlock, 
  Mail, 
  Hash, 
  Calendar, 
  Award, 
  Sparkles,
  Check
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { doc, updateDoc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { UserProfile, UserRole, TemporaryDelegation } from '../../types';
import { ROLE_LABELS, getEffectiveRole, getActiveDelegation } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import { createNotification } from '../../lib/notifications';
import { cn } from '../../lib/utils';
import DelegationsTab from './DelegationsTab';
import PermissionsMatrixTab from './PermissionsMatrixTab';

interface UserDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  team: UserProfile[];
  initialTab?: 'assignments' | 'delegations' | 'permissions';
}

export default function UserDetailModal({
  isOpen,
  onClose,
  user,
  team,
  initialTab = 'assignments'
}: UserDetailModalProps) {
  const { user: currentUser } = useAuth();
  const isAdmin = (currentUser?.effectiveRole ?? currentUser?.role) === 'admin';
  const isManagement = (currentUser?.effectiveRole ?? currentUser?.role) === 'admin' || (currentUser?.effectiveRole ?? currentUser?.role) === 'hr';

  const [activeTab, setActiveTab] = useState<'assignments' | 'delegations' | 'permissions'>(initialTab);
  const [effectiveRole, setEffectiveRole] = useState<UserRole | undefined>(user?.role as UserRole);
  const [activeDelegation, setActiveDelegation] = useState<TemporaryDelegation | null>(null);

  // States for Assignments tab
  const [tempAllowedPages, setTempAllowedPages] = useState<string[]>([]);
  const [tempAssignedAreas, setTempAssignedAreas] = useState<string[]>([]);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (user) {
      setTempAllowedPages(user.allowedPages || []);
      setTempAssignedAreas(user.assignedAreas || []);

      // Calculate effective role and active delegation in real-time
      const checkRoles = async () => {
        const eff = await getEffectiveRole(user.uid, (user.role || 'consultant') as UserRole, db);
        const del = await getActiveDelegation(user.uid, db);
        setEffectiveRole(eff);
        setActiveDelegation(del);
      };
      checkRoles();
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const handleSaveAssignments = async () => {
    if (!isAdmin) {
      toast.error('Apenas administradores podem modificar atribuições diretamente.');
      return;
    }

    setIsSavingAssignments(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        allowedPages: tempAllowedPages,
        assignedAreas: tempAssignedAreas,
      });

      toast.success(`Atribuições de ${user.displayName} atualizadas!`);
      if (currentUser?.uid) {
        await createNotification(
          user.uid,
          '🛡️ Atribuições Atualizadas',
          `Suas atribuições de áreas e sistemas foram atualizadas pelo Administrador.`,
          'info'
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar atribuições: ' + err.message);
    } finally {
      setIsSavingAssignments(false);
    }
  };

  const hasActiveDelegation = effectiveRole && effectiveRole !== user.role;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="glass-card w-full max-w-4xl bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-left"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/80">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xl border-2 border-white shadow-sm overflow-hidden">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
                ) : (
                  user.displayName?.[0] || 'U'
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-display font-bold text-slate-800">{user.displayName}</h3>
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                    user.role === 'admin' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                    user.role === 'manager' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                    user.role === 'hr' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                    'bg-emerald-100 text-emerald-700 border-emerald-200'
                  )}>
                    {ROLE_LABELS[user.role as UserRole] || user.role}
                  </span>
                  {hasActiveDelegation && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1 animate-pulse">
                      <Sparkles className="w-3 h-3 text-amber-600" />
                      Delegação: {ROLE_LABELS[effectiveRole] || effectiveRole}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-1">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400" /> {user.email}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Hash className="w-3.5 h-3.5 text-slate-400" /> Matrícula: {user.registrationNumber || '---'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 mt-6 border-b border-slate-200/60 pb-0">
            <button
              type="button"
              onClick={() => setActiveTab('assignments')}
              className={cn(
                "px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all flex items-center gap-2 border-b-2 -mb-[2px] cursor-pointer",
                activeTab === 'assignments'
                  ? "bg-white text-emerald-700 border-emerald-600 shadow-xs"
                  : "text-slate-500 hover:text-slate-800 border-transparent hover:bg-slate-100/50"
              )}
            >
              <Shield className="w-4 h-4" />
              Atribuições & Acessos
            </button>

            {isAdmin && (
              <button
                type="button"
                id="tab-delegations"
                onClick={() => setActiveTab('delegations')}
                className={cn(
                  "px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all flex items-center gap-2 border-b-2 -mb-[2px] cursor-pointer",
                  activeTab === 'delegations'
                    ? "bg-white text-amber-700 border-amber-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-800 border-transparent hover:bg-slate-100/50"
                )}
              >
                <Users className="w-4 h-4" />
                Delegações
                {hasActiveDelegation && (
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                )}
              </button>
            )}

            <button
              type="button"
              id="tab-permissions"
              onClick={() => setActiveTab('permissions')}
              className={cn(
                "px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all flex items-center gap-2 border-b-2 -mb-[2px] cursor-pointer",
                activeTab === 'permissions'
                  ? "bg-white text-slate-700 border-emerald-600 shadow-xs"
                  : "text-slate-500 hover:text-slate-800 border-transparent hover:bg-slate-100/50"
              )}
            >
              <Lock className="w-4 h-4" />
              Permissões do Sistema
            </button>
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/30">
          {activeTab === 'assignments' && (
            <div className="space-y-6">
              {/* Technical Areas */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1 h-3.5 bg-emerald-500 rounded-full"></span>
                  Atribuição de Áreas Técnicas
                </h4>
                <p className="text-xs text-slate-500">
                  Frentes de serviço técnico em que o colaborador atua com maior frequência.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    { id: 'irrigation', label: 'Irrigação e Recursos Hídricos' },
                    { id: 'documentation', label: 'Regularização Ambiental / CAR' },
                    { id: 'topography', label: 'Topografia e Agrimensura' },
                    { id: 'credit', label: 'Crédito Rural e Projetos' },
                    { id: 'general', label: 'Análises e Vistorias Gerais' }
                  ].map((area) => {
                    const isChecked = tempAssignedAreas.includes(area.id);
                    return (
                      <label
                        key={area.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer select-none",
                          isChecked
                            ? "bg-emerald-50/60 border-emerald-300 shadow-xs"
                            : "bg-white border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTempAssignedAreas([...tempAssignedAreas, area.id]);
                            } else {
                              setTempAssignedAreas(tempAssignedAreas.filter(a => a !== area.id));
                            }
                          }}
                          className="sr-only"
                        />
                        <div className={cn(
                          "w-5 h-5 rounded-lg border flex items-center justify-center transition-all",
                          isChecked
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "border-slate-300 bg-slate-50"
                        )}>
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <span className={cn("text-xs font-bold", isChecked ? "text-emerald-900" : "text-slate-700")}>
                          {area.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Special Systems Access */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1 h-3.5 bg-emerald-500 rounded-full"></span>
                  Acesso Excepcional a Sistemas Restritos
                </h4>
                <p className="text-xs text-slate-500">
                  Libere módulos específicos adicionais sem alterar a hierarquia base do cargo.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    { id: 'financial', label: 'Fluxo Financeiro' },
                    { id: 'contracts', label: 'Gestão de Contratos' },
                    { id: 'documents', label: 'Documentos e Arquivos' },
                    { id: 'inventory', label: 'Estoque / Insumos' },
                    { id: 'vehicles', label: 'Veículos / Frotas' },
                    { id: 'reports', label: 'Relatórios Executivos' }
                  ].map((page) => {
                    const isChecked = tempAllowedPages.includes(page.id);
                    return (
                      <label
                        key={page.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer select-none",
                          isChecked
                            ? "bg-slate-50/60 border-slate-300 shadow-xs"
                            : "bg-white border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTempAllowedPages([...tempAllowedPages, page.id]);
                            } else {
                              setTempAllowedPages(tempAllowedPages.filter(p => p !== page.id));
                            }
                          }}
                          className="sr-only"
                        />
                        <div className={cn(
                          "w-5 h-5 rounded-lg border flex items-center justify-center transition-all",
                          isChecked
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "border-slate-300 bg-slate-50"
                        )}>
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <span className={cn("text-xs font-bold", isChecked ? "text-slate-900" : "text-slate-700")}>
                          {page.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {isAdmin && (
                <div className="pt-4 border-t border-slate-200 flex justify-end">
                  <button
                    type="button"
                    onClick={() => runExclusive('UserDetailModal.handleSaveAssignments', () => handleSaveAssignments())}
                    disabled={isSavingAssignments}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-200 transition-all flex items-center gap-2 cursor-pointer disabled:bg-slate-300"
                  >
                    {isSavingAssignments ? 'Salvando...' : 'Salvar Atribuições'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'delegations' && (
            <DelegationsTab user={user} team={team} />
          )}

          {activeTab === 'permissions' && (
            <PermissionsMatrixTab
              user={user}
              activeDelegation={activeDelegation}
              effectiveRole={effectiveRole}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}
