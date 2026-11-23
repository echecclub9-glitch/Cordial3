# Cordial

Clone de Discord : chat temps réel avec comptes, serveurs, salons, réactions et présence.

## Lancer

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000 : la page d'accueil (`/`) propose d'installer l'application, et le chat est sur `/app`. Node.js 22.13 ou plus récent est nécessaire (SQLite est intégré à Node, aucune base à installer).

Variables optionnelles :

| Variable | Rôle |
|---|---|
| `PORT` | port (défaut 3000) |
| `DB_PATH` | fichier SQLite (défaut `cordial.db`) |
| `UPLOAD_DIR` | dossier des fichiers envoyés (défaut à côté de la base) |
| `ADMIN_USERS`, `ADMIN_SETUP_CODE` | pseudos admin (défaut `artachi`) et code de création du compte |
| `TRUST_PROXY` | mettre `1` derrière Nginx ou Caddy |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | clés des notifications push (générées et conservées automatiquement si absentes) |
| `ICE_SERVERS` | serveurs STUN/TURN du vocal, en JSON (défaut : STUN Google) |
| `GITHUB_REPO` | `compte/depot` GitHub : la page d'accueil propose les installeurs Windows, macOS et Linux de la dernière release |
| `DESKTOP_DOWNLOAD_URL` | lien personnalisé de l'installeur Windows (prioritaire sur `GITHUB_REPO`) |

## Fonctionnalités

- Inscription / connexion (mots de passe hachés avec scrypt, sessions de 30 jours)
- Serveurs, salons, codes d'invitation, création de salons par le propriétaire
- Messages en temps réel, historique paginé, suppression, réactions, indicateur de saisie
- Présence (en ligne, absent, ne pas déranger, invisible), mentions @pseudo, liens cliquables
- Anti-spam et limite de tentatives de connexion
- Messages : modifier, répondre, épingler, rechercher dans un salon
- Profils : photo, bannière, bio et statut personnalisé (clic sur son avatar en bas à gauche pour modifier, clic sur un pseudo puis « Voir le profil » pour consulter). Les images sont recadrées dans le navigateur (256 px et 960×320) ; les GIF animés deviennent des images fixes
- Rôles par serveur : bouton **Rôles** dans l'en-tête du serveur (pour le propriétaire et ceux qui ont le droit « Gérer les rôles »). Chaque rôle a un nom, une couleur (visible sur le pseudo) et des permissions : gérer les messages, gérer les salons, gérer les rôles, expulser, parler partout (ignore mode lent et lecture seule). Clic sur un membre pour lui attribuer des rôles ou l'expulser. Hiérarchie : on ne gère que les rôles et membres situés sous son propre niveau, et on ne peut donner que des droits qu'on possède. Le propriétaire, les modérateurs et l'administrateur du site ont tous les droits partout
- Salons privés : dans « Créer un salon » ou les réglages d'un salon, cochez **Salon privé** puis les rôles autorisés. Le salon (texte ou vocal) n'est visible, lisible et accessible que par ces rôles et par ceux qui gèrent les salons ; messages, notifications et présence vocale ne sont diffusés qu'à eux. Un cadenas le signale. Donner ou retirer un rôle l'ouvre ou le ferme aussitôt
- Sanctions (droits « Avertir et mettre en sourdine », « Expulser » et « Bannir ») : clic sur un membre → *Avertir* (message conservé et affiché à la personne), *Mettre en sourdine* (10 min, 1 h ou 1 jour : ni message, ni réaction, ni vocal ; les messages privés restent possibles), *Expulser*, *Bannir* (1 heure, 1 jour ou définitif : retour impossible, même avec le code, jusqu'à la fin de la durée). Le bouton **Sanctions** de l'en-tête affiche les bannis et sourdines en cours (avec levée en un clic) et l'historique complet, réservé aux modérateurs du serveur. Hiérarchie respectée : on ne sanctionne jamais le propriétaire, l'équipe du site ni un niveau égal ou supérieur
- Messages privés (invisibles pour l'équipe, sauf message signalé)
- Images et fichiers (8 Mo, types autorisés vérifiés par leur contenu)
- Mode lent et salons en lecture seule
- Signalement de messages, reçus dans le panneau de modération
- Rôle **modérateur** : supprime des messages, suspend des comptes, traite les signalements, sans accès au reste du panneau
- Notifications push réelles (messages privés, mentions, réponses), même application fermée
- Salons vocaux (WebRTC, 6 personnes max) avec **partage d'écran** : bouton 🖥 dans la barre vocale, image et son de l'onglet, 2 partages simultanés maximum, plein écran. Dans l'appli Windows, un sélecteur propose écrans et fenêtres (le son du système n'est partagé que sous Windows). Le partage passe de navigateur à navigateur : avec 5 spectateurs, votre connexion en envoi doit suivre (environ 2,5 Mbit/s par spectateur)
- **Messages vocaux** : bouton micro dans la zone de saisie, 2 minutes maximum, lecteur avec progression et vitesse ×1 / ×1,5 / ×2 (nécessite HTTPS et un micro)
- **Caméra** dans les salons vocaux (bouton 🎥 de la barre vocale), utilisable en même temps que le partage d'écran ; l'image passe de navigateur à navigateur (environ 0,7 Mbit/s par spectateur)
- Bot **Cordibot** : `/aide`, `/de`, `/pile`, `/choix a|b|c`, `/sondage Question|Option 1|Option 2`

## Vocal et notifications : à savoir

- Le vocal et les notifications exigent **HTTPS** (localhost fonctionne pour tester).
- Derrière certains pare-feu ou réseaux mobiles, le vocal demande un serveur **TURN** (par exemple coturn) à renseigner dans `ICE_SERVERS`.
- Sur iPhone, les notifications ne marchent que si l'application est installée sur l'écran d'accueil.

## Administration (compte Artachi)

Le pseudo **Artachi** est réservé : le compte qui le porte est administrateur et accède au panneau sur `/admin` (lien 🛡 dans le chat).

1. Au premier démarrage, la console affiche un **code de création** (ou définissez-le avec `ADMIN_SETUP_CODE`).
2. Sur la page de connexion, onglet Inscription, saisissez le pseudo `Artachi`, un mot de passe, puis le code demandé.
3. Personne d'autre ne peut prendre ce pseudo sans le code. Pour d'autres admins : `ADMIN_USERS=artachi,autrepseudo`.

Le panneau permet : statistiques, annonce à tous les connectés, suspension / réactivation, déconnexion forcée, mot de passe temporaire et suppression de comptes, suppression de serveurs et de messages, et un journal des actions. Un administrateur ne peut pas être suspendu ni supprimé par le panneau.

## Installer l'application (PWA)

Le site s'installe comme une vraie application (Chrome, Edge, Android, Safari sur iPhone et iPad) grâce à `manifest.webmanifest` et `sw.js`.
L'installation exige HTTPS en production (localhost fonctionne pour tester).
Pour renommer l'application : modifier `name` et `short_name` dans `public/manifest.webmanifest`, ainsi que les textes de `public/index.html` et `public/app.html`.
Les icônes sont dans `public/icons/` (remplacez-les par votre logo en gardant les mêmes noms et tailles).

## Mettre en ligne

Derrière HTTPS (reverse proxy Nginx/Caddy avec support WebSocket), car les jetons de session transitent dans les requêtes.
Sauvegarder régulièrement le fichier `cordial.db`.

## Installeur Windows (Electron)

Le dossier `desktop/` contient l'application de bureau : fenêtre dédiée, icône dans la zone de notification, compteur de non lus, notifications natives.

Test local : `cd desktop && npm install && npm start`. L'adresse du serveur se règle au premier lancement (ou dans `desktop/config.json`, clé `serverUrl`).

Fabriquer le `.exe` : un `.exe` ne se construit pas sous Linux sans Wine, donc le dépôt GitHub le fait pour vous.
1. Poussez le projet sur GitHub et créez la variable de dépôt `CORDIAL_URL` (Settings, Secrets and variables, Actions, Variables) avec l'adresse de votre serveur.
2. Créez une étiquette : `git tag v1.0.0 && git push --tags` (ou lancez le workflow à la main).
3. Récupérez `Cordial Setup x.y.z.exe` dans les Releases, et mettez son lien dans `DESKTOP_DOWNLOAD_URL`.

L'installeur n'est pas signé : Windows affichera « Windows a protégé votre PC » (Informations complémentaires, puis Exécuter quand même). Un certificat de signature de code supprime cet avertissement.
