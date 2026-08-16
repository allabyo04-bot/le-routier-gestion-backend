const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { requireAuth, requirePermission, requireCodeConfirmation } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requirePermission("utilisateurs"));

router.get("/", async (req, res) => {
  const users = await prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: "asc" } });
  res.json(users.map(({ pinHash, reponseSecreteHash, ...u }) => u)); // on ne renvoie jamais les hash
});

router.post("/", requireCodeConfirmation, async (req, res) => {
  const { nom, prenom, login, pin, roleId, boutique, telephone, questionSecrete, reponseSecrete } = req.body;
  if (!nom || !prenom || !login || !/^\d{4,6}$/.test(pin || "")) {
    return res.status(400).json({ error: "Nom, prénom, identifiant et PIN (4 à 6 chiffres) sont obligatoires." });
  }
  const existant = await prisma.user.findUnique({ where: { login } });
  if (existant) return res.status(409).json({ error: "Cet identifiant est déjà utilisé." });
  if (telephone?.trim()) {
    const conflit = await prisma.user.findUnique({ where: { telephone: telephone.trim() } });
    if (conflit) return res.status(409).json({ error: "Ce numéro de téléphone est déjà utilisé par un autre employé." });
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const data = { nom, prenom, login, pinHash, roleId, boutique, actif: true, telephone: telephone?.trim() || null, questionSecrete: questionSecrete?.trim() || null };
  if (reponseSecrete?.trim()) data.reponseSecreteHash = await bcrypt.hash(reponseSecrete.trim().toLowerCase(), 10);

  const user = await prisma.user.create({ data });
  const { pinHash: _, reponseSecreteHash: __, ...safe } = user;
  res.status(201).json(safe);
});

router.put("/:id", requireCodeConfirmation, async (req, res) => {
  const { nom, prenom, login, pin, roleId, boutique, actif, telephone, questionSecrete, reponseSecrete } = req.body;
  if (login) {
    const conflit = await prisma.user.findFirst({ where: { login, NOT: { id: req.params.id } } });
    if (conflit) return res.status(409).json({ error: "Cet identifiant est déjà utilisé par un autre employé." });
  }
  if (telephone?.trim()) {
    const conflit = await prisma.user.findFirst({ where: { telephone: telephone.trim(), NOT: { id: req.params.id } } });
    if (conflit) return res.status(409).json({ error: "Ce numéro de téléphone est déjà utilisé par un autre employé." });
  }
  const data = { nom, prenom, login, roleId, boutique, actif, telephone: telephone?.trim() || null, questionSecrete: questionSecrete?.trim() || null };
  if (pin) data.pinHash = await bcrypt.hash(pin, 10);
  if (reponseSecrete?.trim()) data.reponseSecreteHash = await bcrypt.hash(reponseSecrete.trim().toLowerCase(), 10);

  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  const { pinHash: _, reponseSecreteHash: __, ...safe } = user;
  res.json(safe);
});

router.delete("/:id", requireCodeConfirmation, async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;