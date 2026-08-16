const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requirePermission("ventes"));

router.get("/", async (req, res) => {
  const { boutique } = req.query;
  const retours = await prisma.retour.findMany({
    where: { boutique: boutique || undefined },
    include: { ligneVente: true, vente: true, traitePar: true, bonValeurGenere: true },
    orderBy: { date: "desc" },
  });
  res.json(retours);
});

// POST /api/retours
// body: { venteId, ligneVenteId, type: "Retour"|"Echange", quantite, nouvellePointure?, motif, boutique,
//         montantRembourse?, dateValiditeAvoir? }
// Pour un "Retour" avec montantRembourse, un Avoir (BonValeur) est généré automatiquement pour le client
// de la vente d'origine — le client est donc obligatoire dans ce cas, et la date de validité doit être fournie.
router.post("/", async (req, res) => {
  const { venteId, ligneVenteId, type, quantite, nouvellePointure, motif, boutique, montantRembourse, dateValiditeAvoir } = req.body;

  if (!venteId || !ligneVenteId || !type || !quantite || !boutique) {
    return res.status(400).json({ error: "Vente, ligne concernée, type, quantité et boutique sont obligatoires." });
  }
  if (type === "Echange" && !nouvellePointure) {
    return res.status(400).json({ error: "Précise la nouvelle pointure pour un échange." });
  }
  if (type === "Retour" && montantRembourse) {
    if (!dateValiditeAvoir) return res.status(400).json({ error: "La date de validité de l'avoir est obligatoire." });
  }

  try {
    const retour = await prisma.$transaction(async (tx) => {
      const ligne = await tx.ligneVente.findUnique({ where: { id: ligneVenteId } });
      if (!ligne) throw { status: 404, message: "Ligne de vente introuvable." };
      if (Number(quantite) > ligne.quantite) throw { status: 400, message: "La quantité retournée dépasse la quantité vendue sur cette ligne." };

      let venteOrigine = null;
      if (type === "Retour" && montantRembourse) {
        venteOrigine = await tx.vente.findUnique({ where: { id: venteId } });
        if (!venteOrigine?.clientId) {
          throw { status: 400, message: "Un client doit être associé à la vente pour générer un avoir." };
        }
      }

      // La marchandise vendue revient en stock, à son ancienne pointure, dans la boutique où le retour est traité
      const stockAvantRetour = await tx.stockItem.findUnique({
        where: { articleId_boutique_pointure: { articleId: ligne.articleId, boutique, pointure: ligne.pointure } },
      });
      const dispoAvantRetour = stockAvantRetour?.quantite || 0;
      await tx.stockItem.upsert({
        where: { articleId_boutique_pointure: { articleId: ligne.articleId, boutique, pointure: ligne.pointure } },
        update: { quantite: { increment: Number(quantite) } },
        create: { articleId: ligne.articleId, boutique, pointure: ligne.pointure, quantite: Number(quantite) },
      });

      const mouvementsAVenir = [{
        articleId: ligne.articleId, boutique, pointure: ligne.pointure,
        quantite: Number(quantite), quantiteAvant: dispoAvantRetour, quantiteApres: dispoAvantRetour + Number(quantite),
      }];

      if (type === "Echange") {
        // La nouvelle pointure doit être disponible dans cette boutique
        const stockNouvelle = await tx.stockItem.findUnique({
          where: { articleId_boutique_pointure: { articleId: ligne.articleId, boutique, pointure: nouvellePointure } },
        });
        const dispo = stockNouvelle?.quantite || 0;
        if (dispo < Number(quantite)) {
          throw { status: 409, message: `Stock insuffisant en T${nouvellePointure} pour l'échange (${dispo} disponible(s)).` };
        }
        await tx.stockItem.update({
          where: { articleId_boutique_pointure: { articleId: ligne.articleId, boutique, pointure: nouvellePointure } },
          data: { quantite: { decrement: Number(quantite) } },
        });
        mouvementsAVenir.push({
          articleId: ligne.articleId, boutique, pointure: nouvellePointure,
          quantite: Number(quantite), quantiteAvant: dispo, quantiteApres: dispo - Number(quantite),
        });
      }

      const retourCree = await tx.retour.create({
        data: {
          venteId, ligneVenteId, type, quantite: Number(quantite),
          nouvellePointure: type === "Echange" ? nouvellePointure : null,
          motif, boutique, traiteParId: req.user.id,
          montantRembourse: type === "Retour" && montantRembourse ? Number(montantRembourse) : null,
        },
        include: { ligneVente: true, traitePar: true },
      });

      // Génération automatique de l'avoir pour le client
      if (venteOrigine) {
        const nb = await tx.bonValeur.count({ where: { type: "AVOIR" } });
        const numeroAvoir = `AV-${String(nb + 1).padStart(4, "0")}`;
        await tx.bonValeur.create({
          data: {
            numero: numeroAvoir, type: "AVOIR", montant: Number(montantRembourse),
            dateValidite: new Date(dateValiditeAvoir),
            clientId: venteOrigine.clientId,
            retourOrigineId: retourCree.id,
          },
        });
      }

      // Historique de stock : un mouvement "Retour" (ou "Echange" pour les deux pointures concernées)
      await tx.mouvementStock.createMany({
        data: mouvementsAVenir.map((m) => ({ ...m, type, retourId: retourCree.id, effectueParId: req.user.id })),
      });

      return tx.retour.findUnique({
        where: { id: retourCree.id },
        include: { ligneVente: true, traitePar: true, bonValeurGenere: true },
      });
    });

    res.status(201).json(retour);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || "Erreur lors de l'enregistrement du retour." });
  }
});

module.exports = router;