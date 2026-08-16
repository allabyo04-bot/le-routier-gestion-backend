const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

async function prochainNumero() {
  const dernier = await prisma.vente.findFirst({
    where: { numero: { startsWith: "FV" } },
    orderBy: { numero: "desc" },
  });
  const dernierN = dernier ? parseInt(dernier.numero.replace("FV", ""), 10) : 0;
  const n = (isNaN(dernierN) ? 0 : dernierN) + 1;
  return "FV" + String(n).padStart(7, "0");
}

// GET /api/ventes?depotId=&caissierId=&date=&statut=  (un opérateur ne voit que ses propres ventes)
router.get("/", requireAuth, async (req, res) => {
  const { depotId, date, statut } = req.query;
  const isAdmin = req.user.role === "administrateur";
  const where = {
    ...(depotId ? { depotId } : {}),
    ...(statut ? { statut } : {}),
    ...(!isAdmin ? { caissierId: req.user.id } : {}),
    ...(date
      ? {
          date: {
            gte: new Date(date + "T00:00:00"),
            lt: new Date(date + "T23:59:59.999"),
          },
        }
      : {}),
  };
  const ventes = await prisma.vente.findMany({
    where,
    include: { lignes: true, client: true, caissier: { select: { nom: true } }, depot: true },
    orderBy: { date: "desc" },
  });
  res.json(ventes);
});

router.get("/:id", requireAuth, async (req, res) => {
  const vente = await prisma.vente.findUnique({
    where: { id: req.params.id },
    include: { lignes: true, client: true, caissier: { select: { nom: true } }, depot: true },
  });
  if (!vente) return res.status(404).json({ error: "Vente introuvable." });
  res.json(vente);
});

// POST /api/ventes
// { depotId, clientId?, lignes: [{ articleId, quantite, remise? }], remiseGlobale? }
router.post("/", requireAuth, async (req, res) => {
  const { depotId, clientId, lignes, remiseGlobale } = req.body || {};
  if (!depotId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: "Dépôt et au moins une ligne d'article requis." });
  }

  try {
    const vente = await prisma.$transaction(async (tx) => {
      const numero = await prochainNumero();
      let total = 0;
      const lignesData = [];

      for (const l of lignes) {
        const article = await tx.article.findUnique({ where: { id: l.articleId } });
        if (!article) throw new Error("Article introuvable.");
        const stock = await tx.stockItem.findUnique({
          where: { articleId_depotId: { articleId: l.articleId, depotId } },
        });
        const dispo = stock ? stock.quantite : 0;
        if (dispo < l.quantite) {
          throw new Error(`Stock insuffisant pour ${article.designation} (disponible : ${dispo}).`);
        }
        const remise = Number(l.remise || 0);
        const sousTotal = article.prixVente * l.quantite - remise;
        const margeLigne = (article.prixVente - article.prixAchat) * l.quantite - remise;
        total += sousTotal;
        lignesData.push({
          articleId: l.articleId,
          designation: article.designation,
          quantite: l.quantite,
          prixUnitaire: article.prixVente,
          remise,
          sousTotal,
          prixAchatUnitaire: article.prixAchat,
          margeLigne,
        });
      }
      total -= Number(remiseGlobale || 0);

      const venteCreee = await tx.vente.create({
        data: {
          numero,
          depotId,
          clientId: clientId || null,
          caissierId: req.user.id,
          statut: "Validee",
          total,
          remiseGlobale: Number(remiseGlobale || 0),
          lignes: { create: lignesData },
        },
        include: { lignes: true },
      });

      // Décrément du stock + mouvement, ligne par ligne
      for (const l of venteCreee.lignes) {
        await tx.stockItem.update({
          where: { articleId_depotId: { articleId: l.articleId, depotId } },
          data: { quantite: { decrement: l.quantite } },
        });
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId,
            depotId,
            type: "Vente",
            quantite: -l.quantite,
            venteId: venteCreee.id,
            effectueParId: req.user.id,
          },
        });
      }

      return venteCreee;
    });

    res.status(201).json(vente);
  } catch (e) {
    res.status(400).json({ error: e.message || "Erreur lors de l'enregistrement de la vente." });
  }
});

// DELETE /api/ventes/:id — réservé à l'administrateur. Ne supprime jamais physiquement :
// passe le statut à "Annulee" (jamais recomptée dans le CA/la marge), restocke, et trace l'opération.
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { motif } = req.body || {};
  const vente = await prisma.vente.findUnique({ where: { id: req.params.id }, include: { lignes: true } });
  if (!vente) return res.status(404).json({ error: "Vente introuvable." });
  if (vente.statut === "Annulee") return res.status(400).json({ error: "Cette vente est déjà annulée." });

  await prisma.$transaction(async (tx) => {
    for (const l of vente.lignes) {
      await tx.stockItem.update({
        where: { articleId_depotId: { articleId: l.articleId, depotId: vente.depotId } },
        data: { quantite: { increment: l.quantite } },
      });
      await tx.mouvementStock.create({
        data: {
          articleId: l.articleId,
          depotId: vente.depotId,
          type: "AnnulationVente",
          quantite: l.quantite,
          venteId: vente.id,
          effectueParId: req.user.id,
        },
      });
    }
    await tx.vente.update({
      where: { id: vente.id },
      data: {
        statut: "Annulee",
        motifAnnulation: motif || null,
        annuleeParId: req.user.id,
        dateAnnulation: new Date(),
      },
    });
    await tx.journalAudit.create({
      data: {
        utilisateurId: req.user.id,
        action: "suppression_vente",
        cibleType: "Vente",
        cibleId: vente.id,
        details: `Vente ${vente.numero} annulée (motif : ${motif || "non renseigné"}).`,
      },
    });
  });

  res.json({ ok: true });
});

module.exports = router;
