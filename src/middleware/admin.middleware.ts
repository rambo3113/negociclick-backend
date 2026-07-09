import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const userId   = (req as any).userId as string | undefined;
  const userRole = (req as any).userRole as string | undefined;

  if (userRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true, twoFactorEnabled: true },
    });
    if (!user?.emailVerified) {
      return res.status(403).json({ error: 'Email no verificado' });
    }
    if (!user?.twoFactorEnabled) {
      return res.status(403).json({ error: 'Se requiere 2FA activo para acceder al panel admin' });
    }
  } catch {
    return res.status(500).json({ error: 'Error al verificar permisos de administrador' });
  }

  next();
};
