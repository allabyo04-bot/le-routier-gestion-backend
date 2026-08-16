# LE ROUTIER — Gestion commerciale (backend)

Node/Express/Prisma/PostgreSQL. Premier lot de fonctionnalités : ventes, mise en attente,
historique + annulation tracée, stock multi-dépôt, clients, dépenses/manquants/excédents,
rapport journalier (CA net), utilisateurs (2 rôles : administrateur, opérateur), journal d'audit.

À venir dans une prochaine passe : inventaire (aller-retour Excel), facturation normalisée DGI
(le champ `typeFacture` est déjà prévu dans le schéma pour ne pas bloquer cette évolution).

## Déploiement sur Railway

1. Variables d'environnement à définir sur le service : `DATABASE_URL` (fournie automatiquement
   si le service Postgres est dans le même projet Railway), `JWT_SECRET` (une longue chaîne
   aléatoire).
2. Railway installe les dépendances puis lance `npm start`, qui exécute `prisma migrate deploy`
   avant de démarrer le serveur.
3. Une fois déployé, lancer une seule fois `node prisma/seed.js` (via le terminal Railway du
   service, onglet "Console") pour créer le dépôt principal et le compte administrateur
   (`admin` / `routier2026` — à changer dès la première connexion).

## Développement local

```
npm install
cp .env.example .env   # renseigner DATABASE_URL
npx prisma migrate dev --name init
npm run seed
npm run dev
```
