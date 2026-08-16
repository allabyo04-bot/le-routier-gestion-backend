require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const depotsRoutes = require("./routes/depots");
const articlesRoutes = require("./routes/articles");
const clientsRoutes = require("./routes/clients");
const ventesRoutes = require("./routes/ventes");
const ventesAttenteRoutes = require("./routes/ventes-attente");
const operationsCaisseRoutes = require("./routes/operations-caisse");
const etatsRoutes = require("./routes/etats");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true, service: "le-routier-gestion-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/depots", depotsRoutes);
app.use("/api/articles", articlesRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/ventes", ventesRoutes);
app.use("/api/ventes-attente", ventesAttenteRoutes);
app.use("/api/operations-caisse", operationsCaisseRoutes);
app.use("/api/etats", etatsRoutes);

// Gestionnaire d'erreurs générique — évite qu'une exception non gérée ne fasse planter le process
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`le-routier-gestion-backend démarré sur le port ${PORT}`));
