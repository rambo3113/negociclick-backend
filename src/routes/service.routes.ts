import { Router } from 'express';
import {
  createService,
  getServicesByBusiness,
  getServiceById,
  updateService,
  deleteService,
  uploadServicePhoto,
} from '../controllers/service.controller';
import { authenticate } from '../middleware/auth.middleware';
import { planGuard } from '../middleware/planGuard.middleware';
import { upload } from '../lib/upload';

const router = Router();

// Públicas
router.get('/business/:businessId', getServicesByBusiness);
router.get('/:id', getServiceById);

// Protegidas
router.post('/', authenticate, planGuard, createService);
router.put('/:id', authenticate, updateService);
router.delete('/:id', authenticate, deleteService);
router.post('/:id/photo', authenticate, upload.single('photo'), uploadServicePhoto);

export default router;
