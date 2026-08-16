// Import Articles + Stock — données réelles de lancement.
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

const DOSSIER = __dirname;
const CONFIRMER = process.argv.includes("--confirmer");

const POINTURE_MAP = { 1: "35", 2: "36", 3: "37", 4: "38", 5: "39", 6: "40", 7: "41", 8: "42" };
const DEPOT_MAP = { ANGRE: "Angré", KOUMASSI: "Koumassi" };
const MARQUE_GENERIQUE = "Non renseignée";

function lireFeuille(nomFichier) {
  const wb = XLSX.readFile(path.join(DOSSIER, nomFichier));
  const feuille = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(feuille, { defval: null });
}

async function main() {
  console.log(`\n=== Import Articles + Stock — mode ${CONFIRMER ? "RÉEL" : "TEST"} ===\n`);

  const lignesArticles = lireFeuille("liste_des_articles.xlsx");
  const groupes = new Map();

  for (const l of lignesArticles) {
    const desig = String(l["Désignation de l'article"] || "").trim();
    if (!desig) continue;
    if (!groupes.has(desig)) groupes.set(desig, { codes: [], prix: [], famille: l["Famille"] });
    const g = groupes.get(desig);
    g.codes.push(l["Code"]);
    g.prix.push(Number(l["Prix de vente"]) || 0);
  }

  const catalogue = [];
  for (const [designation, g] of groupes) {
    const compte = {};
    g.prix.forEach((p) => (compte[p] = (compte[p] || 0) + 1));
    const prixRetenu = Number(Object.entries(compte).sort((a, b) => b[1] - a[1])[0][0]);
    catalogue.push({
      reference: String(g.codes[0]),
      designation,
      famille: g.famille === "CHAUSSURES" ? "Chaussure" : "Sac",
      prixVente: prixRetenu,
    });
  }
  console.log(`Articles distincts après fusion : ${catalogue.length}`);

  const famParDesignation = new Map(catalogue.map((a) => [a.designation, a.famille]));
  const lignesStock = lireFeuille("stocks_pointures.xls").filter((l) => l["Articles"] !== "Somme");

  const stockAgrege = new Map();
  for (const l of lignesStock) {
    const designation = String(l["Articles"] || "").trim();
    const boutique = DEPOT_MAP[l["Dépôt"]];
    const famille = famParDesignation.get(designation);
    if (!boutique || !famille) continue;
    let pointure = "";
    if (famille === "Chaussure" && l["Taille"] != null) pointure = POINTURE_MAP[Number(l["Taille"])] || "";
    const cle = `${designation}||${boutique}||${pointure}`;
    stockAgrege.set(cle, (stockAgrege.get(cle) || 0) + Number(l["Quantité en Stocks"] || 0));
  }
  console.log(`Lignes de stock après agrégation : ${stockAgrege.size}`);
  console.log(`Quantité totale : ${[...stockAgrege.values()].reduce((s, q) => s + q, 0)}`);

  if (!CONFIRMER) {
    console.log("\n--- MODE TEST : aucune écriture. Relance avec --confirmer. ---\n");
    return;
  }

  console.log("\nÉcriture en base...");

  let marqueGenerique = await prisma.brand.findUnique({ where: { nom: MARQUE_GENERIQUE } });
  if (!marqueGenerique) marqueGenerique = await prisma.brand.create({ data: { nom: MARQUE_GENERIQUE } });

  const articleIdParDesignation = new Map();
  for (const a of catalogue) {
    const article = await prisma.article.upsert({
      where: { reference: a.reference },
      update: { designation: a.designation, marqueId: marqueGenerique.id, famille: a.famille, prixVente: a.prixVente },
      create: { reference: a.reference, designation: a.designation, marqueId: marqueGenerique.id, famille: a.famille, prixVente: a.prixVente },
    });
    articleIdParDesignation.set(a.designation, article.id);
  }
  console.log(`Articles upsertés : ${catalogue.length}`);

  let stockUpserts = 0;
  for (const [cle, quantite] of stockAgrege) {
    const [designation, boutique, pointure] = cle.split("||");
    const articleId = articleIdParDesignation.get(designation);
    if (!articleId) continue;
    await prisma.stockItem.upsert({
      where: { articleId_boutique_pointure: { articleId, boutique, pointure } },
      update: { quantite },
      create: { articleId, boutique, pointure, quantite },
    });
    stockUpserts++;
  }
  console.log(`Lignes de stock upsertées : ${stockUpserts}`);
  console.log("\n=== Import terminé ===\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());