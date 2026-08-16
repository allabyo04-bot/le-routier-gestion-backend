const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/journal-audit — traçabilité des opérations sensibles (annulations, changements de prix,
// gestion des comptes...), réservé à l'administrateur.
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const entrees = await prisma.journalAudit.findMany({
    include: { utilisateur: { select: { nom: true } } },
    orderBy: { date: "desc" },
    take: 300,
  });
  res.json(entrees);
});

module.exports = router;
