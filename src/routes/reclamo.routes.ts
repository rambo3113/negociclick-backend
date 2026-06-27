import { Router } from 'express';
import { createReclamo } from '../controllers/reclamo.controller';

const router = Router();

router.post('/', createReclamo);

export default router;
