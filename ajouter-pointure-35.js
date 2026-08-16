const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const chaussures = await prisma.article.findMany({ where: { famille: "Chaussure" } });
  const boutiques = ["Angré", "Koumassi"];
  let crees = 0;

  for (const article of chaussures) {
    for (const boutique of boutiques) {
      const existe = await prisma.stockItem.findUnique({
        where: { articleId_boutique_pointure: { articleId: article.id, boutique, pointure: "35" } },
      });
      if (!existe) {
        await prisma.stockItem.create({
          data: { articleId: article.id, boutique, pointure: "35", quantite: 0 },
        });
        crees++;
      }
    }
  }
  console.log(`${crees} lignes de stock T35 créées.`);
  await prisma.$disconnect();
}

main();