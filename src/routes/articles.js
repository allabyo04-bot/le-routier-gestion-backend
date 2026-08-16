const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { BOUTIQUES, POINTURES, refBase } = require("../constants");
const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage() });

function requireAdmin(req, res, next) {
  if (!req.user?.role?.systeme) {
    return res.status(403).json({ error: "Seul l'administrateur peut effectuer des mouvements de stock." });
  }
  next();
}

async function generateReference(marqueNom, famille) {
  const base = refBase(marqueNom, famille);
  const existants = await prisma.article.findMany({ where: { reference: { startsWith: `${base}-` } }, select: { reference: true } });
  const used = new Set(existants.map((a) => parseInt(a.reference.split("-")[1], 10)).filter((n) => !isNaN(n)));
  let n = 1;
  while (used.has(n)) n++;
  return `${base}-${String(n).padStart(3, "0")}`;
}

// GET /api/articles/mouvements/historique?articleId=&boutique=  — historique des mouvements de stock
router.get("/mouvements/historique", async (req, res) => {
  const { articleId, boutique } = req.query;
  const mouvements = await prisma.mouvementStock.findMany({
    where: {
      articleId: articleId || undefined,
      OR: boutique ? [{ boutique }, { boutiqueSource: boutique }] : undefined,
    },
    include: { article: true, effectuePar: true },
    orderBy: { date: "desc" },
    take: 200,
  });
  res.json(mouvements);
});

router.get("/", async (req, res) => {
  const articles = await prisma.article.findMany({
    include: { marque: true, stocks: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(articles);
});

router.post("/", requirePermission("stock"), async (req, res) => {
  const { designation, famille, marqueId, prixVente } = req.body;
  if (!designation?.trim() || !famille || !marqueId || !prixVente) {
    return res.status(400).json({ error: "Désignation, famille, marque et prix de vente sont obligatoires." });
  }
  const marque = await prisma.brand.findUnique({ where: { id: marqueId } });
  if (!marque) return res.status(400).json({ error: "Marque introuvable." });
  const reference = await generateReference(marque.nom, famille);
  const stocksData = famille === "Chaussure"
    ? BOUTIQUES.flatMap((b) => POINTURES.map((p) => ({ boutique: b, pointure: p, quantite: 0 })))
    : BOUTIQUES.map((b) => ({ boutique: b, pointure: "", quantite: 0 }));
  const article = await prisma.article.create({
    data: {
      reference, designation: designation.trim(), famille, marqueId, prixVente: Number(prixVente),
      stocks: { create: stocksData },
    },
    include: { marque: true, stocks: true },
  });
  res.status(201).json(article);
});

router.put("/:id", requirePermission("stock"), async (req, res) => {
  const { designation, prixVente, actif } = req.body;
  const article = await prisma.article.update({
    where: { id: req.params.id },
    data: { designation, prixVente: prixVente ? Number(prixVente) : undefined, actif },
    include: { marque: true, stocks: true },
  });
  res.json(article);
});

router.delete("/:id", requirePermission("stock"), async (req, res) => {
  await prisma.article.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

router.put("/:id/stock", requirePermission("stock"), requireAdmin, async (req, res) => {
  const { boutique, pointure, quantite } = req.body;
  const qty = Math.max(0, parseInt(quantite, 10) || 0);
  const avant = await prisma.stockItem.findUnique({
    where: { articleId_boutique_pointure: { articleId: req.params.id, boutique, pointure: pointure || "" } },
  });
  const quantiteAvant = avant?.quantite || 0;
  const item = await prisma.stockItem.upsert({
    where: { articleId_boutique_pointure: { articleId: req.params.id, boutique, pointure: pointure || "" } },
    update: { quantite: qty },
    create: { articleId: req.params.id, boutique, pointure: pointure || "", quantite: qty },
  });
  await prisma.mouvementStock.create({
    data: {
      articleId: req.params.id, type: "Correction", boutique, pointure: pointure || "",
      quantite: Math.abs(qty - quantiteAvant), quantiteAvant, quantiteApres: qty,
      effectueParId: req.user.id,
    },
  });
  res.json(item);
});

router.post("/:id/stock/ajouter", requirePermission("stock"), requireAdmin, async (req, res) => {
  const { boutique, pointure, quantite } = req.body;
  const qty = parseInt(quantite, 10);
  if (!boutique || !qty || qty <= 0) {
    return res.status(400).json({ error: "Boutique et quantité (positive) sont obligatoires." });
  }
  const avant = await prisma.stockItem.findUnique({
    where: { articleId_boutique_pointure: { articleId: req.params.id, boutique, pointure: pointure || "" } },
  });
  const quantiteAvant = avant?.quantite || 0;
  const item = await prisma.stockItem.upsert({
    where: { articleId_boutique_pointure: { articleId: req.params.id, boutique, pointure: pointure || "" } },
    update: { quantite: { increment: qty } },
    create: { articleId: req.params.id, boutique, pointure: pointure || "", quantite: qty },
  });
  await prisma.mouvementStock.create({
    data: {
      articleId: req.params.id, type: "Ajout", boutique, pointure: pointure || "",
      quantite: qty, quantiteAvant, quantiteApres: quantiteAvant + qty,
      effectueParId: req.user.id,
    },
  });
  res.json(item);
});

router.post("/:id/stock/virement", requirePermission("stock"), requireAdmin, async (req, res) => {
  const { boutiqueSource, boutiqueDestination, pointure, quantite } = req.body;
  const qty = parseInt(quantite, 10);
  if (!boutiqueSource || !boutiqueDestination || !qty || qty <= 0) {
    return res.status(400).json({ error: "Boutique source, boutique destination et quantité (positive) sont obligatoires." });
  }
  if (boutiqueSource === boutiqueDestination) {
    return res.status(400).json({ error: "Les boutiques source et destination doivent être différentes." });
  }
  try {
    const [source, destination] = await prisma.$transaction(async (tx) => {
      const stockSource = await tx.stockItem.findUnique({
        where: { articleId_boutique_pointure: { articleId: req.params.id, boutique: boutiqueSource, pointure: pointure || "" } },
      });
      const dispoSource = stockSource?.quantite || 0;
      if (qty > dispoSource) {
        throw { status: 409, message: `Stock insuffisant à ${boutiqueSource} (${dispoSource} disponible(s)).` };
      }
      const stockDestination = await tx.stockItem.findUnique({
        where: { articleId_boutique_pointure: { articleId: req.params.id, boutique: boutiqueDestination, pointure: pointure || "" } },
      });
      const dispoDestination = stockDestination?.quantite || 0;
      const nouvelleSource = await tx.stockItem.update({
        where: { articleId_boutique_pointure: { articleId: req.params.id, boutique: boutiqueSource, pointure: pointure || "" } },
        data: { quantite: dispoSource - qty },
      });
      const nouvelleDestination = await tx.stockItem.upsert({
        where: { articleId_boutique_pointure: { articleId: req.params.id, boutique: boutiqueDestination, pointure: pointure || "" } },
        update: { quantite: { increment: qty } },
        create: { articleId: req.params.id, boutique: boutiqueDestination, pointure: pointure || "", quantite: qty },
      });
      await tx.mouvementStock.create({
        data: {
          articleId: req.params.id, type: "Virement", boutique: boutiqueDestination, boutiqueSource, pointure: pointure || "",
          quantite: qty, quantiteAvant: dispoDestination, quantiteApres: dispoDestination + qty,
          effectueParId: req.user.id,
        },
      });
      return [nouvelleSource, nouvelleDestination];
    });
    res.json({ source, destination });
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || "Erreur lors du virement de stock.";
    if (status === 500) console.error(err);
    res.status(status).json({ error: message });
  }
});
function normaliserEnTete(valeur) {
  return String(valeur || "").trim().toUpperCase();
}

function lireFichierImport(buffer, modeQuantite) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const lignesBrutes = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const lignes = [];
  for (const ligne of lignesBrutes) {
    const cles = {};
    for (const cle of Object.keys(ligne)) cles[normaliserEnTete(cle)] = ligne[cle];

    const designation = String(cles["REFERENCES"] || "").replace(/\s+/g, " ").trim();
    if (!designation) continue;

    const prixVente = parseInt(cles["PRIX DE VENTE"], 10);
    const quantites = {};

    if (modeQuantite === "pointure") {
      for (const p of POINTURES) {
        const q = parseInt(cles[`T${p}`], 10);
        if (!isNaN(q) && q > 0) quantites[p] = q;
      }
    } else {
      const q = parseInt(cles["QUANTITE"], 10);
      if (!isNaN(q) && q > 0) quantites[""] = q;
    }

    lignes.push({ designation, prixVente: isNaN(prixVente) ? null : prixVente, quantites });
  }
  return lignes;
}

router.post("/import/apercu", requirePermission("stock"), requireAdmin, upload.single("fichier"), async (req, res) => {
  const { marqueId, famille, boutique } = req.body;
  const modeQuantite = req.body.modeQuantite || (famille === "Chaussure" ? "pointure" : "simple"); // repli si non fourni
  if (!req.file || !marqueId || !famille || !boutique) {
    return res.status(400).json({ error: "Fichier, marque, famille et boutique sont obligatoires." });
  }
  const marque = await prisma.brand.findUnique({ where: { id: marqueId } });
  if (!marque) return res.status(400).json({ error: "Marque introuvable." });

  let lignesFichier;
  try {
    lignesFichier = lireFichierImport(req.file.buffer, modeQuantite);
  } catch (e) {
    return res.status(400).json({ error: "Impossible de lire ce fichier Excel. Vérifie le format." });
  }
  if (lignesFichier.length === 0) {
    return res.status(400).json({ error: "Aucune ligne exploitable trouvée dans le fichier." });
  }

  const resultat = [];
  for (const l of lignesFichier) {
    const articleExistant = await prisma.article.findFirst({
      where: { marqueId, famille, designation: { equals: l.designation, mode: "insensitive" } },
      include: { stocks: { where: { boutique } } },
    });

    const quantiteTotale = Object.values(l.quantites).reduce((s, q) => s + q, 0);

    if (articleExistant) {
      const stocksParPointure = {};
      for (const s of articleExistant.stocks) stocksParPointure[s.pointure] = s.quantite;

      resultat.push({
        designation: l.designation,
        existant: true,
        articleId: articleExistant.id,
        ancienPrix: articleExistant.prixVente,
        nouveauPrix: l.prixVente,
        ecartPrix: l.prixVente != null && l.prixVente !== articleExistant.prixVente,
        quantites: l.quantites,
        quantiteTotale,
        stockActuel: stocksParPointure,
      });
    } else {
      resultat.push({
        designation: l.designation,
        existant: false,
        articleId: null,
        ancienPrix: null,
        nouveauPrix: l.prixVente,
        ecartPrix: false,
        quantites: l.quantites,
        quantiteTotale,
        stockActuel: {},
      });
    }
  }

  const nbNouveaux = resultat.filter((r) => !r.existant).length;
  const nbExistants = resultat.filter((r) => r.existant).length;
  const nbEcartsPrix = resultat.filter((r) => r.ecartPrix).length;

  res.json({ marque: marque.nom, famille, boutique, lignes: resultat, nbNouveaux, nbExistants, nbEcartsPrix });
});

router.post("/import/confirmer", requirePermission("stock"), requireAdmin, async (req, res) => {
  const { marqueId, famille, boutique, lignes } = req.body;
  const modeQuantite = req.body.modeQuantite || (famille === "Chaussure" ? "pointure" : "simple"); // repli si non fourni
  if (!marqueId || !famille || !boutique || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: "Marque, famille, boutique et lignes sont obligatoires." });
  }
  const marque = await prisma.brand.findUnique({ where: { id: marqueId } });
  if (!marque) return res.status(400).json({ error: "Marque introuvable." });

  const rapport = { articlesCreees: 0, articlesMisesAJour: 0, mouvements: 0 };

  try {
    for (const l of lignes) {
      const designation = String(l.designation || "").trim();
      if (!designation) continue;
      const quantites = l.quantites || {};
      const prixVente = l.prixVente != null ? Number(l.prixVente) : null;

      let articleId = l.articleId;

      if (!articleId) {
        if (!prixVente) throw { status: 400, message: `Prix de vente manquant pour "${designation}".` };
        const stocksData = modeQuantite === "pointure"
          ? BOUTIQUES.flatMap((b) => POINTURES.map((p) => ({ boutique: b, pointure: p, quantite: 0 })))
          : BOUTIQUES.map((b) => ({ boutique: b, pointure: "", quantite: 0 }));
        let nouvelArticle;
        for (let essai = 0; essai < 5; essai++) {
          const reference = await generateReference(marque.nom, famille);
          try {
            nouvelArticle = await prisma.article.create({
              data: { reference, designation, famille, marqueId, prixVente, stocks: { create: stocksData } },
            });
            break;
          } catch (e) {
            if (e.code === "P2002" && essai < 4) continue;
            throw e;
          }
        }
        articleId = nouvelArticle.id;
        rapport.articlesCreees += 1;
      } else if (prixVente != null) {
        await prisma.article.update({ where: { id: articleId }, data: { prixVente } });
        rapport.articlesMisesAJour += 1;
      }

      for (const [pointure, qte] of Object.entries(quantites)) {
        const qty = parseInt(qte, 10);
        if (!qty || qty <= 0) continue;

        const avant = await prisma.stockItem.findUnique({
          where: { articleId_boutique_pointure: { articleId, boutique, pointure } },
        });
        const quantiteAvant = avant?.quantite || 0;

        await prisma.stockItem.upsert({
          where: { articleId_boutique_pointure: { articleId, boutique, pointure } },
          update: { quantite: { increment: qty } },
          create: { articleId, boutique, pointure, quantite: qty },
        });

        await prisma.mouvementStock.create({
          data: {
            articleId, type: "Ajout", boutique, pointure,
            quantite: qty, quantiteAvant, quantiteApres: quantiteAvant + qty,
            effectueParId: req.user.id,
          },
        });
        rapport.mouvements += 1;
      }
    }
    res.json(rapport);
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || "Erreur lors de l'import.";
    if (status === 500) console.error(err);
    res.status(status).json({ error: message, partiel: rapport });
  }
});

module.exports = router;