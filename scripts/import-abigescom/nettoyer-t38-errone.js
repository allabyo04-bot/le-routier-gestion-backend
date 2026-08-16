require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

async function main() {
  const res = await prisma.stockItem.deleteMany({ where: { pointure: "T38" } });
  console.log(`${res.count} ligne(s) erronée(s) (pointure "T38") supprimée(s).`);
}
main().catch(console.error).finally(() => prisma.$disconnect());