import { Router } from 'express';
import { getHours, upsertHours } from '../controllers/hours.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true }); // hereda :id de businesses

router.get('/', getHours);
router.put('/', authenticate, upsertHours);

export default router;
