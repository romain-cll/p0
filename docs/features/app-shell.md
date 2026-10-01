# Coque UI de l'app desktop

## User story
En tant que développeur qui pilote Claude Code et d'autres CLI, je veux une app desktop avec un layout en 4 colonnes (projets, historique des chats, chat actif, artifacts/diff), afin d'avoir la structure de navigation sur laquelle brancher les CLI ensuite.

## Critères d'acceptation
- [x] CA1 — Étant donné l'app lancée, quand la fenêtre principale s'ouvre, alors elle affiche 4 colonnes de gauche à droite : rail des projets (icônes), historique des chats, chat actif, panneau Artifacts/Diff.
- [x] CA2 — Étant donné l'app lancée, quand la fenêtre s'ouvre, alors le rail affiche une icône par projet fictif (3 projets), le premier projet est sélectionné, la colonne historique affiche ses chats et aucun chat n'est sélectionné.
- [x] CA3 — Étant donné un projet sélectionné, quand je clique sur l'icône d'un autre projet, alors cette icône passe à l'état sélectionné, l'ancienne ne l'est plus, la colonne historique affiche les titres des chats de ce projet et uniquement eux, et aucun chat n'est sélectionné.
- [x] CA4 — Étant donné la liste des chats d'un projet, quand je clique sur un chat, alors il passe à l'état sélectionné et le chat sélectionné auparavant ne l'est plus.
- [x] CA5 — Étant donné n'importe quel projet et n'importe quel chat sélectionnés (ou aucun), quand je regarde la colonne chat actif, alors elle affiche l'empty state « Aucun message pour l'instant » et aucun message.
- [x] CA6 — Étant donné la zone de saisie en bas du chat actif, quand je tape du texte, alors le texte s'affiche dans la zone et la touche Entrée y insère un retour à la ligne ; le bouton d'envoi reste désactivé, et ni un clic dessus ni la touche Entrée n'ajoutent de message ni ne vident la zone.
- [x] CA7 — Étant donné n'importe quel état de l'app, quand je regarde le panneau Artifacts/Diff, alors il affiche l'empty state « Aucun artifact ni diff » et aucun autre contenu.
- [x] CA8 — Étant donné la poignée située entre le chat actif et le panneau Artifacts/Diff, quand je la fais glisser horizontalement, alors la largeur du panneau suit le curseur et le chat actif occupe l'espace restant, sans que le panneau descende sous 320 px ni que le chat actif descende sous 360 px.
- [x] CA9 — Étant donné la fenêtre de l'app, quand je la redimensionne, alors la fenêtre entière (barre de titre comprise) ne descend pas sous 1024 × 640 px ; quand elle rétrécit, le panneau Artifacts/Diff garde sa largeur et le chat actif se réduit jusqu'à 360 px, puis seulement ensuite le panneau se réduit, jusqu'à 320 px minimum.
- [x] CA10 — Étant donné macOS réglé en mode sombre (resp. clair), quand l'app démarre, alors elle s'affiche en thème sombre (resp. clair) ; et quand je change ce réglage pendant que l'app tourne, alors le thème bascule sans redémarrage.

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
- Barre de titre intégrée façon Codex (boutons de fenêtre au-dessus du rail) : future US de finition.
- Lint, formatage, CI : future US `chore/` dédiée.
- TanStack (Router, Start, Query) : à réévaluer quand la version web ou des données asynchrones seront spécifiées.
- En-têtes de colonne, bouton « nouveau chat » et tout élément non exigé par les CA.

## Contraintes
- App desktop Electron, validée sur macOS.
- Ordre des colonnes conforme au croquis `docs/features/app-shell-sketch.png` : rail des projets à gauche, panneau Artifacts/Diff à droite. Les points bleus du croquis sont ignorés (cf. Hors scope).
- Dimensions : fenêtre de 1280 × 800 px au lancement, rail de 56 px, historique de 240 px, espacements de 8 px, panneau Artifacts/Diff de 400 px au lancement.
- Accent couleur : bleu, uniquement sur l'icône du projet sélectionné et sur l'anneau de focus. Le chat sélectionné est surligné dans une teinte neutre.
- Composants : privilégier les composants shadcn/ui. Remplacer un composant shadcn existant par un composant maison exige la validation de Romain.
- Style visuel inspiré de l'app Codex d'OpenAI : colonnes présentées comme des panneaux à coins arrondis séparés par un espacement (cf. croquis), bordures fines, palette neutre, police système, un seul accent couleur.
- Données fictives en dur : 3 projets, chacun avec 3 à 7 chats. Les titres sont distincts au sein d'un même projet, mais un même titre peut apparaître dans deux projets différents. L'icône d'un projet affiche l'initiale de son nom.
- Stack d'interface demandée par Romain : React + shadcn/ui. TanStack est à évaluer par l'architect : comparer TanStack Router, TanStack Start et l'absence de routeur dans le contexte Electron (avec la version web future en tête), et dire si TanStack Query a sa place dans cette US. Il doit recommander une option, que Romain tranche. Le reste de la stack (bundler, outillage de test, structure du projet) revient à l'architect et doit être validé par Romain.
- Le code de l'interface ne dépend pas directement des API Electron, afin de pouvoir le servir plus tard dans un navigateur. La version web elle-même reste hors scope.
- Git : gitflow `main` → `dev` → branches `feat/`, `fix/`, `docs/`, `chore/`… créées depuis `dev`, PR vers `dev`. Messages au format Conventional Commits.

## Plan technique
### Approche
Electron (dernière stable 44.x) outillé par electron-vite, avec un process main et un renderer, sans preload. Le renderer tourne en sandbox et n'a accès à aucune API Electron, ce qui garantit la portabilité web dès la conception. Le renderer est en React 19 + TypeScript + Tailwind v4 + shadcn/ui. La sélection projet/chat est un état local d'`App` (deux `useState`), les données sont en dur, sans routeur ni TanStack Query. La poignée chat/panneau utilise shadcn Resizable avec des bornes en px. Le thème passe uniquement par la media query `prefers-color-scheme`, sans JS. Les comportements sont testés avec Vitest + Testing Library, le layout, la fenêtre et le thème avec Playwright Electron.

### Fichiers
- créé : /Users/romain/projects/p0/package.json — dépendances, `"main": "./out/main/index.js"`, scripts `dev` (`electron-vite dev`), `build` (`electron-vite build`), `start` (`electron-vite preview`), `typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), `test` (`vitest run`), `test:e2e` (`electron-vite build && playwright test`)
- créé : /Users/romain/projects/p0/package-lock.json — généré par npm
- créé : /Users/romain/projects/p0/electron.vite.config.ts — sections `main` et `renderer` seulement (pas de `preload`), plugins `@vitejs/plugin-react` et `@tailwindcss/vite`, alias `@` → `src/renderer/src`
- créé : /Users/romain/projects/p0/tsconfig.json, /Users/romain/projects/p0/tsconfig.node.json, /Users/romain/projects/p0/tsconfig.web.json — références main/configs et renderer ; `paths` `@/*` dans tsconfig.json et tsconfig.web.json, nécessaire à la CLI shadcn
- créé : /Users/romain/projects/p0/components.json — config shadcn (alias `@/components`, `@/lib/utils`, CSS `src/renderer/src/index.css`)
- créé : /Users/romain/projects/p0/vitest.config.ts — environnement jsdom, plugin React, alias `@`, setup, include `src/renderer/**/*.test.{ts,tsx}`
- créé : /Users/romain/projects/p0/playwright.config.ts — `testDir: 'e2e'`, `workers: 1`, sans navigateur à installer (Playwright utilise le binaire `electron`)
- créé : /Users/romain/projects/p0/.gitignore — `node_modules`, `out`, `test-results`, `playwright-report`
- créé : /Users/romain/projects/p0/src/main/index.ts — `BrowserWindow` 1280 × 800, `minWidth: 1024`, `minHeight: 640`, `show: false` puis affichage sur `ready-to-show`, charge `ELECTRON_RENDERER_URL` en dev et `../renderer/index.html` en build ; aucun preload, sécurité Electron par défaut (contextIsolation, sandbox)
- créé : /Users/romain/projects/p0/src/renderer/index.html — point d'entrée HTML, meta CSP, `#root`
- créé : /Users/romain/projects/p0/src/renderer/src/main.tsx — montage React
- créé : /Users/romain/projects/p0/src/renderer/src/App.tsx — layout 4 colonnes et état de sélection (`projectId`, `chatId`)
- créé : /Users/romain/projects/p0/src/renderer/src/index.css — Tailwind v4 et tokens shadcn ; variante `dark` et tokens sombres sous `@media (prefers-color-scheme: dark)` ; `color-scheme: light dark` ; police système
- créé : /Users/romain/projects/p0/src/renderer/src/data/projects.ts — 3 projets fictifs aux initiales distinctes, 3 à 7 chats chacun, titres tous distincts
- créé : /Users/romain/projects/p0/src/renderer/src/data/projects.test.ts — vérifie que les données fictives respectent la spec
- créé : /Users/romain/projects/p0/src/renderer/src/components/ProjectRail.tsx — rail d'icônes (initiale, `aria-label` = nom du projet, `aria-current` sur le projet sélectionné)
- créé : /Users/romain/projects/p0/src/renderer/src/components/ChatHistory.tsx — liste des titres de chats du projet (`aria-current` sur le chat sélectionné)
- créé : /Users/romain/projects/p0/src/renderer/src/components/ActiveChat.tsx — empty state « Aucun message pour l'instant », textarea non contrôlé, bouton d'envoi `disabled`
- créé : /Users/romain/projects/p0/src/renderer/src/components/ArtifactsPanel.tsx — empty state « Aucun artifact ni diff »
- créé : /Users/romain/projects/p0/src/renderer/src/components/ui/button.tsx, textarea.tsx, resizable.tsx — générés par `npx shadcn@latest add button textarea resizable`
- créé : /Users/romain/projects/p0/src/renderer/src/lib/utils.ts — `cn`, généré par shadcn
- créé : /Users/romain/projects/p0/src/renderer/src/test/setup.ts — `@testing-library/jest-dom`, stub `ResizeObserver` (absent de jsdom)
- créé : /Users/romain/projects/p0/src/renderer/src/App.test.tsx — tests composant CA1 à CA7, titres préfixés par l'identifiant du CA
- créé : /Users/romain/projects/p0/e2e/app.spec.ts — e2e Electron CA1, CA8, CA9, CA10, titres préfixés par l'identifiant du CA
- modifié : /Users/romain/projects/p0/docs/features/app-shell.md — section « Plan technique » (par le PO)

### Tâches (ordonnées)
1. `chore:` socle Electron. Crée package.json, electron.vite.config.ts (main + renderer), les tsconfig et .gitignore. Écrit src/main/index.ts (fenêtre 1280 × 800, minimum 1024 × 640, `ready-to-show`) et un renderer minimal. Contrôle : `npm run dev` ouvre une fenêtre vide. — couvre CA9 (taille mini), socle de CA1
2. `chore:` Tailwind v4 + shadcn/ui. Init avec Radix, couleur de base Neutral, style compact, police système (retirer toute police web ajoutée par le preset), puis ajout de button, textarea et resizable. Dans index.css, la variante `dark` et les tokens sombres passent sous `@media (prefers-color-scheme: dark)`. — couvre CA10
3. `chore:` outillage de test. vitest.config.ts + setup.ts, playwright.config.ts, scripts `test` et `test:e2e`, test e2e de fumée (la fenêtre s'ouvre). — socle de tous les CA
4. `feat:` données fictives dans data/projects.ts et leur test unitaire. — couvre CA2
5. `feat:` layout 4 colonnes dans App. Quatre régions nommées (`aria-label` : « Projets », « Historique des chats », « Chat actif », « Artifacts et diff »). Rail fixe de 56 px, historique fixe de 240 px, espacements de 8 px, panneaux à coins arrondis et bordure fine. `ResizablePanelGroup` horizontal : chat (`minSize={360}`), séparateur dans l'espace de 8 px, panneau (`minSize={320}`, `defaultSize={400}`, `groupResizeBehavior="preserve-pixel-size"`). Écrire tout de suite l'e2e CA9 pour lever le risque n°1. — couvre CA1, CA8, CA9
6. `feat:` ProjectRail + ChatHistory et état de sélection dans App. Au départ `projectId` = premier projet et `chatId = null` ; changer de projet remet `chatId` à `null` ; l'élément sélectionné porte `aria-current="true"`. Tests composant dans la même tâche. — couvre CA2, CA3, CA4
7. `feat:` ActiveChat. Empty state ; textarea non contrôlé (Entrée garde le comportement natif) ; bouton d'envoi `disabled` avec icône lucide et `aria-label="Envoyer"`, sans handler. Tests composant. — couvre CA5, CA6
8. `feat:` ArtifactsPanel, avec l'empty state comme seul contenu. Test composant. — couvre CA7
9. `test:` e2e Playwright Electron : ordre des colonnes, glisser la poignée, taille mini et bornes, thème au démarrage et bascule à chaud. — couvre CA1, CA8, CA9, CA10
10. Vérification manuelle sur macOS, inscrite en checklist de PR : redimensionner la fenêtre à la souris ; basculer Réglages Système > Apparence avec l'app ouverte ; revue visuelle du style Codex en clair et en sombre. — couvre CA9, CA10 et les contraintes de style

### Stratégie de test
- Commandes (à la racine /Users/romain/projects/p0, après `npm install`) :
  - `npm test` lance les tests unitaires et composant (`vitest run`, sans build).
  - `npm run test:e2e` lance les e2e Electron (`electron-vite build && playwright test`), sur macOS en session graphique.
  - Pour filtrer un CA : `npx vitest run -t "CA3"` ou `npx playwright test -g "CA8"`.
  - Types : `npm run typecheck`.
- CA1 → composant + e2e Electron.
  - Composant : les 4 régions nommées existent dans l'ordre du DOM.
  - E2E : les 4 régions sont visibles et leur `boundingBox().x` croît strictement de gauche à droite.
- CA2 → unitaire + composant.
  - Unitaire : 3 projets, initiales distinctes, 3 à 7 chats par projet, titres distincts.
  - Composant : 3 boutons de projet affichent leur initiale ; seul le premier a `aria-current` ; l'historique liste exactement les titres du projet 1 ; aucun chat n'a `aria-current`.
- CA3 → composant. On sélectionne un chat du projet 1, puis on clique le projet 2. Seul le projet 2 a `aria-current` ; la liste affichée est égale aux titres du projet 2 (ni plus, ni moins) ; aucun chat n'est sélectionné. Le test est répété pour le projet 3.
- CA4 → composant. Un clic sur le chat A puis sur le chat B laisse `aria-current` sur B seulement.
- CA5 → composant. On boucle sur chaque projet × (aucun chat, puis chaque chat). La région « Chat actif » affiche « Aucun message pour l'instant » et ne contient aucun élément de message (aucun `listitem`).
- CA6 → composant (user-event). Après saisie de « bonjour », le textarea contient « bonjour » et le bouton « Envoyer » est `disabled`. Après un clic sur le bouton puis la touche Entrée, la zone n'est pas vidée (elle contient toujours « bonjour ») et aucun message n'apparaît (l'empty state reste affiché).
- CA7 → composant. Après changement de projet, sélection de chat et saisie, le `textContent` de la région « Artifacts et diff » vaut exactement « Aucun artifact ni diff ».
- CA8 → e2e Electron. On drague le `separator` à la souris (`page.mouse`) :
  - vers la gauche de 100 px : le panneau s'élargit de 100 px (±1) et le bord droit du chat + 8 px = bord gauche du panneau ;
  - tout à droite : le panneau vaut 320 px ;
  - tout à gauche : le chat vaut 360 px.
  - Ce CA ne peut pas être testé en jsdom, qui n'a pas de layout.
- CA9 → e2e Electron + manuel. Ce CA est difficile à automatiser, car le redimensionnement réel se fait au niveau de l'OS.
  - Via `electronApp.evaluate`, `setSize(800, 500)` doit donner `getSize()` = `[1024, 640]` et `getMinimumSize()` = `[1024, 640]`.
  - Panneau élargi à 500 px puis fenêtre ramenée à 1024 : chat = 360 px et panneau ≥ 320 px.
  - Contrôle manuel : redimensionnement par le coin de la fenêtre.
- CA10 → e2e Electron + manuel. Ce CA est difficile à automatiser, car le vrai réglage macOS ne se pilote pas proprement depuis un test.
  - Démarrage : deux lancements avec `electron.launch({ colorScheme: 'dark' | 'light' })`. Le `background-color` calculé de `body` doit égaler le token `--background` du thème attendu.
  - Bascule à chaud : sans émulation, on pose un marqueur sur `window`, puis `nativeTheme.themeSource = 'dark'` puis `'light'` via `electronApp.evaluate`. Le fond change à chaque fois et le marqueur subsiste, ce qui prouve l'absence de rechargement.
  - Preuve finale, manuelle : bascule de Réglages Système > Apparence avec l'app ouverte. Un `osascript` est possible mais modifie le réglage réel du poste ; non retenu.

### Décisions à valider
- Routeur et TanStack — options : A. pas de routeur / B. TanStack Router / C. TanStack Start — recommandation : A. L'US n'a qu'un écran et la sélection projet/chat est un état local non persisté (la persistance est hors scope) : deux `useState` suffisent, sans dépendance.
  - B : routes typées et search params, utiles le jour où la sélection devra vivre dans l'URL (deep link, précédent/suivant en version web). En Electron, le renderer est chargé en `file://`, ce qui impose `createHashHistory` ou `createMemoryHistory` côté desktop et `createBrowserHistory` côté web ([doc history](https://tanstack.com/router/latest/docs/framework/react/guide/history-types)). Coût aujourd'hui : une dépendance et un arbre de routes pour un seul écran, sans aucun CA de plus couvert. La migration ultérieure reste locale (App devient le composant de route).
  - C : framework full-stack (SSR, server functions, server routes), encore en Release Candidate. Même en mode SPA, les server functions exigent un serveur déployé ([doc SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)). En Electron, il faudrait un serveur HTTP dans le process main à la place de l'IPC : un surcoût sans bénéfice pour le desktop. À réévaluer seulement quand la version web sera spécifiée, si elle a besoin d'un backend pour lancer les CLI.
- TanStack Query dans cette US — options : A. absent / B. présent — recommandation : A. Les données sont en dur et synchrones : il n'y a ni cache, ni chargement, ni invalidation à gérer. Query deviendra utile quand projets et historiques viendront d'une source asynchrone (IPC en desktop, HTTP en web).
- Outillage Electron — options : A. electron-vite 5 / B. Electron Forge + plugin Vite / C. Vite pour le renderer + `tsc` et scripts maison pour main (sans outillage Electron dédié) — recommandation : A, mis en place à la main.
  - Avec A, le renderer reste une app Vite standard et la config est minimale.
  - B apporte surtout packaging et makers, hors scope ; C impose de maintenir des scripts de dev (relance de main, URL du serveur de dev).
  - Pas de template `npm create @quick-start/electron` : il embarque electron-builder, electron-updater, un preload et ESLint/Prettier, tous hors scope.
- Structure du dépôt — options : A. package unique `src/main` + `src/renderer` / B. monorepo (`packages/ui`, `apps/desktop`) — recommandation : A. B ne sert que la version web, hors scope. L'absence de preload suffit à garantir que l'UI ne dépend pas d'Electron.
- Primitives shadcn/ui — options : A. Radix / B. Base UI / C. React Aria ([CLI shadcn](https://ui.shadcn.com/docs/cli)) — recommandation : A, la base la plus éprouvée ; l'impact est quasi nul ici (Button, Textarea, Resizable). Style compact (preset Nova ou Mira, cf. [shadcn create](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)), couleur de base Neutral, police système (pile `ui-sans-serif, system-ui` de Tailwind, aucune police web).
- Poignée de redimensionnement — options : A. shadcn Resizable, qui ajoute la dépendance react-resizable-panels v4 (tailles en px et `groupResizeBehavior="preserve-pixel-size"`, cf. [README](https://github.com/bvaughn/react-resizable-panels)) / B. splitter maison d'environ 40 lignes (pointer events + `clamp()` CSS), sans dépendance — recommandation : A, le composant de la stack demandée, qui fournit le rôle `separator` et le redimensionnement au clavier. B sert de repli si le risque n°1 se confirme.
- Thème système — options : A. CSS seul (variante `dark` et tokens sous `@media (prefers-color-scheme: dark)`) / B. ThemeProvider shadcn (classe `.dark` posée en JS) — recommandation : A.
  - Avec A : aucun JS, pas de flash au démarrage, et la bascule à chaud est native, car Electron aligne `prefers-color-scheme` sur macOS ([nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)).
  - B ne suit pas les changements à chaud sans ajouter un écouteur `matchMedia` ([doc shadcn](https://ui.shadcn.com/docs/dark-mode/vite)).
- Outillage de test — options : A. Vitest + Testing Library + jsdom pour les comportements, Playwright Electron pour le layout, la fenêtre et le thème / B. Playwright Electron seul (cinq dépendances de moins, mais build et lancement d'Electron à chaque exécution) / C. Vitest en mode navigateur à la place de jsdom — recommandation : A.
  - CA2 à CA7 sont de la logique de renderer, testable en quelques secondes sans build.
  - CA1, CA8, CA9 et CA10 exigent un vrai layout et une vraie fenêtre ([Playwright Electron](https://playwright.dev/docs/api/class-electron)).
- Gestionnaire de paquets — options : A. npm / B. pnpm — recommandation : A, aucun outil en plus et pas de friction avec le binaire Electron.
- Dépendances (toutes nouvelles, le projet est vierge) — recommandation : valider la liste telle quelle.
  - Runtime : react, react-dom, et celles qu'induit shadcn/ui (radix-ui, class-variance-authority, clsx, tailwind-merge, lucide-react, tw-animate-css, react-resizable-panels).
  - Dev : electron 44.x ([releases](https://releases.electronjs.org/)), electron-vite, vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom, @types/node, tailwindcss, @tailwindcss/vite, vitest, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, @playwright/test.
  - Alternatives sans dépendance : voir les lignes ci-dessus (splitter maison, Playwright seul, scripts maison). lucide-react est remplaçable par un SVG inline pour l'unique icône d'envoi.
- Lint, formatage, CI — options : A. hors de cette US / B. ESLint + Prettier + GitHub Actions sur runner macOS — recommandation : A, car aucun CA ne l'exige ; à traiter dans une US `chore/` dédiée.
- Barre de titre — options : A. barre macOS standard / B. barre intégrée façon Codex (`titleBarStyle: 'hiddenInset'`, feux tricolores au-dessus du rail, zones de drag en CSS) — recommandation : A, car aucun CA ne l'exige et B ajoute des zones de drag à gérer ; B est faisable dans une US de finition.
- Dimensions par défaut (absentes de la spec) — proposition : fenêtre initiale 1280 × 800, rail 56 px, historique 240 px, espacements 8 px, panneau Artifacts/Diff à 400 px au lancement — recommandation : valider ces valeurs. Contrainte : à 1024 px de large, 8 + 56 + 8 + 240 + 8 + 360 + 8 + 320 + 8 = 1016 px, donc l'historique ne peut pas dépasser 248 px sans violer CA9.
- Ambiguïté spec, CA9 : qui cède quand la fenêtre rétrécit ? — options : A. le panneau garde sa largeur et le chat absorbe jusqu'à 360 px, puis le panneau rétrécit jusqu'à 320 px / B. les deux rétrécissent proportionnellement dans leurs bornes — recommandation : A, cohérent avec CA8 (« le chat actif occupe l'espace restant »). Autre point : le minimum de 1024 × 640 s'entend-il fenêtre entière, barre de titre comprise (défaut Electron) ? Recommandation : oui.
- Ambiguïté spec, CA6 : que fait Entrée dans la zone ? — options : A. elle insère un retour à la ligne (comportement natif du textarea, aucun code) / B. elle ne fait rien — recommandation : A. Les deux satisfont le CA tel qu'il est écrit ; le futur « Entrée = envoyer » se décidera avec l'US d'envoi.
- Ambiguïté spec, croquis : la spec y renvoie (ordre des colonnes, panneaux arrondis, espacements), mais il n'est pas dans le dépôt — options : A. le versionner à côté de la spec avant l'implémentation (ex. `docs/features/app-shell-sketch.png`) / B. s'en passer — recommandation : A. Sans croquis, la coque n'affiche que ce que les CA exigent : pas d'en-tête de colonne, pas de bouton « nouveau chat ».
- Ambiguïté spec, accent couleur : quelle couleur, et sur quels éléments ? — options : A. bleu, réservé à l'icône du projet sélectionné et à l'anneau de focus, avec le chat sélectionné en surbrillance neutre / B. une autre couleur ou un autre usage, au choix de Romain — recommandation : A.

### Risques
- Comportement de react-resizable-panels v4 non vérifié : quand le groupe rétrécit, un panneau en `preserve-pixel-size` doit céder jusqu'à 320 px une fois le chat à son minimum. L'e2e CA9, écrit dès la tâche 5, le révèle tôt ; repli : splitter maison.
- La CLI shadcn peut mal gérer l'arborescence electron-vite (`src/renderer/src`, plusieurs tsconfig) : détection du framework ou des alias. Repli : installation manuelle documentée par shadcn. Vérifier aussi que le preset n'installe pas de police web.
- jsdom n'a ni layout ni `ResizeObserver` : un stub est prévu dans le setup, et aucune taille n'est vérifiée en test composant (tout passe en e2e).
- Le support Electron de Playwright est « experimental ». L'émulation `colorScheme` peut masquer la bascule `nativeTheme.themeSource`. Repli : `page.emulateMedia` ; la vérification manuelle sur macOS reste la preuve finale.
- Le clamp de `BrowserWindow.setSize` sous la taille mini est attendu sur macOS mais pas confirmé. Le test vérifie aussi `getMinimumSize()`, et le redimensionnement à la souris reste manuel.
- Les e2e exigent une session macOS graphique. Sans CI prévue, il faut les lancer en local avant chaque PR.
- electron-vite 5 exige Node 20.19+ ou 22.12+ et Vite 5+. Épingler une version de Vite supportée si la dernière majeure ne l'est pas encore.

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
- 2026-10-01 — Plan technique : toutes les recommandations de l'architect retenues (validée par Romain) :
  - ni TanStack Router, ni Start, ni Query dans cette US ;
  - outillage electron-vite ;
  - un seul package (`src/main` + `src/renderer`), sans preload ;
  - shadcn/ui sur Radix, palette Neutral, police système ;
  - thème géré en CSS seul (`prefers-color-scheme`) ;
  - tests avec Vitest, Testing Library et Playwright Electron ;
  - npm comme gestionnaire de paquets ;
  - barre de titre macOS standard ;
  - dimensions, accent couleur, CA6 (Entrée) et CA9 (ordre de réduction) précisés dans la spec.
- 2026-10-01 — Poignée : shadcn Resizable. Le séparateur maison n'est pas un repli automatique : si Resizable ne tient pas CA8/CA9, on remonte à Romain (validée par Romain)
- 2026-10-01 — Preset de style shadcn : Mira (validée par Romain)
- 2026-10-01 — Titres de chats uniques au sein d'un projet seulement, pas d'un projet à l'autre ; test CA2 corrigé en conséquence (validée par Romain)
- 2026-10-01 — Tests CA6 corrigés côté test, sans changer les assertions : en jsdom, Resizable capte les clics et empêche la saisie. Aucun contournement dans l'app (validée par Romain)
- 2026-10-01 — electron-vite 5 stable avec Vite 7 épinglé, plutôt que la bêta 6 (validée par Romain)
