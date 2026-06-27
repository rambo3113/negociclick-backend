/**
 * Ejecuta una función pesada después de liberar el event loop actual.
 * El response del cliente se envía antes de que la tarea inicie.
 * Los errores se loguean pero nunca interrumpen el flujo del request.
 */
export function runAsync(label: string, fn: () => Promise<void>): void {
  setImmediate(() => {
    fn().catch((err) => console.error(`[asyncTask:${label}]`, err));
  });
}
