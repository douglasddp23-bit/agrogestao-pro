import { Router } from 'express';
import { requireManager } from '../middlewares/authMiddleware';
import { userLimiter } from '../middlewares/security';
import { cancelFiscal, consultFiscal, emitFiscal, fiscalStatus, retryFiscal } from '../controllers/fiscalController';

// Documentos fiscais: Gerente e Administrador (fiscal.emitir / fiscal.cancelar),
// iguais às regras do banco. Consultor/RH recebem 403.
const router = Router();
const fiscalLimiter = userLimiter({ windowMs: 15 * 60 * 1000, max: 60, message: 'Muitas operações fiscais seguidas. Aguarde alguns minutos.' });

router.get('/status', requireManager, fiscalStatus);
router.post('/emit', requireManager, fiscalLimiter, emitFiscal);
router.post('/consult', requireManager, fiscalLimiter, consultFiscal);
router.post('/retry', requireManager, fiscalLimiter, retryFiscal);
router.post('/cancel', requireManager, fiscalLimiter, cancelFiscal);

export default router;
