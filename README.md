# Gestion Commerciale — Backend

API pour la gestion commerciale (chaussures & sacs) — La Pointure Espagnole.

## Démarrage en local

1. **Installer les dépendances**
   ```
   npm install
   ```

2. **Créer le fichier `.env`**
   Copie `.env.example` en `.env` et remplis `DATABASE_URL` (une base PostgreSQL locale,
   ou directement l'URL fournie par Railway si tu préfères développer contre le cloud).

3. **Créer les tables dans la base**
   ```
   npx prisma migrate dev --name init
   ```
   Cette commande lit `prisma/schema.prisma` et crée toutes les tables correspondantes.

4. **Créer les rôles + le premier compte administrateur**
   ```
   npm run seed
   ```
   Ça crée automatiquement :
   - Les rôles Administrateur / Gérant / Vendeur
   - Un compte `djenie` avec le PIN `1234` (rôle Administrateur)

   **Change ce PIN dès la première connexion** — il n'est là que pour démarrer.

5. **Lancer le serveur**
   ```
   npm run dev
   ```
   L'API tourne sur `http://localhost:4000`.

## Tester que ça marche

```
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login": "djenie", "pin": "1234"}'
```

Tu dois recevoir un token. Toutes les autres routes (`/api/users`, `/api/articles`, `/api/clients`,
`/api/ventes`...) demandent ce token dans l'en-tête :
```
Authorization: Bearer <le-token-reçu>
```

## Prochaine étape

Une fois que ça fonctionne en local, on passe à :
1. Créer le dépôt GitHub et y pousser ce code
2. Créer le projet Railway, y ajouter une base PostgreSQL
3. Configurer les variables d'environnement sur Railway
4. Déployer → obtenir l'URL publique
5. Adapter le frontend React pour appeler cette API au lieu du stockage de l'artifact
