// Diagnostic puis correction des numéros de téléphone clients auxquels il manque le "0" de tête
// (bug classique d'Excel qui traite une colonne de numéros comme un nombre et avale le zéro initial).
//
// Un numéro ivoirien correct fait 10 chiffres (ex : 0778138742). Ce script repère les numéros
// à 9 chiffres qui ne commencent pas par 0, et propose de leur ajouter ce zéro manquant.
//
// Usage :
//   node scripts/corriger-telephones.js                 → diagnostic seul, ne modifie rien
//   node scripts/corriger-telephones.js --appliquer      → applique réellement la correction

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function estCandidat(numero) {
  if (!numero) return false;
  const n = numero.trim();
  return /^[1-9][0-9]{8}$/.test(n); // exactement 9 chiffres, ne commence pas par 0
}

async function main() {
  const appliquer = process.argv.includes("--appliquer");

  const clients = await prisma.client.findMany({
    select: { id: true, nomPrenoms: true, telephone: true, whatsapp: true, carteFidelite: true },
  });

  const aCorreiger = [];
  for (const c of clients) {
    const telOk = estCandidat(c.telephone);
    const waOk = estCandidat(c.whatsapp);
    if (telOk || waOk) {
      aCorreiger.push({
        ...c,
        nouveauTelephone: telOk ? "0" + c.telephone.trim() : c.telephone,
        nouveauWhatsapp: waOk ? "0" + c.whatsapp.trim() : c.whatsapp,
      });
    }
  }

  console.log(`Total clients : ${clients.length}`);
  console.log(`Numéros à 9 chiffres détectés (téléphone et/ou WhatsApp) : ${aCorreiger.length}`);
  console.log("");
  console.log("Aperçu des 15 premiers :");
  for (const c of aCorreiger.slice(0, 15)) {
    console.log(`  ${c.nomPrenoms} (carte ${c.carteFidelite || "—"}) : ${c.telephone || "—"} → ${c.nouveauTelephone || "—"}`
      + (c.whatsapp ? `  |  whatsapp ${c.whatsapp} → ${c.nouveauWhatsapp}` : ""));
  }

  if (!appliquer) {
    console.log("");
    console.log("Mode diagnostic uniquement — rien n'a été modifié.");
    console.log("Pour appliquer la correction : node scripts/corriger-telephones.js --appliquer");
    await prisma.$disconnect();
    return;
  }

  console.log("");
  console.log("Application de la correction...");
  let corriges = 0;
  let erreurs = [];
  for (const c of aCorreiger) {
    try {
      await prisma.client.update({
        where: { id: c.id },
        data: {
          telephone: c.nouveauTelephone,
          whatsapp: c.nouveauWhatsapp,
        },
      });
      corriges++;
    } catch (e) {
      // Le plus probable : conflit d'unicité (le numéro corrigé existe déjà chez un autre client,
      // ce qui peut indiquer un doublon préexistant à régler manuellement).
      erreurs.push({ nomPrenoms: c.nomPrenoms, carteFidelite: c.carteFidelite, erreur: e.message.split("\n")[0] });
    }
  }

  console.log(`${corriges} client(s) corrigé(s) avec succès.`);
  if (erreurs.length > 0) {
    console.log(`${erreurs.length} en erreur (probablement des doublons à régler à la main) :`);
    erreurs.forEach((e) => console.log(`  - ${e.nomPrenoms} (carte ${e.carteFidelite || "—"}) : ${e.erreur}`));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
