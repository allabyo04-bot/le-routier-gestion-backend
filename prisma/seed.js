// Initialise le dépôt principal et le compte administrateur.
// Usage : node prisma/seed.js
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const depot = await prisma.depot.upsert({
    where: { nom: "DEPOT PRINCIPAL" },
    update: {},
    create: { nom: "DEPOT PRINCIPAL", adresse: "Agla Les Pylônes, Cotonou" },
  });

  const motDePasseHash = await bcrypt.hash("routier2026", 10);
  await prisma.user.upsert({
    where: { identifiant: "admin" },
    update: {},
    create: {
      nom: "DOSSA Cocou Joscio",
      identifiant: "admin",
      motDePasseHash,
      role: "administrateur",
      depotParDefautId: depot.id,
    },
  });

  await prisma.client.upsert({
    where: { telephone: "___client_comptoir___" },
    update: {},
    create: {
      raisonSociale: "Client comptoir",
      estClientComptoir: true,
      telephone: "___client_comptoir___",
    },
  });

  console.log("Seed terminé : dépôt principal, compte admin/routier2026, client comptoir créés.");
  console.log("⚠️  Change ce mot de passe dès la première connexion (Mon compte → changer le mot de passe).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
