const prisma = require("./src/prisma");

async function main() {
  const resultat = await prisma.stockItem.updateMany({
    where: { pointure: null },
    data: { pointure: "" },
  });
  console.log(`${resultat.count} ligne(s) de stock corrigée(s).`);
  process.exit();
}

main();