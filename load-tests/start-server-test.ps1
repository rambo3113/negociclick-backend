# Arranca el backend en modo test (rate limiting desactivado)
# Uso: .\load-tests\start-server-test.ps1
# Luego en otra terminal: node load-tests/test-public.js

$env:NODE_ENV = "test"
Write-Host "Iniciando servidor en NODE_ENV=test (sin rate limiting)..."
npx ts-node --transpile-only src/app.ts
