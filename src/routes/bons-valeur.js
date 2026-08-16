const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requirePermission("ventes"));

// GET /api/bons-valeur?type=AVOIR|CADEAU
router.get("/", async (req, res) => {
  const { type } = req.query;
  const bons = await prisma.bonValeur.findMany({
    where: { type: type || undefined },
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(bons);
});

// GET /api/bons-valeur/:numero/verifier — utilisé au moment du paiement pour valider un bon avant de l'accepter
router.get("/:numero/verifier", async (req, res) => {
  const bon = await prisma.bonValeur.findUnique({ where: { numero: req.params.numero }, include: { client: true } });
  if (!bon) return res.status(404).json({ error: "Aucun bon ne correspond à ce numéro." });
  if (bon.enStock) return res.status(409).json({ error: "Cette carte n'a pas encore été vendue à une cliente." });
  if (bon.utilisee) return res.status(409).json({ error: "Ce bon a déjà été utilisé." });
  if (bon.dateValidite && new Date(bon.dateValidite) < new Date()) {
    return res.status(409).json({ error: "Ce bon a expiré." });
  }
  res.json(bon);
});

// POST /api/bons-valeur — création manuelle d'une carte cadeau (numéro auto ou saisi)
// La carte est payée à sa création : boutique et mode de paiement obligatoires,
// pour que ce montant apparaisse comme un vrai encaissement du jour dans les États.
// La création décrémente aussi le stock de l'article générique "CARTES CADEAUX" (si créé).
router.post("/", async (req, res) => {
  const { numero, montant, dateValidite, boutique, modePaiement } = req.body;
  if (!montant) return res.status(400).json({ error: "Le montant est obligatoire." });
  if (!boutique) return res.status(400).json({ error: "La boutique est obligatoire." });
  if (!modePaiement) return res.status(400).json({ error: "Le mode de paiement est obligatoire." });

  let numeroFinal = numero?.trim();
  if (!numeroFinal) {
    const nb = await prisma.bonValeur.count({ where: { type: "CADEAU" } });
    numeroFinal = `CG-${String(nb + 1).padStart(4, "0")}`;
  }

  const existant = await prisma.bonValeur.findUnique({ where: { numero: numeroFinal } });
  if (existant) return res.status(409).json({ error: "Ce numéro existe déjà." });

  try {
    const bon = await prisma.$transaction(async (tx) => {
      const articleCarte = await tx.article.findFirst({ where: { designation: "CARTES CADEAUX" } });
      if (articleCarte) {
        const stockItem = await tx.stockItem.findUnique({
          where: { articleId_boutique_pointure: { articleId: articleCarte.id, boutique, pointure: "" } },
        });
        const dispo = stockItem?.quantite || 0;
        if (dispo <= 0) throw { status: 409, message: `Aucune carte cadeau en stock à ${boutique}. Fais d'abord une réception de stock.` };

        await tx.stockItem.update({
          where: { articleId_boutique_pointure: { articleId: articleCarte.id, boutique, pointure: "" } },
          data: { quantite: dispo - 1 },
        });

        await tx.mouvementStock.create({
          data: {
            articleId: articleCarte.id, type: "Correction", boutique, pointure: "",
            quantite: 1, quantiteAvant: dispo, quantiteApres: dispo - 1,
            effectueParId: req.user.id,
          },
        });
      }

      const bonCree = await tx.bonValeur.create({
        data: {
          numero: numeroFinal, type: "CADEAU", montant: Number(montant),
          dateValidite: dateValidite ? new Date(dateValidite) : null,
          boutique, modePaiement,
        },
      });

      const denomination = await tx.denominationCarteCadeau.findUnique({ where: { montant: Number(montant) } });
      if (denomination) {
        await tx.denominationCarteCadeau.update({
          where: { id: denomination.id },
          data: { stockRestant: Math.max(0, denomination.stockRestant - 1) },
        });
      }

      return bonCree;
    });
    res.status(201).json(bon);
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || "Erreur lors de la création de la carte cadeau.";
    if (status === 500) console.error(err);
    res.status(status).json({ error: message });
  }
});

module.exports = router;