export interface Chat {
  title: string
}

export interface Project {
  name: string
  chats: Chat[]
}

export const projects: Project[] = [
  {
    name: 'Atlas',
    chats: [
      { title: 'Migrer la base vers PostgreSQL' },
      { title: 'Corriger le bug de pagination' },
      { title: 'Ajouter un export CSV' },
      { title: 'Revoir les règles de cache' }
    ]
  },
  {
    name: 'Borealis',
    chats: [
      { title: 'Refondre la page de connexion' },
      { title: 'Écrire les tests de l’API' },
      { title: 'Optimiser le temps de build' }
    ]
  },
  {
    name: 'Cobalt',
    chats: [
      { title: 'Préparer la release 2.0' },
      { title: 'Documenter le module d’auth' },
      { title: 'Nettoyer les dépendances' },
      { title: 'Ajouter le mode hors ligne' },
      { title: 'Diagnostiquer une fuite mémoire' }
    ]
  }
]
