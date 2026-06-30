import { z } from 'zod';

// ── Auth ────────────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  name:     z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(100),
  email:    z.string().email('Correo electrónico inválido').toLowerCase(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(100),
  phone:    z.string().regex(/^\+?[\d\s\-]{7,20}$/, 'Teléfono inválido').optional(),
  role:     z.enum(['CLIENT', 'VENDOR']).optional(),
});

export const loginSchema = z.object({
  email:    z.string().email('Correo electrónico inválido').toLowerCase(),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Correo electrónico inválido').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(1, 'Token requerido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(100),
});

// ── Business ────────────────────────────────────────────────────────────────
export const createBusinessSchema = z.object({
  name:        z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150).transform(s => s.trim()),
  description: z.string().max(1000).optional(),
  slogan:      z.string().max(200).optional(),
  category:    z.string().min(1, 'La categoría es requerida').max(50),
  address:     z.string().min(5, 'La dirección debe tener al menos 5 caracteres').max(300).transform(s => s.trim()),
  city:        z.string().min(2, 'La ciudad es requerida').max(100),
  phone:       z.string().regex(/^\+?[\d\s\-]{7,20}$/, 'Teléfono inválido'),
  email:       z.string().email('Correo inválido').toLowerCase().optional().or(z.literal('')),
  latitude:    z.coerce.number().min(-90).max(90).optional(),
  longitude:   z.coerce.number().min(-180).max(180).optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ── Service ─────────────────────────────────────────────────────────────────
export const createServiceSchema = z.object({
  name:        z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150).transform(s => s.trim()),
  description: z.string().max(500).optional(),
  price:       z.coerce.number().positive('El precio debe ser mayor a 0').max(99999),
  duration:    z.coerce.number().int().positive().max(1440).optional(),
  category:    z.string().min(1, 'La categoría es requerida').max(50),
  businessId:  z.string().cuid('ID de negocio inválido'),
});

// ── Booking ─────────────────────────────────────────────────────────────────
export const createBookingSchema = z.object({
  serviceId:  z.string().cuid('ID de servicio inválido'),
  businessId: z.string().cuid('ID de negocio inválido'),
  date:       z.string().datetime('Fecha inválida'),
  notes:      z.string().max(500).optional(),
});

// ── Review ───────────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  bookingId: z.string().cuid('ID de reserva inválido'),
  rating:    z.number().int().min(1, 'La calificación mínima es 1').max(5, 'La calificación máxima es 5'),
  comment:   z.string().max(1000).optional(),
});

// ── Subscription ─────────────────────────────────────────────────────────────
export const subscriptionSchema = z.object({
  plan:       z.enum(['PRO', 'PREMIUM']).refine(v => ['PRO', 'PREMIUM'].includes(v), { message: 'Plan inválido. Usa PRO o PREMIUM' }),
  culqiToken: z.string().min(1, 'Token de pago requerido'),
});

// ── Featured ─────────────────────────────────────────────────────────────────
export const featuredSchema = z.object({
  period:     z.enum(['7days', '15days', '30days']).refine(v => ['7days', '15days', '30days'].includes(v), { message: 'Período inválido. Usa: 7days, 15days o 30days' }),
  culqiToken: z.string().min(1, 'Token de pago requerido'),
});

// ── Reclamo ──────────────────────────────────────────────────────────────────
export const reclamoSchema = z.object({
  nombre:   z.string().min(2, 'El nombre es requerido').max(100),
  email:    z.string().email('Correo inválido').toLowerCase(),
  telefono: z.string().regex(/^\+?[\d\s\-]{7,20}$/, 'Teléfono inválido').optional(),
  tipo:     z.enum(['RECLAMO', 'QUEJA']).optional(),
  detalle:  z.string().min(10, 'El detalle debe tener al menos 10 caracteres').max(2000),
});

// ── Admin ─────────────────────────────────────────────────────────────────────
export const updateRoleSchema = z.object({
  role: z.enum(['CLIENT', 'VENDOR', 'ADMIN']),
});
