const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/articles?q=&depotId=
router.get("/", requireAuth, async (req, res) => {
  const { q, depotId } = req.query;
  const articles = await prisma.article.findMany({
    where: {
      actif: true,
      ...(q
        ? {
            OR: [
              { designation: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      stocks: depotId ? { where: { depotId } } : true,
    },
    orderBy: { designation: "asc" },
  });
  res.json(articles);
});

// POST /api/articles  { code, designation, prixAchat, prixVente }
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { code, designation, prixAchat, prixVente } = req.body || {};
  if (!code || !designation || prixAchat == null || prixVente == null) {
    return res.status(400).json({ error: "Code, désignation, prix d'achat et prix de vente requis." });
  }
  if (Number(prixAchat) > Number(prixVente)) {
    return res.status(400).json({
      error: "Le prix d'achat est supérieur au prix de vente — vérifie les montants avant de valider.",
      warning: "prix_incoherent",
    });
  }
  const article = await prisma.article.create({
    data: { code, designation, prixAchat: Number(prixAchat), prixVente: Number(prixVente) },
  });

  // Initialise une ligne de stock à 0 pour chaque dépôt actif existant
  const depots = await prisma.depot.findMany({ where: { actif: true } });
  await prisma.stockItem.createMany({
    data: depots.map((d) => ({ articleId: article.id, depotId: d.id, quantite: 0 })),
    skipDuplicates: true,
  });

  res.status(201).json(article);
});

// PUT /api/articles/:id
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { designation, prixAchat, prixVente, actif } = req.body || {};
  if (prixAchat != null && prixVente != null && Number(prixAchat) > Number(prixVente)) {
    return res.status(400).json({
      error: "Le prix d'achat est supérieur au prix de vente — vérifie les montants avant de valider.",
      warning: "prix_incoherent",
    });
  }
  const article = await prisma.article.update({
    where: { id: req.params.id },
    data: {
      ...(designation != null ? { designation } : {}),
      ...(prixAchat != null ? { prixAchat: Number(prixAchat) } : {}),
      ...(prixVente != null ? { prixVente: Number(prixVente) } : {}),
      ...(actif != null ? { actif } : {}),
    },
  });
  res.json(article);
});

// POST /api/articles/:id/reappro  { depotId, quantite }
router.post("/:id/reappro", requireAuth, requireAdmin, async (req, res) => {
  const { depotId, quantite } = req.body || {};
  const qte = Number(quantite);
  if (!depotId || !qte || qte <= 0) {
    return res.status(400).json({ error: "Dépôt et quantité (positive) requis." });
  }
  const result = await prisma.$transaction(async (tx) => {
    const stock = await tx.stockItem.upsert({
      where: { articleId_depotId: { articleId: req.params.id, depotId } },
      update: { quantite: { increment: qte } },
      create: { articleId: req.params.id, depotId, quantite: qte },
    });
    await tx.mouvementStock.create({
      data: {
        articleId: req.params.id,
        depotId,
        type: "Reappro",
        quantite: qte,
        effectueParId: req.user.id,
      },
    });
    return stock;
  });
  res.json(result);
});

module.exports = router;
