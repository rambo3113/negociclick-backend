// src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import serviceRoutes from './routes/service.routes';
import bookingRoutes from './routes/booking.routes';
import reviewRoutes from './routes/review.routes';
import subscriptionRoutes from './routes/subscription.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import hoursRoutes from './routes/hours.routes';
import photosRoutes from './routes/photos.routes';
import { startCancelExpiredBookings } from './jobs/cancelExpiredBookings';
import { startAppointmentReminders } from './jobs/appointmentReminder';
import { startCleanupTokens } from './jobs/cleanupTokens';
import { startCleanupRefreshTokens } from './jobs/cleanupRefreshTokens';
import { startExpireSubscriptions } from './jobs/expireSubscriptions';
import { startExpireFeatured } from './jobs/expireFeatured';
import { startExpireManualTrials } from './jobs/expireManualTrials';
import reclamoRoutes from './routes/reclamo.routes';
import chatRoutes from './routes/chat.routes';
import featuredRoutes from './routes/featured.routes';
import professionalRoutes from './routes/professional.routes';
import {
  loginLimiter,
  loginIpLimiter,
  registerLimiter,
  searchLimiter,
  paymentLimiter,
  generalLimiter,
} from './middleware/rateLimit.middleware';
import { auditHttpError } from './lib/audit';
import availabilityRoutes from './routes/availability.routes';
import subcategoryRoutes from './routes/subcategory.routes';
import { getFeaturedBusinesses } from './controllers/featured.public.controller';

dotenv.config();

// ── Guard de arranque: variables críticas de pagos ──────────────────────────
// Sin estas, el servidor arrancaría "cojo": cobros que nunca se pueden hacer
// o un webhook que rechaza todo (o peor, que quede sin proteger). Mejor no
// arrancar que arrancar roto en silencio.
{
  // GOOGLE_CLIENT_SECRET no está acá: el backend solo verifica el ID token
  // (verifyIdToken con GOOGLE_CLIENT_ID como audience); el secret lo usa
  // next-auth en el frontend para el intercambio del authorization code.
  const requiredEnvVars = ['CULQI_SECRET_KEY', 'CULQI_WEBHOOK_SECRET', 'PAYMENT_KEYS_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID'];
  const missing = requiredEnvVars.filter(name => !process.env[name]);
  if (missing.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
    console.error('   El servidor no puede arrancar sin ellas (necesarias para procesar pagos con Culqi).');
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad ────────────────────────────────────────────────────────────────

// Forzar HTTPS en producción (Railway/Render inyectan x-forwarded-proto)
app.set('trust proxy', 1);

// ── Health check ─────────────────────────────────────────────────────────────
// DEBE ir antes del redirect HTTPS — Railway hace el health check interno via HTTP
// sin x-forwarded-proto, y el redirect rompería el check devolviendo 301 en vez de 200.
app.get('/health', async (req, res) => {
  if (req.query.deep !== '1') {
    return res.json({ status: 'OK', database: 'unknown' });
  }
  try {
    const { default: prisma } = await import('./lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'OK', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'DOWN', database: 'disconnected' });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

const isProd = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'", 'https://api.negociclick.com', 'https://api.culqi.com'],
      fontSrc:     ["'self'", 'https:', 'data:'],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  hsts: {
    maxAge: 63072000, // 2 años — coherente con el frontend, requerido para HSTS preload
    includeSubDomains: true,
    preload: true,
  },
  xContentTypeOptions: true,        // X-Content-Type-Options: nosniff
  frameguard: { action: 'deny' },   // X-Frame-Options: DENY — la API nunca debe ser embebida en un iframe
  xssFilter: true,                   // X-XSS-Protection: 1; mode=block
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  crossOriginEmbedderPolicy: false,  // evita romper integraciones externas (Culqi)
}));

// Permissions-Policy (no incluido en Helmet v8 por defecto)
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);           // Postman / server-to-server
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400,                     // preflight cacheado 24h
}));

// El parser de body debe ir ANTES de los rate limiters: loginLimiter lee
// req.body.email en su keyGenerator para limitar por cuenta, no solo por IP.
// Si el body llega sin parsear, ese keyGenerator cae siempre al fallback de
// IP — el límite "por email" nunca se aplica de verdad.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// Rate limiting — orden importa: específico antes que general
// forgot-password no va aquí — ya tiene su limiter en auth.routes.ts
app.post('/api/auth/login',    loginIpLimiter, loginLimiter);
app.post('/api/auth/register', registerLimiter);
app.get('/api/businesses',     searchLimiter);  // búsqueda pública
app.use('/api/payments',       paymentLimiter);
app.use('/api',                generalLimiter); // catch-all

// ── Archivos estáticos (fotos subidas) ───────────────────────────────────────
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'public', 'uploads')));

// ── Rutas ─────────────────────────────────────────────────────────────────────
// Public routes
app.get('/api/featured-businesses', getFeaturedBusinesses);

// Auth and other routes
app.use('/api/auth', authRoutes);
app.use('/api/businesses/:id/featured', featuredRoutes);
app.use('/api/businesses/:id/hours', hoursRoutes);
app.use('/api/businesses/:id/photos', photosRoutes);
app.use('/api/businesses/:id/availability', availabilityRoutes);
app.use('/api/businesses/:id/subcategories', subcategoryRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/professionals', professionalRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reclamos', reclamoRoutes);
app.use('/api/chat', chatRoutes);

// ── Middleware de logging de errores HTTP ────────────────────────────────────
// Captura cualquier res con status 4xx/5xx para el audit log de archivo
// Debe ir DESPUÉS de todas las rutas
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const status = res.statusCode;
    if (status >= 400) {
      const errorMsg = (body as any)?.error ?? String(status);
      auditHttpError(status, {
        endpoint:  req.path,
        method:    req.method,
        error:     errorMsg,
        req,
      });
    }
    return originalJson(body);
  };
  next();
});

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔒 CORS permitido: ${allowedOrigins.join(', ')}`);
  startCancelExpiredBookings();
  startAppointmentReminders();
  startCleanupTokens();
  startCleanupRefreshTokens();
  startExpireSubscriptions();
  startExpireFeatured();
  startExpireManualTrials();
});

// Graceful shutdown — espera requests activos antes de cerrar
const shutdown = (signal: string) => {
  console.log(`\n${signal} recibido. Cerrando servidor...`);
  server.close(async () => {
    const { default: prisma } = await import('./lib/prisma');
    await prisma.$disconnect();
    console.log('Servidor cerrado correctamente.');
    process.exit(0);
  });
  // Forzar cierre si tarda más de 10 segundos
  setTimeout(() => { console.error('Forzando cierre.'); process.exit(1); }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
