// Import ponctuel de la liste d'articles LE ROUTIER (issue de l'historique de ventes fourni
// par le client), avec création d'une ligne de stock à 0 dans le dépôt principal pour chacun.
// Usage (depuis la console Railway du service backend) : node scripts/import-articles.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ARTICLES = [
  { code: "1", designation: "Recharge Progaz 3Kg", prixAchat: 2310, prixVente: 2400 },
  { code: "2", designation: "Recharge Progaz 6Kg", prixAchat: 4290, prixVente: 4500 },
  { code: "7", designation: "Recharge Bénin Pétro 3Kg", prixAchat: 1896, prixVente: 2000 },
  { code: "8", designation: "Recharge Bénin Pétro 6Kg", prixAchat: 4290, prixVente: 4500 },
  { code: "9", designation: "Recharge Bénin Pétro 12.5Kg", prixAchat: 9563, prixVente: 10000 },
  { code: "10", designation: "Recharge Bénin Pétro 38Kg", prixAchat: 29070, prixVente: 30400 },
  { code: "11", designation: "Recharge Oryx 3Kg Cerc", prixAchat: 1896, prixVente: 2000 },
  { code: "12", designation: "Recharge Oryx 3Kg Obus", prixAchat: 1896, prixVente: 2000 },
  { code: "13", designation: "Recharge Oryx 6Kg", prixAchat: 4290, prixVente: 4500 },
  { code: "14", designation: "Recharge Oryx 12,5Kg", prixAchat: 9563, prixVente: 10000 },
  { code: "15", designation: "Recharge Oryx 35Kg", prixAchat: 26777, prixVente: 28000 },
  { code: "16", designation: "Recharge Oryx 38Kg", prixAchat: 29070, prixVente: 30400 },
  { code: "17", designation: "Recharge Oryx 52Kg", prixAchat: 39780, prixVente: 41600 },
  { code: "20", designation: "Consigne Oryx 6Kg", prixAchat: 18000, prixVente: 18500 },
  { code: "21", designation: "Consigne Oryx 12,5Kg", prixAchat: 29500, prixVente: 30000 },
  { code: "22", designation: "Consigne Oryx 52Kg", prixAchat: 90000, prixVente: 92000 },
  { code: "23", designation: "Bruleur Oryx R", prixAchat: 3200, prixVente: 3500 },
  { code: "24", designation: "Support Oryx R", prixAchat: 3000, prixVente: 4000 },
  { code: "25", designation: "Détendeur Oryx R", prixAchat: 2500, prixVente: 2650 },
  { code: "33", designation: "Bruleur Oryx", prixAchat: 3200, prixVente: 4000 },
  { code: "37", designation: "Support Oryx 6Kg", prixAchat: 3000, prixVente: 5000 },
  { code: "40", designation: "Détendeur Oryx", prixAchat: 2500, prixVente: 3000 },
  { code: "42", designation: "Bruleur Orgaz", prixAchat: 1250, prixVente: 2000 },
  { code: "44", designation: "Tuyau Orgaz", prixAchat: 750, prixVente: 2000 },
  { code: "45", designation: "Détendeur 6Kg", prixAchat: 3000, prixVente: 5000 },
  { code: "46", designation: "Détendeur Orgaz 12.5Kg", prixAchat: 2000, prixVente: 3000 },
  { code: "48", designation: "Rechaud Orgaz 3 Feux", prixAchat: 13500, prixVente: 19000 },
  { code: "49", designation: "Rechaud Orgaz 4 Feux", prixAchat: 17000, prixVente: 21000 },
  { code: "56", designation: "Super Zem 100 1L", prixAchat: 2291, prixVente: 2800 },
  { code: "57", designation: "Axcella 4T 1L 20W50", prixAchat: 2317, prixVente: 3400 },
  { code: "59", designation: "Axcella A5 1L 20W50", prixAchat: 2609, prixVente: 3400 },
  { code: "60", designation: "Axcella A5 4L 20W50", prixAchat: 9863, prixVente: 12000 },
  { code: "61", designation: "Enduro D2 5L SAE 50", prixAchat: 10875, prixVente: 13000 },
  { code: "62", designation: "Enduro D2 25L SAE 50", prixAchat: 55675, prixVente: 62500 },
  { code: "63", designation: "Enduro D6 5L 15W40", prixAchat: 12059, prixVente: 15000 },
  { code: "64", designation: "Enduro D6 25L 15W40", prixAchat: 60598, prixVente: 69500 },
  { code: "65", designation: "Enduro DX 7 5L 10W40", prixAchat: 13164, prixVente: 18000 },
  { code: "67", designation: "Matic ATF Premium 1L", prixAchat: 2834, prixVente: 4200 },
  { code: "92", designation: "Huile Pont 80W90 Detail", prixAchat: 1320, prixVente: 2000 },
  { code: "95", designation: "Embout Direct", prixAchat: 2000, prixVente: 3000 },
  { code: "97", designation: "Bruleur Star", prixAchat: 500, prixVente: 1000 },
];

async function main() {
  const depot = await prisma.depot.findFirst({ where: { nom: "DEPOT PRINCIPAL" } });
  if (!depot) {
    throw new Error("Dépôt 'DEPOT PRINCIPAL' introuvable — lance d'abord node prisma/seed.js");
  }

  let crees = 0;
  let misAJour = 0;

  for (const a of ARTICLES) {
    const article = await prisma.article.upsert({
      where: { code: a.code },
      update: { designation: a.designation, prixAchat: a.prixAchat, prixVente: a.prixVente },
      create: { code: a.code, designation: a.designation, prixAchat: a.prixAchat, prixVente: a.prixVente },
    });

    const existant = await prisma.stockItem.findUnique({
      where: { articleId_depotId: { articleId: article.id, depotId: depot.id } },
    });

    if (!existant) {
      await prisma.stockItem.create({
        data: { articleId: article.id, depotId: depot.id, quantite: 0, seuilAlerte: 0 },
      });
      crees++;
    } else {
      misAJour++;
    }
  }

  console.log(`Import terminé : ${ARTICLES.length} articles traités (${crees} nouvelles lignes de stock créées, ${misAJour} déjà existantes).`);
  console.log("Toutes les quantités sont à 0 — va dans 'Stock' pour saisir les quantités réelles reçues.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
