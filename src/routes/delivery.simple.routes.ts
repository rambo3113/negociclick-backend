import express from 'express';
import { getDeliveryMethods } from '../controllers/delivery.simple.controller';

const router = express.Router();

// PUBLIC: Get delivery methods for booking
router.get('/:businessId/delivery-methods', getDeliveryMethods);

export default router;
