import { PrismaClient } from '@prisma/client';

// Neon serverless: limitar pool a 10 conexiones para Railway starter.
// Evita el "connection pool exhausted" bajo carga concurrente alta.
// Subir a 20 cuando se migre a plan Neon de pago.
function buildDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url || url.includes('connection_limit')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=10&pool_timeout=20`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: buildDatabaseUrl() } },
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export default prisma;
