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
          business: { orderMode: 'APPOINTMENT', remindersEnabled: true }, // los pedidos (ORDER) no usan recordatorio de "cita"
        },
        include: {
          client:   { select: { email: true, name: true } },
          service:  { select: { name: true } },
          business: { select: { name: true, phone: true } },
          reminderLogs: {
            where: { status: 'sent' },
            orderBy: { sentAt: 'desc' },
            take: 1,
          },
        },
      });

      let sentCount = 0;
      for (const booking of bookings) {
        // No reenviar si ya se mandó un recordatorio para esta reserva en las últimas 12h
        // (el cron corre cada hora; la ventana de 23-25h antes puede solapar entre corridas)
        const lastSent = booking.reminderLogs[0]?.sentAt;
        if (lastSent && Date.now() - lastSent.getTime() < 12 * 60 * 60 * 1000) continue;

        try {
          await sendAppointmentReminder({
            clientEmail:   booking.client.email,
            clientName:    booking.client.name,
            serviceName:   booking.service.name,
            businessName:  booking.business.name,
            businessPhone: booking.business.phone,
            date:          booking.date,
          });
          await prisma.reminderLog.create({ data: { bookingId: booking.id, status: 'sent' } });
          sentCount++;
        } catch (err) {
          await prisma.reminderLog.create({
            data: { bookingId: booking.id, status: 'failed', errorMsg: String(err) },
          }).catch(() => {});
        }
      }

      if (sentCount > 0) {
        console.log(`[cron] Recordatorios enviados: ${sentCount}`);
      }
    } catch (err) {
      console.error('[cron] Error en recordatorios de citas:', err);
    }
  });

  console.log('[cron] Job de recordatorios de citas iniciado (cada hora, :30)');
}
