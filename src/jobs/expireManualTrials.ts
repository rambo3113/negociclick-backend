import cron from 'node-cron';
import prisma from '../lib/prisma';
import { sendTrialExpired, sendTrialExpiring } from '../lib/email';
import { invalidateSubscription } from '../lib/cache';

export function startExpireManualTrials() {

  // ── Aviso 3 días antes (9:15 AM) — dedup via campo trialReminderSentAt no existe,
  //    usamos: endDate in [+2d, +3d] y status ACTIVE isManualTrial=true ──────────
  cron.schedule('15 9 * * *', async () => {
    try {
      const now  = new Date();
      const from = new Date(now.getTime() + 2 * 86_400_000);
      const to   = new Date(now.getTime() + 3 * 86_400_000);

      const expiringSoon = await prisma.subscription.findMany({
        where: {
          isManualTrial: true,
          status:        'ACTIVE',
          endDate:       { gte: from, lte: to },
        } as any,
        include: { user: { select: { email: true, name: true } } },
      });

      for (const sub of expiringSoon) {
        const daysRemaining = Math.ceil((sub.endDate!.getTime() - now.getTime()) / 86_400_000);
        const biz = await prisma.business.findFirst({
          where:  { ownerId: sub.userId },
          select: { name: true },
        });

        await sendTrialExpiring({
          email:         sub.user.email,
          name:          sub.user.name,
          businessName:  biz?.name ?? 'tu negocio',
          plan:          sub.plan,
          daysRemaining,
          endDate:       sub.endDate!,
        }).catch(() => {});
      }

      if (expiringSoon.length > 0) {
        console.log(`[cron] ${expiringSoon.length} aviso(s) de trial por vencer enviados`);
      }
    } catch (err) {
      console.error('[cron] Error en avisos de trial:', err);
    }
  });

  // ── Expirar trials vencidos (00:15 AM) ────────────────────────────────────
  cron.schedule('15 0 * * *', async () => {
    try {
      const now = new Date();

      const expired = await prisma.subscription.findMany({
        where: {
          isManualTrial: true,
          status:        'ACTIVE',
          endDate:       { lt: now },
        } as any,
        include: { user: { select: { email: true, name: true } } },
      });

      for (const sub of expired) {
        // 1. Marcar como EXPIRED
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  { status: 'EXPIRED' },
        });

        // 2. Crear FREE activa
        await prisma.subscription.create({
          data: {
            plan:           'FREE',
            status:         'ACTIVE',
            commissionRate: 0,
            maxServices:    5,
            price:          0,
            autoRenew:      false,
            userId:         sub.userId,
          },
        });
        invalidateSubscription(sub.userId);

        // 3. Email con template específico de trial (no el de suscripción de pago)
        const biz = await prisma.business.findFirst({
          where:  { ownerId: sub.userId },
          select: { name: true },
        });
        await sendTrialExpired({
          email:        sub.user.email,
          name:         sub.user.name,
          businessName: biz?.name ?? 'tu negocio',
          plan:         sub.plan,
        }).catch(() => {});
      }

      if (expired.length > 0) {
        console.log(`[cron] ${expired.length} trial(s) manual(es) expirado(s)`);
      }
    } catch (err) {
      console.error('[cron] Error al expirar manual trials:', err);
    }
  });

  console.log('[cron] Manual trials: aviso 3 días 9:15 AM · expiración 00:15 AM');
}
