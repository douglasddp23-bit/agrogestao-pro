import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_LABELS, UserRole } from '../lib/permissions';
import { 
  History, 
  PlusCircle, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Eye, 
  ChevronDown, 
  ChevronUp,
  Clock,
  User as UserIcon
} from 'lucide-react';
import { cn } from '../lib/utils';

export interface AuditTrailProps {
  recordId: string;
  collectionName: string;
  className?: string;
}

interface AuditLogEntry {
  id: string;
  recordId: string;
  collection: string;
  userId: string;
  userName: string;
  userRole?: string;
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'approved' | 'rejected' | 'read' | string;
  changedFields?: string[];
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  recordName?: string;
  timestamp: string;
  details?: string;
}

const ACTION_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  created: { label: 'Criação', icon: PlusCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  updated: { label: 'Atualização', icon: Edit3, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
  deleted: { label: 'Exclusão', icon: Trash2, color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
  approved: { label: 'Aprovação', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  rejected: { label: 'Rejeição', icon: XCircle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  status_changed: { label: 'Alteração de Status', icon: History, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
  read: { label: 'Visualização', icon: Eye, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
};

function formatValue(value: any, keyName?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (keyName && (keyName.toLowerCase().includes('preco') || keyName.toLowerCase().includes('valor') || keyName.toLowerCase().includes('honorario') || keyName.toLowerCase().includes('price') || keyName.toLowerCase().includes('cost') || keyName.toLowerCase().includes('total'))) {
      return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    return value.toLocaleString('pt-BR');
  }
  if (typeof value === 'object') {
    if (value.seconds) {
      return new Date(value.seconds * 1000).toLocaleString('pt-BR');
    }
    return JSON.stringify(value);
  }
  const str = String(value);
  // Check if ISO Date string
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    try {
      return new Date(str).toLocaleString('pt-BR');
    } catch {
      return str;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  return str;
}

export default function AuditTrail({ recordId, collectionName, className }: AuditTrailProps) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  // Apenas Administradores podem visualizar o AuditTrail
  if ((user?.effectiveRole ?? user?.role) !== 'admin') {
    return null;
  }

  useEffect(() => {
    if (!recordId || !collectionName) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Query audit_logs by recordId and collectionName
    const q = query(
      collection(db, 'logs'),
      where('recordId', '==', recordId),
      where('collection', '==', collectionName),
      orderBy('timestamp', 'desc'),
      limit(30)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched: AuditLogEntry[] = [];
        snapshot.forEach((docSnap) => {
          fetched.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        setLogs(fetched);
        setLoading(false);
      },
      (error) => {
        // Se houver erro de índice composto no Firestore, tenta fallback sem orderBy composto
        console.warn('AuditTrail fallback query:', error);
        const fallbackQ = query(
          collection(db, 'logs'),
          where('recordId', '==', recordId),
          limit(30)
        );
        const unsubFallback = onSnapshot(fallbackQ, (snap) => {
          const fetched: AuditLogEntry[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            if (!data.collection || data.collection === collectionName) {
              fetched.push({ id: docSnap.id, ...data });
            }
          });
          fetched.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
          setLogs(fetched);
          setLoading(false);
        });
        return () => unsubFallback();
      }
    );

    return () => unsubscribe();
  }, [recordId, collectionName]);

  return (
    <div className={cn("glass-card p-4 rounded-2xl border border-slate-200/80 shadow-sm mt-4", className)}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between cursor-pointer select-none group"
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              Histórico de Alterações & Auditoria
              <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                {logs.length}
              </span>
            </h4>
            <p className="text-[10px] text-slate-400">Exclusivo para Administrador</p>
          </div>
        </div>
        <button className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 group-hover:text-slate-600 transition-colors">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          {loading ? (
            <div className="py-4 text-center text-xs text-slate-400 animate-pulse flex items-center justify-center gap-2">
              <Clock className="w-4 h-4 animate-spin" /> Carregando trilha de auditoria...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400 italic">
              Nenhuma alteração registrada até o momento para este registro.
            </div>
          ) : (
            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {logs.map((log) => {
                const actConfig = ACTION_CONFIG[log.action] || {
                  label: log.action,
                  icon: History,
                  color: 'text-slate-600',
                  bg: 'bg-slate-50 border-slate-200'
                };
                const Icon = actConfig.icon;
                const formattedTime = log.timestamp 
                  ? new Date(log.timestamp).toLocaleString('pt-BR') 
                  : 'Data não informada';

                const diffFields: { key: string; prev: any; next: any }[] = [];
                if (log.action === 'updated' && log.newValues) {
                  const prevObj = log.previousValues || {};
                  const nextObj = log.newValues || {};
                  const keys = log.changedFields || Array.from(new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]));
                  
                  keys.forEach((k) => {
                    // Ignora campos internos
                    if (['updatedAt', 'lastModified', 'passwordHash', 'createdAt'].includes(k)) return;
                    if (JSON.stringify(prevObj[k]) !== JSON.stringify(nextObj[k])) {
                      diffFields.push({
                        key: k,
                        prev: prevObj[k],
                        next: nextObj[k]
                      });
                    }
                  });
                }

                return (
                  <div key={log.id} className="relative group">
                    {/* Timeline Node */}
                    <div className={cn(
                      "absolute -left-6 top-1 w-5 h-5 rounded-full border flex items-center justify-center bg-white shadow-xs",
                      actConfig.color
                    )}>
                      <Icon className="w-3 h-3" />
                    </div>

                    <div className="p-3 bg-white/70 hover:bg-white rounded-xl border border-slate-100 shadow-2xs transition-all space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border",
                            actConfig.bg,
                            actConfig.color
                          )}>
                            {actConfig.label}
                          </span>
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                            <UserIcon className="w-3 h-3 text-slate-400" />
                            {log.userName || 'Sistema'}
                          </span>
                          {log.userRole && (
                            <span className="text-[10px] text-slate-400 font-medium">
                              ({ROLE_LABELS[log.userRole as UserRole] || log.userRole})
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formattedTime}
                        </span>
                      </div>

                      {log.details && (
                        <p className="text-xs text-slate-600">{log.details}</p>
                      )}

                      {/* Diff Table for Updates */}
                      {diffFields.length > 0 && (
                        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200/60 bg-slate-50/50">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-slate-100/80 text-slate-500 font-semibold border-b border-slate-200/60">
                              <tr>
                                <th className="p-1.5 pl-2">Campo</th>
                                <th className="p-1.5 text-rose-600">Antes</th>
                                <th className="p-1.5 text-emerald-600">Depois</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/40">
                              {diffFields.map(({ key, prev, next }) => (
                                <tr key={key} className="hover:bg-white/60 transition-colors">
                                  <td className="p-1.5 pl-2 font-mono text-[10px] font-semibold text-slate-600">
                                    {key}
                                  </td>
                                  <td className="p-1.5 text-rose-700 bg-rose-50/30 max-w-[140px] truncate" title={formatValue(prev, key)}>
                                    {formatValue(prev, key)}
                                  </td>
                                  <td className="p-1.5 text-emerald-700 bg-emerald-50/30 font-medium max-w-[140px] truncate" title={formatValue(next, key)}>
                                    {formatValue(next, key)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
