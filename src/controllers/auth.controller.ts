import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.util';
import { sendPasswordResetEmail, sendEmailVerification } from '../lib/email';

const validatePassword = (password: string): string | null => {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe tener al menos una mayúscula';
  if (!/[0-9]/.test(password)) return 'La contraseña debe tener al menos un número';
  return null;
};

// ============================================
// 1. REGISTRO
// ============================================
export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, role } = req.body as {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role?: string;
    };

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: name, email, password' });
    }

    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Only CLIENT and VENDOR are allowed — ADMIN can never be self-registered
    const safeRole = role === 'VENDOR' ? 'VENDOR' : 'CLIENT';

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        role: safeRole
      }
    });

    const accessToken  = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
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
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const accessToken  = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });

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

    res.json({ success: true, user });

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
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };

    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Se requieren la contraseña actual y la nueva' });
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });

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
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.emailVerified) return res.status(400).json({ error: 'Tu correo ya está verificado' });

    await prisma.emailVerificationToken.updateMany({
      where: { userId, used: false },
      data: { used: true },
    });

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.emailVerificationToken.create({
      data: { token, userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    sendEmailVerification({ email: user.email, name: user.name, verifyUrl: `${frontendUrl}/verificar-email?token=${token}` }).catch(() => {});

    res.json({ success: true, message: 'Correo de verificación enviado.' });
  } catch {
    res.status(500).json({ error: 'Error al enviar verificación' });
  }
};

// ============================================
// 9. VERIFICAR EMAIL CON TOKEN
// ============================================
export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { token } = req.query as { token: string };
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { used: true } }),
    ]);

    res.json({ success: true, message: '¡Correo verificado exitosamente!' });
  } catch {
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
// 11. REFRESH TOKEN
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
    const { refreshToken } = req.body as { refreshToken: string };
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
};
