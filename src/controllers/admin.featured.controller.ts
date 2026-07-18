import { Request, Response } from 'express';
import { prisma } from '../config/database';

/**
 * Admin: Assign featured plan manually
 * POST /admin/featured
 */
export const assignFeaturedPlan = async (req: Request, res: Response) => {
  try {
    const { businessId, period, days, amount, featuredUntil, reason } = req.body;
    const userId = (req as any).user?.id;

    // Validation
    if (!businessId || !period || !days || !amount || !featuredUntil) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Verify business exists
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Create FeaturedPayment (without actual Culqi charge)
    const featured = await prisma.featuredPayment.create({
      data: {
        businessId,
        userId: business.ownerId, // Assign to business owner
        period,
        days,
        amount: parseFloat(String(amount)),
        culqiChargeId: `ADMIN_MANUAL_${Date.now()}`, // Mark as admin-created
        featuredUntil: new Date(featuredUntil),
      },
    });

    // Update business featured status
    await prisma.business.update({
      where: { id: businessId },
      data: {
        featured: true,
        featuredUntil: new Date(featuredUntil),
      },
    });

    // Log admin action
    console.log(`[ADMIN] Featured plan assigned: Business=${businessId}, Plan=${period}, By=${userId}, Reason=${reason || 'N/A'}`);

    return res.status(201).json({
      success: true,
      message: `Plan de ${period} asignado a ${business.name}`,
      featured,
    });
  } catch (error) {
    console.error('Error assignFeaturedPlan:', error);
    return res.status(500).json({ error: 'Error al asignar plan destacado' });
  }
};

/**
 * Admin: List featured payments
 * GET /admin/featured
 */
export const listFeaturedPayments = async (req: Request, res: Response) => {
  try {
    const { businessId, limit = 50, offset = 0 } = req.query;

    const where: any = {};
    if (businessId) where.businessId = String(businessId);

    const [featured, total] = await Promise.all([
      prisma.featuredPayment.findMany({
        where,
        include: {
          business: { select: { id: true, name: true, category: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit), 100),
        skip: Number(offset),
      }),
      prisma.featuredPayment.count({ where }),
    ]);

    return res.json({
      success: true,
      featured,
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    console.error('Error listFeaturedPayments:', error);
    return res.status(500).json({ error: 'Error al obtener pagos destacados' });
  }
};

/**
 * Admin: Extend featured plan
 * PUT /admin/featured/:id/extend
 */
export const extendFeaturedPlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { days, newFeaturedUntil } = req.body;

    if (!days || !newFeaturedUntil) {
      return res.status(400).json({ error: 'Faltan días o nueva fecha' });
    }

    const featured = await prisma.featuredPayment.findUnique({
      where: { id },
    });

    if (!featured) {
      return res.status(404).json({ error: 'Featured payment no encontrado' });
    }

    // Update FeaturedPayment
    const updated = await prisma.featuredPayment.update({
      where: { id },
      data: {
        featuredUntil: new Date(newFeaturedUntil),
        days: featured.days + days,
      },
    });

    // Update business featuredUntil
    await prisma.business.update({
      where: { id: featured.businessId },
      data: { featuredUntil: new Date(newFeaturedUntil) },
    });

    console.log(`[ADMIN] Featured plan extended: ID=${id}, NewUntil=${newFeaturedUntil}`);

    return res.json({
      success: true,
      message: 'Plan destacado extendido',
      featured: updated,
    });
  } catch (error) {
    console.error('Error extendFeaturedPlan:', error);
    return res.status(500).json({ error: 'Error al extender plan destacado' });
  }
};
