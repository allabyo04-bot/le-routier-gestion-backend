const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non authentifié." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, nom, role, depotParDefautId }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "administrateur") {
    return res.status(403).json({ error: "Réservé à l'administrateur." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
