/**
 * Seed directo via Prisma (solo para load testing).
 * Bypasea verificación de email creando usuarios directamente en BD.
 */
import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET!;

async function post(path: string, body: object, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await r.json() as any;
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const ts = Date.now();
  const password = await bcrypt.hash('Test1234!', 10);

  // Crear vendor directamente en BD con emailVerified=true
  const vendor = await prisma.user.create({
    data: {
      name: 'LoadTest Vendor',
      email: `lt_vendor_${ts}@test.com`,
      password,
      role: 'VENDOR',
      emailVerified: true,
    },
  });

  // Crear client directamente en BD
  const client = await prisma.user.create({
    data: {
      name: 'LoadTest Client',
      email: `lt_client_${ts}@test.com`,
      password,
      role: 'CLIENT',
      emailVerified: true,
    },
  });

  // Generar tokens JWT válidos
  const vendorToken = jwt.sign({ userId: vendor.id, role: vendor.role }, JWT_SECRET, { expiresIn: '24h' });
  const clientToken = jwt.sign({ userId: client.id, role: client.role }, JWT_SECRET, { expiresIn: '24h' });

  // Crear negocio via API (vendor ya verificado)
  const bizRes = await post('/api/businesses', {
    name: `LoadTest Biz ${ts}`,
    category: 'BARBERIA',
    address: 'Av. Test 123',
    city: 'Lima',
    phone: '999000000',
  }, vendorToken);
  const businessId = bizRes.business.id as string;

  // Crear servicio via API
  const svcRes = await post('/api/services', {
    businessId,
    name: 'Corte LoadTest',
    price: 20,
    duration: 30,
    category: 'BARBERIA',
  }, vendorToken);
  const serviceId = svcRes.service.id as string;

  const result = {
    vendorToken,
    clientToken,
    vendorEmail: vendor.email,
    clientEmail: client.email,
    vendorId: vendor.id,
    clientId: client.id,
    businessId,
    serviceId,
    baseUrl: BASE,
  };

  process.stdout.write(JSON.stringify(result));
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('SEED ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
