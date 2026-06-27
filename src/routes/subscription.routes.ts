import { Router } from 'express';
import {
  getMySubscription,
  subscribe,
  subscribePaid,
  cancelSubscription,
  getSubscriptionHistory,
  getAllSubscriptions,
  getPlans,
  refundSubscription,
} from '../controllers/subscription.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();

// Pública
router.get('/plans', getPlans);

// Protegidas
router.use(authenticate);
router.get('/my', getMySubscription);
router.get('/history', getSubscriptionHistory);
router.post('/', subscribe);
router.post('/pay', subscribePaid);
router.delete('/cancel', cancelSubscription);

// Solo admin
router.get('/', requireAdmin, getAllSubscriptions);
router.post('/:id/refund', requireAdmin, refundSubscription);

export default router;
