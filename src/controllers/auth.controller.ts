import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../lib/prisma';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.util';
import { sendPasswordResetEmail, sendEmailVerification, sendWelcomeVendor, sendWelcomeClient, sendAccountExistsEmail } from '../lib/email';
import { audit } from '../lib/audit';

const JWT_SECRET = process.env.JWT_SECRET!;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Re-autenticación con Google ─────────────────────────────────────────────
// Verifica un ID token de Google fresco (emitido hace < 5 min) y que su sub
// coincida con el googleId del usuario. Usado en deleteAccount y changePassword
// para operaciones destructivas en cuentas solo-Google.
// Lanza Error con mensaje user-facing si algo falla.
async function verifyFreshGoogleToken(idToken: string, expectedGoogleId: string): Promise<void> {
  let payload: any;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new Error('Token de Google inválido o expirado. Vuelve a iniciar sesión con Google.');
  }

  if (!payload?.sub) throw new Error('Token de Google inválido');
  if (payload.sub !== expectedGoogleId) {
    throw new Error('El token de Google no corresponde a esta cuenta');
  }

  // iat está en segundos Unix. El token debe ser reciente (< 5 min) para
  // que no sea reutilizable de una sesión anterior del atacante.
  const nowSec = Math.floor(Date.now() / 1000);
  const iat = payload.iat ?? 0;
  if (nowSec - iat > 300) {
    throw new Error('El token de Google es demasiado antiguo. Vuelve a iniciar sesión con Google para confirmar la acción.');
  }
}

const validatePassword = (password: string): string | null => {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe tener al menos una mayúscula';
  if (!/[0-9]/.test(password)) return 'La contraseña debe tener al menos un número';
  return null;
};

// Emite (o reutiliza) un token de verificación vigente y envía el correo.
// Reutilizar evita que un segundo "reenviar" invalide el enlace de un correo
// anterior que el usuario todavía no abrió (el link viejo dejaba de servir
// silenciosamente y el usuario terminaba con la cuenta sin verificar).
async function issueAndSendVerificationEmail(user: { id: string; email: string; name: string }) {
  let record = await prisma.emailVerificationToken.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    const token = crypto.randomBytes(32).toString('hex');
    record = await prisma.emailVerificationToken.create({
      data: { token, userId: user.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    console.log(`[verify-email] token nuevo emitido para userId=${user.id}`);
  } else {
    console.log(`[verify-email] reutilizando token vigente para userId=${user.id}`);
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/verificar-email?token=${record.token}`;

  sendEmailVerification({ email: user.email, name: user.name, verifyUrl })
    .then(() => console.log(`[verify-email] correo enviado a ${user.email}`))
    .catch((err) => console.error(`[verify-email] fallo al enviar correo a ${user.email}:`, err));
}

// ============================================
// 1. REGISTRO
// ============================================
export const register = async (req: Request, res: Response) => {
  // Respuesta genérica — misma en todos los casos para evitar enumeración de emails.
  // Cualquier diferencia observable (status, cuerpo, latencia) permitiría a un atacante
  // deducir si un email ya está registrado.
  const GENERIC_OK = { success: true, message: 'Revisa tu correo para confirmar tu cuenta.' };

  try {
    const { name, email, password, phone, role, turnstileToken } = req.body as {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role?: string;
      turnstileToken?: string;
    };

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: name, email, password' });
    }

    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    // ── Cloudflare Turnstile anti-bot ────────────────────────────────────────
    // Solo se aplica si TURNSTILE_SECRET_KEY está configurada en el entorno,
    // lo que permite ejecutar sin CAPTCHA en desarrollo local.
    if (process.env.TURNSTILE_SECRET_KEY) {
      if (!turnstileToken) {
        return res.status(400).json({ error: 'Verificación anti-bot requerida.' });
      }
      try {
        const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret:   process.env.TURNSTILE_SECRET_KEY,
            response: turnstileToken,
            remoteip: req.ip,
          }),
        });
        const tsData = await tsRes.json() as { success: boolean };
        if (!tsData.success) {
          return res.status(400).json({ error: 'Verificación anti-bot fallida. Recarga e inténtalo de nuevo.' });
        }
      } catch (tsErr) {
        console.error('[register] Turnstile siteverify error:', tsErr);
        return res.status(503).json({ error: 'Error al verificar. Inténtalo de nuevo en un momento.' });
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      // Anti-enumeración: notifica al propietario del correo sin revelar nada al solicitante.
      // Fire-and-forget para que la latencia sea indistinguible del caso nuevo.
      sendAccountExistsEmail({
        email: existingUser.email,
        name: existingUser.name,
        loginUrl: `${frontendUrl}/login`,
        resetUrl: `${frontendUrl}/forgot-password`,
      }).catch(() => {});
      return res.status(200).json(GENERIC_OK);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Only CLIENT and VENDOR are allowed — ADMIN can never be self-registered
    const safeRole = role === 'VENDOR' ? 'VENDOR' : 'CLIENT';

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, phone: phone || null, role: safeRole },
    });

    audit('REGISTER', { userId: user.id, meta: { email: user.email, role: user.role }, req });

    // Fire-and-forget: responde antes de que los correos salgan — esto minimiza
    // la diferencia de latencia con el caso "email ya existe".
    if (safeRole === 'VENDOR') {
      sendWelcomeVendor({ email: user.email, name: user.name }).catch(() => {});
    } else {
      sendWelcomeClient({ email: user.email, name: user.name }).catch(() => {});
    }
    issueAndSendVerificationEmail(user).catch((err) =>
      console.error('[register] fallo al emitir verificación:', err)
    );

    return res.status(200).json(GENERIC_OK);

  } catch (error: any) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
};

// ============================================
// 2. LOGIN
// ============================================
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan campos: email y password' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim() }
    });

    if (!user) {
      audit('LOGIN_FAILED', { meta: { email: email.trim(), reason: 'user_not_found' }, req });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.password) {
      audit('LOGIN_FAILED', { userId: user.id, meta: { email: user.email, reason: 'google_only_account' }, req });
      return res.status(401).json({ error: 'Esta cuenta se creó con Google. Inicia sesión con "Continuar con Google" o configura una contraseña desde tu perfil.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      audit('LOGIN_FAILED', { userId: user.id, meta: { email: user.email, reason: 'wrong_password' }, req });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Si 2FA está habilitado, emitir token temporal (válido 5 min)
    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { userId: user.id, purpose: '2fa_pending' },
        JWT_SECRET,
        { expiresIn: '5m' },
      );
      return res.json({
        requiresTwoFactor: true,
        tempToken,
        message: 'Ingresa el código de 6 dígitos de tu autenticador',
      });
    }

    const accessToken  = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    audit('LOGIN', { userId: user.id, meta: { email: user.email }, req });

    res.json({
      success: true,
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerified
      }
    });

  } catch (error: any) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error en login' });
  }
};

// ============================================
// 2b. LOGIN / SIGNUP CON GOOGLE
// ============================================
// El frontend (next-auth) nos manda el ID token crudo que Google le dio —
// NUNCA confiamos en googleId/email/name sueltos en el body, porque
// cualquiera podría mandar esos campos y hacerse pasar por otro usuario.
// Verificamos el JWT de Google nosotros mismos, contra nuestro propio
// GOOGLE_CLIENT_ID como audience, y solo confiamos en lo que Google firmó.
export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) return res.status(400).json({ error: 'Falta idToken' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.warn('[google-auth] idToken inválido:', verifyErr instanceof Error ? verifyErr.message : verifyErr);
      return res.status(401).json({ error: 'Token de Google inválido o expirado' });
    }

    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: 'Google no devolvió los datos esperados' });
    }

    // Fix 1 (CRÍTICO): rechazar si Google no verificó explícitamente el email.
    // Sin este check, un atacante con un email no verificado en Google podría
    // vincular su cuenta Google a la cuenta de otra persona (account takeover).
    if (payload.email_verified !== true) {
      console.warn(`[google-auth] email no verificado en Google: ${payload.email}`);
      return res.status(403).json({
        error: 'Tu dirección de email no está verificada en Google. Verifica tu email en Google primero.',
      });
    }

    const googleId    = payload.sub;
    const googleEmail = payload.email;
    const name        = payload.name || googleEmail.split('@')[0];
    const picture     = payload.picture;

    let user: any;
    let isNewUser = false;

    // Fix 3: todos los guards (isActive, etc.) ANTES de cualquier escritura a BD.
    const existingByGoogleId = await prisma.user.findUnique({ where: { googleId } });

    if (existingByGoogleId) {
      // Cuenta ya vinculada con este googleId
      if (!existingByGoogleId.isActive) {
        return res.status(403).json({ error: 'Esta cuenta está desactivada' });
      }
      user = existingByGoogleId;
      audit('GOOGLE_LOGIN', { userId: user.id, meta: { email: user.email }, req });

    } else {
      // Sin cuenta con este googleId — buscar por email para vincular
      const existingByEmail = await prisma.user.findUnique({ where: { email: googleEmail } });

      if (existingByEmail) {
        // Fix 3: verificar isActive ANTES del UPDATE que vincula googleId
        if (!existingByEmail.isActive) {
          return res.status(403).json({ error: 'Esta cuenta está desactivada' });
        }
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleId, googleEmail, avatar: existingByEmail.avatar ?? picture ?? null },
        });
        audit('GOOGLE_LINK', { userId: user.id, meta: { email: user.email }, req });

      } else {
        // Cuenta nueva — email_verified ya validado arriba, marcamos como verificado
        user = await prisma.user.create({
          data: {
            name,
            email: googleEmail,
            password: null,
            role: 'CLIENT',
            googleId,
            googleEmail,
            avatar: picture ?? null,
            emailVerified: true,      // Fix 1: solo llegamos aquí si email_verified === true
            emailVerifiedAt: new Date(),
          },
        });
        isNewUser = true;
        audit('GOOGLE_SIGNUP', { userId: user.id, meta: { email: user.email }, req });
        sendWelcomeClient({ email: user.email, name: user.name }).catch(() => {});
      }
    }

    // Mismo flujo de 2FA que el login normal — Google no lo saltea.
    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { userId: user.id, purpose: '2fa_pending' },
        JWT_SECRET,
        { expiresIn: '5m' },
      );
      return res.json({
        requiresTwoFactor: true,
        tempToken,
        message: 'Ingresa el código de 6 dígitos de tu autenticador',
      });
    }

    const accessToken  = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });

    res.status(isNewUser ? 201 : 200).json({
      success: true,
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error: any) {
    console.error('[google-auth] Error inesperado:', error);
    res.status(500).json({ error: 'Error al procesar el inicio de sesión con Google' });
  }
};

// ============================================
// 2c. DESVINCULAR GOOGLE
// ============================================
export const unlinkGoogle = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (!user.googleId) {
      return res.status(400).json({ error: 'Esta cuenta no está vinculada con Google' });
    }
    if (!user.password) {
      return res.status(400).json({ error: 'No puedes desvincular Google sin antes configurar una contraseña de respaldo.' });
    }

    await prisma.user.update({ where: { id: userId }, data: { googleId: null, googleEmail: null } });
    audit('GOOGLE_UNLINK', { userId, req });

    res.json({ success: true, message: 'Cuenta de Google desvinculada correctamente.' });
  } catch (error: any) {
    console.error('[unlink-google] Error inesperado:', error);
    res.status(500).json({ error: 'Error al desvincular Google' });
  }
};

// ============================================
// 3. PERFIL DEL USUARIO AUTENTICADO
// ============================================
export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        avatar: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        googleId: true,
        googleEmail: true,
        password: true,
        businesses: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            category: true,
            city: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Nunca mandar el hash de la contraseña al cliente — solo si existe o no.
    const { password, ...safeUser } = user;

    res.json({ success: true, user: { ...safeUser, hasPassword: !!password } });

  } catch (error: any) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
};

// ============================================
// 4. ACTUALIZAR PERFIL
// ============================================
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { name, phone } = req.body as { name?: string; phone?: string };

    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: name.trim(), phone: phone?.trim() || null },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });

    res.json({ success: true, user });
  } catch {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
};

// ============================================
// 5. CAMBIAR CONTRASEÑA
// ============================================
export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    // currentPassword: requerido para cuentas con password
    // idToken: requerido para cuentas solo-Google (primer password de respaldo)
    const { currentPassword, newPassword, idToken } = req.body as {
      currentPassword?: string;
      newPassword?: string;
      idToken?: string;
    };

    if (!newPassword)
      return res.status(400).json({ error: 'La nueva contraseña es requerida' });
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (user.password) {
      // Fix 4: cuenta con contraseña — currentPassword obligatorio y verificado con bcrypt
      if (!currentPassword) {
        return res.status(400).json({ error: 'La contraseña actual es requerida' });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        audit('PASSWORD_CHANGE_FAILED', { userId, meta: { reason: 'wrong_current_password' }, req });
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
      }
    } else if (user.googleId) {
      // Fix 4: cuenta solo-Google — re-autenticar con token fresco de Google
      // Se niega cualquier currentPassword; solo se acepta idToken reciente.
      if (!idToken) {
        return res.status(400).json({
          error: 'Para establecer tu primera contraseña, confirma tu identidad con Google.',
          requiresGoogleReauth: true,
        });
      }
      try {
        await verifyFreshGoogleToken(idToken, user.googleId);
      } catch (err: any) {
        audit('PASSWORD_CHANGE_FAILED', { userId, meta: { reason: 'google_reauth_failed' }, req });
        return res.status(401).json({ error: err.message });
      }
    } else {
      // Edge case: usuario sin password ni googleId (estado incoherente)
      return res.status(400).json({ error: 'No se puede cambiar la contraseña sin verificación de identidad.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    audit('PASSWORD_CHANGED', { userId, req });

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};

// ============================================
// 6. SOLICITAR RECUPERACIÓN DE CONTRASEÑA
// ============================================
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    // Responder siempre OK para no revelar si el email existe
    const OK = { success: true, message: 'Si el email existe, recibirás un enlace en breve.' };
    if (!user) return res.json(OK);

    // Invalidar tokens anteriores del mismo usuario
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl }).catch(() => {});

    res.json(OK);
  } catch {
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
};

// ============================================
// 7. RESTABLECER CONTRASEÑA CON TOKEN
// ============================================
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body as { token: string; password: string };

    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña son requeridos' });

    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const record = await prisma.passwordResetToken.findUnique({ where: { token } });

    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró. Solicita uno nuevo.' });
    }

    const hashed = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
    ]);

    res.json({ success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
  } catch {
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
};

// ============================================
// 8. ENVIAR EMAIL DE VERIFICACIÓN
// ============================================
export const sendVerificationEmail = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.warn(`[send-verification] usuario no encontrado: userId=${userId}`);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (user.emailVerified) {
      console.log(`[send-verification] ignorado, ya verificado: userId=${userId}`);
      return res.status(400).json({ error: 'Tu correo ya está verificado' });
    }

    await issueAndSendVerificationEmail(user);

    res.json({ success: true, message: 'Correo de verificación enviado.' });
  } catch (error: any) {
    console.error('[send-verification] ERROR inesperado:', error);
    res.status(500).json({ error: 'Error al enviar verificación' });
  }
};

// ============================================
// 9. VERIFICAR EMAIL CON TOKEN
// ============================================
export const verifyEmail = async (req: Request, res: Response) => {
  const { token } = req.query as { token: string };
  try {
    if (!token) {
      console.warn('[verify-email] rechazado: falta el parámetro token');
      return res.status(400).json({ error: 'Token requerido' });
    }

    const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!record) {
      console.warn(`[verify-email] rechazado: token no existe en BD (${token.slice(0, 8)}…)`);
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    }
    if (record.used) {
      console.warn(`[verify-email] rechazado: token ya usado (userId=${record.userId})`);
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    }
    if (record.expiresAt < new Date()) {
      console.warn(`[verify-email] rechazado: token expirado (userId=${record.userId}, expiraba=${record.expiresAt.toISOString()})`);
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    }

    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { used: true } }),
    ]);
    console.log(`[verify-email] OK: userId=${record.userId}, emailVerified=${updatedUser.emailVerified}`);

    // Emite sesión para que el frontend pueda loguear al usuario sin que tenga que
    // escribir su contraseña de nuevo — el clic en el enlace ya es prueba de identidad.
    const accessToken  = generateAccessToken({ userId: updatedUser.id, email: updatedUser.email, role: updatedUser.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: updatedUser.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });

    res.json({
      success: true,
      message: '¡Correo verificado exitosamente!',
      token: accessToken,
      refreshToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        role: updatedUser.role,
        emailVerified: updatedUser.emailVerified,
      },
    });
  } catch (error: any) {
    console.error(`[verify-email] ERROR inesperado (token=${token ? token.slice(0, 8) + '…' : 'ausente'}):`, error);
    res.status(500).json({ error: 'Error al verificar email' });
  }
};

// ============================================
// 10. CONTEO DE RESERVAS PENDIENTES (badge navbar)
// ============================================
export const getPendingCount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const userRole = (req as any).userRole as string;

    let count = 0;
    if (userRole === 'CLIENT') {
      count = await prisma.booking.count({ where: { clientId: userId, status: 'PENDING' } });
    } else if (userRole === 'VENDOR' || userRole === 'ADMIN') {
      const businesses = await prisma.business.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      const bizIds = businesses.map(b => b.id);
      count = await prisma.booking.count({ where: { businessId: { in: bizIds }, status: 'PENDING' } });
    }

    res.json({ success: true, count });
  } catch {
    res.status(500).json({ error: 'Error al obtener conteo' });
  }
};

// ============================================
// 11. ELIMINAR CUENTA (requiere JWT válido)
// ============================================
export const deleteAccount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    // password: para cuentas con contraseña
    // idToken: para cuentas solo-Google (token fresco emitido hace < 5 min)
    const { password, idToken } = req.body as { password?: string; idToken?: string };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (user.password) {
      // Fix 2: cuenta con contraseña — confirmar con bcrypt
      if (!password) {
        return res.status(400).json({ error: 'Debes confirmar tu contraseña para eliminar la cuenta' });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta. No se puede eliminar la cuenta.' });
    } else if (user.googleId) {
      // Fix 2: cuenta solo-Google — re-autenticar con token fresco
      // Un JWT de acceso (15 min) no es suficiente para una acción irreversible.
      if (!idToken) {
        return res.status(400).json({
          error: 'Para eliminar una cuenta de Google, debes confirmar con un token de Google reciente.',
          requiresGoogleReauth: true,
        });
      }
      try {
        await verifyFreshGoogleToken(idToken, user.googleId);
      } catch (err: any) {
        return res.status(401).json({ error: err.message });
      }
    } else {
      // Edge case: cuenta sin password ni googleId
      return res.status(400).json({ error: 'No se puede eliminar la cuenta sin verificación de identidad.' });
    }

    // Eliminar en orden para respetar foreign keys
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } }),
      prisma.user.update({ where: { id: userId }, data: { isActive: false, email: `deleted_${userId}@negociclick.deleted`, name: '[Cuenta eliminada]', password: '' } }),
    ]);

    audit('ACCOUNT_DELETED', { userId, req });
    res.json({ success: true, message: 'Cuenta eliminada correctamente.' });
  } catch (error: any) {
    console.error('[deleteAccount]', error?.message);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
};

// ============================================
// 12. REFRESH TOKEN
// ============================================
export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken requerido' });

    const record = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });

    if (!record || record.expiresAt < new Date()) {
      if (record) await prisma.refreshToken.delete({ where: { id: record.id } });
      return res.status(401).json({ error: 'Sesión expirada. Inicia sesión nuevamente.' });
    }

    if (!record.user.isActive) {
      return res.status(403).json({ error: 'Cuenta desactivada.' });
    }

    const newAccessToken  = generateAccessToken({ userId: record.user.id, email: record.user.email, role: record.user.role });
    const newRefreshToken = generateRefreshToken();

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: record.id } }),
      prisma.refreshToken.create({ data: { token: newRefreshToken, userId: record.user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) } }),
    ]);

    res.json({ success: true, token: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(500).json({ error: 'Error al renovar sesión' });
  }
};

// ============================================
// 12. LOGOUT
// ============================================
export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string | undefined;
    const { refreshToken } = req.body as { refreshToken: string };
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    audit('LOGOUT', { userId, req });
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
};
