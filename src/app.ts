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
import { startExpireSubscriptions } from './jobs/expireSubscriptions';
import reclamoRoutes from './routes/reclamo.routes';
import { authLimiter, paymentLimiter, generalLimiter } from './middleware/rateLimit.middleware';
import availabilityRoutes from './routes/availability.routes';

dotenv.config();

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

app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Rate limiting (skip automático en NODE_ENV !== 'production')
app.use('/api/auth',     authLimiter);
app.use('/api/payments', paymentLimiter);
app.use('/api',          generalLimiter);

app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// ── Archivos estáticos (fotos subidas) ───────────────────────────────────────
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'public', 'uploads')));

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/businesses/:id/hours', hoursRoutes);
app.use('/api/businesses/:id/photos', photosRoutes);
app.use('/api/businesses/:id/availability', availabilityRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reclamos', reclamoRoutes);

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔒 CORS permitido: ${allowedOrigins.join(', ')}`);
  startCancelExpiredBookings();
  startAppointmentReminders();
  startCleanupTokens();
  startExpireSubscriptions();
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
