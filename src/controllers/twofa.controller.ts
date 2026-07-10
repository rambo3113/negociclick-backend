import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.util';
import {
  generateTOTPSecret,
  generateQRCode,
  generateBackupCodes,
  verifyTOTPToken,
  encryptSecret,
  decryptSecret,
} from '../utils/twofa.util';
import { audit } from '../lib/audit';

const JWT_SECRET = process.env.JWT_SECRET!;

// POST /api/auth/2fa/setup
// Genera secret + QR + backup codes (no guarda en BD todavía)
export const setup2FA = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA ya está habilitado. Deshabilítalo primero si quieres cambiarlo.' });
    }

    const secret = generateTOTPSecret(user.email);
    const qrCode = await generateQRCode(secret.otpauth_url!);
    const backupCodes = generateBackupCodes();

    res.json({
      secret: secret.base32,
      qrCode,
      backupCodes,
      message: 'Escanea el QR con Google Authenticator, Authy o Microsoft Authenticator. Guarda los códigos de respaldo en un lugar seguro.',
    });
  } catch (error) {
    console.error('[2FA setup]', error);
    res.status(500).json({ error: 'Error al generar configuración 2FA' });
  }
};

// POST /api/auth/2fa/enable
// Confirma el código TOTP y persiste 2FA en la BD
export const enable2FA = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { secret, totp, backupCodes } = req.body as {
      secret: string;
      totp: string;
      backupCodes: string[];
    };

    if (!secret || !totp || !Array.isArray(backupCodes) || backupCodes.length === 0) {
      return res.status(400).json({ error: 'Faltan campos: secret, totp, backupCodes' });
    }
    if (!/^\d{6}$/.test(totp)) {
      return res.status(400).json({ error: 'El código TOTP debe ser de 6 dígitos' });
    }

    const isValid = verifyTOTPToken(secret, totp);
    if (!isValid) {
      return res.status(400).json({ error: 'Código TOTP incorrecto. Asegúrate de que el reloj de tu dispositivo esté sincronizado.' });
    }

    // Hashear cada backup code por separado
    const hashedBackupCodes = await Promise.all(
      backupCodes.map(code => bcrypt.hash(code, 10)),
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: encryptSecret(secret),
        twoFactorBackupCodes: hashedBackupCodes,
        twoFactorVerifiedAt: new Date(),
      },
    });

    audit('2FA_ENABLED', { userId, req });

    res.json({ success: true, message: '2FA habilitado exitosamente.' });
  } catch (error) {
    console.error('[2FA enable]', error);
    res.status(500).json({ error: 'Error al habilitar 2FA' });
  }
};

// POST /api/auth/2fa/verify-login
// Segunda fase del login: verifica TOTP o backup code con tempToken
export const verifyLogin2FA = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const tempToken = authHeader?.split(' ')[1];
    const { code } = req.body as { code: string };

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Token temporal y código son requeridos' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token temporal expirado o inválido. Inicia sesión nuevamente.' });
    }

    if (decoded.purpose !== '2fa_pending') {
      return res.status(401).json({ error: 'Token no válido para verificación 2FA' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
      return res.status(401).json({ error: 'Usuario sin 2FA activo' });
    }

    // Intentar TOTP (6 dígitos numéricos)
    if (/^\d{6}$/.test(code)) {
      const isValid = verifyTOTPToken(decryptSecret(user.twoFactorSecret), code);
      if (isValid) {
        return issueFullTokens(user, res, req);
      }
    }

    // Intentar backup code (8 chars hex en mayúsculas)
    const normalizedCode = code.toUpperCase().trim();
    for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
      const match = await bcrypt.compare(normalizedCode, user.twoFactorBackupCodes[i]);
      if (match) {
        // Eliminar el código usado (single-use)
        const remaining = user.twoFactorBackupCodes.filter((_, idx) => idx !== i);
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: remaining },
        });
        audit('2FA_BACKUP_CODE_USED', { userId: user.id, meta: { remaining: remaining.length }, req });
        return issueFullTokens(user, res, req, remaining.length);
      }
    }

    audit('2FA_FAILED', { userId: user.id, meta: { reason: 'invalid_code' }, req });
    return res.status(401).json({ error: 'Código incorrecto. Verifica tu autenticador o usa un código de respaldo.' });
  } catch (error) {
    console.error('[2FA verify-login]', error);
    res.status(500).json({ error: 'Error al verificar código 2FA' });
  }
};

async function issueFullTokens(
  user: { id: string; email: string; role: string; name: string; phone: string | null; emailVerified: boolean },
  res: Response,
  req: Request,
  backupCodesRemaining?: number,
) {
  const accessToken = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });
  audit('LOGIN', { userId: user.id, meta: { email: user.email, via: '2fa' }, req });

  const body: Record<string, unknown> = {
    success: true,
    token: accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role, emailVerified: user.emailVerified },
  };
  if (backupCodesRemaining !== undefined) {
    body.backupCodesRemaining = backupCodesRemaining;
    body.warning = backupCodesRemaining <= 3 ? 'Te quedan pocos códigos de respaldo. Genera nuevos desde tu perfil.' : undefined;
  }
  return res.json(body);
}

// POST /api/auth/2fa/disable
// Deshabilita 2FA confirmando contraseña
export const disable2FA = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { password } = req.body as { password: string };

    if (!password) {
      return res.status(400).json({ error: 'Contraseña requerida para deshabilitar 2FA' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA no está habilitado' });

    // Cuentas solo-Google no tienen password que confirmar — el JWT ya prueba identidad.
    if (user.password) {
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
        twoFactorVerifiedAt: null,
      },
    });

    audit('2FA_DISABLED', { userId, req });
    res.json({ success: true, message: '2FA deshabilitado.' });
  } catch (error) {
    console.error('[2FA disable]', error);
    res.status(500).json({ error: 'Error al deshabilitar 2FA' });
  }
};

// GET /api/auth/2fa/status
export const get2FAStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorVerifiedAt: true, twoFactorBackupCodes: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorVerifiedAt: user.twoFactorVerifiedAt,
      backupCodesRemaining: user.twoFactorBackupCodes.length,
    });
  } catch {
    res.status(500).json({ error: 'Error al obtener estado 2FA' });
  }
};

// POST /api/auth/2fa/regenerate-backup-codes
// Regenera los 10 backup codes (requiere TOTP activo)
export const regenerateBackupCodes = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { totp } = req.body as { totp: string };

    if (!totp || !/^\d{6}$/.test(totp)) {
      return res.status(400).json({ error: 'Código TOTP de 6 dígitos requerido para regenerar códigos de respaldo' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA no está habilitado' });
    }

    const isValid = verifyTOTPToken(decryptSecret(user.twoFactorSecret), totp);
    if (!isValid) return res.status(401).json({ error: 'Código TOTP incorrecto' });

    const newCodes = generateBackupCodes();
    const hashed = await Promise.all(newCodes.map(c => bcrypt.hash(c, 10)));

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: hashed },
    });

    audit('2FA_BACKUP_CODES_REGENERATED', { userId, req });
    res.json({ success: true, backupCodes: newCodes, message: 'Guarda estos códigos en un lugar seguro. No se mostrarán de nuevo.' });
  } catch (error) {
    console.error('[2FA regenerate]', error);
    res.status(500).json({ error: 'Error al regenerar códigos de respaldo' });
  }
};
