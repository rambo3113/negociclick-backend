import { Router } from 'express';
import {
  createReview,
  getReviewsByBusiness,
  getMyReviews,
  updateReview,
  deleteReview,
  replyToReview
} from '../controllers/review.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Públicas
router.get('/business/:businessId', getReviewsByBusiness);

// Protegidas
router.use(authenticate);
router.post('/', createReview);
router.get('/my', getMyReviews);
router.put('/:id', updateReview);
router.post('/:id/reply', replyToReview);
router.delete('/:id', deleteReview);

export default router;
