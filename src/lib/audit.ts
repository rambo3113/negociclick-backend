import { Request } from 'express';
import prisma from './prisma';

export async function audit(
  action: string,
  opts: { userId?: string; targetId?: string; meta?: object; req?: Request },
) {
  try {
    const ip = opts.req
      ? (opts.req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? opts.req.socket?.remoteAddress
      : undefined;

    await prisma.auditLog.create({
      data: {
        action,
        userId:   opts.userId,
        targetId: opts.targetId,
        meta:     opts.meta ? JSON.stringify(opts.meta) : undefined,
        ip,
      },
    });
  } catch {
    // Auditoría nunca debe romper el flujo principal
  }
}
