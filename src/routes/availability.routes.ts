import { Router } from 'express';
import { getAvailabilityBlocks, createAvailabilityBlock, deleteAvailabilityBlock } from '../controllers/availability.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true });

router.get('/', getAvailabilityBlocks);
router.post('/', authenticate, createAvailabilityBlock);
router.delete('/:blockId', authenticate, deleteAvailabilityBlock);

export default router;
