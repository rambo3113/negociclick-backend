import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { featuredSchema } from '../lib/schemas';
import { getFeaturedPricing, getFeaturedStatus, purchaseFeatured } from '../controllers/featured.controller';

const router = Router({ mergeParams: true });

router.get('/pricing', getFeaturedPricing);
router.get('/status', authenticate, getFeaturedStatus);
router.post('/', authenticate, validate(featuredSchema), purchaseFeatured);

export default router;
