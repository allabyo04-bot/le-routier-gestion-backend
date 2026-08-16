const prisma = require("./src/prisma");

async function main() {
  const r1 = await prisma.retour.deleteMany({});
  console.log(`${r1.count} retour(s) supprimé(s).`);

  const r2 = await prisma.paiement.deleteMany({});
  console.log(`${r2.count} paiement(s) supprimé(s).`);

  const r3 = await prisma.ligneVente.deleteMany({});
  console.log(`${r3.count} ligne(s) de vente supprimée(s).`);

  const r4 = await prisma.vente.deleteMany({});
  console.log(`${r4.count} vente(s) supprimée(s).`);

  console.log("Terminé — les ventes de test sont vidées.");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());