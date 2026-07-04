import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { sendBookingConfirmedToClient, sendPaymentReceivedToVendor } from '../lib/email';

const CULQI_API = 'https://api.culqi.com/v2';

async function culqiRequest(path: string, body: object) {
  const res = await fetch(`${CULQI_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ============================================
// 1. INICIAR PAGO — crea registro en BD
// ============================================
export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { bookingId } = req.body as { bookingId: string };

    if (!bookingId) return res.status(400).json({ error: 'Falta bookingId' });

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.clientId !== userId) return res.status(403).json({ error: 'No puedes pagar una reserva que no es tuya' });
    if (booking.status === 'CANCELLED') return res.status(400).json({ error: 'No puedes pagar una reserva cancelada' });
    if (booking.payment) {
      // Si ya está pagado, bloquear. Si está PENDING, devolver el pago existente para reintentar.
      if (booking.payment.status === 'PAID') {
        return res.status(409).json({ error: 'Esta reserva ya fue pagada' });
      }
      return res.status(200).json({ success: true, payment: booking.payment });
    }

    const payment = await prisma.payment.create({
      data: {
        amount: booking.totalAmount,
        currency: 'PEN',
        status: 'PENDING',
        provider: 'CULQI',
        commissionAmount: booking.commission,
        vendorAmount: booking.vendorAmount,
        bookingId,
        userId,
      },
    });

    res.status(201).json({ success: true, payment });

  } catch (error: any) {
    console.error('Error al iniciar pago:', error);
    res.status(500).json({ error: 'Error al iniciar pago' });
  }
};

// ============================================
// 2. COBRAR — envía token de Culqi a la API
// ============================================
export const chargePayment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const { token } = req.body as { token: string };

    if (!token) return res.status(400).json({ error: 'Falta token de pago' });

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
    if (payment.userId !== userId) return res.status(403).json({ error: 'No tienes permiso' });
    if (payment.status === 'PAID') return res.status(400).json({ error: 'Este pago ya fue procesado' });

    // Email tomado del JWT (no del body) para evitar falsificación
    const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!userRecord) return res.status(404).json({ error: 'Usuario no encontrado' });
    const email = userRecord.email;

    const amountInCents = Math.round(Number(payment.amount) * 100);

    const charge = await culqiRequest('/charges', {
      amount: amountInCents,
      currency_code: 'PEN',
      email,
      source_id: token,
      description: `NegociClick - Reserva #${payment.bookingId.slice(0, 8)}`,
      metadata: { bookingId: payment.bookingId },
    });

    if (charge.object === 'error' || !charge.id) {
      const message = charge.merchant_message || charge.user_message || 'Pago rechazado';
      return res.status(400).json({ error: message });
    }

    const [updatedPayment] = await prisma.$transaction([
      prisma.payment.update({
        where: { id },
        data: { status: 'PAID', providerId: charge.id },
      }),
      prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: 'CONFIRMED' },
      }),
    ]);

    // Emails de confirmación
    const fullBooking = await prisma.booking.findUnique({
      where: { id: payment.bookingId },
      include: {
        client:   { select: { name: true, email: true } },
        service:  { select: { name: true } },
        business: { select: { name: true, phone: true, orderMode: true } },
      },
    });
    if (fullBooking) {
      sendBookingConfirmedToClient({
        clientEmail:   fullBooking.client.email,
        clientName:    fullBooking.client.name,
        serviceName:   fullBooking.service.name,
        businessName:  fullBooking.business.name,
        businessPhone: fullBooking.business.phone,
        date:          fullBooking.date,
        amount:        Number(payment.amount),
        orderMode:     fullBooking.business.orderMode as 'APPOINTMENT' | 'ORDER',
        notes:         fullBooking.notes,
        deliveryAddress: fullBooking.deliveryAddress,
      }).catch(() => {});

      // Notificar al vendor — buscamos el dueño por businessId del booking
      const biz = await prisma.business.findUnique({
        where: { id: payment.booking.businessId },
        select: { ownerId: true },
      });
      if (biz) {
        const vendor = await prisma.user.findUnique({
          where: { id: biz.ownerId },
          select: { email: true, name: true },
        });
        if (vendor) {
          sendPaymentReceivedToVendor({
            vendorEmail:  vendor.email,
            vendorName:   vendor.name,
            clientName:   fullBooking.client.name,
            serviceName:  fullBooking.service.name,
            businessName: fullBooking.business.name,
            date:         fullBooking.date,
            amount:       Number(payment.amount),
            vendorAmount: Number(payment.vendorAmount),
            commission:   Number(payment.commissionAmount),
            orderMode:    fullBooking.business.orderMode as 'APPOINTMENT' | 'ORDER',
          }).catch(() => {});
        }
      }
    }

    res.json({ success: true, message: 'Pago exitoso. Reserva confirmada.', payment: updatedPayment });

  } catch (error: any) {
    console.error('Error al cobrar:', error);
    res.status(500).json({ error: 'Error al procesar el pago' });
  }
};

// ============================================
// 3. REEMBOLSAR (admin)
// ============================================
export const refundPayment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
    if (payment.status !== 'PAID') return res.status(400).json({ error: 'Solo se pueden reembolsar pagos completados' });

    if (payment.provider === 'CULQI' && payment.providerId) {
      const refund = await culqiRequest('/refunds', {
        amount: Math.round(Number(payment.amount) * 100),
        reason: 'solicitud_comprador',
        charge_id: payment.providerId,
      });
      if (refund.object === 'error') {
        return res.status(400).json({ error: refund.user_message || 'Error al reembolsar en Culqi' });
      }
    }

    const [updatedPayment] = await prisma.$transaction([
      prisma.payment.update({ where: { id }, data: { status: 'REFUNDED' } }),
      prisma.booking.update({ where: { id: payment.bookingId }, data: { status: 'CANCELLED' } }),
    ]);

    res.json({ success: true, message: 'Reembolso procesado.', payment: updatedPayment });

  } catch (error: any) {
    console.error('Error al reembolsar:', error);
    res.status(500).json({ error: 'Error al reembolsar pago' });
  }
};

// ============================================
// 4. MIS PAGOS (cliente)
// ============================================
export const getMyPayments = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const payments = await prisma.payment.findMany({
      where: { userId },
      include: {
        booking: {
          select: {
            date: true, status: true,
            business: { select: { name: true, city: true } },
            service: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, count: payments.length, payments });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
};

// ============================================
// 5. DETALLE DE UN PAGO
// ============================================
export const getPaymentById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            business: { select: { name: true, ownerId: true } },
            service: { select: { name: true } },
            client: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

    const isClient = payment.userId === userId;
    const isVendor = payment.booking.business.ownerId === userId;
    if (!isClient && !isVendor && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para ver este pago' });
    }

    res.json({ success: true, payment });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener pago' });
  }
};

// ============================================
// 6. TODOS LOS PAGOS (admin)
// ============================================
export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const payments = await prisma.payment.findMany({
      where: status ? { status } : {},
      include: {
        user: { select: { name: true, email: true } },
        booking: {
          select: {
            date: true,
            business: { select: { name: true } },
            service: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue = payments
      .filter((p: typeof payments[0]) => p.status === 'PAID')
      .reduce((sum: number, p: typeof payments[0]) => sum + Number(p.commissionAmount), 0);

    res.json({ success: true, count: payments.length, totalCommissionRevenue: parseFloat(totalRevenue.toFixed(2)), payments });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar pagos' });
  }
};

// ============================================
// 7. WEBHOOK DE CULQI
// ============================================
export const handleWebhook = async (req: Request, res: Response) => {
  const event = req.body as { type?: string; data?: { object?: any } };

  if (!event.type || !event.data?.object) {
    return res.status(400).json({ error: 'Evento de webhook inválido' });
  }

  try {
    if (event.type === 'charge.succeeded') {
      const chargeFromWebhook = event.data.object as { id: string; metadata?: { bookingId?: string } };
      const bookingId = chargeFromWebhook.metadata?.bookingId;
      if (!bookingId) return res.json({ received: true });

      // Re-verificar el cobro directamente con Culqi para evitar webhooks falsificados
      const verified = await fetch(`https://api.culqi.com/v2/charges/${chargeFromWebhook.id}`, {
        headers: { Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}` },
      }).then(r => r.json()) as { object?: string; outcome?: { type?: string } };

      if (verified.object !== 'charge' || verified.outcome?.type !== 'venta_exitosa') {
        console.warn(`[webhook] Cobro ${chargeFromWebhook.id} no verificado con Culqi`);
        return res.json({ received: true });
      }

      const payment = await prisma.payment.findFirst({ where: { bookingId } });
      if (payment && payment.status !== 'PAID') {
        await prisma.$transaction([
          prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'PAID', providerId: chargeFromWebhook.id },
          }),
          prisma.booking.update({
            where: { id: bookingId },
            data: { status: 'CONFIRMED' },
          }),
        ]);
        console.log(`[webhook] charge.succeeded verificado — booking ${bookingId} confirmada`);
      }
    }

    if (event.type === 'charge.failed') {
      const charge = event.data.object as { id: string; failure_message?: string };
      console.warn(`[webhook] charge.failed — id: ${charge.id}, razón: ${charge.failure_message ?? 'desconocida'}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[webhook] Error al procesar evento:', error);
    res.status(500).json({ error: 'Error interno al procesar webhook' });
  }
};
