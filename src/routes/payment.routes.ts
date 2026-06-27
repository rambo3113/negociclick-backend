import { Router } from 'express';
import {
  initiatePayment,
  chargePayment,
  refundPayment,
  getMyPayments,
  getPaymentById,
  getAllPayments,
  handleWebhook,
} from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { verifyCulqiWebhook } from '../middleware/verifyWebhook';

const router = Router();

// Webhook de Culqi — sin autenticación JWT, solo verificación HMAC
router.post('/webhook', verifyCulqiWebhook, handleWebhook);

router.use(authenticate);

router.post('/', initiatePayment);
router.post('/:id/charge', chargePayment);
router.get('/my', getMyPayments);
router.get('/:id', getPaymentById);

router.post('/:id/refund', requireAdmin, refundPayment);
router.get('/', requireAdmin, getAllPayments);

export default router;
