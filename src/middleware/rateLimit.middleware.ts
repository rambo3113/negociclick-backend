import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

const skipInTest = (_req: Request) => process.env.NODE_ENV === 'test';

const ip = (req: Request) => ipKeyGenerator(req.ip ?? '');

const base: Partial<Options> = {
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
};

// ── 1. LOGIN — 5 intentos / 15 min, key = email del body (fallback: IP) ──────
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req: Request) => {
    const email = (req.body?.email as string | undefined)?.toLowerCase().trim();
    return email ? `login:${email}` : ip(req);
  },
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta en 15 minutos.' },
  skipSuccessfulRequests: true,   // solo cuenta intentos fallidos
});

// ── 2. REGISTRO — 3 registros / hora, key = IP ───────────────────────────────
export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req: Request) => ip(req),
  message: { error: 'Demasiados registros desde esta dirección. Intenta en 1 hora.' },
});

// ── 3. BÚSQUEDA — 30 búsquedas / minuto, key = IP ───────────────────────────
export const searchLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => ip(req),
  message: { error: 'Demasiadas búsquedas seguidas. Espera un momento e intenta de nuevo.' },
});

// ── 4. PAGOS — 10 intentos / minuto, key = IP ───────────────────────────────
export const paymentLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => ip(req),
  message: { error: 'Demasiados intentos de pago. Espera un momento.' },
});

// ── 5. RECUPERACIÓN DE CONTRASEÑA — 5 intentos / hora, key = IP ──────────────
export const forgotPasswordLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req: Request) => ip(req),
  message: { error: 'Demasiados intentos de recuperación. Espera una hora antes de volver a intentarlo.' },
});

// ── 6b. REENVÍO DE VERIFICACIÓN DE EMAIL — 1 intento / minuto, key = userId ──
export const resendVerificationLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (req: Request) => {
    const userId = (req as any).userId as string | undefined;
    return userId ? `resend-verify:${userId}` : ip(req);
  },
  message: { error: 'Espera un minuto antes de solicitar otro correo de verificación.' },
});

// ── 6. API GENERAL — 1000 requests / 15 min, key = IP ───────────────────────
export const generalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req: Request) => ip(req),
  message: { error: 'Demasiadas solicitudes. Intenta en 15 minutos.' },
  skip: (req: Request) => {
    // Health check y assets estáticos no cuentan
    if (process.env.NODE_ENV === 'test') return true;
    if (req.path === '/health') return true;
    // GET requests son de solo lectura, sin riesgo
    if (req.method === 'GET') return true;
    return false;
  },
});

// Alias para compatibilidad con imports anteriores
export const authLimiter = loginLimiter;
