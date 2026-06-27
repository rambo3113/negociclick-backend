import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Solo omitir en tests automatizados — siempre activo en dev y producción
const skipInDev = (_req: Request) => process.env.NODE_ENV === 'test';

// Login y registro: max 10 intentos por 15 minutos por IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipInDev,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' },
});

// Pagos: max 10 intentos por minuto por IP
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: skipInDev,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de pago. Espera un momento.' },
});

// General: max 200 requests por 15 minutos por IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  skip: skipInDev,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta más tarde.' },
});
