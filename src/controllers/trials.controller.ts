import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { invalidateSubscription } from '../lib/cache';
import { audit } from '../lib/audit';
import {
  sendTrialGranted,
  sendTrialRevoked,
} from '../lib/email';

const PLAN_CONFIG: Record<string, { commissionRate: number; maxServices: number | null }> = {
  PRO:     { commissionRate: 0, maxServices: null },
  PREMIUM: { commissionRate: 0, maxServices: null },
};

// ── POST /admin/trials/grant ─────────────────────────────────────────────────
export const grantTrial = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).userId as string;
    const { businessId, planType, durationDays, reason } = req.body as {
      businessId: string;
      planType: 'PRO' | 'PREMIUM';
      durationDays: number;
      reason?: string;
    };

    if (!businessId || !planType || !durationDays) {
      return res.status(400).json({ error: 'Faltan campos: businessId, planType, durationDays' });
    }
    if (!['PRO', 'PREMIUM'].includes(planType)) {
      return res.status(400).json({ error: 'planType debe ser PRO o PREMIUM' });
    }
    if (![60, 90, 180].includes(durationDays)) {
      return res.status(400).json({ error: 'durationDays debe ser 60, 90 o 180' });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Cancel any active subscription
    await prisma.subscription.updateMany({
      where: { userId: business.ownerId, status: 'ACTIVE' },
      data:  { status: 'CANCELLED', endDate: new Date() },
    });
    invalidateSubscription(business.ownerId);

    const cfg = PLAN_CONFIG[planType];
    const endDate = new Date(Date.now() + durationDays * 86_400_000);

    const subscription = await prisma.subscription.create({
      data: {
        plan:           planType,
        status:         'ACTIVE',
        commissionRate: cfg.commissionRate,
        maxServices:    cfg.maxServices,
        price:          0,
        isTrial:        true,
        isManualTrial:  true,
        autoRenew:      false,
        endDate,
        userId:         business.ownerId,
        trialGrantedAt: new Date(),
        trialGrantedBy: adminId,
        trialReason:    reason ?? null,
      } as any,
    });

    audit('TRIAL_GRANTED', {
      userId: adminId, targetId: businessId,
      meta: { planType, durationDays, reason, endDate },
      req,
    });

    sendTrialGranted({
      email:        business.owner.email,
      name:         business.owner.name,
      businessName: business.name,
      plan:         planType,
      durationDays,
      endDate,
    }).catch(() => {});

    res.status(201).json({ success: true, subscription });
  } catch (error: any) {
    console.error('[trials] grantTrial error:', error);
    res.status(500).json({ error: 'Error al asignar trial' });
  }
};

// ── POST /admin/trials/revoke ─────────────────────────────────────────────────
export const revokeTrial = async (req: Request, res: Response) => {
  try {
    const adminId    = (req as any).userId as string;
    const { businessId } = req.body as { businessId: string };
    if (!businessId) return res.status(400).json({ error: 'Falta businessId' });

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const activeTrial = await prisma.subscription.findFirst({
      where: { userId: business.ownerId, status: 'ACTIVE', isManualTrial: true } as any,
    });
    if (!activeTrial) return res.status(404).json({ error: 'No hay trial activo para este negocio' });

    const revokedPlan = activeTrial.plan;

    // Mark as CANCELLED
    await prisma.subscription.update({
      where: { id: activeTrial.id },
      data:  { status: 'CANCELLED', endDate: new Date() },
    });

    // Create FREE subscription
    await prisma.subscription.create({
      data: {
        plan:           'FREE',
        status:         'ACTIVE',
        commissionRate: 0,
        maxServices:    5,
        price:          0,
        autoRenew:      false,
        userId:         business.ownerId,
      },
    });
    invalidateSubscription(business.ownerId);

    audit('TRIAL_REVOKED', { userId: adminId, targetId: businessId, req });

    sendTrialRevoked({
      email:        business.owner.email,
      name:         business.owner.name,
      businessName: business.name,
      plan:         revokedPlan,
    }).catch(() => {});

    res.json({ success: true, message: 'Trial revocado. El negocio vuelve a plan FREE.' });
  } catch (error: any) {
    console.error('[trials] revokeTrial error:', error);
    res.status(500).json({ error: 'Error al revocar trial' });
  }
};

// ── GET /admin/trials ─────────────────────────────────────────────────────────
export const getTrials = async (req: Request, res: Response) => {
  try {
    const { status, planType } = req.query as { status?: string; planType?: string };
    const page  = Math.max(1, parseInt((req.query.page as string) || '1'));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '25')));
    const skip  = (page - 1) * limit;

    const statusFilter = status === 'ACTIVE'
      ? { status: 'ACTIVE' as const }
      : status === 'EXPIRED'
      ? { status: 'EXPIRED' as const }
      : status === 'CANCELLED'
      ? { status: 'CANCELLED' as const }
      : {};

    const where = {
      isManualTrial: true,
      ...(planType ? { plan: planType } : {}),
      ...statusFilter,
    } as any;

    const [subs, total] = await prisma.$transaction([
      prisma.subscription.findMany({
        where,
        include: {
          user: {
            select: { email: true, name: true },
          },
        },
        orderBy: { trialGrantedAt: 'desc' } as any,
        skip,
        take: limit,
      }),
      prisma.subscription.count({ where }),
    ]);

    const now = new Date();

    // Enrich with business name + days remaining
    const enriched = await Promise.all(subs.map(async (s: any) => {
      const biz = await prisma.business.findFirst({
        where: { ownerId: s.userId },
        select: { id: true, name: true },
      });
      const daysRemaining = s.endDate
        ? Math.max(0, Math.ceil((new Date(s.endDate).getTime() - now.getTime()) / 86_400_000))
        : null;

      // Check if converted to paid post-trial
      const convertedSub = s.status !== 'ACTIVE'
        ? await prisma.subscription.findFirst({
            where: {
              userId:  s.userId,
              status:  'ACTIVE',
              plan:    { not: 'FREE' },
              isTrial: false,
              isManualTrial: false,
            } as any,
          })
        : null;

      return {
        subscriptionId: s.id,
        businessId:     biz?.id ?? null,
        businessName:   biz?.name ?? '(sin negocio)',
        ownerEmail:     s.user.email,
        ownerName:      s.user.name,
        planType:       s.plan,
        status:         s.status,
        startDate:      s.startDate,
        endDate:        s.endDate,
        daysRemaining,
        trialGrantedAt: s.trialGrantedAt,
        trialReason:    s.trialReason,
        converted:      !!convertedSub,
      };
    }));

    res.json({ success: true, total, page, totalPages: Math.ceil(total / limit), trials: enriched });
  } catch (error: any) {
    console.error('[trials] getTrials error:', error);
    res.status(500).json({ error: 'Error al listar trials' });
  }
};

// ── GET /admin/trials/stats ───────────────────────────────────────────────────
export const getTrialStats = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    const [total, active, byPlan] = await Promise.all([
      prisma.subscription.count({ where: { isManualTrial: true } as any }),
      prisma.subscription.count({ where: { isManualTrial: true, status: 'ACTIVE' } as any }),
      prisma.subscription.groupBy({
        by: ['plan'],
        where: { isManualTrial: true, status: 'ACTIVE' } as any,
        _count: { _all: true },
      }),
    ]);

    // Conversion: expired/cancelled trials where user subsequently bought a paid plan
    const expiredTrials = await prisma.subscription.findMany({
      where: { isManualTrial: true, status: { in: ['EXPIRED', 'CANCELLED'] } } as any,
      select: { userId: true },
    });

    let converted = 0;
    let revenueSum = 0;
    for (const t of expiredTrials) {
      const paid = await prisma.subscription.findFirst({
        where: {
          userId:        t.userId,
          status:        'ACTIVE',
          plan:          { not: 'FREE' },
          isTrial:       false,
          isManualTrial: false,
        } as any,
      });
      if (paid) {
        converted++;
        revenueSum += Number(paid.price);
      }
    }

    const conversionRate = total > 0
      ? `${Math.round((converted / (total - active)) * 100) || 0}%`
      : '0%';

    const trialsByPlan: Record<string, number> = {};
    for (const g of byPlan) {
      trialsByPlan[g.plan] = (g._count as any)._all;
    }

    res.json({
      success: true,
      stats: {
        totalTrialsGiven:   total,
        activeTrials:       active,
        convertedToPayment: converted,
        conversionRate,
        revenuePostTrial:   `S/ ${revenueSum.toFixed(2)}`,
        trialsByPlan,
      },
    });
  } catch (error: any) {
    console.error('[trials] getTrialStats error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

// ── GET /admin/trials/:businessId ─────────────────────────────────────────────
export const getBusinessTrials = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.businessId as string;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true, name: true },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const trials = await prisma.subscription.findMany({
      where:   { userId: business.ownerId, isManualTrial: true } as any,
      orderBy: { trialGrantedAt: 'desc' } as any,
    });

    const now = new Date();
    const enriched = trials.map((t: any) => ({
      ...t,
      daysRemaining: t.endDate
        ? Math.max(0, Math.ceil((new Date(t.endDate).getTime() - now.getTime()) / 86_400_000))
        : null,
    }));

    res.json({ success: true, businessName: business.name, trials: enriched });
  } catch (error: any) {
    console.error('[trials] getBusinessTrials error:', error);
    res.status(500).json({ error: 'Error al obtener historial de trials' });
  }
};

// ── POST /admin/trials/extend ─────────────────────────────────────────────────
export const extendTrial = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).userId as string;
    const { businessId, extraDays } = req.body as { businessId: string; extraDays: number };

    if (!businessId || !extraDays || extraDays < 1 || extraDays > 180) {
      return res.status(400).json({ error: 'Faltan businessId o extraDays (1-180)' });
    }

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true, name: true } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const activeTrial = await prisma.subscription.findFirst({
      where: { userId: business.ownerId, status: 'ACTIVE', isManualTrial: true } as any,
    });
    if (!activeTrial) return res.status(404).json({ error: 'No hay trial activo para este negocio' });

    const now = new Date();
    const base = activeTrial.endDate && activeTrial.endDate > now ? activeTrial.endDate : now;
    const newEndDate = new Date(base.getTime() + extraDays * 86_400_000);

    await prisma.subscription.update({
      where: { id: activeTrial.id },
      data:  { endDate: newEndDate },
    });
    invalidateSubscription(business.ownerId);

    audit('TRIAL_EXTENDED', {
      userId: adminId, targetId: businessId,
      meta: { extraDays, newEndDate },
      req,
    });

    res.json({ success: true, newEndDate, message: `Trial extendido ${extraDays} días más.` });
  } catch (error: any) {
    console.error('[trials] extendTrial error:', error);
    res.status(500).json({ error: 'Error al extender trial' });
  }
};
