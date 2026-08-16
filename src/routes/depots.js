const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const depots = await prisma.depot.findMany({ orderBy: { nom: "asc" } });
  res.json(depots);
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { nom, adresse } = req.body || {};
  if (!nom) return res.status(400).json({ error: "Nom du dépôt requis." });
  const depot = await prisma.depot.create({ data: { nom, adresse } });
  res.status(201).json(depot);
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { nom, adresse, actif } = req.body || {};
  const depot = await prisma.depot.update({
    where: { id: req.params.id },
    data: { nom, adresse, actif },
  });
  res.json(depot);
});

module.exports = router;
