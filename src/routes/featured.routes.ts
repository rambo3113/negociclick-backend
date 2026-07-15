import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { featuredSchema } from '../lib/schemas';
import {
  getFeaturedPricing,
  getFeaturedStatus,
  purchaseFeatured,
  cancelFeatured,
  getFeaturedHistory,
} from '../controllers/featured.controller';

const router = Router({ mergeParams: true });

router.get('/pricing', getFeaturedPricing);
router.get('/status', authenticate, getFeaturedStatus);
router.get('/history', authenticate, getFeaturedHistory);
router.post('/', authenticate, validate(featuredSchema), purchaseFeatured);
router.delete('/', authenticate, cancelFeatured);

export default router;
