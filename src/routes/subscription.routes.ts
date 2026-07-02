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
  activateTrial,
} from '../controllers/subscription.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { validate } from '../middleware/validate.middleware';
import { subscriptionSchema } from '../lib/schemas';

const router = Router();

// Pública
router.get('/plans', getPlans);

// Protegidas
router.use(authenticate);
router.get('/my', getMySubscription);
router.get('/history', getSubscriptionHistory);
router.post('/', subscribe);
router.post('/trial', activateTrial);
router.post('/pay', validate(subscriptionSchema), subscribePaid);
router.delete('/cancel', cancelSubscription);

// Solo admin
router.get('/', requireAdmin, getAllSubscriptions);
router.post('/:id/refund', requireAdmin, refundSubscription);

export default router;
