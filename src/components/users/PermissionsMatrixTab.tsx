import React from 'react';
import { Shield, Sparkles, UserCheck } from 'lucide-react';
import { UserProfile, UserRole, TemporaryDelegation } from '../../types';
import { ROLE_LABELS } from '../../lib/permissions';
import { cn } from '../../lib/utils';

interface PermissionsMatrixTabProps {
  user: UserProfile;
  activeDelegation?: TemporaryDelegation | null;
  effectiveRole?: UserRole;
}

const PERMISSION_TABLE = [
  { module: 'Dashboard',          consultant: '✓', hr: '✓', manager: '✓', admin: '✓' },
  { module: 'Clientes',           consultant: 'Próprios', hr: '✗', manager: '✓', admin: '✓+D' },
  { module: 'Análises',           consultant: 'Criar', hr: '✗', manager: 'C+E', admin: 'C+E+D' },
  { module: 'Visitas de Campo',   consultant: 'Criar', hr: '✗', manager: 'C+E', admin: 'C+E+D' },
  { module: 'Agendamentos',       consultant: 'Criar', hr: '✗', manager: 'C+E+Cancel.', admin: 'C+E+D' },
  { module: 'Contratos',          consultant: '✗', hr: '✗', manager: 'C+E+Aprov.', admin: 'C+E+D' },
  { module: 'Financeiro',         consultant: '✗', hr: '✗', manager: 'C+E', admin: 'C+E+D' },
  { module: 'Estoque',            consultant: '✗', hr: '✗', manager: 'C+E', admin: 'C+E+D+Preço' },
  { module: 'Ponto Eletrônico',   consultant: 'Próprio', hr: 'Todos', manager: 'Próprio', admin: 'Todos' },
  { module: 'Usuários',           consultant: '✗', hr: 'C+E (C/RH)', manager: '✗', admin: 'Total' },
  { module: 'Relatórios',         consultant: '✗', hr: '✗', manager: '✓', admin: '✓' },
  { module: 'Documentos',         consultant: '✗', hr: '✗', manager: '✓', admin: '✓' },
  { module: 'Perícia Judicial',   consultant: 'Criar', hr: '✗', manager: 'C+E', admin: 'C+E+D' },
  { module: 'Avaliação Imóveis',  consultant: 'Criar', hr: '✗', manager: 'C+E', admin: 'C+E+D' },
  { module: 'Auditoria',          consultant: '✗', hr: '✗', manager: '✗', admin: '✓' },
];

const ROLES_COLUMNS: { key: UserRole; label: string }[] = [
  { key: 'consultant', label: 'Consultor' },
  { key: 'hr', label: 'RH' },
  { key: 'manager', label: 'Gerente' },
  { key: 'admin', label: 'Administrador' }
];

export default function PermissionsMatrixTab({ user, activeDelegation, effectiveRole }: PermissionsMatrixTabProps) {
  const currentBaseRole = (user.role || 'consultant') as UserRole;
  const currentEffectiveRole = (effectiveRole || user.effectiveRole || currentBaseRole) as UserRole;
  const hasActiveDelegation = currentEffectiveRole !== currentBaseRole;

  return (
    <div className="space-y-6 text-left">
      {/* Overview Card */}
      <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shadow-xs">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Perfil de Acesso do Colaborador</div>
            <div className="text-sm font-bold text-slate-800 flex items-center gap-2 mt-0.5">
              <span>{user.displayName}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300">
                Base: {ROLE_LABELS[currentBaseRole] || currentBaseRole}
              </span>
              {hasActiveDelegation && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  Efetivo: {ROLE_LABELS[currentEffectiveRole] || currentEffectiveRole} (Temporário)
                </span>
              )}
            </div>
          </div>
        </div>

        {hasActiveDelegation && activeDelegation && (
          <div className="text-right text-xs text-amber-800 bg-amber-50/80 px-3 py-2 rounded-xl border border-amber-200">
            <div className="font-bold flex items-center gap-1.5 justify-end">
              <UserCheck className="w-3.5 h-3.5 text-amber-600" />
              Substituindo {activeDelegation.absentUserName}
            </div>
            <div className="text-[11px] text-amber-700 mt-0.5">
              Período: {new Date(activeDelegation.startDate + 'T12:00:00').toLocaleDateString('pt-BR')} 
              {activeDelegation.endDate ? ` até ${new Date(activeDelegation.endDate + 'T12:00:00').toLocaleDateString('pt-BR')}` : ' (Indeterminado)'}
            </div>
          </div>
        )}
      </div>

      {/* Permissions Matrix Table (5 columns) */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800">Matriz de Permissões do Sistema</h4>
            <p className="text-xs text-slate-500 mt-0.5">Níveis de acesso e prerrogativas de operação por cargo</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4 w-2/6">Módulo</th>
                {ROLES_COLUMNS.map((col) => {
                  const isUserBase = col.key === currentBaseRole;
                  const isUserEffective = col.key === currentEffectiveRole && hasActiveDelegation;

                  return (
                    <th
                      key={col.key}
                      className={cn(
                        "py-3 px-3 text-center transition-all w-1/6",
                        isUserEffective
                          ? "bg-amber-100/80 text-amber-900 border-x-2 border-amber-400 font-black"
                          : isUserBase
                          ? "bg-emerald-50 text-emerald-900 border-x-2 border-emerald-400 font-black"
                          : "text-slate-600"
                      )}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{col.label}</span>
                        {isUserBase && !hasActiveDelegation && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-600 text-white font-bold tracking-tighter">
                            Atual
                          </span>
                        )}
                        {isUserBase && hasActiveDelegation && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-500 text-white font-bold tracking-tighter">
                            Base
                          </span>
                        )}
                        {isUserEffective && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-600 text-white font-bold tracking-tighter animate-pulse">
                            Temporário
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {PERMISSION_TABLE.map((row) => {
                return (
                  <tr key={row.module} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-800">
                      {row.module}
                    </td>
                    {ROLES_COLUMNS.map((col) => {
                      const isUserBase = col.key === currentBaseRole;
                      const isUserEffective = col.key === currentEffectiveRole && hasActiveDelegation;
                      const val = row[col.key];

                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "py-3 px-3 text-center align-middle font-medium transition-all",
                            isUserEffective
                              ? "bg-amber-50/60 border-x-2 border-amber-300 text-amber-900 font-bold"
                              : isUserBase
                              ? "bg-emerald-50 border-x-2 border-emerald-300 text-emerald-900 font-bold"
                              : val === '✗' ? "text-slate-300" : "text-slate-600"
                          )}
                        >
                          <span className={cn(
                            val === '✓' ? 'text-emerald-600 font-bold' :
                            val === '✗' ? 'text-slate-300' :
                            'text-slate-700 font-semibold'
                          )}>
                            {val}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-slate-600">
            Legenda: <span className="font-normal text-slate-500 ml-1">C = Criar | E = Editar | D = Excluir | Aprov. = Aprovar | Cancel. = Cancelar</span>
          </div>
          <div className="text-[10px] text-slate-400">
            * Destaques em verde representam o cargo base do usuário; destaques em amarelo representam delegação temporária ativa.
          </div>
        </div>
      </div>
    </div>
  );
}
