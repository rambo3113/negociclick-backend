/**
 * Load test — Stress y límites del sistema
 * Detecta: memory leaks, connection pool exhaustion, caché bajo carga extrema,
 *          rate limiting, response bajo spike repentino
 */
const autocannon = require('autocannon');
const ctx = JSON.parse(process.env.LOAD_CTX);

async function run() {
  const results = [];
  const errors_detail = [];

  // ── 1. Spike test — 500 conexiones en 3 segundos ─────────────────────────
  console.log('\n[STRESS-1] Spike: 500 conexiones × 3s en /api/businesses');
  console.log('   → Detecta: server crash, pool exhaustion, memory spike');
  const r1 = await autocannon({
    url: `${ctx.baseUrl}/api/businesses`,
    connections: 500,
    duration: 3,
    pipelining: 1,
  });
  results.push({ test: 'Spike 500 conex × 3s', ...summarize(r1) });

  // ── 2. Sustained high load — 250 usuarios × 30s ───────────────────────────
  console.log('\n[STRESS-2] Sustained: 250 usuarios × 30s en /businesses/:id');
  console.log('   → Detecta: memory leak (latencia creciente), caché hit rate');
  const r2 = await autocannon({
    url: `${ctx.baseUrl}/api/businesses/${ctx.businessId}`,
    connections: 250,
    duration: 30,
  });
  results.push({ test: 'Sustained 250 × 30s (cached)', ...summarize(r2) });

  // ── 3. Mixed traffic — requests simultáneos a múltiples endpoints ──────────
  console.log('\n[STRESS-3] Mixed traffic: auth + public + subscriptions × 15s');
  const [r3a, r3b, r3c] = await Promise.all([
    autocannon({ url: `${ctx.baseUrl}/api/businesses`, connections: 100, duration: 15 }),
    autocannon({
      url: `${ctx.baseUrl}/api/auth/me`,
      connections: 100, duration: 15,
      headers: { Authorization: `Bearer ${ctx.clientToken}` },
    }),
    autocannon({
      url: `${ctx.baseUrl}/api/subscriptions/my`,
      connections: 50, duration: 15,
      headers: { Authorization: `Bearer ${ctx.vendorToken}` },
    }),
  ]);
  results.push({ test: 'Mixed /businesses (100)', ...summarize(r3a) });
  results.push({ test: 'Mixed /auth/me (100)', ...summarize(r3b) });
  results.push({ test: 'Mixed /subscriptions (50)', ...summarize(r3c) });

  // ── 4. Rate limit test (en test mode debe estar desactivado) ──────────────
  console.log('\n[STRESS-4] Auth rate limit — 200 logins × 5s (NODE_ENV=test)');
  console.log('   → Verifica que NODE_ENV=test omite rate limiting en load tests');
  const r4 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/login`,
    connections: 200,
    duration: 5,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ctx.clientEmail, password: 'Test1234!' }),
  });
  results.push({ test: 'Auth rate limit (test mode)', ...summarize(r4) });

  // ── 5. Large payload — request con body grande ────────────────────────────
  console.log('\n[STRESS-5] Large payload — notes 5KB × 100 conex × 5s');
  const bigNotes = 'A'.repeat(5000);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  tomorrow.setHours(14, 0, 0, 0);
  const r5 = await autocannon({
    url: `${ctx.baseUrl}/api/bookings`,
    connections: 50,
    duration: 5,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.clientToken}` },
    body: JSON.stringify({
      serviceId: ctx.serviceId, businessId: ctx.businessId,
      date: tomorrow.toISOString(), notes: bigNotes,
    }),
  });
  results.push({ test: 'Large payload (5KB notes)', ...summarize(r5) });

  // ── 6. Health check bajo carga máxima ─────────────────────────────────────
  console.log('\n[STRESS-6] /health bajo carga — 300 conexiones × 5s');
  const r6 = await autocannon({
    url: `${ctx.baseUrl}/health`,
    connections: 300,
    duration: 5,
  });
  results.push({ test: '/health bajo carga máxima', ...summarize(r6) });

  // ── 7. Endpoint inexistente — manejo de 404 ───────────────────────────────
  console.log('\n[STRESS-7] 404 handling — 200 conex × 3s a ruta inexistente');
  const r7 = await autocannon({
    url: `${ctx.baseUrl}/api/ruta-que-no-existe-${Date.now()}`,
    connections: 200,
    duration: 3,
  });
  results.push({ test: '404 handling (ruta inexistente)', ...summarize(r7) });

  printReport('STRESS & LÍMITES DEL SISTEMA', results);
}

function summarize(r) {
  return {
    rps: Math.round(r.requests.mean), latP50: r.latency.p50,
    latP99: r.latency.p99, errors: r.errors,
    non2xx: r.non2xx, timeouts: r.timeouts, totalReqs: r.requests.total,
  };
}

function printReport(title, results) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  REPORTE: ${title}`);
  console.log('═'.repeat(80));
  console.log('Test'.padEnd(36) + 'RPS'.padEnd(7) + 'p50'.padEnd(7) + 'p99'.padEnd(8) + 'Err'.padEnd(7) + 'T/O'.padEnd(6) + 'Non2xx');
  console.log('─'.repeat(80));
  for (const r of results) {
    const hasIssue = r.errors > 5 || r.timeouts > 0 || r.latP99 > 5000;
    const flag = hasIssue ? ' ⚠' : ' ✓';
    console.log(
      r.test.padEnd(36) + String(r.rps).padEnd(7) + String(r.latP50).padEnd(7) +
      String(r.latP99).padEnd(8) + String(r.errors).padEnd(7) +
      String(r.timeouts).padEnd(6) + String(r.non2xx) + flag
    );
  }
  console.log('═'.repeat(80));

  const issues = [];
  for (const r of results) {
    if (r.errors > 5)    issues.push(`${r.test}: ${r.errors} connection errors — servidor rechazando conexiones`);
    if (r.timeouts > 0)  issues.push(`${r.test}: ${r.timeouts} timeouts bajo carga extrema`);
    if (r.latP99 > 5000) issues.push(`${r.test}: p99=${r.latP99}ms — degradación severa`);
  }

  // Análisis de rate limit
  const rateLimitTest = results.find(r => r.test.includes('rate limit'));
  if (rateLimitTest && rateLimitTest.non2xx > rateLimitTest.totalReqs * 0.5) {
    issues.push(`RATE LIMIT: ${rateLimitTest.non2xx}/${rateLimitTest.totalReqs} bloqueados en NODE_ENV=test — verificar skipInDev`);
  }

  if (issues.length) {
    console.log('\n⚠️  PROBLEMAS BAJO ESTRÉS:');
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log('\n✅ El sistema soportó carga extrema sin fallos críticos.');
  }
}

run().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
