import { Router } from 'express';
import {
  createBooking,
  getMyBookings,
  getBookingsByBusiness,
  getBookingById,
  updateBookingStatus,
  rescheduleBooking,
  cancelBooking,
  markAsPaid,
  getEarnings,
  getAvailableSlots,
} from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createBookingSchema } from '../lib/schemas';

const router = Router();

// Pública — el cliente necesita ver slots antes de autenticarse
router.get('/slots/:serviceId', getAvailableSlots);

// Todas las demás requieren autenticación
router.use(authenticate);

router.post('/', validate(createBookingSchema), createBooking);
router.get('/my', getMyBookings);
router.get('/business/:businessId', getBookingsByBusiness);
router.get('/business/:businessId/earnings', getEarnings);
router.get('/:id', getBookingById);
router.put('/:id/status', updateBookingStatus);
router.put('/:id/reschedule', rescheduleBooking);
router.post('/:id/mark-paid', markAsPaid);
router.delete('/:id', cancelBooking);

export default router;
