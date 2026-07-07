import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { cacheGet, cacheSet, cacheKey, TTL } from '../lib/cache';

const PLAN_LIMITS: Record<string, number> = { FREE: 5, PRO: Infinity, PREMIUM: Infinity };

type CachedSub = { plan: string; endDate: Date | null };

export async function planGuard(req: Request, _res: Response, next: NextFunction) {
  const userId = (req as any).userId;
  if (!userId) return next();

  try {
    const key    = cacheKey.subscription(userId);
    let   cached = cacheGet<CachedSub>(key);

    if (!cached) {
      const sub = await prisma.subscription.findFirst({
        where:   { userId, status: 'ACTIVE' },
        orderBy: { startDate: 'desc' },
        select:  { plan: true, endDate: true },
      });
      cached = sub ?? { plan: 'FREE', endDate: null };
      cacheSet(key, cached, TTL.SUBSCRIPTION);
    }

    const now       = new Date();
    const isExpired = cached.plan !== 'FREE' && cached.endDate && new Date(cached.endDate) < now;
    const plan      = isExpired ? 'FREE' : cached.plan;

    (req as any).effectivePlan = plan;
    (req as any).maxServices   = PLAN_LIMITS[plan] ?? 5;
  } catch {
    (req as any).effectivePlan = 'FREE';
    (req as any).maxServices   = 5;
  }

  next();
}
