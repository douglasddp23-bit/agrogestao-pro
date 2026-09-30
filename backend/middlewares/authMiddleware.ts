import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

export type StaffRole = 'consultant' | 'hr' | 'manager' | 'admin' | 'staff';
const STAFF_ROLES: StaffRole[] = ['consultant', 'hr', 'manager', 'admin', 'staff'];

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken & {
    role?: string;
  };
}

// SEGURANÇA: não existe mais nenhum "token virtual"/bypass (VIRTUAL_USER_BYPASS,
// virtual_*, VIRT-*). Antes, fora do modo produção, qualquer texto curto no
// cabeçalho Authorization virava administrador — e as rotas de admin usam o
// Admin SDK com credenciais reais (criar/apagar contas de verdade).
// Também não há mais e-mail "mágico" de administrador: admin@agrogestao.com.br
// não existia e qualquer pessoa poderia criar essa conta e virar admin.

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/** E-mail do administrador principal (ADMIN_EMAIL), só aceito se o e-mail estiver verificado. */
function isVerifiedPrimaryAdmin(decoded: admin.auth.DecodedIdToken): boolean {
  const envAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').toLowerCase().trim();
  const email = (decoded.email || '').toLowerCase().trim();
  return !!envAdminEmail && email === envAdminEmail && decoded.email_verified === true;
}

/**
 * Cargo efetivo de quem chamou: claim "role" do token; se ausente, o cargo do
 * documento users/{uid} (definido por um administrador). Bloqueados = sem cargo.
 */
async function resolveRole(decoded: admin.auth.DecodedIdToken): Promise<string | null> {
  if (isVerifiedPrimaryAdmin(decoded)) return 'admin';
  let profileRole: string | null = null;
  try {
    const snap = await admin.firestore().collection('users').doc(decoded.uid).get();
    const data = snap.exists ? snap.data() : null;
    if (data?.blocked) return null;
    profileRole = typeof data?.role === 'string' ? data.role : null;
  } catch {
    // sem acesso ao Firestore: usa só o token
  }
  const claimRole = typeof (decoded as any).role === 'string' ? (decoded as any).role : null;
  return claimRole || profileRole;
}

/**
 * Duração máxima de uma sessão (desde o login com senha), em horas. O Firebase
 * renova o token sozinho a cada hora e, sem este limite, uma sessão aberta
 * duraria para sempre. Passado o prazo, é preciso digitar a senha de novo.
 * As regras do Firestore (firestore.rules → isSignedIn) usam o mesmo prazo.
 */
export const SESSION_MAX_HOURS = Math.min(Math.max(Number(process.env.SESSION_MAX_HOURS) || 12, 1), 12);

export function isSessionTooOld(decoded: admin.auth.DecodedIdToken): boolean {
  const authTime = Number(decoded.auth_time) || 0;
  return !authTime || Date.now() - authTime * 1000 > SESSION_MAX_HOURS * 60 * 60 * 1000;
}

async function authenticate(req: AuthenticatedRequest, res: Response): Promise<{ decoded: admin.auth.DecodedIdToken; role: string } | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Token de autorização não fornecido ou inválido' });
    return null;
  }
  let decoded: admin.auth.DecodedIdToken;
  try {
    // checkRevoked: contas bloqueadas (tokens revogados) são recusadas na hora
    decoded = await admin.auth().verifyIdToken(token, true);
  } catch {
    res.status(401).json({ error: 'Sessão expirada ou inválida. Por favor, faça login novamente.', code: 'session_expired' });
    return null;
  }
  if (isSessionTooOld(decoded)) {
    res.status(401).json({ error: `Sua sessão passou de ${SESSION_MAX_HOURS} horas. Entre novamente com sua senha.`, code: 'session_expired' });
    return null;
  }
  const role = await resolveRole(decoded);
  if (!role || !STAFF_ROLES.includes(role as StaffRole)) {
    // Conta existe no Firebase, mas não foi cadastrada por um administrador (ou está bloqueada)
    res.status(403).json({ error: 'Acesso negado: conta sem cargo autorizado no sistema.' });
    return null;
  }
  return { decoded, role };
}

/** Rotas de gestão de usuários: Administrador, RH ou Gerente (cada ação refina depois). */
export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const auth = await authenticate(req, res);
  if (!auth) return;
  if (!['admin', 'hr', 'manager'].includes(auth.role)) {
    console.warn(`[requireAdmin] Acesso negado para uid ${auth.decoded.uid} (cargo ${auth.role})`);
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de Administrador ou Gestor' });
  }
  req.user = { ...auth.decoded, role: auth.role };
  next();
}

/** Gerente ou Administrador (quem enxerga contratos e valores). */
export async function requireManager(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const auth = await authenticate(req, res);
  if (!auth) return;
  if (!['admin', 'manager'].includes(auth.role)) {
    return res.status(403).json({ error: 'Acesso negado: requer cargo de Gerente ou Administrador.' });
  }
  req.user = { ...auth.decoded, role: auth.role };
  next();
}

/** Qualquer colaborador cadastrado e ativo. */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const auth = await authenticate(req, res);
  if (!auth) return;
  req.user = { ...auth.decoded, role: auth.role };
  next();
}
