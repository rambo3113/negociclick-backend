/**
 * Load test — Flujo de reservas (el más complejo del sistema)
 * Detecta: race conditions en conflictos de horario, deadlocks en transacciones,
 *          N+1 queries en listados, overflow del pool de conexiones Prisma
 */
const autocannon = require('autocannon');
const ctx = JSON.parse(process.env.LOAD_CTX);

async function run() {
  const results = [];

  // Fecha futura para reservas de prueba (mañana a las 10:00 AM)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const bookingDate = tomorrow.toISOString();

  const bookingBody = JSON.stringify({
    serviceId: ctx.serviceId,
    businessId: ctx.businessId,
    date: bookingDate,
    notes: 'Load test booking',
  });

  // ── 1. Creación concurrente de reservas (detecta race conditions) ──────────
  console.log('\n[BOOKING-1] POST /bookings — 30 usuarios simultáneos × 10s');
  console.log('   → Detecta: race condition en verificación de conflictos de horario');
  const r1 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings`,
    connections: 30,
    duration: 10,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.clientToken}`,
    },
    body: bookingBody,
  });
  results.push({ test: 'POST /bookings (race condition)', ...summarize(r1) });

  // ── 2. GET /bookings/my — historial del cliente ───────────────────────────
  console.log('\n[BOOKING-2] GET /bookings/my — 200 usuarios × 10s');
  const r2 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings/my`,
    connections: 200,
    duration: 10,
    headers: { Authorization: `Bearer ${ctx.clientToken}` },
  });
  results.push({ test: 'GET /bookings/my', ...summarize(r2) });

  // ── 3. GET /bookings/vendor/:businessId ───────────────────────────────────
  console.log('\n[BOOKING-3] GET /bookings/vendor/:id — 100 usuarios × 10s');
  const r3 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings/vendor/${ctx.businessId}`,
    connections: 100,
    duration: 10,
    headers: { Authorization: `Bearer ${ctx.vendorToken}` },
  });
  results.push({ test: 'GET /bookings/vendor/:id', ...summarize(r3) });

  // ── 4. GET /bookings/slots (disponibilidad) ───────────────────────────────
  const slotDate = tomorrow.toISOString().split('T')[0];
  console.log('\n[BOOKING-4] GET /bookings/slots — 150 usuarios × 10s');
  console.log('   → Detecta: lentitud en cálculo de slots disponibles');
  const r4 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings/slots?businessId=${ctx.businessId}&serviceId=${ctx.serviceId}&date=${slotDate}`,
    connections: 150,
    duration: 10,
    headers: { Authorization: `Bearer ${ctx.clientToken}` },
  });
  results.push({ test: 'GET /bookings/slots', ...summarize(r4) });

  // ── 5. Mismo slot exacto — 50 clientes intentan reservar a la vez ─────────
  console.log('\n[BOOKING-5] POST /bookings mismo slot 50 concurrentes × 5s');
  console.log('   → CRÍTICO: solo 1 debería confirmarse, el resto error 409');
  const r5 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings`,
    connections: 50,
    duration: 5,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.clientToken}`,
    },
    body: JSON.stringify({
      serviceId: ctx.serviceId,
      businessId: ctx.businessId,
      date: bookingDate,
      notes: 'Race condition test',
    }),
  });
  results.push({ test: 'POST /bookings (mismo slot ×50)', ...summarize(r5) });

  // ── 6. Booking sin autenticación (debe 401) ───────────────────────────────
  console.log('\n[BOOKING-6] POST /bookings sin token — 50 usuarios × 5s');
  const r6 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings`,
    connections: 50,
    duration: 5,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bookingBody,
  });
  results.push({ test: 'POST /bookings sin token (→401)', ...summarize(r6) });

  printReport('RESERVAS', results);
}

function summarize(r) {
  return {
    rps: Math.round(r.requests.mean), latP50: r.latency.p50,
    latP99: r.latency.p99, errors: r.errors,
    non2xx: r.non2xx, timeouts: r.timeouts, totalReqs: r.requests.total,
  };
}

function printReport(title, results) {
  console.log(`\n${'═'.repeat(75)}`);
  console.log(`  REPORTE: ${title}`);
  console.log('═'.repeat(75));
  console.log('Test'.padEnd(36) + 'RPS'.padEnd(7) + 'p50'.padEnd(7) + 'p99'.padEnd(7) + 'Err'.padEnd(7) + 'Non2xx'.padEnd(8) + 'Total');
  console.log('─'.repeat(75));
  for (const r of results) {
    const isSecurity = r.test.includes('→401') || r.test.includes('sin token');
    const hasIssue = r.errors > 0 || r.timeouts > 0 || r.latP99 > 3000 ||
      (isSecurity && r.non2xx === 0);
    const flag = hasIssue ? ' ⚠' : ' ✓';
    console.log(
      r.test.padEnd(36) + String(r.rps).padEnd(7) + String(r.latP50).padEnd(7) +
      String(r.latP99).padEnd(7) + String(r.errors).padEnd(7) +
      String(r.non2xx).padEnd(8) + String(r.totalReqs) + flag
    );
  }
  console.log('═'.repeat(75));

  const issues = [];
  for (const r of results) {
    if (r.errors > 0)    issues.push(`${r.test}: ${r.errors} connection errors (pool agotado?)`);
    if (r.timeouts > 0)  issues.push(`${r.test}: ${r.timeouts} timeouts — query demasiado lento`);
    if (r.latP99 > 3000) issues.push(`${r.test}: p99=${r.latP99}ms — supera 3s bajo carga`);
    const isSecurity = r.test.includes('→401') || r.test.includes('sin token');
    if (isSecurity && r.non2xx === 0) issues.push(`⚠️ SEGURIDAD: ${r.test} — esperaba 401 pero no hubo non2xx`);
  }

  // Análisis especial: race condition (test 5)
  const raceTest = results.find(r => r.test.includes('mismo slot'));
  if (raceTest) {
    const successRate = (raceTest.totalReqs - raceTest.non2xx) / raceTest.totalReqs;
    if (successRate > 0.1) {
      issues.push(`RACE CONDITION: ${Math.round(successRate * 100)}% de requests al mismo slot retornaron 2xx — posible doble booking`);
    } else {
      console.log(`\n✅ Race condition test: solo ${Math.round(successRate * 100)}% de éxito (esperado) — transacción funciona correctamente`);
    }
  }

  if (issues.length) {
    console.log('\n⚠️  PROBLEMAS DETECTADOS:');
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log('\n✅ Flujo de reservas funciona correctamente bajo carga.');
  }
}

run().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
