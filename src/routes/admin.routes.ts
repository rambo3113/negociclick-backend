import { Router } from 'express';
import {
  getAdminStats,
  getAllUsers,
  getAllBusinessesAdmin,
  getFeaturedPaymentsAdmin,
  updateUserRole,
  toggleBusinessActive,
} from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/stats',                  getAdminStats);
router.get('/users',                  getAllUsers);
router.get('/businesses',             getAllBusinessesAdmin);
router.get('/featured-payments',      getFeaturedPaymentsAdmin);
router.put('/users/:id/role',         updateUserRole);
router.put('/businesses/:id/toggle',  toggleBusinessActive);

export default router;
