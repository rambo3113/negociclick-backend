import { Request } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from './prisma';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOGS_DIR, `audit-${date}.json`);
}

function writeToFile(entry: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(getLogFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // File logging nunca rompe el flujo
  }
}

function getIp(req?: Request): string | undefined {
  if (!req) return undefined;
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress
  );
}

function getUserAgent(req?: Request): string | undefined {
  return req?.headers['user-agent'] as string | undefined;
}

export async function audit(
  action: string,
  opts: { userId?: string; targetId?: string; meta?: object; req?: Request },
): Promise<void> {
  const ip        = getIp(opts.req);
  const userAgent = getUserAgent(opts.req);

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event:     action,
    ip,
    userAgent,
    ...(opts.userId   ? { userId:   opts.userId }   : {}),
    ...(opts.targetId ? { targetId: opts.targetId } : {}),
    ...(opts.meta     ? { meta:     opts.meta }      : {}),
  };

  // Escribir a archivo JSON diario
  writeToFile(entry);

  // Persistir en base de datos
  try {
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
    // Nunca rompe el flujo principal
  }
}

// Alias tipado para eventos HTTP (4xx/5xx)
export function auditHttpError(
  statusCode: number,
  opts: { endpoint: string; method: string; error: string; req: Request },
): void {
  const entry: Record<string, unknown> = {
    timestamp:  new Date().toISOString(),
    event:      statusCode >= 500 ? 'http_5xx' : 'http_4xx',
    statusCode,
    method:     opts.method,
    endpoint:   opts.endpoint,
    error:      opts.error,
    ip:         getIp(opts.req),
    userAgent:  getUserAgent(opts.req),
    userId:     (opts.req as any).userId ?? undefined,
  };
  writeToFile(entry);
}
