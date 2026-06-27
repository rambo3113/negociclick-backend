import { Request, Response } from 'express';
import prisma from '../lib/prisma';

export const getAdminStats = async (_req: Request, res: Response) => {
  try {
    const [
      totalUsers,
      usersByRole,
      totalBusinesses,
      totalBookings,
      bookingsByStatus,
      totalPayments,
      paidPayments,
      subscriptionsByPlan,
      recentBookings,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: { id: true } }),
      prisma.business.count({ where: { isActive: true } }),
      prisma.booking.count(),
      prisma.booking.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.payment.count(),
      prisma.payment.findMany({
        where: { status: 'PAID' },
        select: { amount: true, commissionAmount: true },
      }),
      prisma.subscription.groupBy({
        by: ['plan'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
      }),
      prisma.booking.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          client:   { select: { name: true, email: true } },
          business: { select: { name: true } },
          service:  { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      }),
    ]);

    const totalRevenue = paidPayments.reduce((s, p) => s + Number(p.amount), 0);
    const totalVolume  = totalRevenue;

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          byRole: Object.fromEntries(usersByRole.map(r => [r.role, r._count.id])),
        },
        businesses: { total: totalBusinesses },
        bookings: {
          total: totalBookings,
          byStatus: Object.fromEntries(bookingsByStatus.map(b => [b.status, b._count.id])),
        },
        payments: {
          total: totalPayments,
          paid: paidPayments.length,
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          totalVolume:  parseFloat(totalVolume.toFixed(2)),
        },
        subscriptions: {
          active: Object.fromEntries(subscriptionsByPlan.map(s => [s.plan, s._count.id])),
        },
      },
      recentBookings,
      recentUsers,
    });
  } catch (error: any) {
    console.error('Error admin stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true },
    });
    res.json({ success: true, count: users.length, users });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
};
