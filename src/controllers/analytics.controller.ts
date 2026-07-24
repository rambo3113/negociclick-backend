import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// POST /api/businesses/:id/view — no auth required, fire-and-forget
export const recordView = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.business.updateMany({
      where: { id, isActive: true },
      data: { viewCount: { increment: 1 } },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Error al registrar vista' });
  }
};

// GET /api/businesses/:id/analytics — owner only
export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const userId     = (req as any).userId as string;
    const businessId = req.params.id as string;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true, viewCount: true, name: true },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const sevenDaysAgo  = new Date(Date.now() - 7  * 86_400_000);

    const [
      bookingsLast30,
      bookingsLast7,
      bookingsByStatus,
      recentReviews,
      topServices,
      revenueData,
    ] = await Promise.all([
      prisma.booking.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, createdAt: { gte: sevenDaysAgo } } }),
      prisma.booking.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { id: true },
      }),
      prisma.review.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, rating: true, comment: true, createdAt: true, vendorReply: true, vendorRepliedAt: true, client: { select: { name: true } } },
      }),
      prisma.booking.groupBy({
        by: ['serviceId'],
        where: { businessId, status: 'COMPLETED' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      prisma.payment.findMany({
        where: { booking: { businessId }, status: 'PAID', createdAt: { gte: thirtyDaysAgo } },
        select: { amount: true, vendorAmount: true },
      }),
    ]);

    // Fetch service names for top services
    const serviceIds = topServices.map(s => s.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true },
    });
    const serviceMap = Object.fromEntries(services.map(s => [s.id, s.name]));

    const totalRevenue = revenueData.reduce((s, p) => s + Number(p.vendorAmount ?? p.amount), 0);

    res.json({
      success: true,
      analytics: {
        views:          business.viewCount,
        bookingsLast30,
        bookingsLast7,
        bookingsByStatus: Object.fromEntries(bookingsByStatus.map(b => [b.status, b._count.id])),
        recentReviews,
        topServices: topServices.map(s => ({ name: serviceMap[s.serviceId] ?? 'Servicio', count: s._count.id })),
        revenueLastMonth: parseFloat(totalRevenue.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: 'Error al obtener analíticas' });
  }
};
