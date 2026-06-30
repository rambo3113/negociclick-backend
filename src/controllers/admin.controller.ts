import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { audit } from '../lib/audit';

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

export const getAllBusinessesAdmin = async (req: Request, res: Response) => {
  try {
    const businesses = await prisma.business.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { bookings: true, reviews: true, services: true } },
      },
    });
    res.json({ success: true, count: businesses.length, businesses });
  } catch {
    res.status(500).json({ error: 'Error al listar negocios' });
  }
};

export const getFeaturedPaymentsAdmin = async (_req: Request, res: Response) => {
  try {
    const payments = await prisma.featuredPayment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        business: { select: { name: true } },
        user:     { select: { name: true, email: true } },
      },
    });
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);
    res.json({ success: true, count: payments.length, total: parseFloat(total.toFixed(2)), payments });
  } catch {
    res.status(500).json({ error: 'Error al listar pagos destacados' });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const id   = req.params.id as string;
    const { role } = req.body as { role: string };
    if (!['CLIENT', 'VENDOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    const user = await prisma.user.update({ where: { id }, data: { role } });
    audit('ROLE_CHANGE', { userId: (req as any).userId, targetId: id, meta: { newRole: role }, req });
    res.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch {
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
};

export const toggleBusinessActive = async (req: Request, res: Response) => {
  try {
    const id  = req.params.id as string;
    const biz = await prisma.business.findUnique({ where: { id }, select: { isActive: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const updated = await prisma.business.update({ where: { id }, data: { isActive: !biz.isActive } });
    audit('BUSINESS_TOGGLE', { userId: (req as any).userId, targetId: id, meta: { isActive: updated.isActive }, req });
    res.json({ success: true, isActive: updated.isActive });
  } catch {
    res.status(500).json({ error: 'Error al actualizar negocio' });
  }
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const { action, userId, limit = '100' } = req.query as Record<string, string>;
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, parseInt(limit)),
    });
    res.json({ success: true, count: logs.length, logs });
  } catch {
    res.status(500).json({ error: 'Error al obtener logs' });
  }
};
