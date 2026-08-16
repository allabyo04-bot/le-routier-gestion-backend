const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/operations-caisse?depotId=&date=&type=
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const { depotId, date, type } = req.query;
  const operations = await prisma.operationCaisse.findMany({
    where: {
      ...(depotId ? { depotId } : {}),
      ...(type ? { type } : {}),
      ...(date
        ? {
            date: {
              gte: new Date(date + "T00:00:00"),
              lt: new Date(date + "T23:59:59.999"),
            },
          }
        : {}),
    },
    include: { saisiePar: { select: { nom: true } } },
    orderBy: { date: "desc" },
  });
  res.json(operations);
});

// POST /api/operations-caisse  { type: "Depense"|"Manquant"|"Excedent", depotId, motif, montant, date? }
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { type, depotId, motif, montant, date } = req.body || {};
  if (!["Depense", "Manquant", "Excedent"].includes(type)) {
    return res.status(400).json({ error: "Type invalide (Depense, Manquant ou Excedent)." });
  }
  if (!depotId || !motif || montant == null || Number(montant) <= 0) {
    return res.status(400).json({ error: "Dépôt, motif et montant (positif) requis." });
  }
  const operation = await prisma.operationCaisse.create({
    data: {
      type,
      depotId,
      motif,
      montant: Number(montant),
      date: date ? new Date(date) : new Date(),
      saisieParId: req.user.id,
    },
  });
  res.status(201).json(operation);
});

// POST /api/operations-caisse/:id/annuler — jamais de suppression physique, tracée dans le journal d'audit
router.post("/:id/annuler", requireAuth, requireAdmin, async (req, res) => {
  const operation = await prisma.operationCaisse.findUnique({ where: { id: req.params.id } });
  if (!operation) return res.status(404).json({ error: "Opération introuvable." });
  await prisma.$transaction(async (tx) => {
    await tx.operationCaisse.update({ where: { id: operation.id }, data: { annulee: true } });
    await tx.journalAudit.create({
      data: {
        utilisateurId: req.user.id,
        action: "annulation_operation_caisse",
        cibleType: "OperationCaisse",
        cibleId: operation.id,
        details: `${operation.type} de ${operation.montant} F (${operation.motif}) annulée.`,
      },
    });
  });
  res.json({ ok: true });
});

module.exports = router;
