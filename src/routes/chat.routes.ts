import { Router } from 'express';
import { chat } from '../controllers/chat.controller';
import rateLimit from 'express-rate-limit';

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: (_req) => process.env.NODE_ENV === 'test',
  message: { error: 'Demasiados mensajes. Espera un momento.' },
});

const router = Router();
router.post('/', chatLimiter, chat);

export default router;
