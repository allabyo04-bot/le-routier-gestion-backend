const FAMILLES = ["Chaussure", "Sac", "Article d'entretien"];
const BOUTIQUES = ["Angré", "Koumassi"];
const POINTURES = ["35", "36", "36.5", "37", "37.5", "38", "38.5", "39", "39.5", "40", "40.5", "41", "41.5", "42", "42.5", "43", "43.5", "44", "44.5", "45", "45.5", "46", "46.5", "47", "47.5", "48"];

// Génère la base de la référence d'un article : 3 lettres de la marque + 2 lettres de la famille.
// Exemple : Hispanitas + Chaussure -> "HISCH"
function refBase(marqueNom, famille) {
  const lettresMarque = (marqueNom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const lettresFamille = famille === "Chaussure" ? "CH" : famille === "Sac" ? "SA" : famille === "Article d'entretien" ? "EN" : "XX";
  return lettresMarque + lettresFamille;
}

module.exports = { FAMILLES, BOUTIQUES, POINTURES, refBase };