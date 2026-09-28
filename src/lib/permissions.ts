import { collection, query, where, getDocs, Firestore } from 'firebase/firestore';
import { todayLocalDateString } from './utils';
import { TemporaryDelegation } from '../types';

export type UserRole = 'consultant' | 'hr' | 'manager' | 'admin';

export const ROLE_LABELS: Record<UserRole, string> = {
  consultant: 'Consultor',
  hr: 'RH',
  manager: 'Gerente',
  admin: 'Administrador',
};

export const ROLE_LEVEL: Record<UserRole, number> = {
  consultant: 1,
  hr: 2,
  manager: 3,
  admin: 4,
};

export function hasRole(userRole: UserRole, minRole: UserRole): boolean {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[minRole] || 0);
}

export async function getEffectiveRole(
  userId: string,
  originalRole: UserRole,
  db: Firestore
): Promise<UserRole> {
  if (!userId || !db) return originalRole;
  const today = todayLocalDateString();
  try {
    const q = query(
      collection(db, 'delegations'),
      where('delegateUserId', '==', userId),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return originalRole;

    let highestRole = originalRole;
    snap.docs.forEach(doc => {
      const d = doc.data() as TemporaryDelegation;
      // Verificar se está dentro do prazo
      const withinPeriod = d.startDate <= today &&
        (!d.endDate || d.endDate >= today);
      if (withinPeriod) {
        // Usar a role mais alta entre original e delegada
        if ((ROLE_LEVEL[d.absentUserRole] || 0) > (ROLE_LEVEL[highestRole] || 0)) {
          highestRole = d.absentUserRole;
        }
      }
    });
    return highestRole;
  } catch (e) {
    console.warn('[Permissions] Erro ao calcular role efetiva:', e);
    return originalRole;
  }
}

export async function getActiveDelegation(
  userId: string,
  db: Firestore
): Promise<TemporaryDelegation | null> {
  if (!userId || !db) return null;
  const today = todayLocalDateString();
  try {
    const q = query(
      collection(db, 'delegations'),
      where('delegateUserId', '==', userId),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    let bestDelegation: TemporaryDelegation | null = null;
    let highestLevel = -1;

    snap.docs.forEach(doc => {
      const d = { id: doc.id, ...doc.data() } as TemporaryDelegation;
      const withinPeriod = d.startDate <= today && (!d.endDate || d.endDate >= today);
      if (withinPeriod) {
        const level = ROLE_LEVEL[d.absentUserRole] || 0;
        if (level > highestLevel) {
          highestLevel = level;
          bestDelegation = d;
        }
      }
    });
    return bestDelegation;
  } catch (e) {
    console.warn('[Permissions] Erro ao buscar delegação ativa:', e);
    return null;
  }
}

// Quais abas cada role pode acessar
export const NAV_ACCESS: Record<string, UserRole[]> = {
  dashboard:             ['consultant', 'hr', 'manager', 'admin'],
  clients:               ['consultant', 'manager', 'admin'],
  analyses:              ['consultant', 'manager', 'admin'],
  field_visits:          ['consultant', 'manager', 'admin'],
  scheduling:            ['consultant', 'manager', 'admin'],
  judicial_expertise:    ['consultant', 'manager', 'admin'],
  rural_valuation:       ['consultant', 'manager', 'admin'],
  irrigation:            ['consultant', 'manager', 'admin'],
  topography:            ['consultant', 'manager', 'admin'],
  regularization:        ['consultant', 'manager', 'admin'],
  rural_credit:          ['consultant', 'manager', 'admin'],
  pest_disease:          ['consultant', 'manager', 'admin'],
  environmental_xray:    ['consultant', 'manager', 'admin'],
  contracts:             ['manager', 'admin'],
  financial:             ['manager', 'admin'],
  inventory:             ['manager', 'admin'],
  reports:               ['manager', 'admin'],
  documents:             ['manager', 'admin'],
  vehicles:              ['manager', 'admin'],
  // E-mail interno: todos recebem mensagens (o ícone no topo mostra o contador), então todos precisam ler.
  messages:              ['consultant', 'hr', 'manager', 'admin'],
  // Ponto Eletrônico: todos batem ponto e pedem férias/licenças no "Meu Painel";
  // as abas de gestão (Funcionários, Folha, Logs) continuam só para RH/Admin dentro da tela.
  hr:                    ['consultant', 'hr', 'manager', 'admin'],
  users:                 ['hr', 'admin'],
  audit_logs:            ['admin'],
  property_map:          ['manager', 'admin'],
};

export function canAccessNav(role: UserRole, navKey: string): boolean {
  if (!role) return false;
  // Suporte a chaves com hífen/sublinhado ou aliases
  const normalizedKey = navKey.replace(/-/g, '_').replace(/^analysis_/, '');
  const accessList = NAV_ACCESS[navKey] || NAV_ACCESS[normalizedKey] || (navKey === 'analysis' ? NAV_ACCESS.analyses : undefined);
  return (accessList || []).includes(role);
}

export function canCreateRole(userRole: UserRole, targetRole: UserRole): boolean {
  if (userRole === 'admin') return true;
  if (userRole === 'hr') return targetRole === 'consultant' || targetRole === 'hr';
  return false;
}

export function canBlockUsers(role: UserRole): boolean {
  return role === 'admin';
}

export function canDeleteUsers(role: UserRole): boolean {
  return role === 'admin';
}

// Permissões de CRUD por módulo
export const PERMISSIONS = {
  canCreate:         (role: UserRole) => true,
  canAddInfo:        (role: UserRole) => true,
  canEdit:           (role: UserRole) => hasRole(role, 'manager'),
  canDelete:         (role: UserRole) => role === 'admin',
  canApprove:        (role: UserRole) => hasRole(role, 'manager'),
  canViewAudit:      (role: UserRole) => role === 'admin',
  canManageUsers:    (role: UserRole) => hasRole(role, 'hr'),
  canViewAllClients: (role: UserRole) => hasRole(role, 'manager'),
  canViewFinancial:  (role: UserRole) => hasRole(role, 'manager'),
  canViewReports:    (role: UserRole) => hasRole(role, 'manager'),
  canEditPrice:      (role: UserRole) => role === 'admin',
  canCreateRole,
  canBlockUsers,
  canDeleteUsers,
  canCreateClient:   (role: UserRole) => hasRole(role, 'manager'),
  canEditClient:     (role: UserRole) => hasRole(role, 'manager'),
  canDeleteClient:   (role: UserRole, hasActiveServices = false) => role === 'admin' || (role === 'manager' && !hasActiveServices),
  canDeleteAnalysis: (role: UserRole, status?: string) => role === 'admin' || (role === 'manager' && status === 'draft'),
  canDeleteVisit:    (role: UserRole, status?: string) => role === 'admin' || (role === 'manager' && status === 'agendada'),
  canCancelSchedule: (role: UserRole, isOwner = false) => hasRole(role, 'manager') || isOwner,
  canDeleteSchedule: (role: UserRole) => role === 'admin',
};
