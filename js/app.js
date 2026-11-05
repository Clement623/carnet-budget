// ===== 1. Les données de départ =====
// Une catégorie = id + nom + budget mensuel en centimes (70000 = 700,00 €).
const CATEGORIES_DE_DEPART = [
  { id: 1, nom: 'Courses',   budget_mensuel: 0 },
  { id: 2, nom: 'Logement',  budget_mensuel: 0 },
  { id: 3, nom: 'Transport', budget_mensuel: 0 },
  { id: 4, nom: 'Loisirs',   budget_mensuel: 0 },
  { id: 5, nom: 'Santé',     budget_mensuel: 0 },
  { id: 6, nom: 'Autres',    budget_mensuel: 0 },
];

// La carte qui existe toujours, et qui récupère les données déjà saisies.
const CARTE_DE_DEPART = { id: 1, nom: 'Carte principale' };

// Les trois tables d'opérations. Elles fonctionnent toutes de la même façon.
const TABLES = { depense: 'depenses', revenu: 'revenus', epargne: 'epargne' };

// L'état de l'appli : une copie en mémoire de la base, plus ce qui est affiché.
// filtre vaut 'tout', 'depense', 'revenu', 'epargne' ou le numéro d'une catégorie.
const etat = { cartes: [], carte: CARTE_DE_DEPART.id, categories: [], depenses: [], revenus: [], epargne: [], modeles: [], mois: cleDuMois(new Date()), filtre: 'tout', typeSaisie: 'depense', edition: null };


// ===== 2. La base de données =====
// Dexie simplifie IndexedDB, la base intégrée au navigateur. Rien n'est envoyé sur Internet.
let base = null;

async function ouvrirBase() {
  try {
    const db = new Dexie('carnet-budget');
    // On déclare les tables, leur identifiant et les champs utilisés pour chercher.
    db.version(1).stores({ categories: 'id', depenses: 'id, date, categorie_id' });
    // Version 2 : on ajoute deux tables. Dexie conserve les données déjà enregistrées.
    db.version(2).stores({ revenus: 'id, date', epargne: 'id, date' }).upgrade(async (transaction) => {
    });
    // Version 3 : les dépenses peuvent porter la marque "fixe". Aucune donnée n'est perdue.
    db.version(3).stores({});
    // Version 4 : chaque frais fixe a un modèle qui sert à le recréer tous les mois.
    db.version(4).stores({ modeles: 'id' }).upgrade(async (transaction) => {
      const depenses = await transaction.table('depenses').toArray();
      const modeles = creerModelesDepuisFixes(depenses);
      await transaction.table('depenses').bulkPut(depenses);
      await transaction.table('modeles').bulkPut(modeles);
    });
    // Version 5 : on efface les lignes d'exemple installées par les anciennes versions.
    db.version(5).stores({}).upgrade(async (transaction) => {
      for (const nom of ['depenses', 'revenus', 'epargne', 'modeles']) {
        await transaction.table(nom).filter((l) => l.exemple).delete();
      }
    });
    // Version 6 : chaque opération appartient à une carte.
    db.version(6).stores({ cartes: 'id' }).upgrade(async (transaction) => {
      await transaction.table('cartes').put(CARTE_DE_DEPART);
      for (const nom of ['depenses', 'revenus', 'epargne', 'modeles']) {
        await transaction.table(nom).toCollection().modify({ carte_id: CARTE_DE_DEPART.id });
      }
    });
    await db.open();
    return db;
  } catch (e) {
    return null; // Base bloquée : l'appli marche quand même, mais sans rien conserver.
  }
}

async function chargerDonnees() {
  if (base) {
    etat.cartes = await base.cartes.toArray();
    etat.categories = await base.categories.toArray();
    etat.depenses = await base.depenses.toArray();
    etat.revenus = await base.revenus.toArray();
    etat.epargne = await base.epargne.toArray();
    etat.modeles = await base.modeles.toArray();
  }
  // Premier lancement : aucune catégorie, donc on installe celles de départ.
  if (etat.categories.length === 0) {
    // Sur une installation neuve, la version 6 ne s'exécute pas : on crée la carte ici.
    await remplacerTout({ cartes: [{ ...CARTE_DE_DEPART }], categories: CATEGORIES_DE_DEPART, depenses: [], revenus: [], epargne: [], modeles: [] });
  }
  // Par sécurité, il existe toujours au moins une carte.
  if (etat.cartes.length === 0) {
    etat.cartes = [{ ...CARTE_DE_DEPART }];
    await ecrire(() => base.cartes.put(etat.cartes[0]));
  }
  etat.carte = etat.cartes[0].id;
}

// Exécute une écriture dans la base et prévient si elle échoue.
async function ecrire(action) {
  if (!base) return;
  try { await action(); }
  catch (e) { afficherMessage("L'enregistrement a échoué. Vérifie l'espace libre sur ton téléphone."); }
}

async function remplacerTout(donnees) {
  Object.assign(etat, donnees);
  // Une transaction fait tout ou rien : on ne peut pas se retrouver avec une base à moitié vidée.
  await ecrire(() => base.transaction('rw', base.cartes, base.categories, base.depenses, base.revenus, base.epargne, base.modeles, async () => {
    for (const nom of ['cartes', 'categories', 'depenses', 'revenus', 'epargne', 'modeles']) {
      await base[nom].clear();
      await base[nom].bulkPut(donnees[nom]);
    }
  }));
}


// ===== 3. Les montants et les dates =====
// "12,50" devient 1250. Calculer en centimes évite les erreurs d'arrondi de JavaScript
// (dans ce langage, 0.1 + 0.2 ne donne pas exactement 0.3).
function lireCentimes(texte) {
  const propre = texte.replace(/[\s\u00a0€]/g, '');
  const morceaux = propre.match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!morceaux) return null;
  const euros = parseInt(morceaux[1], 10);
  const centimes = parseInt(((morceaux[2] || '') + '00').slice(0, 2), 10);
  const total = euros * 100 + centimes;
  return Number.isSafeInteger(total) ? total : null;
}
// Une opération doit dépasser 0. Un budget, lui, peut valoir 0.
function texteVersCentimes(texte) {
  const total = lireCentimes(texte);
  return total > 0 ? total : null;
}
// L'inverse : 1250 devient "12,50" pour remplir un champ à modifier.
function centimesVersTexte(centimes) { return (centimes / 100).toFixed(2).replace('.', ','); }

const formatEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
function euros(centimes) { return formatEuros.format(centimes / 100); }

function deuxChiffres(n) { return String(n).padStart(2, '0'); }
// Date locale au format AAAA-MM-JJ. toISOString() donnerait parfois la veille à cause du fuseau horaire.
function dateEnTexte(d) { return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate()); }
function cleDuMois(d) { return dateEnTexte(d).slice(0, 7); } // "2026-11"
function moisVoisin(cle, decalage) {
  const [annee, mois] = cle.split('-').map(Number);
  return cleDuMois(new Date(annee, mois - 1 + decalage, 1));
}


// ===== 4. Le classement automatique =====
// Si la description contient un de ces mots, on propose la catégorie correspondante.
// Pour enrichir le classement, il suffit d'ajouter des mots à cette liste.
const MOTS_CLES = {
  1: ['carrefour', 'lidl', 'leclerc', 'auchan', 'intermarché', 'monoprix', 'boulangerie', 'courses'],
  2: ['loyer', 'électricité', 'edf', 'assurance habitation', 'charges'],
  3: ['essence', 'train', 'sncf', 'bus', 'métro', 'péage', 'parking'],
  4: ['cinéma', 'restaurant', 'concert', 'bar', 'netflix', 'spotify', 'bowling'],
  5: ['pharmacie', 'médecin', 'dentiste', 'mutuelle'],
};

function proposerCategorie(description) {
  const texte = description.toLowerCase();
  for (const [categorieId, mots] of Object.entries(MOTS_CLES)) {
    // La catégorie a pu être supprimée entre-temps.
    if (mots.some((mot) => texte.includes(mot)) && etat.categories.some((c) => c.id === Number(categorieId))) return Number(categorieId);
  }
  return null;
}


// ===== 5. Le calcul du solde =====
// Rien n'est stocké : le solde est recalculé à partir des opérations à chaque affichage.
// Il ne peut donc jamais être faux ou décalé par rapport à la liste.
function somme(lignes) { return lignes.reduce((total, ligne) => total + ligne.montant, 0); }

// Ne garde que les lignes de la carte affichée.
function deLaCarte(lignes) {
  return lignes.filter((ligne) => ligne.carte_id === etat.carte);
}

function calculerBilan(mois) {
  const revenusCarte = deLaCarte(etat.revenus);
  const depensesCarte = deLaCarte(etat.depenses);
  const epargneCarte = deLaCarte(etat.epargne);
  const duMois = (ligne) => ligne.date.startsWith(mois);
  // Les dates "AAAA-MM-JJ" se comparent comme du texte : on garde tout jusqu'à la fin du mois affiché.
  const jusquAuMois = (ligne) => ligne.date.slice(0, 7) <= mois;

  const revenus = somme(revenusCarte.filter(duMois));
  const depenses = somme(depensesCarte.filter(duMois));
  const fixes = somme(depensesCarte.filter((d) => duMois(d) && d.fixe));
  const epargneDuMois = somme(epargneCarte.filter(duMois));
  const epargneTotale = somme(epargneCarte.filter(jusquAuMois));

  // Le solde cumule tous les mois. L'argent mis de côté en sort, et y revient s'il est repris.
  const solde = somme(revenusCarte.filter(jusquAuMois))
              - somme(depensesCarte.filter(jusquAuMois))
              - epargneTotale;

  return { revenus, depenses, fixes, epargneDuMois, epargneTotale, solde, reste: revenus - depenses - epargneDuMois };
}


// ===== 6. Les frais fixes =====
// Un frais fixe, c'est deux choses :
//  - un modèle (table "modeles") : la description, le montant et le jour du mois ;
//  - les dépenses créées à partir de lui, une par mois, marquées fixe: true.
// Elles comptent dans le solde et dans leur catégorie comme n'importe quelle dépense.
const MOTS_FIXES = ['loyer', 'abonnement', 'forfait', 'netflix', 'spotify', 'assurance', 'mutuelle', 'crédit', 'box internet', 'électricité', 'edf'];

function ressembleAFraisFixe(description) {
  const texte = description.toLowerCase();
  return MOTS_FIXES.some((mot) => texte.includes(mot));
}

// La date du frais pour un mois donné. Un frais du 31 tombe le 30 en novembre.
function dateDuModele(modele, mois) {
  const [annee, numero] = mois.split('-').map(Number);
  const dernierJour = new Date(annee, numero, 0).getDate();
  return mois + '-' + deuxChiffres(Math.min(modele.jour, dernierJour));
}

// Un frais marqué après coup ne remplit pas les mois passés : il repart au plus tôt de ce mois-ci.
function pointDeDepart(mois) {
  const moisPrecedent = moisVoisin(cleDuMois(new Date()), -1);
  return mois > moisPrecedent ? mois : moisPrecedent;
}

function creerModele(id, depense) {
  return {
    id,
    description: depense.description,
    montant: depense.montant,
    jour: Number(depense.date.slice(8)),
    categorie_id: depense.categorie_id,
    carte_id: depense.carte_id,
    dernier_mois: pointDeDepart(depense.date.slice(0, 7)), // Le dernier mois déjà traité.
    actif: true,
  };
}

// Crée un modèle pour chaque frais fixe qui n'en a pas (anciennes données et anciennes sauvegardes).
function creerModelesDepuisFixes(depenses) {
  const modeles = [];
  const parNom = new Map();
  const fixes = depenses.filter((d) => d.fixe).sort((a, b) => b.date.localeCompare(a.date));
  for (const depense of fixes) { // La plus récente d'abord : elle donne le montant et le jour.
    const cle = depense.carte_id + '|' + depense.description + '|' + depense.categorie_id;
    if (!parNom.has(cle)) {
      const modele = creerModele(modeles.length + 1, depense);
      parNom.set(cle, modele);
      modeles.push(modele);
    }
    depense.modele_id = parNom.get(cle).id;
  }
  return modeles;
}

// Le cœur de l'automatisme, lancé à chaque ouverture de l'appli : on ajoute les frais dont la date
// est arrivée. Si l'appli n'a pas été ouverte depuis trois mois, les trois mois sont rattrapés.
// dernier_mois garantit qu'un frais n'est jamais créé deux fois.
async function genererFraisFixes() {
  const aujourdhui = dateEnTexte(new Date());
  const nouvelles = [];
  const modifies = [];
  for (const modele of etat.modeles) {
    if (!modele.actif) continue;
    const depart = modele.dernier_mois;
    while (true) {
      const mois = moisVoisin(modele.dernier_mois, 1);
      const date = dateDuModele(modele, mois);
      if (date > aujourdhui) break; // Cette date n'est pas encore arrivée.
      const depense = {
        id: prochainId(etat.depenses),
        montant: modele.montant,
        date,
        description: modele.description,
        categorie_id: modele.categorie_id,
        carte_id: modele.carte_id,
        fixe: true,
        modele_id: modele.id,
      };
      etat.depenses.push(depense);
      nouvelles.push(depense);
      modele.dernier_mois = mois;
    }
    if (modele.dernier_mois !== depart) modifies.push(modele);
  }
  if (nouvelles.length > 0) {
    await ecrire(() => base.transaction('rw', base.depenses, base.modeles, async () => {
      await base.depenses.bulkPut(nouvelles);
      await base.modeles.bulkPut(modifies);
    }));
  }
  return nouvelles.length;
}

// Les frais attendus jusqu'au mois indiqué, pas encore passés. Ils ne sont pas enregistrés :
// ils sont seulement déduits des modèles.
function fraisAVenir(jusquAuMois) {
  const resultat = [];
  for (const modele of deLaCarte(etat.modeles)) {
    if (!modele.actif) continue;
    let mois = moisVoisin(modele.dernier_mois, 1);
    while (mois <= jusquAuMois) {
      resultat.push({ modele, mois, date: dateDuModele(modele, mois) });
      mois = moisVoisin(mois, 1);
    }
  }
  return resultat;
}

async function sauverFrais(depense, modele) {
  await ecrire(() => base.transaction('rw', base.depenses, base.modeles, async () => {
    if (depense) await base.depenses.put(depense);
    if (modele) await base.modeles.put(modele);
  }));
}

// Rend une dépense récurrente.
function activerFixe(depense) {
  let modele = etat.modeles.find((m) => m.id === depense.modele_id);
  depense.fixe = true;
  if (modele) {
    modele.actif = true;
    const depart = pointDeDepart(depense.date.slice(0, 7));
    if (depart > modele.dernier_mois) modele.dernier_mois = depart;
  } else {
    modele = creerModele(prochainId(etat.modeles), depense);
    etat.modeles.push(modele);
    depense.modele_id = modele.id;
  }
  return modele;
}

// Une dépense est "récurrente" si elle a un modèle encore actif.
function modeleActif(depense) {
  const modele = etat.modeles.find((m) => m.id === depense.modele_id);
  return depense.fixe && modele && modele.actif ? modele : null;
}

// Arrête un frais depuis la carte. Les mois déjà passés restent enregistrés.
async function arreterFrais(modele) {
  if (etat.edition) quitterEdition();
  modele.actif = false;
  await sauverFrais(null, modele);
  afficher();
  afficherMessage('« ' + modele.description + ' » ne reviendra plus', 'Annuler', async () => {
    modele.actif = true;
    await sauverFrais(null, modele);
    await genererFraisFixes();
    afficher();
    afficherMessage('Frais fixe rétabli');
  });
}

// Dessine la barre : quelle part du mois partent en frais fixes, autres dépenses et épargne.
function afficherFraisFixes(bilan) {
  const passes = deLaCarte(etat.depenses).filter((d) => d.fixe && d.date.startsWith(etat.mois));
  const attendus = fraisAVenir(etat.mois).filter((f) => f.mois === etat.mois);
  const aVenir = attendus.reduce((total, f) => total + f.modele.montant, 0);

  const autres = bilan.depenses - bilan.fixes;
  const versement = Math.max(bilan.epargneDuMois, 0);
  const disponible = bilan.revenus + Math.max(-bilan.epargneDuMois, 0); // Une reprise d'épargne s'ajoute.
  const reste = disponible - bilan.fixes - autres - versement - aVenir;
  const totalFixes = bilan.fixes + aVenir;

  $('fixes-total').textContent = euros(totalFixes);
  const phrases = [];
  if (totalFixes > 0 && bilan.revenus > 0) phrases.push(Math.round(totalFixes / bilan.revenus * 100) + ' % de tes revenus du mois');
  if (totalFixes > 0 && bilan.revenus === 0) phrases.push('Ajoute un revenu pour voir la part que cela représente');
  if (aVenir > 0) phrases.push('dont ' + euros(aVenir) + ' encore à venir');
  $('fixes-part').textContent = phrases.join(' · ');
  $('fixes-part').hidden = phrases.length === 0;

  const parts = [
    { nom: 'Frais fixes passés', valeur: bilan.fixes, couleur: 'var(--fixe)' },
    // Des rayures pour distinguer ce qui n'est pas encore parti du compte.
    { nom: 'Frais fixes à venir', valeur: aVenir, couleur: 'repeating-linear-gradient(135deg, var(--fixe) 0 3px, transparent 3px 6px)' },
    { nom: 'Autres dépenses', valeur: autres, couleur: 'var(--autres)' },
    { nom: 'Épargne', valeur: versement, couleur: 'var(--part-epargne)' },
    { nom: reste < 0 ? 'Manque' : 'Reste', valeur: Math.abs(reste), couleur: reste < 0 ? 'var(--alerte)' : 'var(--piste)' },
  ];
  const barre = $('repartition');
  barre.replaceChildren();
  for (const part of parts) {
    if (part.valeur === 0) continue;
    const segment = creer('span');
    segment.style.flexGrow = part.valeur; // La largeur est proportionnelle au montant.
    segment.style.background = part.couleur;
    segment.title = part.nom + ' : ' + euros(part.valeur);
    barre.append(segment);
  }
  barre.setAttribute('aria-label', parts.map((part) => part.nom + ' ' + euros(part.valeur)).join(', '));
  barre.hidden = parts.every((part) => part.valeur === 0);

  const legende = $('legende');
  legende.replaceChildren();
  legende.hidden = barre.hidden;
  for (const part of parts) {
    if (part.valeur === 0 && part.nom === 'Frais fixes à venir') continue;
    const element = creer('li');
    const marque = creer('span', 'pastille-couleur');
    marque.style.background = part.couleur;
    element.append(marque, creer('span', '', part.nom), creer('span', 'valeur', euros(part.valeur)));
    legende.append(element);
  }

  const liste = $('fixes-liste');
  liste.replaceChildren();
  const lignes = [
    ...passes.map((d) => ({ depense: d, date: d.date, description: d.description, montant: d.montant, modele: etat.modeles.find((m) => m.id === d.modele_id), statut: 'Passé' })),
    ...attendus.map((f) => ({ date: f.date, description: f.modele.description, montant: f.modele.montant, modele: f.modele, statut: 'À venir' })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  liste.hidden = lignes.length === 0;
  $('fixes-vide').hidden = lignes.length > 0;
  for (const ligne of lignes) {
    const numero = Number(ligne.date.slice(8));
    const actif = Boolean(ligne.modele && ligne.modele.actif);
    const nom = creer('span', '', ligne.description);
    const statut = creer('span', 'statut', ligne.statut + (actif ? ' · ' : ' · ne reviendra plus'));
    if (actif) {
      const modifier = creer('button', 'lien', 'Modifier');
      modifier.type = 'button';
      modifier.setAttribute('aria-label', 'Modifier ' + ligne.description);
      modifier.addEventListener('click', () => {
        if (ligne.depense) modifierLigne('depense', ligne.depense);
        else modifierModele(ligne.modele, ligne.date);
      });
      statut.append(modifier);
      const arreter = creer('button', 'lien', 'Arrêter');
      arreter.type = 'button';
      arreter.setAttribute('aria-label', 'Arrêter ' + ligne.description);
      arreter.addEventListener('click', () => arreterFrais(ligne.modele));
      statut.append(arreter);
    }
    nom.append(statut);
    const element = creer('li');
    element.append(creer('span', 'jour', 'Le ' + (numero === 1 ? '1er' : numero)), nom, creer('span', 'somme', euros(ligne.montant)));
    liste.append(element);
  }
}


// ===== 7. Ajouter et supprimer une opération =====
const $ = (id) => document.getElementById(id);
let categorieChoisieALaMain = false; // On ne remplace jamais un choix fait par la personne.
let fixeChoisiALaMain = false;

const SAISIES = {
  depense: { exemple: 'Carrefour, essence, cinéma…', bouton: 'Enregistrer la dépense' },
  revenu:  { exemple: 'Salaire, remboursement, vente…', bouton: 'Enregistrer le revenu' },
  epargne: { exemple: 'Livret, projet vacances…', bouton: "Enregistrer l'opération d'épargne" },
};

// Le même formulaire sert aux trois types. On montre seulement les champs utiles.
function changerTypeSaisie(type) {
  etat.typeSaisie = type;
  for (const nom of Object.keys(SAISIES)) $('type-' + nom).setAttribute('aria-pressed', String(nom === type));
  $('champ-categorie').hidden = type !== 'depense';
  $('champ-fixe').hidden = type !== 'depense';
  $('champ-sens').hidden = type !== 'epargne';
  $('description').placeholder = SAISIES[type].exemple;
  $('enregistrer').textContent = SAISIES[type].bouton;
  $('erreur').hidden = true;
}

$('description').addEventListener('input', () => {
  if (etat.typeSaisie !== 'depense') return;
  if (!fixeChoisiALaMain) {
    const fixe = ressembleAFraisFixe($('description').value);
    $('est-fixe').checked = fixe;
    $('suggestion-fixe').textContent = fixe ? 'Coché pour toi, car cela ressemble à un frais fixe.' : '';
  }
  if (categorieChoisieALaMain) return;
  const proposition = proposerCategorie($('description').value);
  $('categorie').value = proposition ? String(proposition) : '';
  $('suggestion').textContent = proposition ? 'Catégorie proposée. Tu peux la changer.' : '';
});
$('est-fixe').addEventListener('change', () => {
  fixeChoisiALaMain = true;
  $('suggestion-fixe').textContent = '';
});
$('categorie').addEventListener('change', () => {
  categorieChoisieALaMain = true;
  $('suggestion').textContent = '';
});

function prochainId(lignes) { return lignes.reduce((max, ligne) => Math.max(max, ligne.id), 0) + 1; }

// Une reprise ne doit jamais faire passer l'épargne sous zéro, à aucune date.
function epargneResteraPositive(lignes) {
  const triees = [...lignes].sort((a, b) => a.date.localeCompare(b.date) || b.montant - a.montant);
  let total = 0;
  for (const ligne of triees) {
    total += ligne.montant;
    if (total < 0) return false;
  }
  return true;
}

function viderFormulaire() {
  $('montant').value = '';
  $('description').value = '';
  $('categorie').value = '';
  $('suggestion').textContent = '';
  $('est-fixe').checked = false;
  $('suggestion-fixe').textContent = '';
  $('erreur').hidden = true;
  categorieChoisieALaMain = false;
  fixeChoisiALaMain = false;
}

// Le même formulaire sert à ajouter et à modifier. Seul l'enregistrement change.
$('formulaire').addEventListener('submit', async (evenement) => {
  evenement.preventDefault(); // Empêche le navigateur de recharger la page.

  // On vérifie la saisie et on dit précisément ce qui ne va pas.
  const edition = etat.edition;
  const type = etat.typeSaisie;
  const montant = texteVersCentimes($('montant').value);
  const description = $('description').value.trim();
  const categorieId = Number($('categorie').value);
  const date = $('date').value;
  const retrait = type === 'epargne' && $('sens').value === 'retirer';
  const montantSigne = retrait ? -montant : montant;
  let probleme = '';
  if (!montant) probleme = 'Indique un montant supérieur à 0, par exemple 12,50.';
  else if (!date) probleme = 'Choisis une date.';
  else if (!description) probleme = 'Ajoute une description pour retrouver cette opération.';
  else if (type === 'depense' && !categorieId) probleme = 'Choisis une catégorie.';
  else if (type === 'epargne') {
    const autres = deLaCarte(etat.epargne).filter((l) => !edition || l !== edition.ligne);
    if (!epargneResteraPositive([...autres, { montant: montantSigne, date }])) {
      probleme = 'Impossible : ton épargne deviendrait négative. Vérifie le montant et la date.';
    }
  }
  $('erreur').textContent = probleme;
  $('erreur').hidden = !probleme;
  if (probleme) return;

  const valeurs = { montant: montantSigne, description, categorieId, date };
  if (edition) {
    await enregistrerModification(edition, valeurs);
    return;
  }

  // L'objet enregistré. Seules les dépenses ont une catégorie, et un retrait devient négatif.
  const table = TABLES[type];
  const ligne = { id: prochainId(etat[table]), carte_id: etat.carte, montant: montantSigne, date, description };
  if (type === 'depense') {
    ligne.categorie_id = categorieId;
    if ($('est-fixe').checked) {
      const modele = activerFixe(ligne);
      await ecrire(() => base.modeles.put(modele));
    }
  }
  etat[table].push(ligne);
  await ecrire(() => base[table].add(ligne));

  // On remet le formulaire à zéro, on affiche le bon mois et on redessine l'écran.
  viderFormulaire();
  etat.mois = date.slice(0, 7);
  etat.filtre = 'tout';
  await genererFraisFixes();
  afficher();
  afficherMessage(euros(montant) + ' enregistré : ' + description + (ligne.fixe ? '. Reviendra chaque mois.' : ''));
});

async function supprimer(type, ligne) {
  const table = TABLES[type];
  if (type === 'epargne' && !epargneResteraPositive(deLaCarte(etat.epargne).filter((l) => l !== ligne))) {
    afficherMessage("Impossible : ton épargne deviendrait négative. Supprime d'abord la reprise correspondante.");
    return;
  }
  if (etat.edition && etat.edition.ligne === ligne) quitterEdition();
  etat[table] = etat[table].filter((l) => l.id !== ligne.id);
  await ecrire(() => base[table].delete(ligne.id));
  afficher();
  // Pas de fenêtre de confirmation : on laisse plutôt la possibilité d'annuler.
  const recurrent = ligne.fixe && etat.modeles.some((m) => m.id === ligne.modele_id && m.actif);
  const texte = recurrent ? '« ' + ligne.description + ' » retiré pour ce mois. Il reviendra le mois prochain.' : '« ' + ligne.description + ' » supprimé';
  afficherMessage(texte, 'Annuler', async () => {
    etat[table].push(ligne);
    await ecrire(() => base[table].put(ligne));
    afficher();
    afficherMessage('Opération rétablie');
  });
}


// ===== 8. Modifier une opération =====
// On remplit le formulaire d'ajout avec les valeurs existantes.
// etat.edition retient ce qui est en cours de modification.
function entrerEdition(edition, titre, type) {
  etat.edition = { ...edition, typeAvant: etat.typeSaisie, defilement: window.scrollY };
  changerTypeSaisie(type);
  // Pendant une modification, on ne remplace aucun choix et le type reste le même.
  categorieChoisieALaMain = true;
  fixeChoisiALaMain = true;
  $('choix-type').hidden = true;
  $('formulaire-titre').textContent = titre;
  $('enregistrer').textContent = 'Enregistrer les modifications';
  $('annuler-edition').hidden = false;
  $('formulaire').scrollIntoView({ block: 'center' });
  $('montant').focus({ preventScroll: true });
}

function modifierLigne(type, ligne) {
  if (etat.edition) quitterEdition();
  $('montant').value = centimesVersTexte(Math.abs(ligne.montant));
  $('description').value = ligne.description;
  $('date').value = ligne.date;
  if (type === 'depense') {
    $('categorie').value = String(ligne.categorie_id);
    const recurrente = Boolean(modeleActif(ligne));
    $('est-fixe').checked = recurrente;
    $('appliquer-suite').checked = true;
    $('champ-suite').hidden = !recurrente;
  }
  if (type === 'epargne') $('sens').value = ligne.montant < 0 ? 'retirer' : 'verser';
  entrerEdition({ ligne, type }, 'Modifier : ' + ligne.description, type);
}

// Un frais à venir n'existe pas encore comme dépense : on modifie directement son modèle.
function modifierModele(modele, date) {
  if (etat.edition) quitterEdition();
  $('montant').value = centimesVersTexte(modele.montant);
  $('description').value = modele.description;
  $('date').value = date;
  $('categorie').value = String(modele.categorie_id);
  // Seul le jour compte : on reste dans le mois affiché.
  const mois = date.slice(0, 7);
  $('date').min = mois + '-01';
  $('date').max = dateDuModele({ jour: 31 }, mois);
  entrerEdition({ modele, type: 'depense' }, 'Modifier le frais à venir : ' + modele.description, 'depense');
  $('champ-fixe').hidden = true;
  $('aide-edition').hidden = false;
}

function quitterEdition() {
  const { typeAvant, defilement } = etat.edition;
  etat.edition = null;
  viderFormulaire();
  $('date').removeAttribute('min');
  $('date').removeAttribute('max');
  $('date').value = dateEnTexte(new Date());
  $('aide-edition').hidden = true;
  $('champ-suite').hidden = true;
  $('choix-type').hidden = false;
  $('annuler-edition').hidden = true;
  $('formulaire-titre').textContent = 'Ajouter';
  changerTypeSaisie(typeAvant);
  return defilement;
}

$('annuler-edition').addEventListener('click', () => window.scrollTo(0, quitterEdition()));

// La case "prochains mois" n'a de sens que si la dépense reste récurrente.
$('est-fixe').addEventListener('change', () => {
  if (etat.edition && etat.edition.ligne && modeleActif(etat.edition.ligne)) $('champ-suite').hidden = !$('est-fixe').checked;
});

async function enregistrerModification(edition, valeurs) {
  const { ligne, modele, type } = edition;
  const details = { description: valeurs.description, montant: valeurs.montant };
  let texte = 'Modification enregistrée';

  if (modele) {
    Object.assign(modele, details, { categorie_id: valeurs.categorieId, jour: Number(valeurs.date.slice(8)) });
    await sauverFrais(null, modele);
    texte = 'Frais fixe modifié pour les prochains mois';
  } else {
    Object.assign(ligne, details, { date: valeurs.date });
    let modeleLie = null;
    if (type === 'depense') {
      ligne.categorie_id = valeurs.categorieId;
      const actif = modeleActif(ligne);
      const voulu = $('est-fixe').checked;
      if (voulu && !actif) {
        modeleLie = activerFixe(ligne);
        texte = 'Cette dépense reviendra chaque mois';
      } else if (!voulu && actif) {
        ligne.fixe = false;
        actif.actif = false;
        modeleLie = actif;
        texte = 'Cette dépense ne reviendra plus';
      } else if (voulu && actif && $('appliquer-suite').checked) {
        Object.assign(actif, details, { categorie_id: valeurs.categorieId, jour: Number(valeurs.date.slice(8)) });
        modeleLie = actif;
        texte = 'Modifié pour ce mois et les prochains';
      }
    }
    const table = TABLES[type];
    await ecrire(() => base.transaction('rw', base[table], base.modeles, async () => {
      await base[table].put(ligne);
      if (modeleLie) await base.modeles.put(modeleLie);
    }));
    etat.mois = valeurs.date.slice(0, 7);
    etat.filtre = 'tout';
  }

  const defilement = quitterEdition();
  await genererFraisFixes();
  afficher();
  window.scrollTo(0, defilement);
  afficherMessage(texte);
}


// ===== 9. Les catégories et les budgets =====
function erreurCategories(texte) {
  $('erreur-categories').textContent = texte;
  $('erreur-categories').hidden = !texte;
}

function nomDejaPris(nom, categorie) {
  return etat.categories.some((c) => c !== categorie && c.nom.toLowerCase() === nom.toLowerCase());
}

// Les modifications sont enregistrées dès qu'on quitte le champ.
async function renommerCategorie(categorie, champ) {
  const nom = champ.value.trim();
  const probleme = !nom ? 'Donne un nom à la catégorie.' : nomDejaPris(nom, categorie) ? 'Une catégorie porte déjà ce nom.' : '';
  erreurCategories(probleme);
  if (probleme) { champ.value = categorie.nom; return; }
  if (nom === categorie.nom) return;
  categorie.nom = nom;
  await ecrire(() => base.categories.put(categorie));
  remplirListeCategories();
  afficher();
  afficherMessage('Catégorie renommée : ' + nom);
}

async function changerBudget(categorie, champ) {
  const budget = lireCentimes(champ.value);
  erreurCategories(budget === null ? 'Indique un budget en euros, par exemple 150 ou 49,90.' : '');
  if (budget === null) { champ.value = centimesVersTexte(categorie.budget_mensuel); return; }
  champ.value = centimesVersTexte(budget);
  if (budget === categorie.budget_mensuel) return;
  categorie.budget_mensuel = budget;
  await ecrire(() => base.categories.put(categorie));
  afficher();
  afficherMessage('Budget ' + categorie.nom + ' : ' + euros(budget));
}

$('ajouter-categorie').addEventListener('click', async () => {
  const nom = $('nouvelle-categorie').value.trim();
  const texteBudget = $('nouveau-budget').value.trim();
  const budget = texteBudget === '' ? 0 : lireCentimes(texteBudget);
  const probleme = !nom ? 'Donne un nom à la catégorie.'
    : nomDejaPris(nom, null) ? 'Une catégorie porte déjà ce nom.'
    : budget === null ? 'Indique un budget en euros, par exemple 150 ou 49,90.' : '';
  erreurCategories(probleme);
  if (probleme) return;
  // On commence après 6 pour ne pas hériter des mots-clés d'une catégorie de départ supprimée.
  const id = Math.max(6, ...etat.categories.map((c) => c.id)) + 1;
  const categorie = { id, nom, budget_mensuel: budget };
  etat.categories.push(categorie);
  await ecrire(() => base.categories.add(categorie));
  $('nouvelle-categorie').value = '';
  $('nouveau-budget').value = '';
  remplirListeCategories();
  afficherGestionCategories();
  afficher();
  afficherMessage('Catégorie ajoutée : ' + nom);
});

// Si la catégorie sert encore, on déplace d'abord ses dépenses et ses frais fixes.
async function supprimerCategorie(categorie, remplacementId) {
  if (etat.edition) quitterEdition();
  const lignes = etat.depenses.filter((d) => d.categorie_id === categorie.id);
  const modeles = etat.modeles.filter((m) => m.categorie_id === categorie.id);
  for (const element of [...lignes, ...modeles]) element.categorie_id = remplacementId;
  etat.categories = etat.categories.filter((c) => c !== categorie);
  if (etat.filtre === categorie.id) etat.filtre = 'tout';
  await ecrire(() => base.transaction('rw', base.categories, base.depenses, base.modeles, async () => {
    await base.categories.delete(categorie.id);
    await base.depenses.bulkPut(lignes);
    await base.modeles.bulkPut(modeles);
  }));
  remplirListeCategories();
  afficherGestionCategories();
  afficher();
  afficherMessage('Catégorie supprimée : ' + categorie.nom);
}

function demanderSuppression(categorie, zone) {
  erreurCategories('');
  const utilisee = etat.depenses.some((d) => d.categorie_id === categorie.id) || etat.modeles.some((m) => m.categorie_id === categorie.id);
  if (!utilisee) { supprimerCategorie(categorie, null); return; }

  const cadre = creer('div', 'gestion-suppression');
  const texte = creer('label', '', '« ' + categorie.nom + ' » contient des dépenses. Déplace-les vers :');
  const choix = creer('select');
  choix.id = 'remplacement-' + categorie.id;
  texte.htmlFor = choix.id;
  for (const autre of etat.categories) {
    if (autre !== categorie) choix.append(new Option(autre.nom, String(autre.id)));
  }
  const rangee = creer('div', 'rangee');
  const confirmer = creer('button', 'bouton danger', 'Déplacer et supprimer');
  confirmer.type = 'button';
  confirmer.addEventListener('click', () => supprimerCategorie(categorie, Number(choix.value)));
  const annuler = creer('button', 'bouton leger', 'Annuler');
  annuler.type = 'button';
  annuler.addEventListener('click', () => cadre.remove());
  rangee.append(confirmer, annuler);
  cadre.append(texte, choix, rangee);
  zone.replaceChildren(cadre);
}

function afficherGestionCategories() {
  const liste = $('gestion-liste');
  liste.replaceChildren();
  for (const categorie of etat.categories) {
    const bloc = creer('div');
    const ligne = creer('div', 'gestion-ligne');
    const nom = creer('input');
    nom.id = 'categorie-nom-' + categorie.id;
    nom.value = categorie.nom;
    nom.setAttribute('aria-label', 'Nom de la catégorie ' + categorie.nom);
    nom.addEventListener('change', () => renommerCategorie(categorie, nom));
    const budget = creer('input', 'gestion-budget');
    budget.id = 'categorie-budget-' + categorie.id;
    budget.inputMode = 'decimal';
    budget.value = centimesVersTexte(categorie.budget_mensuel);
    budget.setAttribute('aria-label', 'Budget de ' + categorie.nom);
    budget.addEventListener('change', () => changerBudget(categorie, budget));
    const zone = creer('div');
    ligne.append(nom, budget);
    if (etat.categories.length > 1) { // Il faut toujours garder au moins une catégorie.
      const retirer = creer('button', 'suppr', '×');
      retirer.type = 'button';
      retirer.setAttribute('aria-label', 'Supprimer la catégorie ' + categorie.nom);
      retirer.addEventListener('click', () => demanderSuppression(categorie, zone));
      ligne.append(retirer);
    }
    bloc.append(ligne, zone);
    liste.append(bloc);
  }
}


// ===== 10. L'affichage =====
// Une seule fonction redessine tout à partir de l'état. Après chaque changement, on l'appelle.
function nomCategorie(id) {
  const categorie = etat.categories.find((c) => c.id === id);
  return categorie ? categorie.nom : 'Sans catégorie';
}

// Petit outil pour créer un élément. textContent protège si une description contient du code.
function creer(balise, classe, texte) {
  const element = document.createElement(balise);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  return element;
}

// Écrit un montant avec son signe : +1 850,00 € ou −951,25 €.
function signe(centimes) {
  if (centimes === 0) return euros(0);
  return (centimes < 0 ? '−' : '+') + euros(Math.abs(centimes));
}

function afficher() {
  const bilan = calculerBilan(etat.mois);
  const [annee, mois] = etat.mois.split('-').map(Number);
  const nomDuMois = new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const moisEnCours = etat.mois === cleDuMois(new Date());

  $('mois-nom').textContent = nomDuMois.charAt(0).toUpperCase() + nomDuMois.slice(1);
  $('solde-titre').textContent = moisEnCours ? 'Solde actuel' : 'Solde fin ' + nomDuMois;
  $('total').textContent = euros(bilan.solde);
  $('total').classList.toggle('negatif', bilan.solde < 0);

  // Le solde prévu retire les frais fixes pas encore passés.
  const attendu = fraisAVenir(etat.mois).reduce((total, f) => total + f.modele.montant, 0);
  $('solde-prevu').hidden = attendu === 0;
  $('solde-prevu').textContent = 'Après les frais fixes à venir' + (etat.mois > cleDuMois(new Date()) ? ', sans tes futurs revenus' : '') + ' : ';
  $('solde-prevu').append(creer('strong', '', euros(bilan.solde - attendu)));

  $('ligne-revenus').textContent = signe(bilan.revenus);
  $('ligne-depenses').textContent = signe(-bilan.depenses);
  $('ligne-fixes').textContent = signe(-bilan.fixes);
  $('ligne-epargne').textContent = signe(-bilan.epargneDuMois);
  $('ligne-reste').textContent = signe(bilan.reste);
  $('ligne-reste').classList.toggle('negatif', bilan.reste < 0);

  $('epargne-total').textContent = euros(bilan.epargneTotale);
  $('epargne-evolution').textContent = bilan.epargneDuMois === 0
    ? 'Aucun mouvement ce mois-ci'
    : signe(bilan.epargneDuMois) + ' ce mois-ci';

  const budgetTotal = etat.categories.reduce((total, c) => total + c.budget_mensuel, 0);
  const resteBudget = budgetTotal - bilan.depenses;
  $('reste').className = resteBudget < 0 ? 'postes-resume depasse' : 'postes-resume';
  $('reste').textContent = euros(bilan.depenses) + ' sur ' + euros(budgetTotal) + ' prévus · ';
  $('reste').append(creer('strong', '', resteBudget < 0 ? 'dépassé de ' + euros(-resteBudget) : 'reste ' + euros(resteBudget)));

  const depensesDuMois = deLaCarte(etat.depenses).filter((d) => d.date.startsWith(etat.mois));
  afficherFraisFixes(bilan);
  afficherCategories(depensesDuMois);
  afficherReleve();

  // Vue "Le code" : la dernière ligne de chaque table, telle qu'elle est stockée.
  const derniere = (lignes) => [...lignes].sort((a, b) => b.id - a.id)[0] || null;
  $('apercu-base').textContent = JSON.stringify({
    cartes: derniere(etat.cartes), depenses: derniere(etat.depenses), revenus: derniere(etat.revenus), epargne: derniere(etat.epargne), modeles: derniere(etat.modeles),
  }, null, 2);
}

function afficherCategories(depensesDuMois) {
  const liste = $('postes');
  liste.replaceChildren();
  for (const categorie of etat.categories) {
    const depense = depensesDuMois.filter((d) => d.categorie_id === categorie.id).reduce((s, d) => s + d.montant, 0);
    const depassement = depense - categorie.budget_mensuel;
    // Le plein de la jauge est le budget, ou la dépense si elle le dépasse.
    const plein = Math.max(categorie.budget_mensuel, depense) || 1;
    const fixes = depensesDuMois.filter((d) => d.categorie_id === categorie.id && d.fixe).reduce((s, d) => s + d.montant, 0);

    const bouton = creer('button', 'poste');
    bouton.type = 'button';
    bouton.setAttribute('aria-pressed', String(etat.filtre === categorie.id));
    // Toucher une catégorie filtre le relevé. La toucher à nouveau retire le filtre.
    bouton.addEventListener('click', () => { etat.filtre = etat.filtre === categorie.id ? 'tout' : categorie.id; afficher(); });

    const ligne = creer('span', 'poste-ligne');
    ligne.append(creer('span', 'poste-nom', categorie.nom), creer('span', 'chiffres', euros(depense) + ' / ' + euros(categorie.budget_mensuel)));
    const jauge = creer('span', depassement > 0 ? 'jauge depasse' : 'jauge');
    const partFixe = creer('i', 'part-fixe');
    partFixe.style.width = fixes / plein * 100 + '%';
    const partAutre = creer('i');
    partAutre.style.width = (depense - fixes) / plein * 100 + '%';
    jauge.append(partFixe, partAutre);
    bouton.append(ligne, jauge);
    if (depassement > 0) bouton.append(creer('span', 'mot-depasse', 'Budget dépassé de ' + euros(depassement)));

    const element = creer('li');
    element.append(bouton);
    liste.append(element);
  }
}

function afficherReleve() {
  // On réunit les trois tables en une seule liste, en notant le type de chaque ligne.
  const lignes = [];
  for (const [type, table] of Object.entries(TABLES)) {
    for (const ligne of deLaCarte(etat[table])) {
      if (ligne.date.startsWith(etat.mois)) lignes.push({ type, ligne });
    }
  }
  const filtre = etat.filtre;
  const visibles = lignes
    .filter(({ type, ligne }) => filtre === 'tout' || filtre === type || ligne.categorie_id === filtre || (filtre === 'fixe' && ligne.fixe))
    .sort((a, b) => b.ligne.date.localeCompare(a.ligne.date) || b.ligne.id - a.ligne.id); // Les plus récentes d'abord.

  const filtreCategorie = typeof filtre === 'number';
  $('releve-titre').textContent = filtreCategorie ? nomCategorie(filtre) : 'Opérations du mois';
  $('sans-filtre').hidden = !filtreCategorie;
  $('releve-vide').hidden = visibles.length > 0;
  for (const bouton of document.querySelectorAll('[data-filtre]')) {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.filtre === filtre));
  }

  const liste = $('releve');
  liste.replaceChildren();
  for (const { type, ligne } of visibles) {
    const element = creer('li', ligne.fixe ? 'ecriture fixe' : 'ecriture');
    const jourAffiche = new Date(ligne.date + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const quoi = creer('span', 'quoi', ligne.description);
    const etiquette = type === 'depense' ? nomCategorie(ligne.categorie_id)
      : type === 'revenu' ? 'Revenu'
      : ligne.montant > 0 ? 'Mis de côté' : "Repris de l'épargne";
    const details = creer('span', 'cat', etiquette);
    if (ligne.fixe) details.prepend(creer('span', 'etiquette-fixe', '↻ Fixe'));
    quoi.append(details);

    // Vu depuis le solde : un revenu entre, une dépense sort, un versement d'épargne sort aussi.
    const effet = type === 'revenu' ? ligne.montant : -ligne.montant;

    const bouton = creer('button', 'suppr', '×');
    bouton.type = 'button';
    bouton.setAttribute('aria-label', 'Supprimer ' + ligne.description);
    bouton.addEventListener('click', () => supprimer(type, ligne));
    const actions = creer('span', 'actions');
    const crayon = creer('button', 'modifier', '✎');
    crayon.type = 'button';
    crayon.setAttribute('aria-label', 'Modifier ' + ligne.description);
    crayon.addEventListener('click', () => modifierLigne(type, ligne));
    actions.append(crayon);
    actions.append(bouton);
    element.append(creer('span', 'date', jourAffiche), quoi, creer('span', effet > 0 ? 'somme entree' : 'somme', signe(effet)), actions);
    liste.append(element);
  }
}

function remplirListeCategories() {
  const liste = $('categorie');
  const valeur = liste.value;
  liste.replaceChildren(new Option('Choisir…', ''));
  for (const categorie of etat.categories) liste.append(new Option(categorie.nom, String(categorie.id)));
  liste.value = etat.categories.some((c) => String(c.id) === valeur) ? valeur : '';
}

let minuteurMessage;
function afficherMessage(texte, libelleAction, action) {
  const zone = $('message');
  const bulle = creer('div');
  bulle.append(creer('span', '', texte));
  if (libelleAction) {
    const bouton = creer('button', '', libelleAction);
    bouton.type = 'button';
    bouton.addEventListener('click', action);
    bulle.append(bouton);
  }
  zone.replaceChildren(bulle);
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => zone.replaceChildren(), libelleAction ? 7000 : 3500);
}


// ===== 11. La sauvegarde =====
// Les données ne vivent que sur l'appareil. Ce texte permet de les retrouver si le navigateur est vidé.
$('preparer').addEventListener('click', () => {
  $('texte-sauvegarde').value = JSON.stringify({ cartes: etat.cartes, categories: etat.categories, depenses: etat.depenses, revenus: etat.revenus, epargne: etat.epargne, modeles: etat.modeles }, null, 1);
  $('copier').hidden = false;
});

$('copier').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('texte-sauvegarde').value);
    afficherMessage('Sauvegarde copiée');
  } catch (e) {
    $('texte-sauvegarde').select(); // Copie refusée : on sélectionne le texte pour le copier à la main.
    afficherMessage('Texte sélectionné. Copie-le manuellement.');
  }
});

function lireSauvegarde(texte) {
  let donnees;
  try { donnees = JSON.parse(texte); } catch (e) { throw new Error("Ce texte n'est pas une sauvegarde valide. Colle-la en entier."); }
  if (!Array.isArray(donnees.categories) || !Array.isArray(donnees.depenses) || donnees.categories.length === 0) {
    throw new Error('Il manque les catégories ou les dépenses dans cette sauvegarde.');
  }
  const ids = new Set(donnees.categories.map((c) => c.id));
  const correcte = (d) => Number.isInteger(d.id) && Number.isInteger(d.montant) && d.montant > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.description === 'string' && ids.has(d.categorie_id)
    && (d.fixe === undefined || typeof d.fixe === 'boolean');
  if (!donnees.depenses.every(correcte)) throw new Error("Une dépense de cette sauvegarde est incorrecte. Rien n'a été modifié.");

  // Une sauvegarde faite avant l'ajout des revenus n'a pas ces deux listes : elles sont alors vides.
  const revenus = donnees.revenus || [];
  const epargne = donnees.epargne || [];
  const base_ok = (l) => Number.isInteger(l.id) && Number.isInteger(l.montant) && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && typeof l.description === 'string';
  if (!Array.isArray(revenus) || !Array.isArray(epargne) || !revenus.every((r) => base_ok(r) && r.montant > 0) || !epargne.every((e) => base_ok(e) && e.montant !== 0)) {
    throw new Error("Un revenu ou une opération d'épargne de cette sauvegarde est incorrect. Rien n'a été modifié.");
  }
  // Une sauvegarde sans cartes : tout va sur la carte de départ.
  const cartes = Array.isArray(donnees.cartes) && donnees.cartes.length > 0 ? donnees.cartes : [{ ...CARTE_DE_DEPART }];
  if (!cartes.every((c) => Number.isInteger(c.id) && typeof c.nom === 'string' && c.nom.trim())) {
    throw new Error("Une carte de cette sauvegarde est incorrecte. Rien n'a été modifié.");
  }
  const idsCartes = new Set(cartes.map((c) => c.id));
  for (const ligne of [...donnees.depenses, ...revenus, ...epargne, ...(donnees.modeles || [])]) {
    if (ligne.carte_id === undefined) ligne.carte_id = cartes[0].id;
    if (!idsCartes.has(ligne.carte_id)) throw new Error("Une opération vise une carte inconnue. Rien n'a été modifié.");
  }

  // Une sauvegarde plus ancienne n'a pas de modèles : on les recrée à partir des frais fixes.
  const modeles = donnees.modeles || creerModelesDepuisFixes(donnees.depenses);
  const modeleCorrect = (m) => Number.isInteger(m.id) && Number.isInteger(m.montant) && m.montant > 0
    && Number.isInteger(m.jour) && m.jour >= 1 && m.jour <= 31 && /^\d{4}-\d{2}$/.test(m.dernier_mois)
    && typeof m.description === 'string' && ids.has(m.categorie_id) && typeof m.actif === 'boolean';
  if (!Array.isArray(modeles) || !modeles.every(modeleCorrect)) throw new Error("Un frais fixe de cette sauvegarde est incorrect. Rien n'a été modifié.");
  return { cartes, categories: donnees.categories, depenses: donnees.depenses, revenus, epargne, modeles };
}

function compter(n) { return n + (n > 1 ? ' opérations' : ' opération'); }
function nombreOperations(d) { return d.depenses.length + d.revenus.length + d.epargne.length; }

// Restaurer efface les données actuelles : on demande de confirmer en touchant le bouton une seconde fois.
let attenteConfirmation = false;
function annulerConfirmation() {
  attenteConfirmation = false;
  $('restaurer').textContent = 'Restaurer depuis ce texte';
  $('restaurer').classList.remove('danger');
}
$('texte-sauvegarde').addEventListener('input', annulerConfirmation);

$('restaurer').addEventListener('click', async () => {
  const erreur = $('erreur-sauvegarde');
  erreur.hidden = true;
  let donnees;
  try { donnees = lireSauvegarde($('texte-sauvegarde').value); }
  catch (e) { erreur.textContent = e.message; erreur.hidden = false; return; }

  if (!attenteConfirmation) {
    attenteConfirmation = true;
    $('restaurer').textContent = 'Confirmer : remplacer mes données actuelles (' + compter(nombreOperations(etat)) + ') par cette sauvegarde (' + compter(nombreOperations(donnees)) + ')';
    $('restaurer').classList.add('danger');
    return;
  }
  annulerConfirmation();
  if (etat.edition) quitterEdition();
  await remplacerTout(donnees);
  etat.carte = etat.cartes[0].id;
  remplirListeCartes();
  await genererFraisFixes();
  etat.filtre = 'tout';
  remplirListeCategories();
  afficherGestionCategories();
  afficher();
  afficherMessage('Sauvegarde restaurée : ' + compter(nombreOperations(donnees)));
});


// ===== 12. Les cartes =====
function remplirListeCartes() {
  const liste = $('carte-active');
  liste.replaceChildren();
  for (const carte of etat.cartes) liste.append(new Option(carte.nom, String(carte.id)));
  liste.value = String(etat.carte);
}

$('carte-active').addEventListener('change', () => {
  if (etat.edition) quitterEdition(); // Une modification en cours concerne l'ancienne carte.
  etat.carte = Number($('carte-active').value);
  etat.filtre = 'tout';
  afficher();
});

$('ajouter-carte').addEventListener('click', async () => {
  const nom = $('nom-nouvelle-carte').value.trim();
  const dejaPris = etat.cartes.some((c) => c.nom.toLowerCase() === nom.toLowerCase());
  const probleme = !nom ? 'Donne un nom à la carte.' : dejaPris ? 'Une carte porte déjà ce nom.' : '';
  $('erreur-carte').textContent = probleme;
  $('erreur-carte').hidden = !probleme;
  if (probleme) return;

  const carte = { id: prochainId(etat.cartes), nom };
  etat.cartes.push(carte);
  await ecrire(() => base.cartes.add(carte));

  // On se place tout de suite sur la nouvelle carte.
  if (etat.edition) quitterEdition();
  etat.carte = carte.id;
  etat.filtre = 'tout';
  $('nom-nouvelle-carte').value = '';
  remplirListeCartes();
  afficher();
  afficherMessage('Carte créée : ' + nom);
});


// ===== 13. Le démarrage =====
function changerVue(code) {
  $('vue-budget').hidden = code;
  $('vue-code').hidden = !code;
  $('onglet-budget').setAttribute('aria-pressed', String(!code));
  $('onglet-code').setAttribute('aria-pressed', String(code));
}

// Affiche le code de cette page, découpé selon ses titres "===== ... =====".
// Le fichier est relu depuis le site, ou depuis le téléphone quand il n'y a pas de connexion.
async function afficherLeCode() {
  let source;
  try {
    const reponse = await fetch('js/app.js');
    if (!reponse.ok) throw new Error('Fichier introuvable');
    source = await reponse.text();
  } catch (e) {
    $('sections-code').textContent = 'Le code est dans le fichier js/app.js du projet.';
    return;
  }
  const morceaux = source.split(/^\/\/ =+ (.+?) =+$/m).slice(1);
  for (let i = 0; i < morceaux.length; i += 2) {
    const bloc = creer('details', 'bloc');
    if (i === 0) bloc.open = true;
    const code = creer('pre', '', morceaux[i + 1].trim());
    code.tabIndex = 0;
    bloc.append(creer('summary', '', morceaux[i]), code);
    $('sections-code').append(bloc);
  }
}

// Rend l'appli utilisable sans connexion (voir sw.js).
function preparerInstallation() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Sans service worker, l'appli fonctionne quand même, mais seulement avec une connexion.
    });
  }
  // Demande au navigateur de ne pas effacer les données quand le téléphone manque de place.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

async function demarrer() {
  $('date').value = dateEnTexte(new Date());
  $('mois-avant').addEventListener('click', () => { etat.mois = moisVoisin(etat.mois, -1); afficher(); });
  $('mois-apres').addEventListener('click', () => { etat.mois = moisVoisin(etat.mois, 1); afficher(); });
  $('sans-filtre').addEventListener('click', () => { etat.filtre = 'tout'; afficher(); });
  for (const nom of Object.keys(SAISIES)) $('type-' + nom).addEventListener('click', () => changerTypeSaisie(nom));
  for (const bouton of document.querySelectorAll('[data-filtre]')) {
    bouton.addEventListener('click', () => { etat.filtre = bouton.dataset.filtre; afficher(); });
  }
  $('onglet-budget').addEventListener('click', () => changerVue(false));
  $('onglet-code').addEventListener('click', () => changerVue(true));
  afficherLeCode();

  preparerInstallation();

  base = typeof Dexie === 'undefined' ? null : await ouvrirBase();
  $('annonce-base').hidden = Boolean(base);
  await chargerDonnees();
  const ajoutes = await genererFraisFixes();
  remplirListeCartes();
  remplirListeCategories();
  afficherGestionCategories();
  afficher();
  if (ajoutes > 0) afficherMessage(ajoutes + (ajoutes > 1 ? ' frais fixes ajoutés' : ' frais fixe ajouté') + ' automatiquement');

  // Si l'appli reste ouverte plusieurs jours, on revérifie quand on revient dessus.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (await genererFraisFixes() > 0) afficher();
  });
}

demarrer();
