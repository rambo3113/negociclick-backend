import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { sendSubscriptionConfirmed } from '../lib/email';
import { invalidateSubscription } from '../lib/cache';

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

const PLANS: Record<string, { price: number; commissionRate: number; maxServices: number | null }> = {
  FREE:    { price: 0,     commissionRate: 0, maxServices: 5    },
  PRO:     { price: 29.99, commissionRate: 0, maxServices: 15   },
  PREMIUM: { price: 79.99, commissionRate: 0, maxServices: null }
};

// Server-side pricing source of truth — never trust client-sent amounts
const PERIOD_PRICING: Record<string, Record<string, { total: number; months: number }>> = {
  PRO: {
    monthly:   { total: 29.99,  months: 1  },
    '3months': { total: 80.97,  months: 3  },
    '6months': { total: 143.94, months: 6  },
  },
  PREMIUM: {
    monthly: { total: 79.99,  months: 1  },
    annual:  { total: 767.88, months: 12 },
  },
};

// ============================================
// 1. VER MI SUSCRIPCIÓN ACTUAL
// ============================================
export const getMySubscription = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' }
    });

    if (!subscription) {
      return res.json({
        success: true,
        subscription: null,
        daysUntilExpiry: null,
        message: 'No tienes una suscripción activa. Estás en el plan FREE por defecto.'
      });
    }

    let daysUntilExpiry: number | null = null;
    if (subscription.endDate) {
      const diff = new Date(subscription.endDate).getTime() - Date.now();
      daysUntilExpiry = Math.ceil(diff / 86_400_000);
    }

    res.json({
      success: true,
      subscription,
      daysUntilExpiry,
      isTrial: (subscription as any).isTrial ?? false,
    });

  } catch (error: any) {
    console.error('Error al obtener suscripción:', error);
    res.status(500).json({ error: 'Error al obtener suscripción' });
  }
};

// ============================================
// TRIAL — 14 días gratis (PRO o PREMIUM)
// ============================================
export const activateTrial = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { plan } = req.body as { plan: 'PRO' | 'PREMIUM' };

    if (!plan || !['PRO', 'PREMIUM'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido. Elige PRO o PREMIUM.' });
    }

    // Verificar que no haya usado trial antes
    const prevTrial = await prisma.subscription.findFirst({
      where: { userId, isTrial: true },
    });
    if (prevTrial) {
      return res.status(409).json({ error: 'Ya usaste tu trial gratuito. ¡Suscríbete para continuar disfrutando los beneficios!' });
    }

    // Verificar que esté en plan FREE
    const activeSub = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (activeSub && (activeSub as any).plan !== 'FREE') {
      return res.status(409).json({ error: 'Ya tienes un plan de pago activo.' });
    }

    // Verificar que tiene al menos 1 negocio activo con al menos 1 servicio activo
    const business = await prisma.business.findFirst({
      where: { ownerId: userId, isActive: true },
      include: { services: { where: { isActive: true }, take: 1 } },
    });
    if (!business) {
      return res.status(400).json({ error: 'Primero crea y activa tu negocio para acceder al trial.' });
    }
    if (business.services.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos 1 servicio a tu negocio para activar el trial.' });
    }

    const { commissionRate, maxServices } = PLANS[plan];
    const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Cancelar FREE activo si existe
    await prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', endDate: new Date() },
    });

    const subscription = await prisma.subscription.create({
      data: {
        plan,
        status:        'ACTIVE',
        commissionRate,
        maxServices,
        price:         0,
        isTrial:       true,
        autoRenew:     false,
        endDate,
        userId,
      },
    });

    invalidateSubscription(userId);

    res.status(201).json({
      success: true,
      message: `¡Trial de 14 días ${plan} activado! Vence el ${endDate.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}.`,
      subscription,
      trialEndsAt: endDate,
    });

  } catch (error: any) {
    console.error('Error al activar trial:', error);
    res.status(500).json({ error: 'Error al activar el trial' });
  }
};

// ============================================
// 2. SUSCRIBIRSE A UN PLAN
// ============================================
export const subscribe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { plan } = req.body as { plan: string };

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({
        error: `Plan inválido. Opciones disponibles: ${Object.keys(PLANS).join(', ')}`
      });
    }

    // Cancelar suscripción activa anterior
    await prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', endDate: new Date() }
    });

    const { price, commissionRate, maxServices } = PLANS[plan];

    const subscription = await prisma.subscription.create({
      data: {
        plan,
        status: 'ACTIVE',
        commissionRate,
        maxServices,
        price,
        userId
      }
    });

    invalidateSubscription(userId);
    res.status(201).json({
      success: true,
      message: `Suscripción al plan ${plan} activada exitosamente`,
      subscription
    });

  } catch (error: any) {
    console.error('Error al suscribirse:', error);
    res.status(500).json({ error: 'Error al procesar la suscripción' });
  }
};

// ============================================
// 3. CANCELAR SUSCRIPCIÓN
// ============================================
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No tienes una suscripción activa' });
    }

    if (subscription.plan === 'FREE') {
      return res.status(400).json({ error: 'No puedes cancelar el plan FREE' });
    }

    const cancelled = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED', endDate: new Date(), autoRenew: false }
    });

    invalidateSubscription(userId);
    res.json({
      success: true,
      message: 'Suscripción cancelada. Permanecerá activa hasta el fin del período.',
      subscription: cancelled
    });

  } catch (error: any) {
    console.error('Error al cancelar suscripción:', error);
    res.status(500).json({ error: 'Error al cancelar suscripción' });
  }
};

// ============================================
// 4. HISTORIAL DE SUSCRIPCIONES
// ============================================
export const getSubscriptionHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' }
    });

    res.json({ success: true, count: subscriptions.length, subscriptions });

  } catch (error: any) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error al obtener historial de suscripciones' });
  }
};

// ============================================
// 5. LISTAR TODOS (solo admin)
// ============================================
export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const { status, plan } = req.query as { status?: string; plan?: string };

    const subscriptions = await prisma.subscription.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(plan ? { plan } : {})
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { startDate: 'desc' }
    });

    res.json({ success: true, count: subscriptions.length, subscriptions });

  } catch (error: any) {
    console.error('Error al listar suscripciones:', error);
    res.status(500).json({ error: 'Error al listar suscripciones' });
  }
};

// ============================================
// 6. PAGAR Y ACTIVAR PLAN (con Culqi)
// ============================================
export const subscribePaid = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { plan, token, period = 'monthly' } = req.body as { plan: string; token?: string; period?: string };

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({
        error: `Plan inválido. Opciones: ${Object.keys(PLANS).join(', ')}`
      });
    }

    if (plan === 'FREE') {
      return res.status(400).json({ error: 'El plan FREE es gratuito — usa POST /subscriptions en su lugar' });
    }

    const { commissionRate, maxServices } = PLANS[plan];

    // Resolve total amount server-side — never trust client-sent amounts
    const periodData = PERIOD_PRICING[plan]?.[period] ?? { total: PLANS[plan].price, months: 1 };
    const totalPrice = periodData.total;
    const months = periodData.months;

    let culqiChargeId: string | null = null;

    if (totalPrice > 0) {
      if (!token) {
        return res.status(400).json({ error: 'Se requiere token de pago para planes de pago' });
      }

      // Email desde la BD del usuario autenticado, nunca del body
      const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!userRecord) return res.status(404).json({ error: 'Usuario no encontrado' });

      const periodLabel = months === 1 ? 'mensual' : `${months} meses`;
      const charge = await culqiRequest('/charges', {
        amount: Math.round(totalPrice * 100),
        currency_code: 'PEN',
        email: userRecord.email,
        source_id: token,
        description: `NegociClick - Plan ${plan} (${periodLabel})`,
        metadata: { userId, plan, period, months },
      });

      if (charge.object === 'error' || !charge.id) {
        const message = charge.merchant_message || charge.user_message || 'Pago rechazado por la entidad bancaria';
        return res.status(400).json({ error: message });
      }

      culqiChargeId = charge.id;
    }

    await prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', endDate: new Date() }
    });

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const subscription = await prisma.subscription.create({
      data: {
        plan, status: 'ACTIVE', commissionRate, maxServices,
        price: totalPrice, endDate, userId,
        culqiChargeId,
      }
    });

    const vendor = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (vendor) {
      sendSubscriptionConfirmed({ email: vendor.email, name: vendor.name, plan, price: totalPrice }).catch(() => {});
    }

    invalidateSubscription(userId);
    res.status(201).json({
      success: true,
      message: `Plan ${plan} activado exitosamente`,
      subscription
    });

  } catch (error: any) {
    console.error('Error al pagar suscripción:', error);
    res.status(500).json({ error: 'Error al procesar el pago' });
  }
};

// ============================================
// 7. REEMBOLSAR SUSCRIPCIÓN (solo admin)
// ============================================
export const refundSubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const subscription = await prisma.subscription.findUnique({ where: { id } });
    if (!subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'CANCELLED') {
      return res.status(400).json({ error: 'Solo se pueden reembolsar suscripciones ACTIVE o CANCELLED' });
    }
    if (!subscription.culqiChargeId) {
      return res.status(400).json({ error: 'Esta suscripción no tiene cobro registrado en Culqi (puede ser plan FREE o anterior a esta funcionalidad)' });
    }

    const refund = await culqiRequest('/refunds', {
      amount: Math.round(Number(subscription.price) * 100),
      reason: 'solicitud_comprador',
      charge_id: subscription.culqiChargeId,
    });

    if (refund.object === 'error') {
      return res.status(400).json({ error: refund.user_message || refund.merchant_message || 'Error al reembolsar en Culqi' });
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: { status: 'CANCELLED', endDate: new Date() },
    });

    invalidateSubscription(subscription.userId);
    res.json({ success: true, message: 'Suscripción reembolsada y cancelada.', subscription: updated });

  } catch (error: any) {
    console.error('Error al reembolsar suscripción:', error);
    res.status(500).json({ error: 'Error al reembolsar suscripción' });
  }
};

// ============================================
// 8. INFO DE PLANES DISPONIBLES (público)
// ============================================
export const getPlans = (_req: Request, res: Response) => {
  const plans = Object.entries(PLANS).map(([name, details]) => ({
    name,
    price: details.price,
    commissionRate: `${(details.commissionRate * 100).toFixed(0)}%`,
    maxServices: details.maxServices ?? 'Ilimitado',
    currency: 'PEN'
  }));

  res.json({ success: true, plans });
};
