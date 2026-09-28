import { Request, Response } from 'express';
import admin from 'firebase-admin';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { sendAdminCredentialsEmail } from '../services/mailService';
import QRCode from 'qrcode';
import {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../services/totp';

// In-memory Virtual Users Store for Sandbox / Development mode
const virtualUsersMap = new Map<string, any>();

// One-time tokens issued right after a successful login (password validated).
// /api/update-password requires one of these, matching the uid, before it
// will change a password. Without this, anyone who only knew (or guessed)
// a user's uid could change that user's password with no authentication at
// all — this closes that hole while still working for both real Firebase
// Auth users and "virtual" (in-memory) users, which have no Firebase ID
// token to present.
const passwordChangeTokens = new Map<string, { token: string; expires: number }>();

function issuePasswordChangeToken(uid: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  passwordChangeTokens.set(uid, { token, expires: Date.now() + 15 * 60 * 1000 });
  return token;
}

function consumePasswordChangeToken(uid: string, token: string): boolean {
  const rec = passwordChangeTokens.get(uid);
  if (!rec || rec.token !== token || rec.expires < Date.now()) {
    return false;
  }
  passwordChangeTokens.delete(uid);
  return true;
}

function isConfigPlaceholder(config: any): boolean {
  if (!config) return true;
  const projId = String(config.projectId || '').trim();
  const apiKey = String(config.apiKey || '').trim();
  
  if (!projId || projId === '123' || projId === 'SEU_FIREBASE_PROJECT_ID' || projId.includes('YOUR_') || projId === 'SUA_FIREBASE_API_KEY') return true;
  if (!apiKey || apiKey === 'SUA_FIREBASE_API_KEY' || !apiKey.startsWith('AIzaSy')) return true;
  
  return false;
}

// Local helper to load Firebase Config
function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  const firestoreDatabaseId = process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || '(default)';

  if (projectId && apiKey && !isConfigPlaceholder({ projectId, apiKey })) {
    return {
      projectId,
      apiKey,
      firestoreDatabaseId
    };
  }

  // Fallback to JSON file
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!isConfigPlaceholder(cfg)) {
        return cfg;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// REST Web API client-side query bypass for Firestore serverless permissions
async function queryUserREST(field: 'email' | 'registrationNumber', value: string) {
  const config = getFirebaseConfig();
  if (!config) {
    // Check in-memory virtual store
    for (const u of virtualUsersMap.values()) {
      if (field === 'email' && u.email?.toLowerCase() === value.toLowerCase()) return u;
      if (field === 'registrationNumber' && u.registrationNumber?.toUpperCase() === value.toUpperCase()) return u;
    }
    return null;
  }
  const projectId = config.projectId;
  const databaseId = config.firestoreDatabaseId || '(default)';
  const apiKey = config.apiKey;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:runQuery?key=${apiKey}`;
  
  const payload = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'EQUAL',
          value: { stringValue: value }
        }
      },
      limit: 1
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return null;
    }

    const results = await response.json();
    if (!results || results.length === 0 || !results[0].document) {
      return null;
    }

    const doc = results[0].document;
    const docFields = doc.fields || {};
    const user: any = {
      uid: doc.name.split('/').pop(),
    };

    for (const [key, val] of Object.entries(docFields)) {
      const fVal: any = val;
      if ('stringValue' in fVal) user[key] = fVal.stringValue;
      else if ('booleanValue' in fVal) user[key] = fVal.booleanValue;
      else if ('integerValue' in fVal) user[key] = parseInt(fVal.integerValue, 10);
      else if ('doubleValue' in fVal) user[key] = parseFloat(fVal.doubleValue);
    }

    return user;
  } catch {
    return null;
  }
}

// REST Web API client-side save bypass for Firestore serverless permissions
async function saveFirestoreUserREST(uid: string, userProfile: any) {
  const config = getFirebaseConfig();
  if (!config) {
    virtualUsersMap.set(uid, userProfile);
    return true;
  }
  const projectId = config.projectId;
  const databaseId = config.firestoreDatabaseId || '(default)';
  const apiKey = config.apiKey;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}?key=${apiKey}`;

  const fields: any = {};
  for (const [key, val] of Object.entries(userProfile)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { doubleValue: val };
    } else if (val instanceof Date) {
      fields[key] = { stringValue: val.toISOString() };
    }
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });

    return response.ok;
  } catch {
    return false;
  }
}

// Senhas (hashes bcrypt) NÃO ficam mais no documento users/{uid} — esse
// documento é lido por qualquer funcionário logado (para a agenda, o chat,
// etc.), então guardar a senha ali significava que qualquer um podia ler o
// hash de senha de qualquer colega. Agora ficam numa coleção separada,
// user_credentials/{uid}, que as regras do Firestore bloqueiam por completo
// para o SDK do cliente — só o servidor (Admin SDK, que ignora as regras)
// consegue ler ou escrever nela.
interface TotpConfig {
  enabled: boolean;
  secret: string;
  enabledAt?: string;
  lastStep?: number | null;
  recoveryCodes?: string[]; // só os hashes SHA-256
}

/** Documento user_credentials/{uid} inteiro (hash da senha + configuração do 2FA). */
async function getCredentialDoc(uid: string): Promise<{ passwordHash?: string; totp?: TotpConfig; totpPending?: { secret: string; createdAt: number } } | null> {
  try {
    const snap = await admin.firestore().collection('user_credentials').doc(uid).get();
    return snap.exists ? (snap.data() as any) : null;
  } catch {
    return null;
  }
}

function activeTotp(cred: { totp?: TotpConfig } | null): TotpConfig | null {
  return cred?.totp?.enabled && cred.totp.secret ? cred.totp : null;
}

async function getUserCredentialHash(uid: string): Promise<string | null> {
  const cred = await getCredentialDoc(uid);
  if (cred?.passwordHash) return cred.passwordHash;
  const config = getFirebaseConfig();
  if (!config) return null;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId || '(default)'}/documents/user_credentials/${uid}?key=${config.apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const doc = await response.json();
    return doc?.fields?.passwordHash?.stringValue || null;
  } catch {
    return null;
  }
}

async function setUserCredential(uid: string, passwordHash: string): Promise<boolean> {
  try {
    await admin.firestore().collection('user_credentials').doc(uid).set(
      { passwordHash, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch {
    // cai para o fallback REST abaixo
  }
  const config = getFirebaseConfig();
  if (!config) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId || '(default)'}/documents/user_credentials/${uid}?updateMask.fieldPaths=passwordHash&key=${config.apiKey}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { passwordHash: { stringValue: passwordHash } } }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// As regras do Firestore (firestore.rules → getRole) só enxergam o cargo que
// está no token de login do Firebase (custom claim "role") — elas NÃO leem o
// campo "role" do documento users/{uid}. Se o token não tiver o cargo, a
// interface mostra os botões (porque lê o documento), mas o Firestore responde
// "missing or insufficient permissions" em toda gravação (ex: cadastrar
// cliente). Estas funções copiam o cargo do documento para o token.
// SEGURANÇA: só o ADMIN_EMAIL configurado (e com e-mail verificado) é administrador
// automático. O antigo "admin@agrogestao.com.br" fixo no código não existia como
// conta — qualquer pessoa poderia criá-la no Firebase e virar administradora.
function getPrimaryAdminEmails(): string[] {
  const envAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').toLowerCase().trim();
  return envAdminEmail ? [envAdminEmail] : [];
}

async function resolveClaimRole(uid: string, email?: string | null, emailVerified = false): Promise<string | null> {
  if (email && emailVerified && getPrimaryAdminEmails().includes(email.toLowerCase().trim())) {
    return 'admin';
  }
  try {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    if (!data || data.blocked) return null;
    const baseRole = typeof data.role === 'string' && data.role ? data.role : null;
    if (!baseRole) return null;
    // Delegação ativa (cobertura de férias/ausência): o token recebe o MAIOR cargo
    // entre o próprio e o de quem está sendo substituído, dentro do período.
    return await applyActiveDelegation(uid, baseRole);
  } catch {
    return null;
  }
}

const ROLE_RANK: Record<string, number> = { staff: 1, consultant: 1, hr: 2, manager: 3, admin: 4 };

function todayBR(): string {
  // Data de hoje no fuso de Brasília (as datas das delegações são digitadas no horário local)
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function applyActiveDelegation(uid: string, baseRole: string): Promise<string> {
  let best = baseRole;
  try {
    const snap = await admin.firestore().collection('delegations')
      .where('delegateUserId', '==', uid)
      .where('active', '==', true)
      .get();
    const today = todayBR();
    snap.forEach(d => {
      const x = d.data();
      const within = typeof x.startDate === 'string' && x.startDate <= today && (!x.endDate || x.endDate >= today);
      if (within && (ROLE_RANK[x.absentUserRole] || 0) > (ROLE_RANK[best] || 0)) best = x.absentUserRole;
    });
  } catch {
    // sem acesso às delegações: fica o cargo base
  }
  return best;
}

/** Recalcula e grava o cargo (claim) de um usuário. Usado após criar/revogar delegação. */
export async function refreshUserClaim(uid: string): Promise<string | null> {
  let email: string | undefined;
  let verified = false;
  try {
    const rec = await admin.auth().getUser(uid);
    email = rec.email;
    verified = rec.emailVerified;
  } catch {
    return null;
  }
  const role = await resolveClaimRole(uid, email, verified);
  if (role) await setRoleClaim(uid, role);
  return role;
}

// POST /api/sync-user-claim { uid } — RH/Admin, depois de criar ou revogar uma delegação
export async function syncUserClaim(req: Request, res: Response) {
  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'UID obrigatório.' });
  }
  const caller = callerOf(req);
  if (!['admin', 'hr'].includes(caller.role)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  try {
    const role = await refreshUserClaim(uid);
    return res.json({ success: true, role });
  } catch (error: any) {
    console.error('Erro ao sincronizar cargo de outro usuário:', error?.message || error);
    return res.status(500).json({ error: 'Falha ao sincronizar o cargo.' });
  }
}

async function setRoleClaim(uid: string, role: string): Promise<void> {
  const userRecord = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, { ...(userRecord.customClaims || {}), role });
}

// Chamado pelo app logo após todo login com Firebase Auth (Google, e-mail/senha
// ou token do servidor). Confere o token de quem chamou e, se o cargo no token
// estiver ausente ou desatualizado, grava o cargo certo nele.
export async function syncRoleClaim(req: Request, res: Response) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return res.status(401).json({ error: 'Token de autorização não fornecido.' });
  }

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }

  try {
    const role = await resolveClaimRole(decoded.uid, decoded.email, decoded.email_verified === true);
    if (!role || decoded.role === role) {
      return res.json({ updated: false, role: decoded.role || null });
    }
    await setRoleClaim(decoded.uid, role);
    return res.json({ updated: true, role });
  } catch (error: any) {
    console.error('Erro ao sincronizar cargo no token:', error);
    return res.status(500).json({ error: 'Falha ao sincronizar o cargo do usuário.' });
  }
}

// Alphanumeric secure temporary password generator matching corporate entropy constraints
function generateSecurePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%&*';
  
  const getRandom = (source: string, len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      // crypto.randomInt: Math.random() é previsível e não serve para senhas.
      result += source.charAt(crypto.randomInt(0, source.length));
    }
    return result;
  };

  return (
    getRandom(upperChars, 3) +
    getRandom(chars, 3) +
    getRandom(numbers, 2) +
    getRandom(symbols, 2)
  );
}

// Generate uniform Portuguese/Latin name sanitized short slugs with standard name.lastname@agrogestao.com.br format
function createEmailSlug(name: string): string {
  const clean = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/);
  
  const first = clean[0] || 'colaborador';
  const last = clean.length > 1 ? clean[clean.length - 1] : '';
  
  const base = last ? `${first}.${last}` : first;
  return `${base}@agrogestao.com.br`;
}

async function generateUniqueRegistrationNumber(role: string, db: admin.firestore.Firestore): Promise<string> {
  const rolePrefixes: Record<string, string> = {
    staff: 'F',
    consultant: 'F',
    manager: 'G',
    hr: 'R',
    admin: 'A'
  };
  const prefix = rolePrefixes[role] || 'F';
  
  for (let attempt = 1; attempt <= 10; attempt++) {
    const num = crypto.randomInt(1000, 10000);
    const regNum = `${prefix}${num}`;
    
    // Check in virtual in-memory store
    let existsInVirtual = false;
    for (const u of virtualUsersMap.values()) {
      if (u.registrationNumber === regNum) {
        existsInVirtual = true;
        break;
      }
    }
    if (existsInVirtual) continue;

    // Check if it already exists in Firestore if available
    try {
      const qSnap = await db.collection('users')
        .where('registrationNumber', '==', regNum)
        .limit(1)
        .get();
        
      if (qSnap.empty) {
        return regNum;
      }
    } catch {
      // If Firestore Admin throws permissions or network, return regNum directly if not in virtual store
      return regNum;
    }
  }
  
  return `${prefix}${crypto.randomInt(1000, 10000)}`;
}

// ─── Hierarquia de cargos (mesma regra de src/lib/permissions.ts) ─────────────
// Antes, qualquer Gerente/RH chamando a API direto conseguia criar Administradores,
// apagar, bloquear ou trocar a senha de qualquer conta — a regra só existia na tela.
const VALID_ROLES = ['consultant', 'hr', 'manager', 'admin'];

function callerOf(req: Request): { uid: string; role: string } {
  const u = (req as any).user || {};
  return { uid: String(u.uid || ''), role: String(u.role || '') };
}

function canAssignRole(callerRole: string, targetRole: string): boolean {
  if (callerRole === 'admin') return VALID_ROLES.includes(targetRole);
  if (callerRole === 'hr') return targetRole === 'consultant' || targetRole === 'hr';
  return false;
}

async function targetRoleOf(uid: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    return snap.exists ? String(snap.data()?.role || '') : null;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

export async function createUser(req: Request, res: Response) {
  let { displayName, role, department, professionalCertification, registrationNumber } = req.body;

  try {
    if (!displayName || !role) {
      return res.status(400).json({ error: 'Os campos Nome e Perfil são obrigatórios.' });
    }

    if (typeof displayName !== 'string' || typeof role !== 'string' ||
        (department && typeof department !== 'string')) {
      return res.status(400).json({ error: 'Os dados fornecidos contêm formatos inválidos.' });
    }

    displayName = cleanText(displayName, 120);
    role = cleanText(role, 20);
    department = cleanText(department || 'Suporte Técnico', 80);
    professionalCertification = cleanText(professionalCertification, 120);
    registrationNumber = cleanText(registrationNumber, 20);

    const caller = callerOf(req);
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Cargo inválido.' });
    }
    if (!canAssignRole(caller.role, role)) {
      return res.status(403).json({ error: 'Você não tem permissão para criar usuários com esse cargo.' });
    }
    if (displayName.length < 3) {
      return res.status(400).json({ error: 'Informe o nome completo do colaborador.' });
    }
    // Quem criou vem do token de quem chamou (antes vinha do corpo do pedido e podia ser falsificado)
    const createdBy = caller.uid;

    const db = admin.firestore();
    let regNum = registrationNumber;
    if (!regNum || regNum === 'PENDENTE' || regNum === 'TEMPORARY') {
      regNum = await generateUniqueRegistrationNumber(role, db);
    }

    const autoEmail = createEmailSlug(displayName);
    const tempPassword = generateSecurePassword();
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    let uid = '';
    let isVirtual = false;

    try {
      // 1. Attempt to create User in native Firebase Auth
      const userRecord = await admin.auth().createUser({
        email: autoEmail,
        emailVerified: true,
        password: tempPassword,
        displayName,
      });
      uid = userRecord.uid;
      
      try {
        await admin.auth().setCustomUserClaims(uid, { role });
      } catch {
        // ignore claims failure
      }
    } catch {
      // Seamless virtualization fallback when Identity Toolkit is disabled or without credentials
      isVirtual = true;
      uid = `VIRT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    // 2. Write User Profile Document
    const userProfile: any = {
      uid,
      displayName,
      email: autoEmail,
      role,
      department: department || 'Suporte Técnico',
      professionalCertification: professionalCertification || '',
      registrationNumber: regNum,
      status: 'offline',
      mustChangePassword: true,
      blocked: false,
      isVirtual,
      passwordHash,
      createdBy: createdBy || 'system_bootstrap',
      createdAt: new Date().toISOString(),
    };

    // Store in virtual users map for instant availability (pode manter o
    // hash aqui — é só memória do servidor, nunca é exposto ao cliente)
    virtualUsersMap.set(uid, userProfile);

    // O documento em users/{uid} é lido por qualquer funcionário logado
    // (agenda, chat, diretório da equipe...), então o hash da senha NUNCA
    // vai nele — fica só em user_credentials/{uid}, que o cliente não
    // consegue ler (ver firestore.rules).
    const { passwordHash: _omitHash, ...firestoreProfile } = userProfile;
    await setUserCredential(uid, passwordHash);

    try {
      await db.collection('users').doc(uid).set({
        ...firestoreProfile,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch {
      // Save via REST if config exists
      const config = getFirebaseConfig();
      if (config) {
        await saveFirestoreUserREST(uid, firestoreProfile);
      }
    }

    // 3. Envia as credenciais ao administrador — SÓ para o ADMIN_EMAIL configurado.
    // (Antes caía em "admin@agrogestao.com.br", endereço que não é da empresa.)
    const finalAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').trim();
    if (finalAdminEmail) {
      sendAdminCredentialsEmail(finalAdminEmail, {
        employeeName: displayName,
        email: autoEmail,
        registrationNumber: regNum,
        temporaryPassword: tempPassword,
        isCreation: true,
      }).catch(() => {});
    }

    // A senha temporária em texto puro só existe aqui, nesta requisição —
    // depois disso ela vira só o hash bcrypt salvo em user_credentials, e
    // ninguém mais consegue recuperá-la. Antes, ela só era enviada por
    // e-mail pro administrador (que exige SMTP configurado); sem SMTP
    // configurado (como no primeiro uso do sistema), a senha se perdia e o
    // colaborador recém-criado nunca conseguia fazer login. Agora também
    // devolvemos ela na resposta, pra tela de "Criar Colaborador" conseguir
    // mostrar (e colocar no PDF) a senha de verdade.
    return res.status(201).json({
      success: true,
      uid,
      email: autoEmail,
      registrationNumber: regNum,
      isVirtual,
      tempPassword,
      temporaryPassword: tempPassword,
    });
  } catch (error: any) {
    console.error('Erro na criação de colaborador:', error?.message || error);
    return res.status(500).json({ error: 'Falha ao processar a criação do colaborador.' });
  }
}

export async function deleteUser(req: Request, res: Response) {
  const { uid } = req.body;
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'UID do usuário é obrigatório para exclusão.' });
  }
  const caller = callerOf(req);
  if (caller.role !== 'admin') {
    return res.status(403).json({ error: 'Somente o Administrador pode excluir usuários.' });
  }
  if (uid === caller.uid) {
    return res.status(400).json({ error: 'Você não pode excluir a sua própria conta.' });
  }

  try {
    // Remove from in-memory virtual store
    virtualUsersMap.delete(uid);

    // Try deleting from Firebase Auth
    try {
      await admin.auth().deleteUser(uid);
    } catch {
      // ignore
    }

    // Try deleting from Firestore
    try {
      await admin.firestore().collection('users').doc(uid).delete();
    } catch {
      // ignore
    }

    return res.json({ success: true, message: 'Colaborador excluído com sucesso.' });
  } catch (err: any) {
    console.error('Erro ao excluir colaborador:', err);
    return res.status(500).json({ error: err.message || 'Erro ao excluir colaborador' });
  }
}

export async function resetPassword(req: Request, res: Response) {
  const { uid } = req.body;
  
  try {
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'Parâmetro UID do colaborador é obrigatório.' });
    }
    const caller = callerOf(req);
    const targetRole = await targetRoleOf(uid);
    // Admin redefine qualquer senha; RH só de Consultor/RH; Gerente não redefine.
    if (!(caller.role === 'admin' || (caller.role === 'hr' && (targetRole === 'consultant' || targetRole === 'hr' || targetRole === 'staff')))) {
      return res.status(403).json({ error: 'Você não tem permissão para redefinir a senha deste usuário.' });
    }

    const db = admin.firestore();
    
    let displayName = 'Funcionário';
    let email = 'sem_email@agro.com';
    let registrationNumber = 'S/M';
    
    // Check virtual store first
    const virtualUser = virtualUsersMap.get(uid);
    if (virtualUser) {
      displayName = virtualUser.displayName || displayName;
      email = virtualUser.email || email;
      registrationNumber = virtualUser.registrationNumber || registrationNumber;
    } else {
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
          const userData = userSnap.data()!;
          displayName = userData.displayName || displayName;
          email = userData.email || email;
          registrationNumber = userData.registrationNumber || registrationNumber;
        }
      } catch {
        try {
          const authUser = await admin.auth().getUser(uid);
          displayName = authUser.displayName || displayName;
          email = authUser.email || email;
        } catch {
          // ignore
        }
      }
    }

    const tempPassword = generateSecurePassword();
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    // Update in-memory store
    if (virtualUser) {
      virtualUser.passwordHash = passwordHash;
      virtualUser.mustChangePassword = true;
      virtualUsersMap.set(uid, virtualUser);
    }

    // 1. Update Password in Firebase Auth via Admin SDK (Attempt)
    try {
      await admin.auth().updateUser(uid, {
        password: await firebasePasswordFor(uid, tempPassword)
      });
    } catch {
      // ignore
    }

    // 2. O hash fica em user_credentials/{uid}, nunca em users/{uid}.
    await setUserCredential(uid, passwordHash);

    try {
      await db.collection('users').doc(uid).update({
        mustChangePassword: true,
        tempPassword: admin.firestore.FieldValue.delete(),
        temporaryPassword: admin.firestore.FieldValue.delete()
      });
    } catch {
      // ignore
    }

    // 3. Envia as credenciais só para o ADMIN_EMAIL configurado
    const finalAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').trim();
    if (finalAdminEmail) {
      sendAdminCredentialsEmail(finalAdminEmail, {
        employeeName: displayName || 'Funcionário',
        email: email || 'sem_email@agro.com',
        registrationNumber: registrationNumber || 'S/M',
        temporaryPassword: tempPassword,
        isCreation: false
      }).catch(() => {});
    }

    // Devolve a senha temporária para a tela mostrar ao administrador (como na
    // criação de colaborador). Antes só ia por e-mail — e sem SMTP configurado
    // a tela exibia um "SENHA123" que não era a senha de verdade.
    return res.json({
      success: true,
      message: 'Senha redefinida eletronicamente.',
      tempPassword,
    });
  } catch (error: any) {
    console.error('Erro ao redefinir senha do colaborador:', error);
    return res.status(500).json({ error: error.message || 'Erro durante a redefinição segura de senha' });
  }
}

export async function blockUser(req: Request, res: Response) {
  const { uid } = req.body;
  
  try {
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'UID do usuário requerido para bloqueio.' });
    }
    const caller = callerOf(req);
    if (caller.role !== 'admin') {
      return res.status(403).json({ error: 'Somente o Administrador pode bloquear usuários.' });
    }
    if (uid === caller.uid) {
      return res.status(400).json({ error: 'Você não pode bloquear a sua própria conta.' });
    }

    const virtualUser = virtualUsersMap.get(uid);
    if (virtualUser) {
      virtualUser.blocked = true;
      virtualUser.status = 'blocked';
      virtualUsersMap.set(uid, virtualUser);
    }

    // 1. Disable in Firebase Authentication (Attempt)
    try {
      await admin.auth().updateUser(uid, {
        disabled: true
      });
      await admin.auth().revokeRefreshTokens(uid);
    } catch {
      // ignore
    }

    // 2. Set profile flags in Firestore
    try {
      const db = admin.firestore();
      await db.collection('users').doc(uid).update({
        blocked: true,
        status: 'blocked'
      });
    } catch {
      // ignore
    }

    return res.json({ success: true, message: 'Usuário bloqueado e desautorizado no sistema.' });
  } catch (error: any) {
    console.error('Erro ao bloquear usuário:', error);
    return res.status(500).json({ error: error.message || 'Falha ao suspender conta de usuário' });
  }
}

export async function unblockUser(req: Request, res: Response) {
  const { uid } = req.body;
  
  try {
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'UID do usuário requerido para desbloqueio.' });
    }
    if (callerOf(req).role !== 'admin') {
      return res.status(403).json({ error: 'Somente o Administrador pode desbloquear usuários.' });
    }

    const virtualUser = virtualUsersMap.get(uid);
    if (virtualUser) {
      virtualUser.blocked = false;
      virtualUser.status = 'offline';
      virtualUsersMap.set(uid, virtualUser);
    }

    // 1. Enable account in Firebase Auth (Attempt)
    try {
      await admin.auth().updateUser(uid, {
        disabled: false
      });
    } catch {
      // ignore
    }

    // 2. Reset flags in Firestore
    try {
      const db = admin.firestore();
      await db.collection('users').doc(uid).update({
        blocked: false,
        status: 'offline'
      });
    } catch {
      // ignore
    }

    return res.json({ success: true, message: 'Usuário restabelecido com sucesso.' });
  } catch (error: any) {
    console.error('Erro ao reativar usuário:', error);
    return res.status(500).json({ error: error.message || 'Falha ao reativar conta de usuário' });
  }
}

export async function loginLog(req: Request, res: Response) {
  const { email, trackingId, status, ip, userAgent, error } = req.body;
  
  try {
    const config = getFirebaseConfig();
    if (isConfigPlaceholder(config)) {
      return res.json({ success: true });
    }

    const db = admin.firestore();
    // Rota pública: tudo é convertido em texto curto (evita encher o banco com lixo)
    // e o IP vem da própria conexão, não do que o cliente diz.
    const auditRecord = {
      email: cleanText(email || trackingId || 'unknown_user', 120),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: status === 'success' ? 'success' : 'failure',
      ip: cleanText(req.ip || '0.0.0.0', 64),
      userAgent: cleanText(userAgent || req.headers['user-agent'] || 'Desconhecido', 300),
      error: error ? cleanText(error, 300) : null,
      createdAt: new Date().toISOString()
    };

    try {
      await db.collection('login_logs').add(auditRecord);
    } catch {
      // ignore
    }
    
    return res.json({ success: true });
  } catch {
    return res.json({ success: true });
  }
}

// ─── Verificação em duas etapas (2FA) ────────────────────────────────────────

// Ticket entregue depois da senha correta, enquanto falta o código do 2FA.
const mfaTickets = new Map<string, { uid: string; expires: number; attempts: number }>();
const MFA_TICKET_TTL = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;

function issueMfaTicket(uid: string): string {
  const now = Date.now();
  for (const [t, rec] of mfaTickets) if (rec.expires < now) mfaTickets.delete(t);
  const ticket = crypto.randomBytes(24).toString('hex');
  mfaTickets.set(ticket, { uid, expires: now + MFA_TICKET_TTL, attempts: 0 });
  return ticket;
}

/** Senha aleatória que ninguém conhece, gravada no Firebase Auth. */
function unguessablePassword(): string {
  return crypto.randomBytes(32).toString('base64url') + 'aA1!';
}

/**
 * Senha que deve ficar gravada no Firebase Auth. Com o 2FA ligado, o login
 * passa SEMPRE pelo servidor (que confere senha + código e emite um token).
 * Se a senha real ficasse também no Firebase Auth, alguém com a senha
 * poderia entrar direto pelo Firebase e pular o código. Por isso, nesse caso,
 * o Firebase Auth recebe uma senha aleatória.
 */
async function firebasePasswordFor(uid: string, plain: string): Promise<string> {
  return activeTotp(await getCredentialDoc(uid)) ? unguessablePassword() : plain;
}

/**
 * Token para o app renovar a própria sessão depois de uma troca de senha
 * (a troca invalida as sessões abertas — o que é bom para OUTROS PCs, mas
 * derrubaria também quem acabou de trocar).
 */
async function freshSessionToken(uid: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    const role = snap.data()?.role;
    return await admin.auth().createCustomToken(uid, role ? { role } : undefined);
  } catch {
    return null;
  }
}

/** Resposta de login bem-sucedido (depois da senha e, se ligado, do 2FA). */
async function buildLoginSuccess(userData: any) {
  // A senha foi validada aqui (bcrypt), mas a senha do Firebase Auth pode
  // estar dessincronizada — e aí o app caía numa "sessão virtual" sem
  // login no Firebase, onde toda gravação no Firestore é negada. Com este
  // token o app entra no Firebase sem depender da senha de lá. Não é
  // emitido para usuários virtuais (só em memória, sem conta real).
  let firebaseToken: string | null = null;
  if (!userData.isVirtual) {
    try {
      try {
        await setRoleClaim(userData.uid, userData.role);
      } catch {
        // a claim também é gravada depois, por /api/sync-role-claim
      }
      firebaseToken = await admin.auth().createCustomToken(userData.uid, { role: userData.role });
    } catch (tokenErr: any) {
      console.warn('[loginUser] Não foi possível emitir token do Firebase (verifique o service-account.json):', tokenErr.message || tokenErr);
    }
  }

  return {
    success: true,
    user: {
      uid: userData.uid,
      displayName: userData.displayName,
      email: userData.email,
      role: userData.role,
      registrationNumber: userData.registrationNumber,
      mustChangePassword: !!userData.mustChangePassword,
      blocked: !!userData.blocked,
      department: userData.department || 'Suporte Técnico',
      professionalCertification: userData.professionalCertification || '',
      isVirtual: !!userData.isVirtual
    },
    isVirtual: !!userData.isVirtual,
    // Só quem acabou de provar que sabe a senha recebe este token, e só
    // ele permite trocar a senha logo em seguida (ver /api/update-password).
    passwordChangeToken: issuePasswordChangeToken(userData.uid),
    firebaseToken
  };
}

/**
 * Confere um código do aplicativo autenticador OU um código de recuperação.
 * Grava o uso (código TOTP não pode ser reaproveitado; código de recuperação
 * é apagado). Devolve true/false.
 */
async function checkSecondFactor(uid: string, totp: TotpConfig, code: string): Promise<boolean> {
  const ref = admin.firestore().collection('user_credentials').doc(uid);
  const step = verifyTotp(totp.secret, code, totp.lastStep ?? null);
  if (step !== null) {
    await ref.set({ totp: { ...totp, lastStep: step } }, { merge: true });
    return true;
  }
  const hashed = hashRecoveryCode(code);
  const codes = totp.recoveryCodes || [];
  if (String(code || '').replace(/[^A-Za-z0-9]/g, '').length === 10 && codes.includes(hashed)) {
    await ref.set({ totp: { ...totp, recoveryCodes: codes.filter(c => c !== hashed) } }, { merge: true });
    return true;
  }
  return false;
}

// POST /api/login/verify-2fa { ticket, code } — 2ª etapa do login
export async function verifyLogin2fa(req: Request, res: Response) {
  const { ticket, code } = req.body || {};
  if (typeof ticket !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'Informe o código de verificação.' });
  }
  const rec = mfaTickets.get(ticket);
  if (!rec || rec.expires < Date.now()) {
    mfaTickets.delete(ticket);
    return res.status(401).json({ error: 'O tempo para digitar o código acabou. Entre com sua senha novamente.', restart: true });
  }
  rec.attempts++;
  if (rec.attempts > MFA_MAX_ATTEMPTS) {
    mfaTickets.delete(ticket);
    return res.status(429).json({ error: 'Muitas tentativas com código errado. Entre com sua senha novamente.', restart: true });
  }

  try {
    const cred = await getCredentialDoc(rec.uid);
    const totp = activeTotp(cred);
    const snap = await admin.firestore().collection('users').doc(rec.uid).get();
    const userData = snap.exists ? { uid: rec.uid, ...snap.data() } as any : null;
    if (!userData || userData.blocked) {
      mfaTickets.delete(ticket);
      return res.status(403).json({ error: 'Acesso suspenso pelo Administrador.', restart: true });
    }
    // 2FA desligado entre a senha e o código (ex.: por outro administrador): segue o login normal.
    if (totp && !(await checkSecondFactor(rec.uid, totp, code))) {
      return res.status(401).json({ error: `Código incorreto ou já utilizado (${MFA_MAX_ATTEMPTS - rec.attempts} tentativa(s) restante(s)).` });
    }
    mfaTickets.delete(ticket);
    return res.json(await buildLoginSuccess(userData));
  } catch (error: any) {
    console.error('Erro na verificação em duas etapas:', error?.message || error);
    return res.status(500).json({ error: 'Falha ao verificar o código. Tente novamente.' });
  }
}

function require2faOwner(req: Request, res: Response): { uid: string; email: string } | null {
  const u = (req as any).user || {};
  if (!u.uid) {
    res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    return null;
  }
  if (u.role !== 'admin') {
    res.status(403).json({ error: 'A verificação em duas etapas está disponível para contas de Administrador.' });
    return null;
  }
  return { uid: String(u.uid), email: String(u.email || '') };
}

// GET /api/2fa/status
export async function twoFactorStatus(req: Request, res: Response) {
  const owner = require2faOwner(req, res);
  if (!owner) return;
  const totp = activeTotp(await getCredentialDoc(owner.uid));
  return res.json({
    enabled: !!totp,
    enabledAt: totp?.enabledAt || null,
    recoveryCodesLeft: totp?.recoveryCodes?.length ?? 0,
  });
}

// POST /api/2fa/setup — gera um segredo novo (ainda não ativo) e o QR Code
export async function twoFactorSetup(req: Request, res: Response) {
  const owner = require2faOwner(req, res);
  if (!owner) return;
  try {
    if (activeTotp(await getCredentialDoc(owner.uid))) {
      return res.status(400).json({ error: 'A verificação em duas etapas já está ativa nesta conta.' });
    }
    const secret = generateTotpSecret();
    await admin.firestore().collection('user_credentials').doc(owner.uid).set(
      { totpPending: { secret, createdAt: Date.now() } },
      { merge: true }
    );
    const url = otpauthUrl(secret, owner.email || owner.uid);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return res.json({ qrDataUrl, secret: secret.replace(/(.{4})/g, '$1 ').trim() });
  } catch (error: any) {
    console.error('Erro ao preparar 2FA:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível preparar a verificação em duas etapas.' });
  }
}

/** Confere a senha atual do usuário (bcrypt no servidor ou, se não houver, pelo Firebase Auth). */
async function checkCurrentPassword(uid: string, email: string, password: string): Promise<boolean> {
  const hash = await getUserCredentialHash(uid);
  if (hash) {
    if (hash.length === 64 && !hash.startsWith('$')) {
      const input = crypto.createHash('sha256').update(password).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(input));
    }
    return bcrypt.compareSync(password, hash);
  }
  const config = getFirebaseConfig();
  if (!config || !email) return false;
  try {
    const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const base = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
    const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data.localId === uid;
  } catch {
    return false;
  }
}

// POST /api/2fa/enable { code, currentPassword }
export async function twoFactorEnable(req: Request, res: Response) {
  const owner = require2faOwner(req, res);
  if (!owner) return;
  const { code, currentPassword } = req.body || {};
  if (typeof code !== 'string' || typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Informe sua senha atual e o código de 6 dígitos do aplicativo.' });
  }
  try {
    const cred = await getCredentialDoc(owner.uid);
    const pending = cred?.totpPending;
    if (!pending?.secret || Date.now() - pending.createdAt > 15 * 60 * 1000) {
      return res.status(400).json({ error: 'A configuração expirou. Clique em "Ativar" de novo para gerar outro QR Code.' });
    }
    if (!(await checkCurrentPassword(owner.uid, owner.email, currentPassword))) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    const step = verifyTotp(pending.secret, code);
    if (step === null) {
      return res.status(400).json({ error: 'Código incorreto. Confira se o horário do celular está certo e digite o código que aparece agora.' });
    }

    const recoveryCodes = generateRecoveryCodes();
    const ref = admin.firestore().collection('user_credentials').doc(owner.uid);
    await ref.set({
      // Garante que exista o hash da senha no servidor: com o 2FA ligado o
      // login só pode acontecer por ele (nunca direto pelo Firebase Auth).
      passwordHash: cred?.passwordHash || bcrypt.hashSync(currentPassword, 10),
      totp: {
        enabled: true,
        secret: pending.secret,
        enabledAt: new Date().toISOString(),
        lastStep: step,
        recoveryCodes: recoveryCodes.map(hashRecoveryCode),
      },
      totpPending: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Tira a senha real do Firebase Auth (ver firebasePasswordFor).
    try {
      await admin.auth().updateUser(owner.uid, { password: unguessablePassword() });
    } catch (e: any) {
      console.warn('[2FA] Não foi possível trocar a senha interna do Firebase Auth:', e?.message || e);
    }
    try {
      await admin.firestore().collection('users').doc(owner.uid).update({ twoFactorEnabled: true });
    } catch {
      // só informativo (a regra de verdade está em user_credentials)
    }
    // Trocar a senha interna do Firebase derruba todas as sessões abertas
    // (inclusive a desta tela). Mandamos uma sessão nova para este PC.
    return res.json({ success: true, recoveryCodes, firebaseToken: await freshSessionToken(owner.uid) });
  } catch (error: any) {
    console.error('Erro ao ativar 2FA:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível ativar a verificação em duas etapas.' });
  }
}

// POST /api/2fa/disable { code } — exige um código válido (ou de recuperação)
export async function twoFactorDisable(req: Request, res: Response) {
  const owner = require2faOwner(req, res);
  if (!owner) return;
  const { code } = req.body || {};
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Digite o código do aplicativo autenticador para desativar.' });
  }
  try {
    const totp = activeTotp(await getCredentialDoc(owner.uid));
    if (!totp) return res.json({ success: true });
    if (!(await checkSecondFactor(owner.uid, totp, code))) {
      return res.status(401).json({ error: 'Código incorreto.' });
    }
    await admin.firestore().collection('user_credentials').doc(owner.uid).set(
      { totp: admin.firestore.FieldValue.delete() },
      { merge: true }
    );
    try {
      await admin.firestore().collection('users').doc(owner.uid).update({ twoFactorEnabled: false });
    } catch {
      // só informativo
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao desativar 2FA:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível desativar a verificação em duas etapas.' });
  }
}

export async function loginUser(req: Request, res: Response) {
  const { id, password } = req.body;
  if (!id || !password) {
    return res.status(400).json({ error: 'Credenciais ou senha inválidas.' });
  }

  if (typeof id !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Os dados fornecidos contêm formatos inválidos.' });
  }

  try {
    const config = getFirebaseConfig();
    const queryId = id.trim().replace(/[<>]/g, '');
    const queryLower = queryId.toLowerCase();
    const queryUpper = queryId.toUpperCase();
    let userData: any = null;

    // Check virtual memory store first
    for (const u of virtualUsersMap.values()) {
      if (u.email?.toLowerCase() === queryLower || u.registrationNumber?.toUpperCase() === queryUpper) {
        userData = u;
        break;
      }
    }

    if (!userData && !isConfigPlaceholder(config)) {
      const db = admin.firestore();
      try {
        let userSnap;
        if (queryId.includes('@')) {
          const q = db.collection('users').where('email', '==', queryLower).limit(1);
          userSnap = await q.get();
        } else {
          const q = db.collection('users').where('registrationNumber', '==', queryUpper).limit(1);
          userSnap = await q.get();
        }

        if (userSnap && !userSnap.empty) {
          userData = userSnap.docs[0].data();
        }
      } catch {
        userData = queryId.includes('@')
          ? await queryUserREST('email', queryLower)
          : await queryUserREST('registrationNumber', queryUpper);
      }
    }

    // Mensagem única para "usuário não existe" e "senha errada": não revela
    // a quem tenta adivinhar quais e-mails/matrículas estão cadastrados.
    const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

    // SEGURANÇA: removido o antigo "sandbox" que, fora do modo produção, criava
    // na hora um usuário virtual (inclusive ADMINISTRADOR, se o e-mail tivesse
    // "douglas") para qualquer login desconhecido.
    if (!userData) {
      return res.status(401).json({ error: INVALID_CREDENTIALS });
    }

    // Usuários "virtuais" (só em memória) ainda carregam o hash junto —
    // nunca passou pelo Firestore. Usuários reais têm o hash separado em
    // user_credentials/{uid} (ver comentário acima de getUserCredentialHash).
    const credentialHash: string | null =
      userData.passwordHash || (!userData.isVirtual ? await getUserCredentialHash(userData.uid) : null);

    if (credentialHash) {
      const isLegacySha256 = credentialHash.length === 64 && !credentialHash.startsWith('$');
      const inputHash = crypto.createHash('sha256').update(password).digest('hex');

      const isMatch = isLegacySha256
        ? crypto.timingSafeEqual(Buffer.from(credentialHash), Buffer.from(inputHash))
        : bcrypt.compareSync(password, credentialHash);

      if (isMatch && userData.blocked) {
        // Só revela o bloqueio a quem acertou a senha.
        return res.status(403).json({ error: 'Acesso suspenso pelo Administrador.' });
      }

      if (isMatch && isLegacySha256 && !userData.isVirtual) {
        // Senha antiga em SHA-256 sem "sal" (fraca): converte para bcrypt agora que a senha foi confirmada.
        await setUserCredential(userData.uid, bcrypt.hashSync(password, 10)).catch(() => {});
      }

      if (isMatch) {
        // Verificação em duas etapas ligada: a senha certa ainda NÃO libera o
        // acesso — devolve só um "ticket" de 5 minutos que precisa ser trocado
        // pelo código do aplicativo autenticador em /api/login/verify-2fa.
        if (!userData.isVirtual && activeTotp(await getCredentialDoc(userData.uid))) {
          return res.json({ success: false, mfaRequired: true, mfaTicket: issueMfaTicket(userData.uid) });
        }
        return res.json(await buildLoginSuccess(userData));
      } else {
        return res.status(401).json({ error: INVALID_CREDENTIALS });
      }
    }

    // Sem hash no servidor: quem confere a senha é o Firebase Auth no app.
    // Devolve SÓ o e-mail (necessário para entrar com matrícula) — antes devolvia
    // nome, cargo, matrícula etc. para qualquer um, sem senha nenhuma.
    return res.status(202).json({
      success: false,
      useNativeAuth: true,
      email: userData.email,
    });

  } catch (error: any) {
    console.error('Erro na autenticação de colaborador:', error);
    return res.status(500).json({ error: 'Falha durante o processamento do login.' });
  }
}

export async function updateUserPassword(req: Request, res: Response) {
  const { uid, newPassword, passwordChangeToken } = req.body;

  if (!uid || !newPassword || typeof uid !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'UID e nova senha são obrigatórios.' });
  }
  // Política mínima de senha
  if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres, com letras e números.' });
  }

  // Quem pode trocar: (a) quem acabou de fazer login com a senha correta
  // (token de uso único), ou (b) o próprio dono da conta com sessão válida do
  // Firebase (token no cabeçalho Authorization com o MESMO uid). Sem uma das
  // duas, qualquer pessoa que soubesse um uid trocaria a senha de outra conta.
  // O (b) evita o erro "sessão inválida" na tela de primeiro acesso quando o
  // usuário recarrega a janela ou o servidor foi reiniciado depois do login.
  let authorized = !!passwordChangeToken && consumePasswordChangeToken(uid, passwordChangeToken);
  let sessionEmail = '';
  if (!authorized) {
    const header = req.headers.authorization || '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken, true);
        authorized = decoded.uid === uid;
        sessionEmail = decoded.email || '';
      } catch {
        authorized = false;
      }
    }
    // Troca "normal" (Meu Perfil → Alterar Minha Senha) com sessão aberta:
    // exige a senha atual, para que alguém que encontre o PC destravado não
    // consiga trocar a senha. No primeiro acesso (senha temporária) não precisa.
    if (authorized) {
      let mustChange = !!virtualUsersMap.get(uid)?.mustChangePassword;
      try {
        const snap = await admin.firestore().collection('users').doc(uid).get();
        mustChange = mustChange || !!snap.data()?.mustChangePassword;
      } catch { /* sem leitura: exige a senha atual */ }
      if (!mustChange) {
        const { currentPassword } = req.body;
        if (typeof currentPassword !== 'string' || !currentPassword ||
            !(await checkCurrentPassword(uid, sessionEmail, currentPassword))) {
          return res.status(401).json({ error: 'Senha atual incorreta.' });
        }
      }
    }
  }
  if (!authorized) {
    return res.status(401).json({
      error: 'Sessão de troca de senha inválida ou expirada. Faça login novamente e tente outra vez.'
    });
  }

  try {
    const db = admin.firestore();

    // A senha temporária (primeiro acesso / redefinida pelo administrador) não
    // pode ser "trocada" por ela mesma — senão continuaria valendo para sempre.
    const currentHash = virtualUsersMap.get(uid)?.passwordHash || await getUserCredentialHash(uid);
    if (currentHash && currentHash.startsWith('$') && bcrypt.compareSync(newPassword, currentHash)) {
      return res.status(400).json({ error: 'A nova senha precisa ser diferente da senha atual/temporária.' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    const virtualUser = virtualUsersMap.get(uid);
    if (virtualUser) {
      virtualUser.passwordHash = passwordHash;
      virtualUser.mustChangePassword = false;
      virtualUsersMap.set(uid, virtualUser);
    }

    try {
      await admin.auth().updateUser(uid, {
        password: await firebasePasswordFor(uid, newPassword)
      });
    } catch {
      // ignore
    }

    await setUserCredential(uid, passwordHash);

    try {
      await db.collection('users').doc(uid).update({
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString(),
      });
    } catch {
      // Documento pode ainda não existir com esse campo — não é crítico,
      // o hash em user_credentials já foi atualizado acima.
    }

    return res.json({
      success: true,
      message: 'Senha atualizada corporativamente com sucesso!',
      // (virtualUsersMap também guarda usuários reais recém-criados — o que
      // importa é a flag isVirtual)
      firebaseToken: virtualUser?.isVirtual ? null : await freshSessionToken(uid),
    });
  } catch (error: any) {
    console.error('Erro na alteração de senha:', error);
    return res.status(500).json({ error: error.message || 'Falha ao processar redefinição de senha' });
  }
}
