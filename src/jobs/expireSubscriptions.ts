import cron from 'node-cron';
import prisma from '../lib/prisma';
import { sendSubscriptionExpiring, sendSubscriptionExpired } from '../lib/email';
import { invalidateSubscription } from '../lib/cache';

export function startExpireSubscriptions() {

  // ── Avisos de renovación: 7 días, 3 días y 1 día antes (9:00 AM) ──────────
  cron.schedule('0 9 * * *', async () => {
    try {
      const now = new Date();

      const warnings = [
        { daysLeft: 7, gte: 6, lte: 7 },
        { daysLeft: 3, gte: 2, lte: 3 },
        { daysLeft: 1, gte: 0, lte: 1 },
      ];

      for (const w of warnings) {
        const from = new Date(now.getTime() + w.gte * 86_400_000);
        const to   = new Date(now.getTime() + w.lte * 86_400_000);

        const expiringSoon = await prisma.subscription.findMany({
          where: {
            status: 'ACTIVE',
            plan:   { not: 'FREE' },
            endDate: { gte: from, lte: to },
          },
          include: { user: { select: { email: true, name: true } } },
        });

        for (const sub of expiringSoon) {
          await sendSubscriptionExpiring({
            email:    sub.user.email,
            name:     sub.user.name,
            plan:     sub.plan,
            endDate:  sub.endDate!,
            daysLeft: w.daysLeft,
          }).catch(() => {});
        }

        if (expiringSoon.length > 0) {
          console.log(`[cron] ${expiringSoon.length} aviso(s) de vencimiento en ${w.daysLeft} día(s) enviados`);
        }
      }
    } catch (err) {
      console.error('[cron] Error al enviar avisos de renovación:', err);
    }
  });

  // ── Degradar suscripciones vencidas a FREE (00:05 AM) ─────────────────────
  cron.schedule('5 0 * * *', async () => {
    try {
      const now = new Date();

      const expired = await prisma.subscription.findMany({
        where: {
          status:  'ACTIVE',
          plan:    { not: 'FREE' },
          endDate: { lt: now },
        },
        include: { user: { select: { email: true, name: true } } },
      });

      for (const sub of expired) {
        // 1. Marcar como EXPIRED
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  { status: 'EXPIRED' },
        });
        invalidateSubscription(sub.userId);

        // 2. Crear suscripción FREE activa
        await prisma.subscription.create({
          data: {
            plan:           'FREE',
            status:         'ACTIVE',
            commissionRate: 0,
            maxServices:    5,
            price:          0,
            userId:         sub.userId,
          },
        });

        // 3. Ocultar servicios que excedan el límite FREE (5) por negocio
        const businesses = await prisma.business.findMany({
          where:  { ownerId: sub.userId },
          select: { id: true },
        });

        for (const biz of businesses) {
          const active = await prisma.service.findMany({
            where:   { businessId: biz.id, isActive: true },
            orderBy: { createdAt: 'asc' },
            select:  { id: true },
          });

          if (active.length > 5) {
            const toHide = active.slice(5).map(s => s.id);
            await prisma.service.updateMany({
              where: { id: { in: toHide } },
              data:  { isActive: false },
            });
            console.log(`[cron] ${toHide.length} servicio(s) ocultados en negocio ${biz.id} (límite FREE)`);
          }
        }

        // 4. Notificar al vendor
        await sendSubscriptionExpired({
          email: sub.user.email,
          name:  sub.user.name,
          plan:  sub.plan,
        }).catch(() => {});
      }

      if (expired.length > 0) {
        console.log(`[cron] ${expired.length} suscripción(es) degradadas a FREE`);
      }
    } catch (err) {
      console.error('[cron] Error al degradar suscripciones vencidas:', err);
    }
  });

  console.log('[cron] Suscripciones: avisos 9:00 AM (7/3/1 días) · degradación FREE 00:05 AM');
}
