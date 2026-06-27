import cron from 'node-cron';
import prisma from '../lib/prisma';

// Corre cada hora
export function startCancelExpiredBookings() {
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();

      // Caso 1: Reserva PENDING cuya fecha ya pasó (aplica todos los planes)
      // El vendedor nunca la confirmó y la cita ya venció
      const pastDue = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          date: { lt: now },
        },
        select: { id: true },
      });

      // Caso 2: Reserva PENDING de PREMIUM con pago PENDING creado hace más de 1 hora
      // El cliente abrió el modal de Culqi pero nunca completó el pago
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const unpaidPremium = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          date: { gte: now },
          payment: {
            status: 'PENDING',
            createdAt: { lt: oneHourAgo },
          },
        },
        select: { id: true, payment: { select: { id: true } } },
      });

      const pastDueIds   = pastDue.map(b => b.id);
      const unpaidIds    = unpaidPremium.map(b => b.id);
      const allIds       = [...new Set([...pastDueIds, ...unpaidIds])];

      if (allIds.length === 0) return;

      // Cancelar reservas vencidas
      await prisma.booking.updateMany({
        where: { id: { in: allIds } },
        data: { status: 'CANCELLED' },
      });

      // Marcar pagos PENDING huérfanos como FAILED
      const paymentIds = unpaidPremium
        .map(b => b.payment?.id)
        .filter((id): id is string => !!id);

      if (paymentIds.length > 0) {
        await prisma.payment.updateMany({
          where: { id: { in: paymentIds } },
          data: { status: 'FAILED' },
        });
      }

      console.log(
        `[cron] Canceladas ${allIds.length} reservas expiradas` +
        ` (${pastDueIds.length} vencidas, ${unpaidIds.length} sin pagar)`
      );
    } catch (err) {
      console.error('[cron] Error al cancelar reservas expiradas:', err);
    }
  });

  console.log('[cron] Job de cancelación de reservas expiradas iniciado (cada hora)');
}
