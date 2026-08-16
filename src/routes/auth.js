const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/login  { identifiant, motDePasse }
router.post("/login", async (req, res) => {
  const { identifiant, motDePasse } = req.body || {};
  if (!identifiant || !motDePasse) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }
  const user = await prisma.user.findUnique({ where: { identifiant } });
  if (!user || !user.actif) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  const ok = await bcrypt.compare(motDePasse, user.motDePasseHash);
  if (!ok) return res.status(401).json({ error: "Identifiants incorrects." });

  const payload = {
    id: user.id,
    nom: user.nom,
    role: user.role,
    depotParDefautId: user.depotParDefautId,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: payload });
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/changer-mot-de-passe  { ancien, nouveau }
router.post("/changer-mot-de-passe", requireAuth, async (req, res) => {
  const { ancien, nouveau } = req.body || {};
  if (!ancien || !nouveau || nouveau.length < 4) {
    return res.status(400).json({ error: "Ancien et nouveau mot de passe requis (4 caractères min)." });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const ok = await bcrypt.compare(ancien, user.motDePasseHash);
  if (!ok) return res.status(401).json({ error: "Ancien mot de passe incorrect." });
  const motDePasseHash = await bcrypt.hash(nouveau, 10);
  await prisma.user.update({ where: { id: user.id }, data: { motDePasseHash } });
  res.json({ ok: true });
});

module.exports = router;
