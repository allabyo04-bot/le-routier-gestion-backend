// Complète le stock T38 uniquement là où il est actuellement à 0,
// à partir d'un fichier de quantités globales (sans détail par pointure).
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

const DOSSIER = __dirname;
const CONFIRMER = process.argv.includes("--confirmer");
const POINTURE_CIBLE = "38";

function lireFeuille(nomFichier) {
  const wb = XLSX.readFile(path.join(DOSSIER, nomFichier));
  const feuille = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(feuille, { defval: null });
}

async function main() {
  console.log(`\n=== Complément stock T38 — mode ${CONFIRMER ? "RÉEL" : "TEST"} ===\n`);

  const lignes = lireFeuille("stock_a_compléter.xls");
  const articles = await prisma.article.findMany({ include: { stocks: true } });
  const parDesignation = new Map(articles.map((a) => [a.designation.trim(), a]));

  let miseAJour = 0, ignoreDejaRempli = 0, introuvable = 0;
  const details = [];

  for (const l of lignes) {
    const designation = String(l["Désignation"] || "").trim();
    const article = parDesignation.get(designation);
    if (!article) { introuvable++; continue; }
    if (article.famille !== "Chaussure") continue; // T38 n'a de sens que pour les chaussures

    for (const [boutique, qte] of [["Angré", l["ANGRE"]], ["Koumassi", l["KOUMASSI"]]]) {
      const quantite = Number(qte) || 0;
      if (quantite <= 0) continue;

      const existant = article.stocks.find((s) => s.boutique === boutique && s.pointure === POINTURE_CIBLE);
      const quantiteActuelle = existant?.quantite || 0;

      if (quantiteActuelle > 0) { ignoreDejaRempli++; continue; }

      details.push({ articleId: article.id, designation, boutique, quantite });
      miseAJour++;
    }
  }

  console.log(`Lignes du fichier : ${lignes.length}`);
  console.log(`Articles introuvables (désignation non reconnue) : ${introuvable}`);
  console.log(`Ignorés (T38 déjà rempli, non écrasé) : ${ignoreDejaRempli}`);
  console.log(`À mettre à jour (T38 actuellement à 0) : ${miseAJour}`);

  if (!CONFIRMER) {
    console.log("\nAperçu des 15 premiers changements :");
    details.slice(0, 15).forEach((d) => console.log(`  ${d.designation} · ${d.boutique} · T38 → ${d.quantite}`));
    console.log("\n--- MODE TEST : rien n'a été modifié. Relance avec --confirmer. ---\n");
    return;
  }

  for (const d of details) {
    await prisma.stockItem.upsert({
      where: { articleId_boutique_pointure: { articleId: d.articleId, boutique: d.boutique, pointure: POINTURE_CIBLE } },
      update: { quantite: d.quantite },
      create: { articleId: d.articleId, boutique: d.boutique, pointure: POINTURE_CIBLE, quantite: d.quantite },
    });
  }
  console.log(`\n=== ${details.length} ligne(s) de stock T38 mises à jour. ===\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());