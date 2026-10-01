import { describe, expect, it } from 'vitest'
import { projects } from './projects'

// `CA<n>` refers to the acceptance criteria of docs/features/app-shell.md.
// Expected contract: `export const projects: { name: string; chats: { title: string }[] }[]`
const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

describe('mock data', () => {
  it('CA2 — contains exactly 3 projects, each with a non-empty name', () => {
    expect(projects).toHaveLength(3)
    for (const project of projects) {
      expect(project.name.trim()).not.toBe('')
    }
  })

  it('CA2 — the 3 projects have distinct initials', () => {
    const initials = projects.map((project) => initialOf(project.name))
    expect(initials.every((initial) => initial !== '')).toBe(true)
    expect(new Set(initials).size).toBe(3)
  })

  it('CA2 — each project has 3 to 7 chats', () => {
    for (const project of projects) {
      expect(project.chats.length).toBeGreaterThanOrEqual(3)
      expect(project.chats.length).toBeLessThanOrEqual(7)
    }
  })

  it('CA2 — chat titles are non-empty and distinct within each project', () => {
    // The same title may appear in two different projects: uniqueness applies within a project only.
    for (const project of projects) {
      const titles = project.chats.map((chat) => chat.title)
      expect(titles.every((title) => title.trim() !== '')).toBe(true)
      expect(new Set(titles).size).toBe(titles.length)
    }
  })
})
