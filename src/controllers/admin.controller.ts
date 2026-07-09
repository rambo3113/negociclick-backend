import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { audit } from '../lib/audit';

// ── helpers ──────────────────────────────────────────────────────────────────
function page(req: Request) {
  return Math.max(1, parseInt((req.query.page as string) ?? '1'));
}
function lim(req: Request, def = 20) {
  return Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? String(def))));
}
function skip(p: number, l: number) { return (p - 1) * l; }

// ── GET /admin/stats ─────────────────────────────────────────────────────────
export const getAdminStats = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      usersByRole,
      totalBusinesses,
      suspendedBusinesses,
      totalBookings,
      bookingsByStatus,
      paidPayments,
      subscriptionsByPlan,
      openReports,
      recentBookings,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: { id: true } }),
      prisma.business.count({ where: { isActive: true } }),
      prisma.business.count({ where: { status: 'suspended' } }),
      prisma.booking.count(),
      prisma.booking.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.payment.findMany({
        where: { status: 'PAID' },
        select: { amount: true, commissionAmount: true, createdAt: true },
      }),
      prisma.subscription.groupBy({
        by: ['plan'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
      }),
      prisma.report.count({ where: { status: 'open' } }),
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

    const totalRevenue  = paidPayments.reduce((s, p) => s + Number(p.amount), 0);
    const monthRevenue  = paidPayments
      .filter(p => p.createdAt >= monthStart)
      .reduce((s, p) => s + Number(p.commissionAmount), 0);

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          byRole: Object.fromEntries(usersByRole.map(r => [r.role, r._count.id])),
        },
        businesses: { total: totalBusinesses, suspended: suspendedBusinesses },
        bookings: {
          total: totalBookings,
          byStatus: Object.fromEntries(bookingsByStatus.map(b => [b.status, b._count.id])),
        },
        payments: {
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          monthCommission: parseFloat(monthRevenue.toFixed(2)),
        },
        subscriptions: {
          active: Object.fromEntries(subscriptionsByPlan.map(s => [s.plan, s._count.id])),
        },
        reports: { open: openReports },
      },
      recentBookings,
      recentUsers,
    });
  } catch (error: any) {
    console.error('Error admin stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

// ── GET /admin/users ─────────────────────────────────────────────────────────
export const getAllUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true, emailVerified: true, twoFactorEnabled: true },
    });
    res.json({ success: true, count: users.length, users });
  } catch {
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
};

// ── GET /admin/businesses ────────────────────────────────────────────────────
export const getAdminBusinessesList = async (req: Request, res: Response) => {
  const { plan, status, search } = req.query as Record<string, string>;
  const p = page(req), l = lim(req);

  try {
    const where: any = {};
    if (status === 'suspended') where.status = 'suspended';
    else if (status === 'active') where.status = 'active';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { owner: { email: { contains: search, mode: 'insensitive' } } },
        { owner: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [businesses, total] = await Promise.all([
      prisma.business.findMany({
        where,
        skip: skip(p, l),
        take: l,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: {
              id: true, name: true, email: true,
              subscriptions: {
                where: { status: 'ACTIVE' },
                orderBy: { startDate: 'desc' },
                take: 1,
                select: { plan: true, endDate: true, status: true, isTrial: true },
              },
            },
          },
          _count: { select: { bookings: true, services: true } },
        },
      }),
      prisma.business.count({ where }),
    ]);

    // Filtrar por plan después de join (simplificado, suficiente para volúmenes actuales)
    const filtered = plan
      ? businesses.filter(b => {
          const activeSub = b.owner.subscriptions[0];
          return activeSub?.plan?.toLowerCase() === plan.toLowerCase();
        })
      : businesses;

    const result = filtered.map(b => {
      const sub = b.owner.subscriptions[0] ?? null;
      const onlinePaymentEnabled = !!(
        sub?.plan === 'PREMIUM' && b.culqiPublicKey && b.culqiKeysValidatedAt
      );
      const { culqiSecretKeyEnc: _omit, culqiPublicKey, culqiKeysValidatedAt, ...rest } = b as any;
      return {
        ...rest,
        onlinePaymentEnabled,
        plan: sub?.plan ?? 'FREE',
        subscription: sub
          ? {
              plan: sub.plan,
              status: sub.status,
              isTrial: sub.isTrial,
              nextRenewal: sub.endDate,
            }
          : null,
      };
    });

    audit('VIEW_REPORT', { userId: (req as any).userId, meta: { targetType: 'Business', page: p } });

    res.json({ success: true, total: plan ? result.length : total, page: p, limit: l, businesses: result });
  } catch (err) {
    console.error('[admin] businesses error:', err);
    res.status(500).json({ error: 'Error al listar negocios' });
  }
};

// ── GET /admin/subscriptions ─────────────────────────────────────────────────
export const getAdminSubscriptions = async (req: Request, res: Response) => {
  const { plan, status } = req.query as Record<string, string>;
  const p = page(req), l = lim(req);

  try {
    const where: any = { plan: { not: 'FREE' } };
    if (plan) where.plan = plan.toUpperCase();
    if (status) where.status = status.toUpperCase();

    const [subs, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        skip: skip(p, l),
        take: l,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              name: true, email: true,
              businesses: { select: { id: true, name: true }, take: 1 },
            },
          },
        },
      }),
      prisma.subscription.count({ where }),
    ]);

    audit('VIEW_REPORT', { userId: (req as any).userId, meta: { targetType: 'Subscription', page: p } });

    res.json({
      success: true, total, page: p, limit: l,
      subscriptions: subs.map(s => ({
        id: s.id,
        plan: s.plan,
        status: s.status,
        isTrial: s.isTrial,
        price: Number(s.price),
        startDate: s.startDate,
        endDate: s.endDate,
        autoRenew: s.autoRenew,
        user: { name: s.user.name, email: s.user.email },
        business: s.user.businesses[0] ?? null,
      })),
    });
  } catch (err) {
    console.error('[admin] subscriptions error:', err);
    res.status(500).json({ error: 'Error al listar suscripciones' });
  }
};

// ── GET /admin/payments ──────────────────────────────────────────────────────
export const getAdminPayments = async (req: Request, res: Response) => {
  const { month, period = 'month' } = req.query as Record<string, string>;
  const p = page(req), l = lim(req);

  try {
    let dateFrom: Date;
    const now = new Date();
    if (month) {
      const [y, m] = month.split('-').map(Number);
      dateFrom = new Date(y, m - 1, 1);
    } else if (period === 'quarter') {
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    } else if (period === 'year') {
      dateFrom = new Date(now.getFullYear(), 0, 1);
    } else {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Pagos de booking (comisiones de plataforma)
    const [bookingPayments, featuredPayments] = await Promise.all([
      prisma.payment.findMany({
        where: { status: 'PAID', createdAt: { gte: dateFrom } },
        skip: skip(p, l),
        take: l,
        orderBy: { createdAt: 'desc' },
        include: {
          booking: {
            select: {
              business: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.featuredPayment.findMany({
        where: { createdAt: { gte: dateFrom } },
        orderBy: { createdAt: 'desc' },
        include: { business: { select: { id: true, name: true } } },
      }),
    ]);

    const allPayments = [
      ...bookingPayments.map(pay => ({
        id: pay.id,
        type: 'booking' as const,
        amount: Number(pay.amount),
        commission: Number(pay.commissionAmount),
        currency: pay.currency,
        status: pay.status,
        date: pay.createdAt,
        businessId: pay.booking.business.id,
        businessName: pay.booking.business.name,
        reference: pay.providerId ?? pay.bookingId,
      })),
      ...featuredPayments.map(fp => ({
        id: fp.id,
        type: 'featured' as const,
        amount: Number(fp.amount),
        commission: Number(fp.amount),
        currency: 'PEN',
        status: 'completed' as const,
        date: fp.createdAt,
        businessId: fp.businessId,
        businessName: fp.business.name,
        reference: fp.culqiChargeId,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalCommission = allPayments.reduce((s, pay) => s + pay.commission, 0);
    const totalVolume     = allPayments.reduce((s, pay) => s + pay.amount, 0);

    audit('VIEW_REPORT', { userId: (req as any).userId, meta: { targetType: 'Payment', period, month } });

    res.json({
      success: true,
      summary: {
        totalVolume:     parseFloat(totalVolume.toFixed(2)),
        totalCommission: parseFloat(totalCommission.toFixed(2)),
        count: allPayments.length,
      },
      payments: allPayments,
    });
  } catch (err) {
    console.error('[admin] payments error:', err);
    res.status(500).json({ error: 'Error al listar pagos' });
  }
};

// ── GET /admin/reports ───────────────────────────────────────────────────────
export const getAdminReports = async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  const p = page(req), l = lim(req);

  try {
    const where = status ? { status } : {};
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        skip: skip(p, l),
        take: l,
        orderBy: { createdAt: 'desc' },
        include: {
          reportedBy:       { select: { id: true, name: true, email: true } },
          reportedBusiness: { select: { id: true, name: true } },
          reportedService:  { select: { id: true, name: true } },
        },
      }),
      prisma.report.count({ where }),
    ]);

    audit('VIEW_REPORT', { userId: (req as any).userId, meta: { targetType: 'Report', page: p } });

    res.json({ success: true, total, page: p, limit: l, reports });
  } catch (err) {
    console.error('[admin] reports error:', err);
    res.status(500).json({ error: 'Error al listar reportes' });
  }
};

// ── POST /admin/reports/:id/resolve ─────────────────────────────────────────
export const resolveReport = async (req: Request, res: Response) => {
  const reportId = req.params.id as string;
  try {
    const report = await prisma.report.update({
      where: { id: reportId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    audit('RESOLVE_REPORT', { userId: (req as any).userId as string, targetId: reportId });
    res.json({ success: true, report });
  } catch {
    res.status(500).json({ error: 'Error al resolver reporte' });
  }
};

// ── POST /admin/businesses/:id/suspend ──────────────────────────────────────
export const suspendBusiness = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { reason } = req.body as { reason?: string };

  try {
    const biz = await prisma.business.findUnique({ where: { id }, select: { name: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    await prisma.business.update({
      where: { id },
      data: { status: 'suspended', isActive: false },
    });

    audit('SUSPEND_BUSINESS', {
      userId: (req as any).userId,
      targetId: id,
      meta: { reason: reason ?? 'Sin motivo especificado', businessName: biz.name },
    });

    res.json({ success: true, message: 'Negocio suspendido' });
  } catch (err) {
    console.error('[admin] suspend error:', err);
    res.status(500).json({ error: 'Error al suspender negocio' });
  }
};

// ── POST /admin/businesses/:id/reactivate ───────────────────────────────────
export const reactivateBusiness = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const biz = await prisma.business.findUnique({ where: { id }, select: { name: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    await prisma.business.update({
      where: { id },
      data: { status: 'active', isActive: true },
    });

    audit('REACTIVATE_BUSINESS', {
      userId: (req as any).userId,
      targetId: id,
      meta: { businessName: biz.name },
    });

    res.json({ success: true, message: 'Negocio reactivado' });
  } catch (err) {
    console.error('[admin] reactivate error:', err);
    res.status(500).json({ error: 'Error al reactivar negocio' });
  }
};

// ── GET /admin/logs ──────────────────────────────────────────────────────────
export const getAdminLogs = async (req: Request, res: Response) => {
  const { action, userId } = req.query as Record<string, string>;
  const p = page(req), l = lim(req, 50);

  try {
    const where: any = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: skip(p, l),
        take: l,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    audit('VIEW_REPORT', { userId: (req as any).userId, meta: { targetType: 'AdminLog', page: p } });

    res.json({ success: true, total, page: p, limit: l, logs });
  } catch {
    res.status(500).json({ error: 'Error al obtener logs' });
  }
};

// ── PUT /admin/users/:id/role ────────────────────────────────────────────────
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const id     = req.params.id as string;
    const { role } = req.body as { role: string };
    if (!['CLIENT', 'VENDOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    const user = await prisma.user.update({ where: { id }, data: { role } });
    audit('ROLE_CHANGE', { userId: (req as any).userId, targetId: id, meta: { newRole: role } });
    res.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch {
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
};

// ── GET /admin/featured-payments ─────────────────────────────────────────────
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
