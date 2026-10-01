import { describe, expect, it } from 'vitest'
import { projects } from './projects'

// Contrat attendu : `export const projects: { name: string; chats: { title: string }[] }[]`
const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

describe('données fictives', () => {
  it('CA2 — contient exactement 3 projets, chacun avec un nom non vide', () => {
    expect(projects).toHaveLength(3)
    for (const project of projects) {
      expect(project.name.trim()).not.toBe('')
    }
  })

  it('CA2 — les 3 projets ont des initiales distinctes', () => {
    const initials = projects.map((project) => initialOf(project.name))
    expect(initials.every((initial) => initial !== '')).toBe(true)
    expect(new Set(initials).size).toBe(3)
  })

  it('CA2 — chaque projet a de 3 à 7 chats', () => {
    for (const project of projects) {
      expect(project.chats.length).toBeGreaterThanOrEqual(3)
      expect(project.chats.length).toBeLessThanOrEqual(7)
    }
  })

  it('CA2 — les titres de chats sont non vides et distincts au sein de chaque projet', () => {
    // Un même titre peut apparaître dans deux projets différents : l'unicité ne porte que sur un projet.
    for (const project of projects) {
      const titles = project.chats.map((chat) => chat.title)
      expect(titles.every((title) => title.trim() !== '')).toBe(true)
      expect(new Set(titles).size).toBe(titles.length)
    }
  })
})
