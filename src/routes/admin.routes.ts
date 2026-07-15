import { Router } from 'express';
import {
  getAdminStats,
  getAllUsers,
  getAdminBusinessesList,
  getAdminSubscriptions,
  getAdminPayments,
  getAdminReports,
  resolveReport,
  suspendBusiness,
  reactivateBusiness,
  getAdminLogs,
  updateUserRole,
  getFeaturedPaymentsAdmin,
} from '../controllers/admin.controller';
import {
  grantTrial,
  revokeTrial,
  getTrials,
  getTrialStats,
  getBusinessTrials,
  extendTrial,
} from '../controllers/trials.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { validate } from '../middleware/validate.middleware';
import { updateRoleSchema } from '../lib/schemas';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/stats',                          getAdminStats);
router.get('/users',                          getAllUsers);
router.put('/users/:id/role',                 validate(updateRoleSchema), updateUserRole);
router.get('/businesses',                     getAdminBusinessesList);
router.post('/businesses/:id/suspend',        suspendBusiness);
router.post('/businesses/:id/reactivate',     reactivateBusiness);
router.get('/subscriptions',                  getAdminSubscriptions);
router.get('/payments',                       getAdminPayments);
router.get('/reports',                        getAdminReports);
router.post('/reports/:id/resolve',           resolveReport);
router.get('/logs',                           getAdminLogs);
router.get('/featured-payments',              getFeaturedPaymentsAdmin);

// ── Trials manuales ───────────────────────────────────────────────────────────
router.get('/trials/stats',                   getTrialStats);
router.get('/trials/:businessId',             getBusinessTrials);
router.get('/trials',                         getTrials);
router.post('/trials/grant',                  grantTrial);
router.post('/trials/revoke',                 revokeTrial);
router.post('/trials/extend',                 extendTrial);

export default router;
