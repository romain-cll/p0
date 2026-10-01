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
      { title: 'Move the database to PostgreSQL' },
      { title: 'Fix the pagination bug' },
      { title: 'Add a CSV export' },
      { title: 'Review the caching rules' }
    ]
  },
  {
    name: 'Borealis',
    chats: [
      { title: 'Redesign the login page' },
      { title: 'Write the API tests' },
      { title: 'Reduce build time' }
    ]
  },
  {
    name: 'Cobalt',
    chats: [
      { title: 'Prepare the 2.0 release' },
      { title: 'Document the auth module' },
      { title: 'Clean up dependencies' },
      { title: 'Add offline mode' },
      { title: 'Investigate a memory leak' }
    ]
  }
]
