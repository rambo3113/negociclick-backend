import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import {
  encryptPaymentKey,
  decryptPaymentKey,
  validateKeyFormat,
  validateCulqiSecretKey,
} from '../utils/paymentKeys.util';

// Helper: verifica que el usuario autenticado sea dueño del negocio y que tenga plan PREMIUM
async function requirePremiumOwner(
  req: Request,
  res: Response,
): Promise<{ businessId: string; userId: string } | null> {
  const businessId = req.params.id as string;
  const userId = (req as any).userId as string;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true },
  });
  if (!business) { res.status(404).json({ error: 'Negocio no encontrado' }); return null; }
  if (business.ownerId !== userId) { res.status(403).json({ error: 'No tienes permiso' }); return null; }

  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { startDate: 'desc' },
    select: { plan: true },
  });
  if (sub?.plan !== 'PREMIUM') {
    res.status(403).json({ error: 'Necesitas el plan PREMIUM para configurar cobros con tarjeta' });
    return null;
  }

  return { businessId, userId };
}

// ============================================
// GET /businesses/:id/payment-config
// ============================================
export const getPaymentConfig = async (req: Request, res: Response) => {
  try {
    const ctx = await requirePremiumOwner(req, res);
    if (!ctx) return;

    const biz = await prisma.business.findUnique({
      where: { id: ctx.businessId },
      select: {
        culqiPublicKey: true,
        culqiSecretKeyEnc: true,
        culqiKeysValidatedAt: true,
        paymentInstructions: true,
      },
    });

    const hasKeys = !!(biz?.culqiPublicKey && biz?.culqiSecretKeyEnc);
    let secretKeyMasked: string | null = null;
    if (hasKeys && biz!.culqiSecretKeyEnc) {
      try {
        const plain = decryptPaymentKey(biz!.culqiSecretKeyEnc);
        // Mostrar prefijo + últimos 4 caracteres
        secretKeyMasked = plain.slice(0, 8) + '…' + plain.slice(-4);
      } catch {
        secretKeyMasked = '••••••••';
      }
    }

    res.json({
      success: true,
      config: {
        publicKey: biz?.culqiPublicKey ?? null,
        secretKeyMasked,
        validatedAt: biz?.culqiKeysValidatedAt ?? null,
        onlinePaymentEnabled: !!biz?.culqiKeysValidatedAt,
        paymentInstructions: biz?.paymentInstructions ?? null,
      },
    });
  } catch (err) {
    console.error('[payment-config] GET error:', err);
    res.status(500).json({ error: 'Error al obtener configuración de cobros' });
  }
};

// ============================================
// PUT /businesses/:id/payment-config
// Body: { publicKey, secretKey } — ambas obligatorias para activar pago online
// ============================================
export const upsertPaymentConfig = async (req: Request, res: Response) => {
  try {
    const ctx = await requirePremiumOwner(req, res);
    if (!ctx) return;

    const { publicKey, secretKey } = req.body as { publicKey?: string; secretKey?: string };

    if (!publicKey || !secretKey) {
      return res.status(400).json({ error: 'Se requieren publicKey y secretKey' });
    }

    // 1) Validación de formato
    const formatError = validateKeyFormat(publicKey.trim(), secretKey.trim());
    if (formatError) return res.status(400).json({ error: formatError });

    // 2) Verificación real contra Culqi
    let valid: boolean;
    try {
      valid = await validateCulqiSecretKey(secretKey.trim());
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }

    if (!valid) {
      return res.status(400).json({
        error: 'Culqi rechazó la clave secreta — verifica que la copiaste completa y sin espacios',
      });
    }

    // 3) Guardar: cifrar sk, guardar pk en texto (es pública), marcar validación
    const encryptedSk = encryptPaymentKey(secretKey.trim());
    await prisma.business.update({
      where: { id: ctx.businessId },
      data: {
        culqiPublicKey: publicKey.trim(),
        culqiSecretKeyEnc: encryptedSk,
        culqiKeysValidatedAt: new Date(),
      },
    });

    console.log(`[payment-config] llaves configuradas — business=${ctx.businessId} env=${publicKey.startsWith('pk_live_') ? 'LIVE' : 'TEST'}`);

    res.json({
      success: true,
      message: 'Llaves configuradas correctamente. Tus clientes ya pueden pagar con tarjeta.',
      onlinePaymentEnabled: true,
    });
  } catch (err) {
    console.error('[payment-config] PUT error:', err);
    res.status(500).json({ error: 'Error al guardar configuración de cobros' });
  }
};

// ============================================
// DELETE /businesses/:id/payment-config
// Quita las llaves → el negocio vuelve a pago directo
// ============================================
export const deletePaymentConfig = async (req: Request, res: Response) => {
  try {
    const ctx = await requirePremiumOwner(req, res);
    if (!ctx) return;

    await prisma.business.update({
      where: { id: ctx.businessId },
      data: {
        culqiPublicKey: null,
        culqiSecretKeyEnc: null,
        culqiKeysValidatedAt: null,
      },
    });

    console.log(`[payment-config] llaves eliminadas — business=${ctx.businessId}`);
    res.json({ success: true, message: 'Llaves de Culqi eliminadas. El negocio vuelve a pago directo.' });
  } catch (err) {
    console.error('[payment-config] DELETE error:', err);
    res.status(500).json({ error: 'Error al eliminar configuración de cobros' });
  }
};

// ============================================
// PUT /businesses/:id/payment-instructions
// Cualquier dueño (FREE/PRO/PREMIUM) puede editar instrucciones de pago directo
// ============================================
export const updatePaymentInstructions = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.id as string;
    const userId = (req as any).userId as string;
    const { paymentInstructions } = req.body as { paymentInstructions?: string };

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true },
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    await prisma.business.update({
      where: { id: businessId },
      data: { paymentInstructions: paymentInstructions?.trim() || null },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[payment-instructions] error:', err);
    res.status(500).json({ error: 'Error al guardar instrucciones de pago' });
  }
};
