const express = require("express");
const prisma = require("../prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function dayRange(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  return {
    gte: new Date(date + "T00:00:00"),
    lt: new Date(date + "T23:59:59.999"),
  };
}

// GET /api/etats/journalier?date=YYYY-MM-DD&depotId=
// CA net = CA brut - remises - dépenses - manquants + excédents (formule du cahier des charges)
router.get("/journalier", requireAuth, requireAdmin, async (req, res) => {
  const { date, depotId } = req.query;
  const range = dayRange(date);

  const ventes = await prisma.vente.findMany({
    where: {
      statut: "Validee",
      date: range,
      ...(depotId ? { depotId } : {}),
    },
    include: { lignes: true, depot: true },
  });

  const operations = await prisma.operationCaisse.findMany({
    where: {
      annulee: false,
      date: range,
      ...(depotId ? { depotId } : {}),
    },
  });

  const parDepot = {};
  function bucket(depotId, depotNom) {
    if (!parDepot[depotId]) {
      parDepot[depotId] = {
        depotId,
        depotNom,
        caBrut: 0,
        remises: 0,
        marge: 0,
        depenses: 0,
        manquants: 0,
        excedents: 0,
      };
    }
    return parDepot[depotId];
  }

  for (const v of ventes) {
    const b = bucket(v.depotId, v.depot?.nom || "");
    b.caBrut += v.total + v.remiseGlobale; // total est déjà net de remise, on ré-additionne pour isoler le brut
    b.remises += v.remiseGlobale + v.lignes.reduce((s, l) => s + l.remise, 0);
    b.marge += v.lignes.reduce((s, l) => s + l.margeLigne, 0);
  }
  for (const op of operations) {
    const b = bucket(op.depotId, "");
    if (op.type === "Depense") b.depenses += op.montant;
    if (op.type === "Manquant") b.manquants += op.montant;
    if (op.type === "Excedent") b.excedents += op.montant;
  }

  const lignes = Object.values(parDepot).map((b) => ({
    ...b,
    caNet: b.caBrut - b.remises - b.depenses - b.manquants + b.excedents,
  }));

  const total = lignes.reduce(
    (acc, l) => ({
      caBrut: acc.caBrut + l.caBrut,
      remises: acc.remises + l.remises,
      marge: acc.marge + l.marge,
      depenses: acc.depenses + l.depenses,
      manquants: acc.manquants + l.manquants,
      excedents: acc.excedents + l.excedents,
      caNet: acc.caNet + l.caNet,
    }),
    { caBrut: 0, remises: 0, marge: 0, depenses: 0, manquants: 0, excedents: 0, caNet: 0 }
  );

  res.json({ date: date || new Date().toISOString().slice(0, 10), parDepot: lignes, total });
});

module.exports = router;
