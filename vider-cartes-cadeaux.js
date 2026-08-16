const prisma = require("./src/prisma");

async function main() {
  const r = await prisma.carteCadeau.deleteMany({});
  console.log(`${r.count} carte(s) cadeau supprimée(s).`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());