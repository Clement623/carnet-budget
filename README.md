# Carnet de dépenses

Application web de suivi de budget, installable sur le téléphone (PWA).
Elle ne dépend d'aucun serveur : **les données restent sur l'appareil**, dans le navigateur. Rien n'est envoyé sur Internet et rien n'est enregistré dans ce dépôt.

## Fonctionnalités

- Dépenses, revenus et épargne, avec modification et suppression
- Solde reporté de mois en mois et solde prévu après les frais à venir
- Catégories et budgets mensuels modifiables
- Frais fixes ajoutés automatiquement chaque mois
- Sauvegarde et restauration sous forme de texte
- Fonctionne sans connexion une fois installée

## Technologies

HTML, CSS et JavaScript sans framework, IndexedDB avec [Dexie.js](https://dexie.org) pour le stockage, service worker et manifeste pour l'installation, GitHub Pages pour l'hébergement.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html` | La structure de la page |
| `css/style.css` | L'apparence |
| `js/app.js` | La logique de l'appli, découpée en étapes commentées |
| `js/dexie.min.js` | La bibliothèque de base de données |
| `sw.js` | Le fonctionnement sans connexion |
| `manifest.webmanifest` | Le nom et l'icône à l'installation |
| `fonts/`, `icons/` | Les polices et les icônes |
| `licences/` | Les licences de Dexie.js et des polices |

## Essayer sur son ordinateur

Le service worker demande un vrai serveur. Depuis ce dossier :

```
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000.

## Publier avec GitHub Pages

Dans le dépôt : **Settings > Pages > Deploy from a branch**, branche `main`, dossier `/ (root)`.

## Installer sur le téléphone

Ouvrir l'adresse du site, puis :

- **iPhone (Safari) :** bouton Partager, puis « Sur l'écran d'accueil »
- **Android (Chrome) :** menu ⋮, puis « Installer l'application » ou « Ajouter à l'écran d'accueil »

## Protéger ses données

Elles sont liées à l'adresse du site et au navigateur. Renommer le dépôt, effacer les données du navigateur ou changer de téléphone peut les rendre inaccessibles. Avant cela, copier le texte de **Sauvegarder ou restaurer mes données** et le garder ailleurs. Ne jamais déposer ce texte dans ce dépôt, qui est public.
