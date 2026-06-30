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
import { validate } from '../middleware/validate.middleware';
import { createServiceSchema } from '../lib/schemas';

const router = Router();

// Públicas
router.get('/business/:businessId', getServicesByBusiness);
router.get('/:id', getServiceById);

// Protegidas
router.post('/', authenticate, planGuard, validate(createServiceSchema), createService);
router.put('/:id', authenticate, updateService);
router.delete('/:id', authenticate, deleteService);
router.post('/:id/photo', authenticate, upload.single('photo'), uploadServicePhoto);

export default router;
