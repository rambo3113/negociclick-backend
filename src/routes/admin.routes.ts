import { Router } from 'express';
import {
  getAdminStats,
  getAllUsers,
  getAllBusinessesAdmin,
  getFeaturedPaymentsAdmin,
  updateUserRole,
  toggleBusinessActive,
  getAuditLogs,
} from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { validate } from '../middleware/validate.middleware';
import { updateRoleSchema } from '../lib/schemas';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/stats',                  getAdminStats);
router.get('/users',                  getAllUsers);
router.get('/businesses',             getAllBusinessesAdmin);
router.get('/featured-payments',      getFeaturedPaymentsAdmin);
router.put('/users/:id/role',         validate(updateRoleSchema), updateUserRole);
router.put('/businesses/:id/toggle',  toggleBusinessActive);
router.get('/audit-logs',             getAuditLogs);

export default router;
