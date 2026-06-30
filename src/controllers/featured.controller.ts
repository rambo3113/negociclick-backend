import { Request, Response } from 'express';
import prisma from '../lib/prisma';

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
  '7days':  { days: 7,  price: 19.90, label: '7 días'  },
  '15days': { days: 15, price: 34.90, label: '15 días' },
  '30days': { days: 30, price: 59.90, label: '30 días' },
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
    const baseDate = business.featured && business.featuredUntil && business.featuredUntil > now
      ? business.featuredUntil
      : now;
    const featuredUntil = new Date(baseDate.getTime() + pricing.days * 86_400_000);

    await prisma.business.update({
      where: { id: businessId },
      data: { featured: true, featuredUntil },
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

    res.json({
      success: true,
      message: `¡Tu negocio aparecerá como Destacado por ${pricing.label}!`,
      featuredUntil,
      chargeId: charge.id,
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
