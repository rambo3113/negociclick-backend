// src/routes/business.routes.ts
import { Router } from 'express';
import {
  createBusiness,
  getAllBusinesses,
  getBusinessById,
  updateBusiness,
  deleteBusiness,
  getMyBusinesses,
  uploadCoverImage,
  updateBusinessProfile,
  uploadHeroBanner,
  getDeliveryMethods,
} from '../controllers/business.controller';
import { getReviewsByBusiness, createBusinessReview } from '../controllers/review.controller';
import {
  getPaymentConfig,
  upsertPaymentConfig,
  deletePaymentConfig,
  updatePaymentInstructions,
} from '../controllers/paymentConfig.controller';
import { recordView, getAnalytics } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateQuery } from '../middleware/validate.middleware';
import { searchQuerySchema } from '../lib/schemas';
import { upload } from '../lib/upload';

const router = Router();

// Rutas públicas
router.get('/', validateQuery(searchQuerySchema), getAllBusinesses);
router.get('/my', authenticate, getMyBusinesses);
router.get('/:id', getBusinessById);
router.get('/:id/delivery-methods', getDeliveryMethods);
router.post('/:id/view', recordView);

// Rutas protegidas
router.get('/:id/analytics', authenticate, getAnalytics);
router.post('/', authenticate, createBusiness);
router.put('/:id', authenticate, updateBusiness);
router.put('/:id/profile', authenticate, updateBusinessProfile);
router.post('/:id/cover', authenticate, upload.single('cover'), uploadCoverImage);
router.post('/:id/hero', authenticate, upload.single('hero'), uploadHeroBanner);
router.get('/:id/reviews', getReviewsByBusiness);
router.post('/:id/reviews', authenticate, createBusinessReview);
router.delete('/:id', authenticate, deleteBusiness);

// Cobros por negocio
router.get('/:id/payment-config', authenticate, getPaymentConfig);
router.put('/:id/payment-config', authenticate, upsertPaymentConfig);
router.delete('/:id/payment-config', authenticate, deletePaymentConfig);
router.put('/:id/payment-instructions', authenticate, updatePaymentInstructions);

export default router;