const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const r1 = await prisma.mouvementStock.deleteMany({});
  console.log(`${r1.count} mouvement(s) de stock supprime(s).`);

  const r2 = await prisma.stockItem.updateMany({ data: { quantite: 0 } });
  console.log(`${r2.count} ligne(s) de stock remise(s) a 0.`);

  await prisma.$disconnect();
}
main();