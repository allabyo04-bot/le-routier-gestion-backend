// Import des ventes historiques Abigescom (avant le go-live), pour consultation à leur date d'origine.
// Aucun impact sur le stock actuel (déjà à jour depuis l'import de juillet) ni sur les clients.
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

const DOSSIER = __dirname;
const CONFIRMER = process.argv.includes("--confirmer");
const DEPOT_MAP = { ANGRE: "Angré", KOUMASSI: "Koumassi" };

function lireFeuille(nomFichier) {
  const wb = XLSX.readFile(path.join(DOSSIER, nomFichier), { cellDates: true });
  const feuille = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(feuille, { defval: null });
}

function resoudreDesignation(row, codeToDesig, desigsValides) {
  let d = row["Désignation de l'article"];
  if (d != null) {
    d = String(d).trim();
    if (desigsValides.has(d)) return d;
    const d2 = d.replace(/\s+\d+$/, "").trim();
    if (desigsValides.has(d2)) return d2;
  }
  const code = String(row["Code Article"]);
  if (codeToDesig.has(code) && desigsValides.has(codeToDesig.get(code))) return codeToDesig.get(code);
  return null;
}

async function main() {
  console.log(`\n=== Import ventes historiques Abigescom — mode ${CONFIRMER ? "RÉEL" : "TEST"} ===\n`);

  const lignesFichier = lireFeuille("Anciennes_ventes_issues_de_Abi.xls").filter((l) => l["Dépôt / magasin"]);
  const catalogueFichier = lireFeuille("liste_des_articles.xlsx");
  const codeToDesig = new Map(catalogueFichier.map((l) => [String(l["Code"]), String(l["Désignation de l'article"]).trim()]));

  const articlesDB = await prisma.article.findMany({ include: { marque: true } });
  const desigsValides = new Set(articlesDB.map((a) => a.designation));
  const articleParDesignation = new Map(articlesDB.map((a) => [a.designation, a]));

  const djenie = await prisma.user.findFirst({ where: { login: "djenie" } });
  if (!djenie) { console.error("Compte djenie introuvable."); return; }

  // Regroupement par document
  const documents = new Map();
  let nonResolues = 0;
  for (const l of lignesFichier) {
    const numero = String(l["N° Document"]);
    if (!documents.has(numero)) {
      documents.set(numero, {
        numero,
        boutique: DEPOT_MAP[l["Dépôt / magasin"]],
        date: l["Date Document"],
        heure: l["Heure"],
        lignes: [],
      });
    }
    const desig = resoudreDesignation(l, codeToDesig, desigsValides);
    if (!desig) { nonResolues++; continue; }
    const article = articleParDesignation.get(desig);
    documents.get(numero).lignes.push({
      articleId: article.id,
      designation: article.designation,
      marque: article.marque.nom,
      famille: article.famille,
      pointure: null,
      quantite: Number(l["Quantité"]) || 1,
      prixUnitaire: Number(l["PU"]) || 0,
      sousTotal: Number(l["Montant Net à Payer"]) || 0,
    });
  }

  const ventesAConstruire = [...documents.values()].map((d) => ({
    ...d,
    total: d.lignes.reduce((s, l) => s + l.sousTotal, 0),
  }));

  console.log(`Documents source : ${documents.size}`);
  console.log(`Lignes non résolues (ignorées) : ${nonResolues}`);
  console.log(`Total général : ${ventesAConstruire.reduce((s, v) => s + v.total, 0)} F`);
  console.log(`  Angré : ${ventesAConstruire.filter((v) => v.boutique === "Angré").reduce((s, v) => s + v.total, 0)} F`);
  console.log(`  Koumassi : ${ventesAConstruire.filter((v) => v.boutique === "Koumassi").reduce((s, v) => s + v.total, 0)} F`);

  // Vérifier les doublons avec des ventes déjà existantes (même numéro)
  const numerosExistants = new Set((await prisma.vente.findMany({ where: { numero: { in: ventesAConstruire.map((v) => v.numero) } }, select: { numero: true } })).map((v) => v.numero));
  const aCreer = ventesAConstruire.filter((v) => !numerosExistants.has(v.numero));
  console.log(`Déjà présentes (ignorées) : ${ventesAConstruire.length - aCreer.length}`);
  console.log(`À créer : ${aCreer.length}`);

  console.log("\nAperçu (3 premières) :");
  aCreer.slice(0, 3).forEach((v) => {
    console.log(`  ${v.numero} · ${v.boutique} · ${v.date} · ${v.total} F · ${v.lignes.length} article(s)`);
  });

  if (!CONFIRMER) {
    console.log("\n--- MODE TEST : rien n'a été créé. Relance avec --confirmer. ---\n");
    return;
  }

  let créées = 0, échecs = 0;
  for (const v of aCreer) {
    try {
      await prisma.vente.create({
        data: {
          numero: v.numero,
          date: new Date(v.date),
          boutique: v.boutique,
          modeVente: "Boutique",
          typeVente: "Comptant",
          statut: "Validee",
          caissierId: djenie.id,
          vendeurId: null,
          clientId: null,
          total: v.total,
          montantRemise: 0,
          monnaieRendue: 0,
          lignes: { create: v.lignes.map(({ articleId, designation, marque, famille, pointure, quantite, prixUnitaire, sousTotal }) => ({ articleId, designation, marque, famille, pointure, quantite, prixUnitaire, sousTotal })) },
          paiements: { create: [{ mode: "especes", montant: v.total }] },
        },
      });
      créées++;
    } catch (e) {
      échecs++;
      console.log(`  Échec ${v.numero} : ${e.message.split("\n")[0]}`);
    }
  }
  console.log(`\nVentes créées : ${créées}`);
  if (échecs) console.log(`Échecs : ${échecs}`);
  console.log("\n=== Import terminé ===\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());