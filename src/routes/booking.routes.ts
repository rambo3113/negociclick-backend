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
  getAgenda,
  getAvailableSlots,
  getAvailableSlotsMultipleDays,
  getCalendarAvailability,
  getBookingTimeline,
  sendBookingReminder,
} from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createBookingSchema } from '../lib/schemas';

const router = Router();

// Pública — el cliente necesita ver slots antes de autenticarse
router.get('/slots/:serviceId', getAvailableSlots);
router.get('/slots-multi/:serviceId', getAvailableSlotsMultipleDays);
router.get('/calendar/:businessId', getCalendarAvailability);

// Todas las demás requieren autenticación
router.use(authenticate);

router.post('/', validate(createBookingSchema), createBooking);
router.get('/my', getMyBookings);
router.get('/business/:businessId', getBookingsByBusiness);
router.get('/business/:businessId/earnings', getEarnings);
router.get('/business/:businessId/agenda',  getAgenda);
router.get('/:id', getBookingById);
router.get('/:id/timeline', getBookingTimeline);
router.put('/:id/status', updateBookingStatus);
router.put('/:id/reschedule', rescheduleBooking);
router.post('/:id/mark-paid', markAsPaid);
router.post('/:id/send-reminder', sendBookingReminder);
router.delete('/:id', cancelBooking);

export default router;
