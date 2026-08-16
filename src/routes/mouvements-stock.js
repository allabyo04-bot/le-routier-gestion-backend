const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/mouvements-stock?depotId=&articleId=&type=&date=
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const { depotId, articleId, type, date } = req.query;
  const where = {
    ...(depotId ? { depotId } : {}),
    ...(articleId ? { articleId } : {}),
    ...(type ? { type } : {}),
    ...(date
      ? {
          date: {
            gte: new Date(date + "T00:00:00"),
            lt: new Date(date + "T23:59:59.999"),
          },
        }
      : {}),
  };
  const mouvements = await prisma.mouvementStock.findMany({
    where,
    include: {
      article: { select: { designation: true, code: true } },
      depot: { select: { nom: true } },
      effectuePar: { select: { nom: true } },
      vente: { select: { numero: true } },
    },
    orderBy: { date: "desc" },
    take: 300,
  });
  res.json(mouvements);
});

module.exports = router;
