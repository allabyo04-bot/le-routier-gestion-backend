require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

async function main() {
  const article = await prisma.article.findFirst({
    where: { designation: { contains: "70128-E6 CUOIO" } },
    include: { stocks: true },
  });
  if (!article) { console.log("Article introuvable en base."); return; }
  console.log("Article:", article.designation, "| actif:", article.actif, "| famille:", article.famille);
  console.log("Stocks:");
  article.stocks.forEach((s) => console.log(`  ${s.boutique} · T${s.pointure} : ${s.quantite}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());