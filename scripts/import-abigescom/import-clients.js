// Import Clients — données réelles de lancement.
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const prisma = require("../../src/prisma");

const DOSSIER = __dirname;
const CONFIRMER = process.argv.includes("--confirmer");

const POINTURE_MAP = { 1: "T35", 2: "T36", 3: "T37", 4: "T38", 5: "T39", 6: "T40", 7: "T41", 8: "T42" };

function lireFeuille(nomFichier) {
  const wb = XLSX.readFile(path.join(DOSSIER, nomFichier));
  const feuille = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(feuille, { defval: null });
}

function normaliserPointure(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (POINTURE_MAP[Number(s)]) return POINTURE_MAP[Number(s)];
  return s;
}

async function main() {
  console.log(`\n=== Import Clients — mode ${CONFIRMER ? "RÉEL" : "TEST"} ===\n`);

  const lignesClients = lireFeuille("clients_telephone_et_autres.xlsx");
  const lignesAnnivs = lireFeuille("Clients_mois_et_années.xlsx");
  const lignesCartes = lireFeuille("carte_de_fidélité.xls");

  const annivParNumero = new Map();
  for (const l of lignesAnnivs) {
    const num = String(l["Numéro du tiers"] || "").trim();
    const jour = Number(l["Jour"]);
    const mois = Number(l["Mois"]);
    annivParNumero.set(num, {
      jour: jour >= 1 && jour <= 31 ? jour : null,
      mois: mois >= 1 && mois <= 12 ? mois : null,
    });
  }

  const carteParNumero = new Map();
  for (const l of lignesCartes) {
    const numtiers = l["numtiers"] != null ? String(l["numtiers"]).trim() : null;
    if (!numtiers) continue;
    carteParNumero.set(numtiers, {
      carteFidelite: l["NuméroCarteFidelite"] != null ? String(l["NuméroCarteFidelite"]).trim() : null,
      montantCumule: Math.round(Number(l["Montant"]) || 0),
    });
  }

  const clientsFinal = [];
  const exclusSansNom = [];
  const telephonesVus = new Set();
  let telephonesVides = 0;

  for (const l of lignesClients) {
    const numero = String(l["Numéro"] || "").trim();
    const nom = l["Intitulé"] != null ? String(l["Intitulé"]).trim() : "";
    if (!nom) { exclusSansNom.push(numero); continue; }

    let telephone = l["Téléphone"] != null ? String(l["Téléphone"]).trim() : null;
    const whatsapp = l["WhatSapp"] != null ? String(l["WhatSapp"]).trim() : null;
    if (telephone) {
      if (telephonesVus.has(telephone)) { telephone = null; telephonesVides++; }
      else telephonesVus.add(telephone);
    }

    const anniv = annivParNumero.get(numero) || {};
    const carte = carteParNumero.get(numero) || {};

    clientsFinal.push({
      code: numero,
      nomPrenoms: nom,
      civilite: "Madame",
      jourAnniv: String(anniv.jour || 1).padStart(2, "0"),
      moisAnniv: String(anniv.mois || 1).padStart(2, "0"),
      adresse: l["Adresse"] || null,
      ville: l["Ville"] || null,
      commune: l["Commune"] || null,
      quartier: l["Quartier"] || null,
      telephone,
      whatsapp,
      pointure: normaliserPointure(l["Pointure"]),
      carteFidelite: carte.carteFidelite || null,
      montantCumule: carte.montantCumule || 0,
    });
  }

  console.log(`Clients source : ${lignesClients.length}`);
  console.log(`Exclus (nom manquant) : ${exclusSansNom.length}`);
  console.log(`Clients à importer : ${clientsFinal.length}`);
  console.log(`Téléphones vidés (doublon) : ${telephonesVides}`);
  console.log(`Avec carte de fidélité : ${clientsFinal.filter((c) => c.carteFidelite).length}`);
  console.log(`Avec date réelle : ${clientsFinal.filter((c) => annivParNumero.get(c.code)?.jour).length}`);
  console.log(`Avec date factice (01/01) : ${clientsFinal.filter((c) => !annivParNumero.get(c.code)?.jour).length}`);

  if (!CONFIRMER) {
    console.log("\n--- MODE TEST : aucune écriture. Relance avec --confirmer. ---\n");
    return;
  }

  console.log("\nÉcriture en base...");
  let créés = 0, échecs = 0;
  for (const c of clientsFinal) {
    try {
      await prisma.client.upsert({ where: { code: c.code }, update: c, create: c });
      créés++;
    } catch (e) {
      échecs++;
      console.log(`  Échec pour ${c.code} (${c.nomPrenoms}) : ${e.code} — ${e.meta ? JSON.stringify(e.meta) : e.message.split("\n")[0]}`);
    }
  }
  console.log(`\nClients upsertés : ${créés}`);
  if (échecs) console.log(`Échecs : ${échecs}`);
  console.log("\n=== Import terminé ===\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());