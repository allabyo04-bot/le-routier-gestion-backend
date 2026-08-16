const prisma = require("./src/prisma");

async function main() {
  const vendeurs = [
    { nom: "EKRAH RUTH MERCY", boutique: "Koumassi" },
    { nom: "KOUAME YVAN AXEL", boutique: "Koumassi" },
    { nom: "KONE KOROTOUM", boutique: "Koumassi" },
    { nom: "ANOH RUTH TANO", boutique: "Koumassi" },
    { nom: "KONAN FALLONE EUDOXIE", boutique: "Angré" },
    { nom: "N'DA TAKI NARCISSE", boutique: "Angré" },
    { nom: "DOUA LYNDA", boutique: "Angré" },
    { nom: "DIANDE AWA", boutique: "Angré" },
    { nom: "KOUAKOU ELLA PAULE", boutique: "Angré" },
  ];

  for (const v of vendeurs) {
    await prisma.vendeur.create({ data: v });
    console.log("Ajouté :", v.nom, "-", v.boutique);
  }

  console.log("Terminé.");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());