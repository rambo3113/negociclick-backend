import cron from 'node-cron';
import prisma from '../lib/prisma';

export function startCleanupRefreshTokens() {
  // Eliminar refresh tokens expirados cada día a las 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        console.log(`[cron] ${result.count} refresh token(s) expirados eliminados`);
      }
    } catch (err) {
      console.error('[cron] Error al limpiar refresh tokens:', err);
    }
  });

  console.log('[cron] Limpieza de refresh tokens: 3:00 AM diario');
}
