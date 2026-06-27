/**
 * Load test — Flujo de autenticación y rutas protegidas
 * Detecta: JWT decode overhead, sesiones concurrentes, rate limit en test mode
 */
const autocannon = require('autocannon');
const ctx = JSON.parse(process.env.LOAD_CTX);

async function run() {
  const results = [];

  // ── 1. Login concurrente (endpoint crítico) ───────────────────────────────
  console.log('\n[AUTH-1] POST /auth/login — 50 usuarios × 10s');
  const r1 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/login`,
    connections: 50,
    duration: 10,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ctx.clientEmail, password: 'Test1234!' }),
  });
  results.push({ test: 'POST /auth/login', ...summarize(r1) });

  // ── 2. GET /auth/me con token válido ──────────────────────────────────────
  console.log('\n[AUTH-2] GET /auth/me (JWT verify) — 200 usuarios × 10s');
  const r2 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/me`,
    connections: 200,
    duration: 10,
    headers: { Authorization: `Bearer ${ctx.clientToken}` },
  });
  results.push({ test: 'GET /auth/me (jwt valid)', ...summarize(r2) });

  // ── 3. GET /auth/me con token inválido (debe retornar 401) ────────────────
  console.log('\n[AUTH-3] GET /auth/me token inválido — 100 usuarios × 5s');
  const r3 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/me`,
    connections: 100,
    duration: 5,
    headers: { Authorization: 'Bearer token_invalido_xxxxxx' },
  });
  results.push({ test: 'GET /auth/me (jwt invalid → 401)', ...summarize(r3) });

  // ── 4. GET /auth/me sin token (debe retornar 401) ─────────────────────────
  console.log('\n[AUTH-4] GET /auth/me sin token — 100 usuarios × 5s');
  const r4 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/me`,
    connections: 100,
    duration: 5,
  });
  results.push({ test: 'GET /auth/me (sin token → 401)', ...summarize(r4) });

  // ── 5. GET /subscriptions/my (planGuard + caché) ─────────────────────────
  console.log('\n[AUTH-5] GET /subscriptions/my (planGuard cache) — 150 usuarios × 10s');
  const r5 = await autocannon({
    url: `${ctx.baseUrl}/api/subscriptions/my`,
    connections: 150,
    duration: 10,
    headers: { Authorization: `Bearer ${ctx.vendorToken}` },
  });
  results.push({ test: 'GET /subscriptions/my (planGuard)', ...summarize(r5) });

  // ── 6. Múltiples tokens concurrentes (simula N usuarios logueados) ─────────
  console.log('\n[AUTH-6] GET /auth/me 300 conexiones simultáneas × 5s');
  const r6 = await autocannon({
    url: `${ctx.baseUrl}/api/auth/me`,
    connections: 300,
    duration: 5,
    headers: { Authorization: `Bearer ${ctx.vendorToken}` },
  });
  results.push({ test: 'GET /auth/me 300 concurrent', ...summarize(r6) });

  printReport('AUTENTICACIÓN Y RUTAS PROTEGIDAS', results);
}

function summarize(r) {
  return {
    rps: Math.round(r.requests.mean), latP50: r.latency.p50,
    latP99: r.latency.p99, errors: r.errors,
    non2xx: r.non2xx, timeouts: r.timeouts, totalReqs: r.requests.total,
  };
}

function printReport(title, results) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  REPORTE: ${title}`);
  console.log('═'.repeat(70));
  console.log('Test'.padEnd(36) + 'RPS'.padEnd(7) + 'p50'.padEnd(7) + 'p99'.padEnd(7) + 'Err'.padEnd(7) + 'Non2xx');
  console.log('─'.repeat(70));
  for (const r of results) {
    const expectNon2xx = r.test.includes('401') || r.test.includes('invalid') || r.test.includes('sin token');
    const hasIssue = r.errors > 0 || r.latP99 > 2000 || r.timeouts > 0 ||
      (!expectNon2xx && r.non2xx > 0) || (expectNon2xx && r.non2xx === 0);
    const flag = hasIssue ? ' ⚠' : ' ✓';
    console.log(
      r.test.padEnd(36) + String(r.rps).padEnd(7) + String(r.latP50).padEnd(7) +
      String(r.latP99).padEnd(7) + String(r.errors).padEnd(7) + String(r.non2xx) + flag
    );
  }
  console.log('═'.repeat(70));

  const issues = [];
  for (const r of results) {
    if (r.errors > 0)    issues.push(`${r.test}: ${r.errors} connection errors`);
    if (r.timeouts > 0)  issues.push(`${r.test}: ${r.timeouts} timeouts`);
    if (r.latP99 > 2000) issues.push(`${r.test}: latencia p99=${r.latP99}ms`);
    const expectNon2xx = r.test.includes('401') || r.test.includes('invalid') || r.test.includes('sin token');
    if (!expectNon2xx && r.non2xx > 0) issues.push(`${r.test}: ${r.non2xx} respuestas inesperadas no-2xx`);
    if (expectNon2xx && r.non2xx === 0) issues.push(`${r.test}: esperaba 401 pero recibió 2xx — falla de seguridad`);
  }

  if (issues.length) {
    console.log('\n⚠️  PROBLEMAS DETECTADOS:');
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log('\n✅ Auth y protección de rutas funcionan correctamente bajo carga.');
  }
}

run().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
