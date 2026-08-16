const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.stockItem.deleteMany({ where: { article: { reference: "HISCH-090" } } });
  await prisma.article.delete({ where: { reference: "HISCH-090" } });
  console.log("HISCH-090 supprime proprement.");
  await prisma.$disconnect();
}
main();