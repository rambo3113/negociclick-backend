// Asigna orderMode a los negocios existentes según su categoría.
// Uso: npx ts-node scripts/migrate-order-mode.ts  (o: npx tsx scripts/migrate-order-mode.ts)
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Categorías que son "pedido de producto" (sin agenda de citas)
const ORDER_CATEGORIES = new Set([
  'REPOSTERIA',
  'FLORES',
  'CATERING',
  'TEJIDOS_CROCHET',
  'DECORACION_EVENTOS',
]);

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true, category: true } });

  let toOrder = 0;
  let toAppointment = 0;

  for (const b of businesses) {
    const mode = ORDER_CATEGORIES.has(b.category) ? 'ORDER' : 'APPOINTMENT';
    await prisma.business.update({ where: { id: b.id }, data: { orderMode: mode } });
    if (mode === 'ORDER') toOrder++; else toAppointment++;
  }

  console.log(`Negocios actualizados: ${businesses.length}`);
  console.log(`  -> ORDER:       ${toOrder}`);
  console.log(`  -> APPOINTMENT: ${toAppointment}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
