const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requirePermission("ventes"));

// GET /api/bons-livraison?statut=EN_COURS&boutique=
router.get("/", async (req, res) => {
  const { statut, boutique } = req.query;
  const bons = await prisma.bonLivraison.findMany({
    where: { statut: statut || undefined, boutique: boutique || undefined },
    include: {
      lignes: { include: { article: true } },
      creePar: true, cloturePar: true, client: true,
      venteGeneree: { select: { numero: true, total: true } },
    },
    orderBy: { dateCreation: "desc" },
  });
  res.json(bons);
});

// GET /api/bons-livraison/:id
router.get("/:id", async (req, res) => {
  const bon = await prisma.bonLivraison.findUnique({
    where: { id: req.params.id },
    include: {
      lignes: { include: { article: true } },
      creePar: true, cloturePar: true, client: true,
      venteGeneree: true,
    },
  });
  if (!bon) return res.status(404).json({ error: "Bon de livraison introuvable." });
  res.json(bon);
});

// POST /api/bons-livraison   { boutique, clientNom, clientTelephone, clientId?, livreurNom?, notes?,
//                              lignes: [{ articleId, pointure?, quantite }] }
// Décrémente le stock IMMÉDIATEMENT — c'est le départ du livreur qui est enregistré ici, pas la vente.
router.post("/", async (req, res) => {
  const { boutique, clientNom, clientTelephone, clientId, livreurNom, notes, lignes } = req.body;
  const utilisateurId = req.user.id;

  if (!boutique || !clientNom?.trim() || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: "Boutique, nom du client et au moins une ligne sont obligatoires." });
  }
  for (const l of lignes) {
    if (!l.articleId || !l.quantite || Number(l.quantite) <= 0) {
      return res.status(400).json({ error: "Chaque ligne doit avoir un article et une quantité positive." });
    }
  }

  try {
    const bon = await prisma.$transaction(async (tx) => {
      const articles = await tx.article.findMany({ where: { id: { in: lignes.map((l) => l.articleId) } } });
      const parId = Object.fromEntries(articles.map((a) => [a.id, a]));

      const lignesData = [];
      for (const l of lignes) {
        const article = parId[l.articleId];
        if (!article) throw { status: 404, message: "Un article de la liste est introuvable." };
        const pointure = l.pointure || "";
        const quantite = Number(l.quantite);

        const stockItem = await tx.stockItem.findUnique({
          where: { articleId_boutique_pointure: { articleId: l.articleId, boutique, pointure } },
        });
        const avant = stockItem?.quantite || 0;
        if (avant < quantite) {
          throw { status: 409, message: `Stock insuffisant pour ${article.designation}${pointure ? ` (T${pointure})` : ""} : ${avant} disponible(s), ${quantite} demandé(s).` };
        }
        lignesData.push({ articleId: l.articleId, pointure, quantite, prixUnitaire: article.prixVente, avant });
      }

      const nb = await tx.bonLivraison.count();
      const numero = `BL-${String(nb + 1).padStart(6, "0")}`;

      const bonCree = await tx.bonLivraison.create({
        data: {
          numero, boutique, clientNom: clientNom.trim(), clientTelephone: clientTelephone || null,
          clientId: clientId || null, livreurNom: livreurNom || null, notes: notes || null,
          creeParId: utilisateurId,
          lignes: { create: lignesData.map(({ articleId, pointure, quantite, prixUnitaire }) => ({ articleId, pointure, quantite, prixUnitaire })) },
        },
        include: { lignes: { include: { article: true } } },
      });

      for (const l of lignesData) {
        const apres = l.avant - l.quantite;
        await tx.stockItem.update({
          where: { articleId_boutique_pointure: { articleId: l.articleId, boutique, pointure: l.pointure } },
          data: { quantite: apres },
        });
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId, type: "SortieLivraison", boutique, pointure: l.pointure,
            quantite: l.quantite, quantiteAvant: l.avant, quantiteApres: apres,
            bonLivraisonId: bonCree.id, effectueParId: utilisateurId,
          },
        });
      }

      return bonCree;
    });
    res.status(201).json(bon);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la création du bon de livraison." });
  }
});

// POST /api/bons-livraison/:id/cloturer
// body: { clientId?, typeVente, paiements, lignes: [{ ligneId, statut: "VENDU"|"RETOURNE"|"PERDU" }] }
// Réconciliation au retour du livreur, article par article :
//  - VENDU    → entre dans une vraie vente (encaissement, reçu), au prix figé au départ
//  - RETOURNE → remis en stock immédiatement
//  - PERDU    → reste hors stock (perte/casse), tracé mais jamais réintégré automatiquement
router.post("/:id/cloturer", async (req, res) => {
  const { clientId, typeVente, paiements, lignes } = req.body;
  const utilisateurId = req.user.id;
  const type = typeVente === "Credit" ? "Credit" : "Comptant";

  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: "Le détail de la réconciliation (ligne par ligne) est obligatoire." });
  }

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const bon = await tx.bonLivraison.findUnique({
        where: { id: req.params.id },
        include: { lignes: { include: { article: true } } },
      });
      if (!bon) throw { status: 404, message: "Bon de livraison introuvable." };
      if (bon.statut !== "EN_COURS") throw { status: 409, message: "Ce bon de livraison a déjà été clôturé." };

      const parLigneId = Object.fromEntries(bon.lignes.map((l) => [l.id, l]));
      if (lignes.length !== bon.lignes.length || !lignes.every((l) => parLigneId[l.ligneId])) {
        throw { status: 400, message: "Le détail de réconciliation ne correspond pas exactement aux lignes du bon." };
      }

      const lignesVendues = [];
      for (const l of lignes) {
        const ligneBon = parLigneId[l.ligneId];
        if (!["VENDU", "RETOURNE", "PERDU"].includes(l.statut)) {
          throw { status: 400, message: "Statut de ligne invalide (VENDU, RETOURNE ou PERDU attendu)." };
        }
        await tx.ligneBonLivraison.update({ where: { id: l.ligneId }, data: { statut: l.statut } });

        if (l.statut === "RETOURNE") {
          const stockItem = await tx.stockItem.findUnique({
            where: { articleId_boutique_pointure: { articleId: ligneBon.articleId, boutique: bon.boutique, pointure: ligneBon.pointure || "" } },
          });
          const avant = stockItem?.quantite || 0;
          const apres = avant + ligneBon.quantite;
          if (stockItem) {
            await tx.stockItem.update({
              where: { articleId_boutique_pointure: { articleId: ligneBon.articleId, boutique: bon.boutique, pointure: ligneBon.pointure || "" } },
              data: { quantite: apres },
            });
          } else {
            await tx.stockItem.create({ data: { articleId: ligneBon.articleId, boutique: bon.boutique, pointure: ligneBon.pointure || "", quantite: apres } });
          }
          await tx.mouvementStock.create({
            data: {
              articleId: ligneBon.articleId, type: "RetourLivraison", boutique: bon.boutique, pointure: ligneBon.pointure || "",
              quantite: ligneBon.quantite, quantiteAvant: avant, quantiteApres: apres,
              bonLivraisonId: bon.id, effectueParId: utilisateurId,
            },
          });
        } else if (l.statut === "VENDU") {
          lignesVendues.push(ligneBon);
        }
        // PERDU : rien à faire sur le stock — il est déjà décrémenté depuis le départ, ça reste ainsi.
      }

      let venteCreee = null;
      if (lignesVendues.length > 0) {
        const total = lignesVendues.reduce((s, l) => s + l.prixUnitaire * l.quantite, 0);
        const totalPaye = (paiements || []).reduce((s, p) => s + Number(p.montant || 0), 0);
        if (type === "Comptant" && totalPaye < total) {
          throw { status: 400, message: "Le total payé est inférieur au total des articles vendus." };
        }
        if (type === "Credit" && totalPaye > total) {
          throw { status: 400, message: "Le montant payé ne peut pas dépasser le total pour une vente à crédit." };
        }

        const nbVentes = await tx.vente.count();
        const numero = `REC-${String(nbVentes + 1).padStart(6, "0")}`;

        venteCreee = await tx.vente.create({
          data: {
            numero, boutique: bon.boutique, modeVente: "Livraison", typeVente: type,
            caissierId: utilisateurId, clientId: clientId || bon.clientId || null,
            total, bonLivraisonOrigineId: bon.id,
            monnaieRendue: Math.max(0, totalPaye - total),
            lignes: {
              create: lignesVendues.map((l) => ({
                articleId: l.articleId, designation: l.article.designation, marque: l.article.marque?.nom || "",
                famille: l.article.famille, pointure: l.pointure || null,
                quantite: l.quantite, prixUnitaire: l.prixUnitaire, sousTotal: l.prixUnitaire * l.quantite,
              })),
            },
            paiements: { create: (paiements || []).map((p) => ({ mode: p.mode, montant: Number(p.montant) })) },
          },
          include: { lignes: true, paiements: true, caissier: true, client: true },
        });

        for (const l of lignesVendues) {
          await tx.mouvementStock.create({
            data: {
              articleId: l.articleId, type: "Vente", boutique: bon.boutique, pointure: l.pointure || "",
              quantite: l.quantite, quantiteAvant: 0, quantiteApres: 0, // déjà décrémenté au départ, ceci ne fait que tracer la vente elle-même
              venteId: venteCreee.id, effectueParId: utilisateurId,
            },
          });
        }
      }

      const bonMisAJour = await tx.bonLivraison.update({
        where: { id: bon.id },
        data: { statut: "CLOTURE", clotureParId: utilisateurId, dateCloture: new Date() },
        include: { lignes: { include: { article: true } }, venteGeneree: true },
      });

      return { bon: bonMisAJour, vente: venteCreee };
    });
    res.json(resultat);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la clôture du bon de livraison." });
  }
});

// POST /api/bons-livraison/:id/annuler
// Annule un bon AVANT le départ (erreur de saisie, par ex.) — remet tout le stock, sans passer
// par une vente ni un article "perdu". Impossible une fois le bon déjà clôturé.
router.post("/:id/annuler", async (req, res) => {
  const utilisateurId = req.user.id;
  try {
    await prisma.$transaction(async (tx) => {
      const bon = await tx.bonLivraison.findUnique({ where: { id: req.params.id }, include: { lignes: true } });
      if (!bon) throw { status: 404, message: "Bon de livraison introuvable." };
      if (bon.statut !== "EN_COURS") throw { status: 409, message: "Ce bon de livraison n'est plus annulable (déjà clôturé)." };

      for (const l of bon.lignes) {
        const stockItem = await tx.stockItem.findUnique({
          where: { articleId_boutique_pointure: { articleId: l.articleId, boutique: bon.boutique, pointure: l.pointure || "" } },
        });
        const avant = stockItem?.quantite || 0;
        const apres = avant + l.quantite;
        await tx.stockItem.update({
          where: { articleId_boutique_pointure: { articleId: l.articleId, boutique: bon.boutique, pointure: l.pointure || "" } },
          data: { quantite: apres },
        });
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId, type: "RetourLivraison", boutique: bon.boutique, pointure: l.pointure || "",
            quantite: l.quantite, quantiteAvant: avant, quantiteApres: apres,
            bonLivraisonId: bon.id, effectueParId: utilisateurId,
          },
        });
      }

      await tx.bonLivraison.update({ where: { id: bon.id }, data: { statut: "ANNULE" } });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de l'annulation du bon de livraison." });
  }
});

module.exports = router;
