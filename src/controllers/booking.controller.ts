import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { sendBookingCreatedToVendor, sendBookingCancelledToClient, sendBookingCancelledToVendor, sendPaymentReceivedToVendor, sendReviewReminderToClient, sendBookingRescheduledToVendor, sendOrderStatusUpdateToClient } from '../lib/email';

// Extrae hora/minuto/día de semana de un Date en zona horaria de Lima (UTC-5, sin DST)
function toLimaTimeParts(date: Date): { dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    weekday: 'short',
    hour:    '2-digit',
    minute:  '2-digit',
    hour12:  false,
  }).formatToParts(date);
  const DAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dayOfWeek: DAY_MAP[parts.find(p => p.type === 'weekday')?.value ?? 'Sun'] ?? 0,
    hour:      parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0'),
    minute:    parseInt(parts.find(p => p.type === 'minute')?.value ?? '0'),
  };
}


// ============================================
// 1. CREAR RESERVA (cliente)
// ============================================
export const createBooking = async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId;
    const { serviceId, date, notes, serviceIds, orderTotal, deliveryAddress } = req.body as {
      serviceId: string;
      date: string;
      notes?: string;
      serviceIds?: string[];
      orderTotal?: number;
      deliveryAddress?: string;
    };

    if (!serviceId || !date) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: serviceId, date' });
    }

    const bookingDate = new Date(date);
    if (isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }

    // Obtener el servicio y su negocio
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { business: true }
    });

    if (!service || !service.isActive) {
      return res.status(404).json({ error: 'Servicio no encontrado o inactivo' });
    }

    if (!service.business.isActive) {
      return res.status(400).json({ error: 'El negocio no está disponible' });
    }

    const isOrderMode = service.business.orderMode === 'ORDER';

    if (isOrderMode) {
      // Negocios de pedido (repostería, flores, catering...): solo importa el día de entrega
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deliveryDay = new Date(bookingDate);
      deliveryDay.setHours(0, 0, 0, 0);
      if (deliveryDay < today) {
        return res.status(400).json({ error: 'La fecha de entrega no puede ser anterior a hoy' });
      }
      if (!deliveryAddress || !deliveryAddress.trim()) {
        return res.status(400).json({ error: 'La dirección de entrega es obligatoria' });
      }
    } else {
      if (bookingDate < new Date()) {
        return res.status(400).json({ error: 'No puedes reservar una cita en el pasado' });
      }
    }

    if (bookingDate > new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) {
      return res.status(400).json({ error: 'No puedes reservar con más de 1 año de anticipación' });
    }

    // Verificar que el negocio no tenga bloqueada esa fecha (vacaciones, feriados, etc.)
    const blocked = await prisma.availabilityBlock.findFirst({
      where: {
        businessId: service.businessId,
        startDate: { lte: bookingDate },
        endDate:   { gte: bookingDate },
      },
    });
    if (blocked) {
      const reason = blocked.reason ? `: ${blocked.reason}` : '';
      return res.status(409).json({ error: `El negocio no está disponible en esa fecha${reason}` });
    }

    // Verificar horarios de atención del negocio (solo aplica a citas con hora fija)
    if (!isOrderMode) {
      const { dayOfWeek, hour: bkHour, minute: bkMinute } = toLimaTimeParts(bookingDate);
      const businessHrs = await prisma.businessHours.findUnique({
        where: { businessId_dayOfWeek: { businessId: service.businessId, dayOfWeek } },
      });
      if (businessHrs) {
        if (businessHrs.isClosed) {
          return res.status(400).json({ error: 'El negocio está cerrado ese día' });
        }
        const [openH, openM]   = businessHrs.openTime.split(':').map(Number);
        const [closeH, closeM] = businessHrs.closeTime.split(':').map(Number);
        const bkMinutes    = bkHour * 60 + bkMinute;
        const openMinutes  = openH  * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;
        if (bkMinutes < openMinutes || bkMinutes >= closeMinutes) {
          return res.status(400).json({
            error: `El negocio atiende de ${businessHrs.openTime} a ${businessHrs.closeTime}`,
          });
        }
      }
    }

    if (notes && notes.length > 500) {
      return res.status(400).json({ error: 'Las notas no pueden superar los 500 caracteres' });
    }

    const durationMs   = (service.duration ?? 60) * 60 * 1000;
    const requestedEnd = new Date(bookingDate.getTime() + durationMs);

    // Si vienen múltiples serviceIds, sumar precios desde BD (nunca confiar en monto del cliente)
    let totalAmount = Number(service.price);
    let serviceNamesTag: string | null = null;
    if (serviceIds && serviceIds.length > 1) {
      const extraServices = await prisma.service.findMany({
        where: { id: { in: serviceIds }, isActive: true, businessId: service.businessId },
        select: { price: true, name: true },
      });
      totalAmount = extraServices.reduce((s, sv) => s + Number(sv.price), 0);
      serviceNamesTag = `[SERVICIOS: ${extraServices.map(sv => sv.name).join(', ')}]`;
    }

    // Para pedidos (negocios ORDER) el frontend calcula el total correcto con cantidades (x2, x3, etc.)
    if (isOrderMode && typeof orderTotal === 'number' && orderTotal > 0) {
      totalAmount = orderTotal;
    }

    const finalNotes = serviceNamesTag
      ? (notes ? `${serviceNamesTag}\n${notes}` : serviceNamesTag)
      : (notes || null);

    const commission   = 0;
    const vendorAmount = totalAmount;

    // Transacción serializable: el chequeo de conflicto y la creación son atómicos
    // Los negocios ORDER no tienen slot de hora, así que no aplica el chequeo de conflicto
    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        if (!isOrderMode) {
          const conflicting = await tx.booking.findFirst({
            where: {
              serviceId,
              status: { in: ['PENDING', 'CONFIRMED'] },
              date: { lt: requestedEnd },
              AND: { date: { gte: new Date(bookingDate.getTime() - durationMs) } },
            },
          });
          if (conflicting) throw Object.assign(new Error(), { isSlotConflict: true });
        }

        return tx.booking.create({
          data: {
            date: bookingDate,
            totalAmount,
            commission,
            vendorAmount,
            notes: finalNotes,
            deliveryAddress: isOrderMode ? deliveryAddress!.trim() : null,
            clientId,
            businessId: service.businessId,
            serviceId,
          },
          include: {
            service:  { select: { name: true, price: true, duration: true } },
            business: { select: { name: true, address: true, city: true, phone: true, orderMode: true } },
            client:   { select: { name: true, email: true, phone: true } },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (txErr: any) {
      if (txErr.isSlotConflict || txErr.code === 'P2034') {
        return res.status(409).json({ error: 'Ese horario ya está reservado. Por favor elige otra hora.' });
      }
      throw txErr;
    }

    // Email al vendor (sin await para no bloquear la respuesta)
    const vendor = await prisma.user.findUnique({ where: { id: service.business.ownerId }, select: { email: true, name: true } });
    if (vendor) {
      sendBookingCreatedToVendor({
        vendorEmail: vendor.email,
        vendorName: vendor.name,
        clientName: booking.client.name,
        serviceName: booking.service.name,
        businessName: booking.business.name,
        date: booking.date,
        amount: Number(booking.totalAmount),
        orderMode: booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
        notes: booking.notes,
        deliveryAddress: booking.deliveryAddress,
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: 'Reserva creada exitosamente',
      booking
    });

  } catch (error: any) {
    console.error('Error al crear reserva:', error);
    res.status(500).json({ error: 'Error al crear reserva' });
  }
};

// ============================================
// 2. MIS RESERVAS (como cliente)
// ============================================
export const getMyBookings = async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId;
    const { status } = req.query as { status?: string };
    const page  = Math.max(1, parseInt((req.query.page  as string) || '1'));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20')));
    const skip  = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: { clientId, ...(status ? { status } : {}) },
        include: {
          service:  { select: { name: true, price: true, duration: true } },
          business: { select: { name: true, address: true, city: true, phone: true, ownerId: true, orderMode: true } },
          review:   { select: { id: true, rating: true, comment: true } },
          payment:  { select: { status: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.booking.count({ where: { clientId, ...(status ? { status } : {}) } }),
    ]);

    // Obtener plan de los owners (solo de la página actual, no de todos)
    const ownerIds = [...new Set(bookings.map((b: any) => b.business.ownerId))];
    const subs = ownerIds.length > 0
      ? await prisma.subscription.findMany({
          where: { userId: { in: ownerIds as string[] }, status: 'ACTIVE' },
          select: { userId: true, plan: true },
        })
      : [];
    const planMap: Record<string, string> = {};
    subs.forEach((s: any) => { planMap[s.userId] = s.plan; });

    const result = bookings.map((b: any) => ({
      ...b,
      business: { ...b.business, ownerPlan: planMap[b.business.ownerId] ?? 'FREE' },
    }));

    res.json({
      success: true,
      count: result.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      bookings: result,
    });

  } catch (error: any) {
    console.error('Error al obtener reservas:', error);
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
};

// ============================================
// 3. RESERVAS DE UN NEGOCIO (vendor/admin)
// ============================================
export const getBookingsByBusiness = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const businessId = req.params.businessId as string;
    const { status } = req.query as { status?: string };

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    if (business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para ver estas reservas' });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        businessId,
        ...(status ? { status } : {})
      },
      include: {
        service: { select: { name: true, price: true, duration: true } },
        client: { select: { name: true, email: true, phone: true } },
        review: { select: { id: true, rating: true, comment: true } },
        payment: { select: { status: true } },
      },
      orderBy: { date: 'desc' }
    });

    res.json({ success: true, count: bookings.length, bookings });

  } catch (error: any) {
    console.error('Error al obtener reservas del negocio:', error);
    res.status(500).json({ error: 'Error al obtener reservas del negocio' });
  }
};

// ============================================
// 4. OBTENER UNA RESERVA POR ID
// ============================================
export const getBookingById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        service: { select: { name: true, price: true, duration: true } },
        business: { select: { name: true, address: true, city: true, phone: true, ownerId: true } },
        client: { select: { name: true, email: true, phone: true } },
        review: true,
        payment: { select: { status: true, amount: true, provider: true } }
      }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const isClient = booking.clientId === userId;
    const isOwner = booking.business.ownerId === userId;

    if (!isClient && !isOwner && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para ver esta reserva' });
    }

    res.json({ success: true, booking });

  } catch (error: any) {
    console.error('Error al obtener reserva:', error);
    res.status(500).json({ error: 'Error al obtener reserva' });
  }
};

// ============================================
// 5. ACTUALIZAR ESTADO DE RESERVA (vendor/admin)
// ============================================
export const updateBookingStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const { status } = req.body as { status: string };

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        business: true,
        payment:  true,
        client:   { select: { name: true, email: true } },
        service:  { select: { name: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const isOrderMode = booking.business.orderMode === 'ORDER';

    // Máquina de estados: transiciones válidas según el tipo de negocio
    const TRANSITIONS: Record<string, string[]> = isOrderMode
      ? {
          PENDING:   ['PREPARING', 'CANCELLED'],
          PREPARING: ['DELIVERED', 'CANCELLED'],
          DELIVERED: [],
          CANCELLED: [],
        }
      : {
          PENDING:   ['CONFIRMED', 'CANCELLED'],
          CONFIRMED: ['COMPLETED', 'CANCELLED'],
          COMPLETED: [],
          CANCELLED: [],
        };

    const VALID_STATUSES = isOrderMode
      ? ['PREPARING', 'DELIVERED', 'CANCELLED']
      : ['CONFIRMED', 'COMPLETED', 'CANCELLED'];
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Estado inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}`
      });
    }

    if (booking.business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo el dueño del negocio puede cambiar el estado' });
    }

    if (!TRANSITIONS[booking.status]?.includes(status)) {
      return res.status(400).json({
        error: `No se puede pasar de ${booking.status} a ${status}`
      });
    }

    // Si el vendor cancela una reserva con pago PAID → reembolsar automáticamente
    if (status === 'CANCELLED' && booking.payment?.status === 'PAID' && booking.payment.providerId) {
      const refund = await fetch('https://api.culqi.com/v2/refunds', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount:    Math.round(Number(booking.payment.amount) * 100),
          reason:    'solicitud_comprador',
          charge_id: booking.payment.providerId,
        }),
      }).then(r => r.json());

      if (refund.object === 'error') {
        return res.status(400).json({ error: refund.user_message || 'No se pudo procesar el reembolso. Contacta soporte.' });
      }

      await prisma.payment.update({
        where: { id: booking.payment.id },
        data: { status: 'REFUNDED' },
      });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: { status }
    });

    // Notificar al cliente cuando el vendor cancela su reserva
    if (status === 'CANCELLED') {
      sendBookingCancelledToClient({
        clientEmail:  booking.client.email,
        clientName:   booking.client.name,
        serviceName:  booking.service.name,
        businessName: booking.business.name,
        orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
      }).catch(() => {});
    }

    // Recordatorio de reseña cuando se completa la reserva
    if (status === 'COMPLETED') {
      sendReviewReminderToClient({
        clientEmail:  booking.client.email,
        clientName:   booking.client.name,
        serviceName:  booking.service.name,
        businessName: booking.business.name,
        orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
      }).catch(() => {});
    }

    // Pedidos (negocios ORDER): avisar al cliente cuando pasa a preparación o se entrega
    if (isOrderMode && (status === 'PREPARING' || status === 'DELIVERED')) {
      sendOrderStatusUpdateToClient({
        clientEmail:  booking.client.email,
        clientName:   booking.client.name,
        businessName: booking.business.name,
        status,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Reserva ${status.toLowerCase()} exitosamente`,
      booking: updatedBooking
    });

  } catch (error: any) {
    console.error('Error al actualizar estado:', error);
    res.status(500).json({ error: 'Error al actualizar estado de la reserva' });
  }
};

// ============================================
// 6. REAGENDAR RESERVA (cliente)
// ============================================
export const rescheduleBooking = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const clientId = (req as any).userId;
    const { date } = req.body as { date: string };

    if (!date) {
      return res.status(400).json({ error: 'La nueva fecha es obligatoria' });
    }

    const newDate = new Date(date);
    if (isNaN(newDate.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    if (newDate <= new Date()) {
      return res.status(400).json({ error: 'La nueva fecha debe ser futura' });
    }
    if (newDate > new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) {
      return res.status(400).json({ error: 'No puedes reagendar con más de 1 año de anticipación' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        service: { include: { business: { select: { ownerId: true, name: true, orderMode: true } } } },
        client:  { select: { name: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (booking.clientId !== clientId) {
      return res.status(403).json({ error: 'Solo puedes reagendar tus propias reservas' });
    }

    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'No puedes reagendar una reserva completada o cancelada' });
    }

    // Verificar que el negocio no tenga bloqueada la nueva fecha
    const blocked = await prisma.availabilityBlock.findFirst({
      where: {
        businessId: booking.businessId,
        startDate: { lte: newDate },
        endDate:   { gte: newDate },
      },
    });
    if (blocked) {
      const reason = blocked.reason ? `: ${blocked.reason}` : '';
      return res.status(409).json({ error: `El negocio no está disponible en esa fecha${reason}` });
    }

    // Verificar horarios de atención para la nueva fecha
    const { dayOfWeek: newDow, hour: newHour, minute: newMinute } = toLimaTimeParts(newDate);
    const newDayHrs = await prisma.businessHours.findUnique({
      where: { businessId_dayOfWeek: { businessId: booking.businessId, dayOfWeek: newDow } },
    });
    if (newDayHrs) {
      if (newDayHrs.isClosed) {
        return res.status(400).json({ error: 'El negocio está cerrado ese día' });
      }
      const [openH, openM]   = newDayHrs.openTime.split(':').map(Number);
      const [closeH, closeM] = newDayHrs.closeTime.split(':').map(Number);
      const reqMin   = newHour * 60 + newMinute;
      const openMin  = openH  * 60 + openM;
      const closeMin = closeH * 60 + closeM;
      if (reqMin < openMin || reqMin >= closeMin) {
        return res.status(400).json({
          error: `El negocio atiende de ${newDayHrs.openTime} a ${newDayHrs.closeTime}`,
        });
      }
    }

    // Verificar conflicto en el nuevo horario (excluir la reserva actual)
    const durationMs = (booking.service.duration ?? 60) * 60 * 1000;
    const requestedEnd = new Date(newDate.getTime() + durationMs);

    const conflicting = await prisma.booking.findFirst({
      where: {
        id: { not: id },
        serviceId: booking.serviceId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        date: { lt: requestedEnd },
        AND: { date: { gte: new Date(newDate.getTime() - durationMs) } },
      },
    });

    if (conflicting) {
      return res.status(409).json({ error: 'Ese horario ya está reservado. Por favor elige otra hora.' });
    }

    const oldDate = booking.date;

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: { date: newDate, status: 'PENDING' }
    });

    // Notificar al vendor del cambio de horario
    const vendor = await prisma.user.findUnique({
      where: { id: booking.service.business.ownerId },
      select: { email: true, name: true },
    });
    if (vendor) {
      sendBookingRescheduledToVendor({
        vendorEmail:  vendor.email,
        vendorName:   vendor.name,
        clientName:   booking.client.name,
        serviceName:  booking.service.name,
        businessName: booking.service.business.name,
        oldDate,
        newDate,
        orderMode:    booking.service.business.orderMode as 'APPOINTMENT' | 'ORDER',
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Reserva reagendada exitosamente',
      booking: updatedBooking
    });

  } catch (error: any) {
    console.error('Error al reagendar reserva:', error);
    res.status(500).json({ error: 'Error al reagendar reserva' });
  }
};

// ============================================
// 7. CANCELAR RESERVA (cliente)
// ============================================
export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const clientId = (req as any).userId;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        payment:  true,
        client:   { select: { name: true } },
        service:  { select: { name: true } },
        business: { select: { name: true, ownerId: true, orderMode: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (booking.clientId !== clientId) {
      return res.status(403).json({ error: 'Solo puedes cancelar tus propias reservas' });
    }

    if (booking.status === 'COMPLETED' || booking.status === 'DELIVERED') {
      return res.status(400).json({ error: 'No puedes cancelar un pedido/reserva ya finalizado' });
    }

    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'La reserva ya está cancelada' });
    }

    // Política de cancelación: mínimo 2 horas de anticipación (solo aplica a citas con hora fija)
    if (booking.business.orderMode !== 'ORDER') {
      const hoursUntil = (booking.date.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil >= 0 && hoursUntil < 2) {
        return res.status(400).json({
          error: 'No se puede cancelar con menos de 2 horas de anticipación. Contacta al negocio directamente.',
        });
      }
    }

    // Si hay un pago confirmado, reembolsar en Culqi antes de cancelar
    if (booking.payment && booking.payment.status === 'PAID' && booking.payment.providerId) {
      const refund = await fetch('https://api.culqi.com/v2/refunds', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(Number(booking.payment.amount) * 100),
          reason: 'solicitud_comprador',
          charge_id: booking.payment.providerId,
        }),
      }).then(r => r.json());

      if (refund.object === 'error') {
        return res.status(400).json({ error: refund.user_message || 'No se pudo procesar el reembolso. Contacta soporte.' });
      }

      await prisma.payment.update({
        where: { id: booking.payment.id },
        data: { status: 'REFUNDED' },
      });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id },
      include: {
        client:   { select: { name: true, email: true } },
        service:  { select: { name: true } },
        business: { select: { name: true } },
      },
      data: { status: 'CANCELLED' }
    });

    sendBookingCancelledToClient({
      clientEmail:  updatedBooking.client.email,
      clientName:   updatedBooking.client.name,
      serviceName:  updatedBooking.service.name,
      businessName: updatedBooking.business.name,
      orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
    }).catch(() => {});

    // Notificar al vendor que el cliente canceló
    prisma.user.findUnique({ where: { id: booking.business.ownerId }, select: { email: true, name: true } })
      .then(vendor => {
        if (!vendor) return;
        sendBookingCancelledToVendor({
          vendorEmail:  vendor.email,
          vendorName:   vendor.name,
          clientName:   booking.client.name,
          serviceName:  booking.service.name,
          businessName: booking.business.name,
          date:         booking.date,
          orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
        }).catch(() => {});
      }).catch(() => {});

    const wasRefunded = !!(booking.payment && booking.payment.status === 'PAID');
    res.json({
      success: true,
      message: wasRefunded
        ? 'Reserva cancelada y reembolso procesado exitosamente'
        : 'Reserva cancelada exitosamente',
      booking: updatedBooking,
      refunded: wasRefunded,
    });

  } catch (error: any) {
    console.error('Error al cancelar reserva:', error);
    res.status(500).json({ error: 'Error al cancelar reserva' });
  }
};

// ============================================
// 8. MARCAR COMO PAGADO EN EFECTIVO (FREE/PRO vendor)
// ============================================
export const markAsPaid = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const vendorId = (req as any).userId as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        business: { select: { id: true, name: true, ownerId: true, orderMode: true } },
        service:  { select: { name: true } },
        client:   { select: { name: true, email: true } },
        payment:  true,
      },
    });

    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.business.ownerId !== vendorId) return res.status(403).json({ error: 'No tienes permiso' });

    // PREMIUM no usa efectivo — tiene Culqi
    const sub = await prisma.subscription.findFirst({
      where: { userId: vendorId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
    if (sub?.plan === 'PREMIUM') {
      return res.status(400).json({ error: 'Los negocios PREMIUM usan pago online. Usa Culqi.' });
    }

    if (booking.status === 'CANCELLED') return res.status(400).json({ error: 'La reserva está cancelada' });
    if (booking.payment?.status === 'PAID') return res.status(409).json({ error: 'La reserva ya está marcada como pagada' });

    // Registrar pago en efectivo
    await prisma.payment.upsert({
      where: { bookingId: id },
      create: {
        bookingId:        id,
        userId:           booking.clientId,
        amount:           booking.totalAmount,
        vendorAmount:     booking.vendorAmount,
        commissionAmount: booking.commission,
        status:           'PAID',
        provider:         'CASH',
      },
      update: {
        status:   'PAID',
        provider: 'CASH',
      },
    });

    await prisma.booking.update({ where: { id }, data: { status: 'COMPLETED' } });

    const vendor = await prisma.user.findUnique({ where: { id: vendorId }, select: { email: true, name: true } });
    if (vendor) {
      sendPaymentReceivedToVendor({
        vendorEmail:  vendor.email,
        vendorName:   vendor.name,
        clientName:   booking.client.name,
        serviceName:  booking.service.name,
        businessName: booking.business.name,
        date:         booking.date,
        amount:       Number(booking.totalAmount),
        commission:   Number(booking.commission),
        vendorAmount: Number(booking.vendorAmount),
        orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
        notes:        booking.notes,
      }).catch(() => {});
    }

    sendReviewReminderToClient({
      clientEmail:  booking.client.email,
      clientName:   booking.client.name,
      serviceName:  booking.service.name,
      businessName: booking.business.name,
      orderMode:    booking.business.orderMode as 'APPOINTMENT' | 'ORDER',
    }).catch(() => {});

    res.json({ success: true, message: 'Reserva marcada como pagada en efectivo' });

  } catch (error: any) {
    console.error('Error al marcar como pagado:', error);
    res.status(500).json({ error: 'Error al marcar como pagado' });
  }
};

// ============================================
// 9. HISTORIAL DE INGRESOS DEL NEGOCIO (vendor)
// ============================================
export const getEarnings = async (req: Request, res: Response) => {
  try {
    const vendorId   = (req as any).userId as string;
    const businessId = req.params.businessId as string;
    const { period } = req.query as { period?: string }; // 'week' | 'month' | 'year' | 'all'

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== vendorId) return res.status(403).json({ error: 'No tienes permiso' });

    const now = new Date();
    let since: Date | undefined;
    if (period === 'week')  since = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    if (period === 'month') since = new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'year')  since = new Date(now.getFullYear(), 0, 1);

    const payments = await prisma.payment.findMany({
      where: {
        status: 'PAID',
        booking: {
          businessId,
          ...(since ? { date: { gte: since } } : {}),
        },
      },
      include: {
        booking: {
          select: {
            date:    true,
            notes:   true,
            service: { select: { name: true } },
            client:  { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue    = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalCommission = payments.reduce((s, p) => s + Number(p.commissionAmount), 0);
    const totalNet        = payments.reduce((s, p) => s + Number(p.vendorAmount), 0);

    const transactions = payments.map(p => ({
      id:           p.id,
      date:         p.booking.date,
      clientName:   p.booking.client.name,
      serviceName:  p.booking.service.name,
      notes:        p.booking.notes,
      amount:       Number(p.amount),
      commission:   Number(p.commissionAmount),
      net:          Number(p.vendorAmount),
      provider:     p.provider,
    }));

    res.json({
      success: true,
      period:  period || 'all',
      summary: {
        totalRevenue:    parseFloat(totalRevenue.toFixed(2)),
        totalCommission: parseFloat(totalCommission.toFixed(2)),
        totalNet:        parseFloat(totalNet.toFixed(2)),
        transactionCount: payments.length,
      },
      transactions,
    });

  } catch (error: any) {
    console.error('Error al obtener ingresos:', error);
    res.status(500).json({ error: 'Error al obtener historial de ingresos' });
  }
};

// ============================================
// 10. AGENDA DIARIA DEL NEGOCIO (vendor)
// GET /api/bookings/agenda/:businessId?date=YYYY-MM-DD
// ============================================
export const getAgenda = async (req: Request, res: Response) => {
  try {
    const vendorId   = (req as any).userId as string;
    const businessId = req.params.businessId as string;
    const { date }   = req.query as { date?: string };

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== vendorId) return res.status(403).json({ error: 'No tienes permiso' });

    // Si no se pasa fecha, usar hoy en Lima (UTC-5)
    const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

    const [year, month, day] = targetDate.split('-').map(Number);
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day,     5, 0, 0)); // 00:00 Lima
    const dayEndUTC   = new Date(Date.UTC(year, month - 1, day + 1, 5, 0, 0)); // 23:59 Lima

    const bookings = await prisma.booking.findMany({
      where: {
        businessId,
        date: { gte: dayStartUTC, lt: dayEndUTC },
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
      include: {
        service: { select: { name: true, duration: true, price: true } },
        client:  { select: { name: true, phone: true, email: true } },
        payment: { select: { status: true, provider: true } },
      },
      orderBy: { date: 'asc' },
    });

    const result = bookings.map(b => ({
      id:          b.id,
      date:        b.date,
      status:      b.status,
      totalAmount: Number(b.totalAmount),
      notes:       b.notes,
      service:     { name: b.service.name, duration: b.service.duration ?? 60, price: Number(b.service.price) },
      client:      { name: b.client.name, phone: b.client.phone, email: b.client.email },
      payment:     b.payment ? { status: b.payment.status, provider: b.payment.provider } : null,
    }));

    res.json({ success: true, date: targetDate, bookings: result });
  } catch (error: any) {
    console.error('Error al obtener agenda:', error);
    res.status(500).json({ error: 'Error al obtener agenda' });
  }
};

// ============================================
// 11. SLOTS DISPONIBLES (público)
// GET /api/bookings/slots/:serviceId?date=YYYY-MM-DD
// ============================================
export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const serviceId = req.params.serviceId as string;
    const { date }  = req.query as { date?: string };

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Parámetro date requerido (formato: YYYY-MM-DD)' });
    }

    const service = await prisma.service.findUnique({
      where:  { id: serviceId },
      select: { id: true, duration: true, businessId: true, isActive: true, business: { select: { isActive: true } } },
    });

    if (!service || !service.isActive) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (!service.business.isActive)    return res.status(400).json({ error: 'El negocio no está disponible' });

    const duration = service.duration ?? 60;

    // Midnight Lima en UTC: Lima = UTC-5, así que 00:00 Lima = 05:00 UTC
    const [year, month, day] = date.split('-').map(Number);
    const dayStartUTC = new Date(Date.UTC(year, month - 1, day,     5, 0, 0));
    const dayEndUTC   = new Date(Date.UTC(year, month - 1, day + 1, 5, 0, 0));

    const { dayOfWeek } = toLimaTimeParts(dayStartUTC);

    // Verificar que el día no esté bloqueado por el negocio
    const blocked = await prisma.availabilityBlock.findFirst({
      where: {
        businessId: service.businessId,
        startDate: { lte: dayEndUTC },
        endDate:   { gte: dayStartUTC },
      },
    });
    if (blocked) {
      const reason = blocked.reason ? `: ${blocked.reason}` : '';
      return res.json({ success: true, date, slots: [], message: `El negocio no está disponible ese día${reason}` });
    }

    const hours = await prisma.businessHours.findUnique({
      where: { businessId_dayOfWeek: { businessId: service.businessId, dayOfWeek } },
    });

    if (!hours) {
      return res.json({ success: true, date, slots: [], message: 'El negocio no ha configurado sus horarios' });
    }
    if (hours.isClosed) {
      return res.json({ success: true, date, slots: [], message: 'El negocio está cerrado ese día' });
    }

    // Generar todos los slots posibles dentro del horario
    const [openH, openM]   = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMinutes  = openH  * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    const allSlots: string[] = [];
    for (let m = openMinutes; m + duration <= closeMinutes; m += duration) {
      const h   = Math.floor(m / 60);
      const min = m % 60;
      allSlots.push(`${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
    }

    // Reservas existentes en ese día
    const existingBookings = await prisma.booking.findMany({
      where: {
        serviceId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        date:   { gte: dayStartUTC, lt: dayEndUTC },
      },
      select: { date: true },
    });

    const now = new Date();

    const available = allSlots.filter(slot => {
      const [slotH, slotM] = slot.split(':').map(Number);
      const slotStart = slotH * 60 + slotM;
      const slotEnd   = slotStart + duration;

      // Descarta slots pasados (dayStartUTC es midnight Lima, +offset da el UTC del slot)
      const slotUTC = new Date(dayStartUTC.getTime() + (slotH * 60 + slotM) * 60_000);
      if (slotUTC <= now) return false;

      // Descarta slots que solapan con reservas existentes
      return !existingBookings.some(b => {
        const { hour: bH, minute: bM } = toLimaTimeParts(b.date);
        const bookedStart = bH * 60 + bM;
        const bookedEnd   = bookedStart + duration;
        return slotStart < bookedEnd && slotEnd > bookedStart;
      });
    });

    res.json({ success: true, date, duration, slots: available });

  } catch (error: any) {
    console.error('Error al obtener slots:', error);
    res.status(500).json({ error: 'Error al obtener slots disponibles' });
  }
};
