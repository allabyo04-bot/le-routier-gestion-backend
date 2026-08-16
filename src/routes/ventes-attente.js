const express = require("express");
const prisma = require("../prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/ventes-attente?depotId=  (un opérateur ne voit que les siennes)
router.get("/", requireAuth, async (req, res) => {
  const { depotId } = req.query;
  const isAdmin = req.user.role === "administrateur";
  const attentes = await prisma.venteAttente.findMany({
    where: {
      ...(depotId ? { depotId } : {}),
      ...(!isAdmin ? { operateurId: req.user.id } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(attentes);
});

// POST /api/ventes-attente  { depotId, label, clientId?, panier }
router.post("/", requireAuth, async (req, res) => {
  const { depotId, label, clientId, panier } = req.body || {};
  if (!depotId || !panier) return res.status(400).json({ error: "Dépôt et panier requis." });
  const attente = await prisma.venteAttente.create({
    data: {
      depotId,
      label: label || "Vente en attente",
      clientId: clientId || null,
      operateurId: req.user.id,
      panier,
    },
  });
  res.status(201).json(attente);
});

// DELETE /api/ventes-attente/:id — reprise (le panier repart côté caisse) ou abandon
router.delete("/:id", requireAuth, async (req, res) => {
  await prisma.venteAttente.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
