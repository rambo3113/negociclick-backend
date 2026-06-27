/**
 * Seed para load testing — crea usuarios, negocio y servicio de prueba.
 * Devuelve JSON con tokens e IDs para que los scripts de carga los usen.
 */
const BASE = 'http://localhost:3001';

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { headers });
  return r.json();
}

async function main() {
  const ts = Date.now();

  // 1. Registrar vendor
  const vendorEmail = `loadtest_vendor_${ts}@test.com`;
  await post('/api/auth/register', {
    name: 'LoadTest Vendor', email: vendorEmail,
    password: 'Test1234!', role: 'VENDOR',
  });

  // 2. Login vendor
  const vendorLogin = await post('/api/auth/login', { email: vendorEmail, password: 'Test1234!' });
  const vendorToken = vendorLogin.token;

  // 3. Registrar client
  const clientEmail = `loadtest_client_${ts}@test.com`;
  await post('/api/auth/register', { name: 'LoadTest Client', email: clientEmail, password: 'Test1234!', role: 'CLIENT' });
  const clientLogin = await post('/api/auth/login', { email: clientEmail, password: 'Test1234!' });
  const clientToken = clientLogin.token;

  // 4. Crear negocio
  const bizRes = await post('/api/businesses', {
    name: `LoadTest Biz ${ts}`, category: 'BARBERIA',
    address: 'Av. Test 123', city: 'Lima', phone: '999000000',
  }, vendorToken);
  const businessId = bizRes.business.id;

  // 5. Crear servicio
  const svcRes = await post(`/api/services`, {
    businessId, name: 'Corte LoadTest', price: 20, duration: 30, category: 'BARBERIA',
  }, vendorToken);
  const serviceId = svcRes.service.id;

  // 6. Buscar un booking existente del vendor (para tests de review, etc.)
  const bookings = await get(`/api/bookings/vendor/${businessId}`, vendorToken);

  const result = {
    vendorToken, clientToken, vendorEmail, clientEmail,
    businessId, serviceId,
    baseUrl: BASE,
  };

  process.stdout.write(JSON.stringify(result));
}

main().catch(e => { console.error('SEED ERROR:', e.message); process.exit(1); });
