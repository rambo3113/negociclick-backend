import cron from 'node-cron';
import prisma from '../lib/prisma';
import { sendAppointmentReminder } from '../lib/email';

// Corre cada hora — envía recordatorio a clientes con cita en las próximas 23-25h
export function startAppointmentReminders() {
  cron.schedule('30 * * * *', async () => {
    try {
      const now   = new Date();
      const from  = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const to    = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const bookings = await prisma.booking.findMany({
        where: {
          status: { in: ['PENDING', 'CONFIRMED'] },
          date: { gte: from, lte: to },
          business: { orderMode: 'APPOINTMENT' }, // los pedidos (ORDER) no usan recordatorio de "cita"
        },
        include: {
          client:   { select: { email: true, name: true } },
          service:  { select: { name: true } },
          business: { select: { name: true, phone: true } },
        },
      });

      for (const booking of bookings) {
        await sendAppointmentReminder({
          clientEmail:   booking.client.email,
          clientName:    booking.client.name,
          serviceName:   booking.service.name,
          businessName:  booking.business.name,
          businessPhone: booking.business.phone,
          date:          booking.date,
        }).catch(() => {});
      }

      if (bookings.length > 0) {
        console.log(`[cron] Recordatorios enviados: ${bookings.length}`);
      }
    } catch (err) {
      console.error('[cron] Error en recordatorios de citas:', err);
    }
  });

  console.log('[cron] Job de recordatorios de citas iniciado (cada hora, :30)');
}
