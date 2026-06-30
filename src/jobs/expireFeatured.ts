import cron from 'node-cron';
import prisma from '../lib/prisma';
import { sendFeaturedExpiring, sendFeaturedExpired } from '../lib/email';

export function startExpireFeatured() {

  // ── Aviso 3 días antes (9:05 AM) ─────────────────────────────────────────
  cron.schedule('5 9 * * *', async () => {
    try {
      const now  = new Date();
      const from = new Date(now.getTime() + 2 * 86_400_000);
      const to   = new Date(now.getTime() + 3 * 86_400_000);

      const expiringSoon = await prisma.business.findMany({
        where: {
          featured: true,
          featuredUntil: { gte: from, lte: to },
        },
        include: { owner: { select: { email: true, name: true } } },
      });

      for (const biz of expiringSoon) {
        const daysLeft = Math.ceil((biz.featuredUntil!.getTime() - now.getTime()) / 86_400_000);
        await sendFeaturedExpiring({
          email:         biz.owner.email,
          name:          biz.owner.name,
          businessName:  biz.name,
          featuredUntil: biz.featuredUntil!,
          daysLeft,
        }).catch(() => {});
      }

      if (expiringSoon.length > 0) {
        console.log(`[cron] ${expiringSoon.length} aviso(s) de destacado por vencer enviados`);
      }
    } catch (err) {
      console.error('[cron] Error en avisos de destacado:', err);
    }
  });

  // ── Expirar destacados vencidos (00:10 AM) ────────────────────────────────
  cron.schedule('10 0 * * *', async () => {
    try {
      const now = new Date();

      const expired = await prisma.business.findMany({
        where: {
          featured: true,
          featuredUntil: { lt: now },
        },
        include: { owner: { select: { email: true, name: true } } },
      });

      for (const biz of expired) {
        await prisma.business.update({
          where: { id: biz.id },
          data:  { featured: false, featuredUntil: null },
        });

        await sendFeaturedExpired({
          email:        biz.owner.email,
          name:         biz.owner.name,
          businessName: biz.name,
        }).catch(() => {});
      }

      if (expired.length > 0) {
        console.log(`[cron] ${expired.length} negocio(s) destacados expirados limpiados`);
      }
    } catch (err) {
      console.error('[cron] Error al expirar destacados:', err);
    }
  });

  console.log('[cron] Destacados: aviso 3 días antes 9:05 AM · expiración 00:10 AM');
}
