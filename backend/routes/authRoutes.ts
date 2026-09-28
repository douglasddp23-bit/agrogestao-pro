import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin } from '../middlewares/authMiddleware';
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
  syncUserClaim
} from '../controllers/authController';

const router = Router();

// Rate limiter for login endpoint based on IP and email/matriculation
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP + login ID combination to 5 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Excesso de tentativas de login. Por razões de segurança, tente novamente em 15 minutos.' },
  keyGenerator: (req) => {
    const loginId = String(req.body.id || '').trim().toLowerCase();
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

// General public API limiter (for logs, etc)
const authApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições recebidas. Tente novamente mais tarde.' },
  validate: false
});

// Logging / Audit (Public Access so we can audit failures client-side too)
router.post('/login-log', authApiLimiter, loginLog);

// Public / Self Auth routes for employees (Virtual Fallback)
router.post('/login', loginIpLimiter, loginLimiter, loginUser);
router.post('/update-password', loginIpLimiter, loginLimiter, updateUserPassword);
router.post('/sync-role-claim', authApiLimiter, syncRoleClaim);

// Administration & Security Operations (Exclusively Protected by requireAdmin Middleware)
router.post('/create-user', requireAdmin, createUser);
router.post('/delete-user', requireAdmin, deleteUser);
router.post('/admin/reset-password', requireAdmin, resetPassword);
router.post('/block-user', requireAdmin, blockUser);
router.post('/unblock-user', requireAdmin, unblockUser);
router.post('/sync-user-claim', requireAdmin, syncUserClaim);

export default router;
