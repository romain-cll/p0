# Coque UI de l'app desktop

## User story
En tant que développeur qui pilote Claude Code et d'autres CLI, je veux une app desktop avec un layout en 4 colonnes (projets, historique des chats, chat actif, artifacts/diff), afin d'avoir la structure de navigation sur laquelle brancher les CLI ensuite.

## Critères d'acceptation
- [ ] CA1 — Étant donné l'app lancée, quand la fenêtre principale s'ouvre, alors elle affiche 4 colonnes de gauche à droite : rail des projets (icônes), historique des chats, chat actif, panneau Artifacts/Diff.
- [ ] CA2 — Étant donné l'app lancée, quand la fenêtre s'ouvre, alors le rail affiche une icône par projet fictif (3 projets), le premier projet est sélectionné, la colonne historique affiche ses chats et aucun chat n'est sélectionné.
- [ ] CA3 — Étant donné un projet sélectionné, quand je clique sur l'icône d'un autre projet, alors cette icône passe à l'état sélectionné, l'ancienne ne l'est plus, la colonne historique affiche les titres des chats de ce projet et uniquement eux, et aucun chat n'est sélectionné.
- [ ] CA4 — Étant donné la liste des chats d'un projet, quand je clique sur un chat, alors il passe à l'état sélectionné et le chat sélectionné auparavant ne l'est plus.
- [ ] CA5 — Étant donné n'importe quel projet et n'importe quel chat sélectionnés (ou aucun), quand je regarde la colonne chat actif, alors elle affiche l'empty state « Aucun message pour l'instant » et aucun message.
- [ ] CA6 — Étant donné la zone de saisie en bas du chat actif, quand je tape du texte, alors le texte s'affiche dans la zone ; le bouton d'envoi reste désactivé, et ni un clic dessus ni la touche Entrée n'ajoutent de message ni ne vident la zone.
- [ ] CA7 — Étant donné n'importe quel état de l'app, quand je regarde le panneau Artifacts/Diff, alors il affiche l'empty state « Aucun artifact ni diff » et aucun autre contenu.
- [ ] CA8 — Étant donné la poignée située entre le chat actif et le panneau Artifacts/Diff, quand je la fais glisser horizontalement, alors la largeur du panneau suit le curseur et le chat actif occupe l'espace restant, sans que le panneau descende sous 320 px ni que le chat actif descende sous 360 px.
- [ ] CA9 — Étant donné la fenêtre de l'app, quand je la redimensionne, alors elle ne descend pas sous 1024 × 640 px, et le chat actif ne descend jamais sous 360 px (le panneau Artifacts/Diff rétrécit, jusqu'à 320 px minimum).
- [ ] CA10 — Étant donné macOS réglé en mode sombre (resp. clair), quand l'app démarre, alors elle s'affiche en thème sombre (resp. clair) ; et quand je change ce réglage pendant que l'app tourne, alors le thème bascule sans redémarrage.

## Hors scope
- Branchement de Claude Code ou de tout autre CLI : aucun processus lancé.
- Envoi de message, affichage de messages, réponses.
- Statut des chats (non lus, en cours, épinglés) : les points bleus du croquis sont ignorés.
- Contenu du panneau Artifacts/Diff (artifacts, diff git, onglets).
- Projets et chats réels : ajout, suppression, renommage, persistance de l'historique.
- Mémorisation entre deux lancements (largeur du panneau, projet ou chat sélectionné).
- Redimensionnement ou masquage du rail et de la colonne historique.
- Version navigateur.
- Builds Windows / Linux, packaging, signature, notarisation, installeur.

## Contraintes
- App desktop Electron, validée sur macOS.
- Ordre des colonnes conforme au croquis : rail des projets à gauche, panneau Artifacts/Diff à droite.
- Style visuel inspiré de l'app Codex d'OpenAI : colonnes présentées comme des panneaux à coins arrondis séparés par un espacement (cf. croquis), bordures fines, palette neutre, police système, un seul accent couleur.
- Données fictives en dur : 3 projets, chacun avec 3 à 7 chats aux titres distincts. L'icône d'un projet affiche l'initiale de son nom.
- Stack d'interface demandée par Romain : React + shadcn/ui. TanStack est à évaluer par l'architect : comparer TanStack Router, TanStack Start et l'absence de routeur dans le contexte Electron (avec la version web future en tête), et dire si TanStack Query a sa place dans cette US. Il doit recommander une option, que Romain tranche. Le reste de la stack (bundler, outillage de test, structure du projet) revient à l'architect et doit être validé par Romain.
- Le code de l'interface ne dépend pas directement des API Electron, afin de pouvoir le servir plus tard dans un navigateur. La version web elle-même reste hors scope.
- Git : gitflow `main` → `dev` → branches `feat/`, `fix/`, `docs/`, `chore/`… créées depuis `dev`, PR vers `dev`. Messages au format Conventional Commits.

## Plan technique
_À compléter par l'architect._

## Décisions
- 2026-10-01 — Dépôt public `romain-cll/p0` sur GitHub ; livraison par PR via `gh` (validée par Romain)
- 2026-10-01 — Gitflow `main` → `dev` → `feat/` `fix/` `docs/`… et Conventional Commits (validée par Romain)
- 2026-10-01 — Push direct, force-push et suppression interdits sur `main` et `dev` (ruleset GitHub `protect-main-dev`, sans exception) ; PR obligatoire, 0 approbation requise (validée par Romain)
- 2026-10-01 — Première US limitée à la coque UI avec données fictives, aucun CLI branché (validée par Romain)
- 2026-10-01 — Cible : Electron desktop seul, pas de version navigateur (validée par Romain)
- 2026-10-01 — Thème clair + sombre, aligné sur le réglage macOS (validée par Romain)
- 2026-10-01 — Chat actif toujours en empty state ; saisie possible, envoi bloqué (validée par Romain)
- 2026-10-01 — Panneau Artifacts/Diff en empty state (validée par Romain)
- 2026-10-01 — Statut des chats (points bleus) retiré de l'US (validée par Romain)
