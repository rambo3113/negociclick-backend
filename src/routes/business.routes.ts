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
} from '../controllers/business.controller';
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
router.post('/:id/view', recordView);

// Rutas protegidas
router.get('/:id/analytics', authenticate, getAnalytics);
router.post('/', authenticate, createBusiness);
router.put('/:id', authenticate, updateBusiness);
router.put('/:id/profile', authenticate, updateBusinessProfile);
router.post('/:id/cover', authenticate, upload.single('cover'), uploadCoverImage);
router.delete('/:id', authenticate, deleteBusiness);

export default router;