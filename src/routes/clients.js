const express = require("express");
const prisma = require("../prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { q } = req.query;
  const clients = await prisma.client.findMany({
    where: {
      archive: false,
      ...(q
        ? {
            OR: [
              { raisonSociale: { contains: q, mode: "insensitive" } },
              { telephone: { contains: q } },
              { ifu: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { raisonSociale: "asc" },
  });
  res.json(clients);
});

// POST /api/clients  { raisonSociale, ifu, telephone, adresse }
router.post("/", requireAuth, async (req, res) => {
  const { raisonSociale, ifu, telephone, adresse } = req.body || {};
  if (!raisonSociale) return res.status(400).json({ error: "Raison sociale requise." });
  const client = await prisma.client.create({
    data: { raisonSociale, ifu, telephone: telephone || null, adresse },
  });
  res.status(201).json(client);
});

router.put("/:id", requireAuth, async (req, res) => {
  const { raisonSociale, ifu, telephone, adresse } = req.body || {};
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data: {
      ...(raisonSociale != null ? { raisonSociale } : {}),
      ...(ifu != null ? { ifu } : {}),
      ...(telephone != null ? { telephone: telephone || null } : {}),
      ...(adresse != null ? { adresse } : {}),
    },
  });
  res.json(client);
});

// DELETE remplacé par un archivage — un client ayant des ventes ne doit pas disparaître de l'historique.
router.delete("/:id", requireAuth, async (req, res) => {
  const ventesCount = await prisma.vente.count({ where: { clientId: req.params.id } });
  if (ventesCount > 0) {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: { archive: true } });
    return res.json({ archived: true, client });
  }
  await prisma.client.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

module.exports = router;
