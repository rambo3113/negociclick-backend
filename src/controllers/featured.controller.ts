import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { audit } from '../lib/audit';
import {
  sendFeaturedActivated,
  sendFeaturedExtended,
} from '../lib/email';

const CULQI_API = 'https://api.culqi.com/v2';

async function culqiCharge(token: string, amount: number, email: string, description: string) {
  const res = await fetch(`${CULQI_API}/charges`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency_code: 'PEN',
      email,
      source_id: token,
      description,
      capture: true,
    }),
  });
  return res.json();
}

// Precios destacado (en soles)
export const FEATURED_PRICING: Record<string, { days: number; price: number; label: string }> = {
  '7days':  { days: 7,  price: 9.90,  label: '7 días'  },
  '15days': { days: 15, price: 19.90, label: '15 días' },
  '30days': { days: 30, price: 29.90, label: '30 días' },
};

// GET /api/businesses/:id/featured/pricing
export const getFeaturedPricing = async (_req: Request, res: Response) => {
  res.json({ success: true, pricing: FEATURED_PRICING });
};

// POST /api/businesses/:id/featured
export const purchaseFeatured = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const businessId = req.params.id as string;
    const { culqiToken, period } = req.body as { culqiToken: string; period: string };

    if (!culqiToken || !period) {
      return res.status(400).json({ error: 'Faltan culqiToken y period' });
    }

    const pricing = FEATURED_PRICING[period];
    if (!pricing) {
      return res.status(400).json({ error: 'Período inválido. Usa: 7days, 15days o 30days' });
    }

    // Verifica que PREMIUM
    const sub = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      select: { plan: true },
    });
    if (!sub || sub.plan !== 'PREMIUM') {
      return res.status(403).json({ error: 'Solo los negocios PREMIUM pueden comprar destacado' });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { owner: { select: { email: true, name: true } } },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    // Cobrar con Culqi
    const charge = await culqiCharge(
      culqiToken,
      pricing.price,
      business.owner.email ?? '',
      `NegociClick Destacado ${pricing.label} — ${business.name}`,
    );

    if (charge.object === 'error' || !charge.id) {
      const msg = charge.user_message || charge.merchant_message || 'Error al procesar el pago';
      return res.status(402).json({ error: msg });
    }

    // Calcular nueva fecha de expiración (extender si ya está destacado)
    const now = new Date();
    const wasAlreadyFeatured = business.featured && !!business.featuredUntil && business.featuredUntil > now;
    const baseDate = wasAlreadyFeatured ? business.featuredUntil! : now;
    const featuredUntil = new Date(baseDate.getTime() + pricing.days * 86_400_000);

    await prisma.business.update({
      where: { id: businessId },
      // reset reminderSentAt so the new period gets its own 3-day reminder
      data: { featured: true, featuredUntil, featuredReminderSentAt: null } as any,
    });

    await prisma.featuredPayment.create({
      data: {
        businessId,
        userId,
        period,
        days:          pricing.days,
        amount:        pricing.price,
        culqiChargeId: charge.id,
        featuredUntil,
      },
    });

    audit('FEATURED_PURCHASE', { userId, targetId: businessId, meta: { period, amount: pricing.price, chargeId: charge.id }, req });

    // Email (fire-and-forget)
    if (wasAlreadyFeatured) {
      sendFeaturedExtended({
        email:         business.owner.email,
        name:          business.owner.name,
        businessName:  business.name,
        extraDays:     pricing.days,
        featuredUntil,
      }).catch(() => {});
    } else {
      sendFeaturedActivated({
        email:         business.owner.email,
        name:          business.owner.name,
        businessName:  business.name,
        durationDays:  pricing.days,
        featuredUntil,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: wasAlreadyFeatured
        ? `¡Destacado extendido ${pricing.label} más!`
        : `¡Tu negocio aparecerá como Destacado por ${pricing.label}!`,
      featuredUntil,
      chargeId: charge.id,
      extended: wasAlreadyFeatured,
    });

  } catch (error: any) {
    console.error('[featured]', error?.message);
    res.status(500).json({ error: 'Error al procesar el pago destacado' });
  }
};

// GET /api/businesses/:id/featured/status
export const getFeaturedStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const businessId = req.params.id as string;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true, featured: true, featuredUntil: true },
    }) as { ownerId: string; featured: boolean; featuredUntil: Date | null } | null;

    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const now = new Date();
    const isActive = business.featured && !!business.featuredUntil && business.featuredUntil > now;
    const daysLeft = isActive && business.featuredUntil
      ? Math.ceil((business.featuredUntil.getTime() - now.getTime()) / 86_400_000)
      : 0;

    res.json({ success: true, featured: isActive, featuredUntil: business.featuredUntil, daysLeft });
  } catch (error: any) {
    console.error('[featured-status]', error?.message);
    res.status(500).json({ error: 'Error al obtener estado destacado' });
  }
};

// DELETE /api/businesses/:id/featured
export const cancelFeatured = async (req: Request, res: Response) => {
  try {
    const userId     = (req as any).userId;
    const businessId = req.params.id as string;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true, featured: true },
    });
    if (!business)              return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });
    if (!business.featured)     return res.status(400).json({ error: 'Este negocio no está destacado' });

    await prisma.business.update({
      where: { id: businessId },
      data:  { featured: false, featuredUntil: null, featuredReminderSentAt: null } as any,
    });

    audit('FEATURED_CANCEL', { userId, targetId: businessId, req });

    res.json({ success: true, message: 'Destacado cancelado. Tu negocio sigue activo normalmente.' });
  } catch (error: any) {
    console.error('[featured-cancel]', error?.message);
    res.status(500).json({ error: 'Error al cancelar destacado' });
  }
};

// GET /api/businesses/:id/featured/history
export const getFeaturedHistory = async (req: Request, res: Response) => {
  try {
    const userId     = (req as any).userId;
    const businessId = req.params.id as string;

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
    if (!business)                   return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const payments = await prisma.featuredPayment.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, payments });
  } catch (error: any) {
    console.error('[featured-history]', error?.message);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
};
