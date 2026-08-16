const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, nom: true, identifiant: true, role: true, actif: true, depotParDefautId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

// POST /api/users  { nom, identifiant, motDePasse, role, depotParDefautId }
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { nom, identifiant, motDePasse, role, depotParDefautId } = req.body || {};
  if (!nom || !identifiant || !motDePasse || !role) {
    return res.status(400).json({ error: "Nom, identifiant, mot de passe et rôle requis." });
  }
  if (!["administrateur", "operateur"].includes(role)) {
    return res.status(400).json({ error: "Rôle invalide (administrateur ou operateur)." });
  }
  const motDePasseHash = await bcrypt.hash(motDePasse, 10);
  const user = await prisma.user.create({
    data: { nom, identifiant, motDePasseHash, role, depotParDefautId: depotParDefautId || null },
  });
  res.status(201).json({ id: user.id, nom: user.nom, identifiant: user.identifiant, role: user.role });
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { nom, actif, depotParDefautId } = req.body || {};
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(nom != null ? { nom } : {}),
      ...(actif != null ? { actif } : {}),
      ...(depotParDefautId !== undefined ? { depotParDefautId } : {}),
    },
  });
  res.json({ id: user.id, nom: user.nom, actif: user.actif });
});

// Réinitialisation par l'administrateur (dépannage) — l'utilisateur peut ensuite la changer lui-même.
router.post("/:id/reinitialiser-mot-de-passe", requireAuth, requireAdmin, async (req, res) => {
  const { nouveauMotDePasse } = req.body || {};
  if (!nouveauMotDePasse || nouveauMotDePasse.length < 4) {
    return res.status(400).json({ error: "Nouveau mot de passe requis (4 caractères min)." });
  }
  const motDePasseHash = await bcrypt.hash(nouveauMotDePasse, 10);
  await prisma.user.update({ where: { id: req.params.id }, data: { motDePasseHash } });
  res.json({ ok: true });
});

module.exports = router;
