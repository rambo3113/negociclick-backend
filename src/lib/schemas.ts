import { z } from 'zod';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Escapa caracteres HTML peligrosos sin dependencias externas
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// String con trim + escape XSS automático
const safeText = (max: number) =>
  z.string().max(max).transform(s => escapeHtml(s.trim()));

// Teléfono peruano: +51XXXXXXXXX, 51XXXXXXXXX, o 9XXXXXXXX (9 dígitos)
const peruPhone = z.string().refine(
  v => /^(\+51|51)?[0-9]{9}$/.test(v),
  { error: 'Teléfono inválido. Usa formato +51XXXXXXXXX o 9XXXXXXXX (9 dígitos)' },
);

// Contraseña segura: ≥12 chars, 1 mayúscula, 1 número, 1 especial
const strongPassword = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres')
  .max(128, 'La contraseña no puede superar 128 caracteres')
  .refine(p => /[A-Z]/.test(p),                                  { error: 'La contraseña debe incluir al menos una mayúscula' })
  .refine(p => /[0-9]/.test(p),                                  { error: 'La contraseña debe incluir al menos un número' })
  .refine(p => /[!@#$%^&*()\-_=+\[\]{};:'"\\|,.<>/?]/.test(p), { error: 'La contraseña debe incluir al menos un carácter especial (!@#$%^&*...)' });

// ── Auth ─────────────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  name:     safeText(100).refine(s => s.length >= 3, { error: 'El nombre debe tener al menos 3 caracteres' }),
  email:    z.string().refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'Correo electrónico inválido' }).transform(v => v.toLowerCase().trim()).pipe(z.string().max(254)),
  password: strongPassword,
  phone:    peruPhone.optional(),
  role:     z.enum(['CLIENT', 'VENDOR']).optional(),
});

export const loginSchema = z.object({
  email:    z.string().refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'Correo electrónico inválido' }).transform(v => v.toLowerCase().trim()),
  password: z.string().min(1, 'La contraseña es requerida').max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'Correo electrónico inválido' }).transform(v => v.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(1, 'Token requerido').max(200),
  password: strongPassword,
});

// ── Business ─────────────────────────────────────────────────────────────────
export const createBusinessSchema = z.object({
  name:        safeText(150).refine(s => s.length >= 2, { error: 'El nombre debe tener al menos 2 caracteres' }),
  description: safeText(1000).optional(),
  slogan:      safeText(200).optional(),
  category:    z.string().min(1, 'La categoría es requerida').max(50),
  address:     safeText(300).refine(s => s.length >= 5, { error: 'La dirección debe tener al menos 5 caracteres' }),
  city:        z.string().min(2, 'La ciudad es requerida').max(100),
  phone:       peruPhone,
  email:       z.string().refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'Correo inválido' }).transform(v => v.toLowerCase()).optional().or(z.literal('')),
  latitude:    z.coerce.number().min(-90).max(90).optional(),
  longitude:   z.coerce.number().min(-180).max(180).optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ── Service ──────────────────────────────────────────────────────────────────
export const createServiceSchema = z.object({
  name:        safeText(150).refine(s => s.length >= 2, { error: 'El nombre debe tener al menos 2 caracteres' }),
  description: safeText(500).optional(),
  price:       z.coerce.number().positive('El precio debe ser mayor a 0').max(99999),
  duration:    z.coerce.number().int().positive().max(1440).optional(),
  category:    z.string().min(1, 'La categoría es requerida').max(50),
  businessId:  z.string().min(1, 'ID de negocio requerido'),
});

// ── Booking ──────────────────────────────────────────────────────────────────
export const createBookingSchema = z.object({
  serviceId:  z.string().min(1, 'ID de servicio requerido'),
  businessId: z.string().min(1, 'ID de negocio requerido'),
  date:       z.string().refine(v => !isNaN(Date.parse(v)), { error: 'Fecha inválida' }),
  notes:      safeText(500).optional(),
});

// ── Review ────────────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  bookingId: z.string().min(1, 'ID de reserva requerido'),
  rating:    z.number().int().min(1, 'La calificación mínima es 1').max(5, 'La calificación máxima es 5'),
  comment:   safeText(500).optional(),
});

// ── Search (query params) ─────────────────────────────────────────────────────
export const searchQuerySchema = z.object({
  search:    safeText(100).optional(),
  category:  z.string().max(50).optional(),
  city:      z.string().max(100).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minPrice:  z.coerce.number().min(0).max(99999).optional(),
  maxPrice:  z.coerce.number().min(0).max(99999).optional(),
  sortBy:    z.enum(['featured', 'rating', 'price_asc', 'price_desc', 'newest', 'popular']).optional(),
  page:      z.coerce.number().int().positive().max(1000).optional(),
  limit:     z.coerce.number().int().min(1).max(50).optional(),
});

// ── Subscription ──────────────────────────────────────────────────────────────
export const subscriptionSchema = z.object({
  plan:       z.enum(['PRO', 'PREMIUM']),
  culqiToken: z.string().min(1, 'Token de pago requerido').max(200),
});

// ── Featured ──────────────────────────────────────────────────────────────────
export const featuredSchema = z.object({
  period:     z.enum(['7days', '15days', '30days']),
  culqiToken: z.string().min(1, 'Token de pago requerido').max(200),
});

// ── Reclamo ───────────────────────────────────────────────────────────────────
export const reclamoSchema = z.object({
  nombre:   safeText(100).refine(s => s.length >= 2, { error: 'El nombre es requerido' }),
  email:    z.string().refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'Correo inválido' }).transform(v => v.toLowerCase().trim()),
  telefono: peruPhone.optional(),
  tipo:     z.enum(['RECLAMO', 'QUEJA']).optional(),
  detalle:  safeText(2000).refine(s => s.length >= 10, { error: 'El detalle debe tener al menos 10 caracteres' }),
});

// ── Admin ─────────────────────────────────────────────────────────────────────
export const updateRoleSchema = z.object({
  role: z.enum(['CLIENT', 'VENDOR', 'ADMIN']),
});
