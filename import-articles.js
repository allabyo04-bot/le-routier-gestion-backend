// Script d'import des articles depuis l'export Abigescom.
// À placer dans le dossier gestion-commerciale-backend, avec articles_import.json
// à côté (par exemple dans un sous-dossier "import").
//
// Usage :
//   node import-articles.js
//
// Ce script :
// 1. Crée (ou récupère) chaque marque nécessaire
// 2. Crée chaque article avec une référence générée automatiquement
// 3. Initialise le stock à 0 pour chaque boutique (et chaque pointure si Chaussure)
//    -> l'import du stock réel se fera dans une étape séparée, à partir du fichier stock

const fs = require("fs");
const path = require("path");
const prisma = require("./src/prisma");
const { BOUTIQUES, POINTURES, refBase } = require("./src/constants");

async function generateReference(marqueNom, famille, usedByBase) {
  const base = refBase(marqueNom, famille);
  if (!usedByBase[base]) {
    const existants = await prisma.article.findMany({
      where: { reference: { startsWith: `${base}-` } },
      select: { reference: true },
    });
    const used = new Set(
      existants.map((a) => parseInt(a.reference.split("-")[1], 10)).filter((n) => !isNaN(n))
    );
    usedByBase[base] = used;
  }
  const used = usedByBase[base];
  let n = 1;
  while (used.has(n)) n++;
  used.add(n);
  return `${base}-${String(n).padStart(3, "0")}`;
}

async function main() {
  const dataPath = path.join(__dirname, "articles_import.json");
  const articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Chargé : ${articles.length} articles à importer.`);

  // 1. Créer les marques nécessaires (upsert par nom)
  const marqueNoms = [...new Set(articles.map((a) => a.marque))];
  const marqueParNom = {};
  for (const nom of marqueNoms) {
    const marque = await prisma.brand.upsert({
      where: { nom },
      update: {},
      create: { nom },
    });
    marqueParNom[nom] = marque;
    console.log(`Marque prête : ${nom}`);
  }

  // 2. Créer les articles un par un
  const usedByBase = {};
  let created = 0;
  let skipped = 0;

  for (const a of articles) {
    const marque = marqueParNom[a.marque];
    if (!marque) {
      console.log(`⚠️  Marque introuvable pour "${a.designation}", ignoré.`);
      skipped++;
      continue;
    }

    // Évite de recréer un article déjà importé (même désignation + même marque)
    const existant = await prisma.article.findFirst({
      where: { designation: a.designation, marqueId: marque.id },
    });
    if (existant) {
      skipped++;
      continue;
    }

    const reference = await generateReference(marque.nom, a.famille, usedByBase);

    const stocksData = a.famille === "Chaussure"
      ? BOUTIQUES.flatMap((b) => POINTURES.map((p) => ({ boutique: b, pointure: p, quantite: 0 })))
      : BOUTIQUES.map((b) => ({ boutique: b, pointure: null, quantite: 0 }));

    await prisma.article.create({
      data: {
        reference,
        designation: a.designation,
        famille: a.famille,
        marqueId: marque.id,
        prixVente: a.prixVente,
        stocks: { create: stocksData },
      },
    });
    created++;
    if (created % 50 === 0) console.log(`... ${created} articles créés`);
  }

  console.log("");
  console.log(`Terminé. Créés : ${created}. Ignorés (déjà existants ou sans marque) : ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
