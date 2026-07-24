import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../lib/upload';
import {
  createProfessional,
  updateProfessional,
  uploadProfessionalPhoto,
  deleteProfessional,
  getProfessionals,
  updateProfessionalSchedule,
  getProfessionalSchedules,
} from '../controllers/professional.controller';

const router = Router();

// Públicas
router.get('/schedules/:professionalId', getProfessionalSchedules);
router.get('/:businessId', getProfessionals);

// Autenticadas (dueño del negocio)
router.post('/:businessId/create', authenticate, createProfessional);
router.put('/:businessId/:professionalId', authenticate, updateProfessional);
router.post('/:businessId/:professionalId/photo', authenticate, upload.single('photo'), uploadProfessionalPhoto);
router.delete('/:businessId/:professionalId', authenticate, deleteProfessional);
router.put('/schedule/:businessId/:professionalId', authenticate, updateProfessionalSchedule);

export default router;
