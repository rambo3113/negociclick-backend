import cron from 'node-cron';
import prisma from '../lib/prisma';

// Corre cada día a las 3:00 AM — elimina tokens de reset expirados o ya usados
export function startCleanupTokens() {
  cron.schedule('0 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const { count } = await prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true, createdAt: { lt: cutoff } },
          ],
        },
      });

      if (count > 0) {
        console.log(`[cron] Eliminados ${count} tokens de reset expirados`);
      }
    } catch (err) {
      console.error('[cron] Error al limpiar tokens:', err);
    }
  });

  console.log('[cron] Job de limpieza de tokens iniciado (diario a las 3:00 AM)');
}
