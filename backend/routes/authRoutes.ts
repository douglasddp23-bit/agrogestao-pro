import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin, requireAuth } from '../middlewares/authMiddleware';
import {
  createUser,
  deleteUser,
  resetPassword,
  blockUser,
  unblockUser,
  loginLog,
  loginUser,
  updateUserPassword,
  syncRoleClaim,
  syncUserClaim,
  verifyLogin2fa,
  twoFactorStatus,
  twoFactorSetup,
  twoFactorEnable,
  twoFactorDisable,
  passwordStatus
} from '../controllers/authController';
import { backupStatus, runBackupNow } from '../services/backupService';
import { userLimiter } from '../middlewares/security';

const router = Router();

// Rate limiter for login endpoint based on IP and email/matriculation
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP + login ID combination to 5 failed requests per 15 minutes
  // Só as tentativas que FALHAM contam: antes, entrar e sair 5 vezes seguidas
  // (ou trocar a senha logo após o login) já bloqueava a pessoa por 15 minutos.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Excesso de tentativas de login. Por razões de segurança, tente novamente em 15 minutos.' },
  keyGenerator: (req) => {
    const loginId = String(req.body.id || req.body.uid || '').trim().toLowerCase();
    // Unique key: Client IP combined with attempt ID
    return `${req.ip}_${loginId}`;
  },
  validate: false
});

// Limite geral por IP (independente do e-mail/matrícula tentado): impede testar
// senhas trocando de conta a cada tentativa ("password spraying").
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login a partir deste computador. Aguarde 15 minutos.' },
  validate: false
});

// Limite POR CONTA (independente do computador/IP): no máximo 10 senhas erradas
// a cada 15 minutos para o mesmo e-mail/matrícula — impede o ataque distribuído
// a uma única conta.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Esta conta recebeu muitas tentativas de senha errada. Por segurança, aguarde 15 minutos.' },
  keyGenerator: (req) => `acct_${String(req.body?.id || req.body?.uid || '').trim().toLowerCase().slice(0, 200)}`,
  validate: false
});

// Ações de administração (criar conta, redefinir senha, bloquear, backup):
// contadas por usuário logado.
const adminActionLimiter = userLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas ações administrativas seguidas. Aguarde alguns minutos.',
});
const backupRunLimiter = userLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: 'O backup manual já foi executado várias vezes nesta hora. Aguarde.',
});

// General public API limiter (for logs, etc)
const authApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições recebidas. Tente novamente mais tarde.' },
  validate: false
});

// Ativar/desativar 2FA: poucas tentativas (cada uma confere senha ou código)
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  validate: false
});

// Logging / Audit (Public Access so we can audit failures client-side too)
router.post('/login-log', authApiLimiter, loginLog);

// Public / Self Auth routes for employees (Virtual Fallback)
router.post('/login', loginIpLimiter, loginAccountLimiter, loginLimiter, loginUser);
router.post('/login/verify-2fa', loginIpLimiter, verifyLogin2fa);
router.post('/update-password', loginIpLimiter, loginAccountLimiter, loginLimiter, updateUserPassword);
router.post('/sync-role-claim', authApiLimiter, syncRoleClaim);
// Validade da senha de quem está logado (aviso "sua senha vence em X dias")
router.get('/password-status', authApiLimiter, requireAuth, passwordStatus);

// Verificação em duas etapas da própria conta (tela Meu Perfil — Administrador)
router.get('/2fa/status', authApiLimiter, requireAuth, twoFactorStatus);
router.post('/2fa/setup', twoFactorLimiter, requireAuth, twoFactorSetup);
router.post('/2fa/enable', twoFactorLimiter, requireAuth, twoFactorEnable);
router.post('/2fa/disable', twoFactorLimiter, requireAuth, twoFactorDisable);

// Administration & Security Operations (Exclusively Protected by requireAdmin Middleware)
router.post('/create-user', requireAdmin, adminActionLimiter, createUser);
router.post('/delete-user', requireAdmin, adminActionLimiter, deleteUser);
router.post('/admin/reset-password', requireAdmin, adminActionLimiter, resetPassword);
router.post('/block-user', requireAdmin, adminActionLimiter, blockUser);
router.post('/unblock-user', requireAdmin, adminActionLimiter, unblockUser);
router.post('/sync-user-claim', requireAdmin, adminActionLimiter, syncUserClaim);

// Backup do banco de dados (só Administrador — conferido dentro das funções)
router.get('/admin/backup/status', requireAdmin, adminActionLimiter, backupStatus);
router.post('/admin/backup/run', requireAdmin, backupRunLimiter, runBackupNow);

export default router;
