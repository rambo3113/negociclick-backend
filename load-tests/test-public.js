/**
 * Load test — Endpoints públicos (sin auth)
 * Simula tráfico del home page: listado + perfil de negocio
 */
const autocannon = require('autocannon');
const ctx = JSON.parse(process.env.LOAD_CTX);

async function run() {
  const results = [];

  // ── 1. GET /businesses (home listing) ─────────────────────────────────────
  console.log('\n[PUBLIC-1] GET /api/businesses — 100 usuarios × 10s');
  const r1 = await autocannon({
    url: `${ctx.baseUrl}/api/businesses`,
    connections: 100,
    duration: 10,
    headers: {},
  });
  results.push({ test: 'GET /businesses', ...summarize(r1) });

  // ── 2. GET /businesses?category=BARBERIA&city=Lima ─────────────────────────
  console.log('\n[PUBLIC-2] GET /businesses con filtros — 80 usuarios × 10s');
  const r2 = await autocannon({
    url: `${ctx.baseUrl}/api/businesses?category=BARBERIA&city=Lima`,
    connections: 80,
    duration: 10,
  });
  results.push({ test: 'GET /businesses?category+city', ...summarize(r2) });

  // ── 3. GET /businesses/:id (perfil) ──────────────────────────────────────
  console.log('\n[PUBLIC-3] GET /businesses/:id — 120 usuarios × 10s');
  const r3 = await autocannon({
    url: `${ctx.baseUrl}/api/businesses/${ctx.businessId}`,
    connections: 120,
    duration: 10,
  });
  results.push({ test: 'GET /businesses/:id', ...summarize(r3) });

  // ── 4. GET /services/:businessId ──────────────────────────────────────────
  console.log('\n[PUBLIC-4] GET /services/:businessId — 80 usuarios × 10s');
  const r4 = await autocannon({
    url: `${ctx.baseUrl}/api/services/business/${ctx.businessId}`,
    connections: 80,
    duration: 10,
  });
  results.push({ test: 'GET /services/:businessId', ...summarize(r4) });

  // ── 5. GET /reviews/:businessId ────────────────────────────────────────────
  console.log('\n[PUBLIC-5] GET /reviews/:businessId — 60 usuarios × 10s');
  const r5 = await autocannon({
    url: `${ctx.baseUrl}/api/reviews/business/${ctx.businessId}`,
    connections: 60,
    duration: 10,
  });
  results.push({ test: 'GET /reviews/:businessId', ...summarize(r5) });

  // ── 6. GET /health ────────────────────────────────────────────────────────
  console.log('\n[PUBLIC-6] GET /health — 200 usuarios × 5s');
  const r6 = await autocannon({
    url: `${ctx.baseUrl}/health`,
    connections: 200,
    duration: 5,
  });
  results.push({ test: 'GET /health', ...summarize(r6) });

  printReport('ENDPOINTS PÚBLICOS', results);
}

function summarize(r) {
  return {
    rps:       Math.round(r.requests.mean),
    latP50:    r.latency.p50,
    latP99:    r.latency.p99,
    errors:    r.errors,
    non2xx:    r.non2xx,
    timeouts:  r.timeouts,
    totalReqs: r.requests.total,
  };
}

function printReport(title, results) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  REPORTE: ${title}`);
  console.log('═'.repeat(70));
  console.log('Test'.padEnd(32) + 'RPS'.padEnd(8) + 'p50ms'.padEnd(8) + 'p99ms'.padEnd(8) + 'Errors'.padEnd(8) + 'Non2xx');
  console.log('─'.repeat(70));
  for (const r of results) {
    const hasIssue = r.errors > 0 || r.non2xx > 0 || r.latP99 > 2000;
    const flag = hasIssue ? ' ⚠' : ' ✓';
    console.log(
      r.test.padEnd(32) +
      String(r.rps).padEnd(8) +
      String(r.latP50).padEnd(8) +
      String(r.latP99).padEnd(8) +
      String(r.errors).padEnd(8) +
      String(r.non2xx) + flag
    );
  }
  console.log('═'.repeat(70));
  const issues = results.filter(r => r.errors > 0 || r.non2xx > 0 || r.latP99 > 2000);
  if (issues.length) {
    console.log('\n⚠️  PROBLEMAS DETECTADOS:');
    for (const r of issues) {
      if (r.errors > 0)      console.log(`  - ${r.test}: ${r.errors} connection errors`);
      if (r.non2xx > 0)      console.log(`  - ${r.test}: ${r.non2xx} respuestas no-2xx`);
      if (r.latP99 > 2000)   console.log(`  - ${r.test}: latencia p99=${r.latP99}ms (>2s)`);
    }
  } else {
    console.log('\n✅ Todos los endpoints públicos respondieron dentro de límites.');
  }
}

run().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
