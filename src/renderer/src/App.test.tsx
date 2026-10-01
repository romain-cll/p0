import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { projects } from './data/projects'

// Contrats supposés (cf. plan technique, tâches 5 à 8) :
// - `App` est l'export par défaut de ./App ;
// - `projects` (./data/projects) : { name: string; chats: { title: string }[] }[] ;
// - quatre régions (role "region") nommées par aria-label ;
// - projets et chats sont des `button` ; l'élément sélectionné porte aria-current="true" ;
// - le bouton d'envoi est un `button` nommé « Envoyer ».

const REGION_NAMES = ['Projets', 'Historique des chats', 'Chat actif', 'Artifacts et diff'] as const

const EMPTY_CHAT = "Aucun message pour l'instant"
const EMPTY_ARTIFACTS = 'Aucun artifact ni diff'

const region = (name: (typeof REGION_NAMES)[number]): HTMLElement =>
  screen.getByRole('region', { name })

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

const isCurrent = (element: HTMLElement): boolean => element.getAttribute('aria-current') === 'true'

const projectButton = (index: number): HTMLElement =>
  within(region('Projets')).getByRole('button', { name: projects[index].name })

const chatButton = (title: string): HTMLElement =>
  within(region('Historique des chats')).getByRole('button', { name: title })

const displayedChatTitles = (): string[] =>
  within(region('Historique des chats'))
    .getAllByRole('button')
    .map((button) => (button.textContent ?? '').trim())

const titlesOf = (index: number): string[] => projects[index].chats.map((chat) => chat.title)

const sorted = (values: string[]): string[] => [...values].sort()

const selectedChatCount = (): number =>
  within(region('Historique des chats'))
    .getAllByRole('button')
    .filter(isCurrent).length

describe('CA1 — layout en 4 colonnes', () => {
  it('CA1 — affiche les 4 régions nommées dans l’ordre du DOM : projets, historique, chat actif, artifacts', () => {
    render(<App />)

    const elements = REGION_NAMES.map((name) => region(name))

    for (let i = 0; i < elements.length - 1; i++) {
      const position = elements[i].compareDocumentPosition(elements[i + 1])
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

describe('CA2 — état initial', () => {
  it('CA2 — le rail affiche un bouton par projet fictif (3), avec son initiale', () => {
    render(<App />)

    const buttons = within(region('Projets')).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    projects.forEach((project, index) => {
      expect(projectButton(index)).toHaveTextContent(initialOf(project.name))
      expect(buttons[index]).toBe(projectButton(index))
    })
  })

  it('CA2 — seul le premier projet est sélectionné', () => {
    render(<App />)

    expect(isCurrent(projectButton(0))).toBe(true)
    expect(isCurrent(projectButton(1))).toBe(false)
    expect(isCurrent(projectButton(2))).toBe(false)
  })

  it('CA2 — l’historique affiche exactement les chats du premier projet et aucun n’est sélectionné', () => {
    render(<App />)

    expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(0)))
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA3 — changer de projet', () => {
  it.each([1, 2])(
    'CA3 — cliquer le projet %i sélectionne son icône, affiche ses chats seuls, sans chat sélectionné',
    async (target) => {
      const user = userEvent.setup()
      render(<App />)

      // un chat du projet 1 est sélectionné avant de changer de projet
      await user.click(chatButton(titlesOf(0)[0]))
      expect(selectedChatCount()).toBe(1)

      await user.click(projectButton(target))

      projects.forEach((_, index) => {
        expect(isCurrent(projectButton(index))).toBe(index === target)
      })
      expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(target)))
      expect(selectedChatCount()).toBe(0)
    }
  )

  it('CA3 — revenir au projet 1 réaffiche ses chats seuls, sans chat sélectionné', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(projectButton(1))
    await user.click(chatButton(titlesOf(1)[0]))
    await user.click(projectButton(0))

    expect(isCurrent(projectButton(0))).toBe(true)
    expect(isCurrent(projectButton(1))).toBe(false)
    expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(0)))
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA4 — sélectionner un chat', () => {
  it('CA4 — cliquer le chat A puis le chat B laisse seul B sélectionné', async () => {
    const user = userEvent.setup()
    render(<App />)
    const [titleA, titleB] = titlesOf(0)

    await user.click(chatButton(titleA))
    expect(isCurrent(chatButton(titleA))).toBe(true)
    expect(selectedChatCount()).toBe(1)

    await user.click(chatButton(titleB))
    expect(isCurrent(chatButton(titleB))).toBe(true)
    expect(isCurrent(chatButton(titleA))).toBe(false)
    expect(selectedChatCount()).toBe(1)
  })
})

describe('CA5 — chat actif toujours vide', () => {
  it('CA5 — affiche l’empty state et aucun message, quel que soit le projet et le chat (ou aucun)', async () => {
    const user = userEvent.setup()
    render(<App />)

    const expectEmptyChat = (): void => {
      const chat = region('Chat actif')
      expect(within(chat).getByText(EMPTY_CHAT)).toBeInTheDocument()
      expect(within(chat).queryAllByRole('listitem')).toHaveLength(0)
    }

    expectEmptyChat() // état initial : projet 1, aucun chat
    for (let index = 0; index < projects.length; index++) {
      await user.click(projectButton(index)) // projet sans chat sélectionné
      expectEmptyChat()
      for (const title of titlesOf(index)) {
        await user.click(chatButton(title))
        expectEmptyChat()
      }
    }
  })
})

describe('CA6 — zone de saisie', () => {
  const sendButton = (): HTMLElement =>
    within(region('Chat actif')).getByRole('button', { name: 'Envoyer' })
  const textarea = (): HTMLElement => within(region('Chat actif')).getByRole('textbox')

  it('CA6 — le texte tapé s’affiche dans la zone et le bouton Envoyer est désactivé', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(sendButton()).toBeDisabled()
    await user.type(textarea(), 'bonjour')

    expect(textarea()).toHaveValue('bonjour')
    expect(sendButton()).toBeDisabled()
  })

  it('CA6 — la touche Entrée insère un retour à la ligne dans la zone', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(textarea(), 'bonjour{Enter}monde')

    expect(textarea()).toHaveValue('bonjour\nmonde')
  })

  it('CA6 — ni un clic sur Envoyer ni Entrée n’ajoutent de message ni ne vident la zone', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(textarea(), 'bonjour')

    await user.click(sendButton())
    expect(textarea()).toHaveValue('bonjour')
    expect(sendButton()).toBeDisabled()

    await user.keyboard('{Enter}')
    // Entrée n'envoie rien : la zone garde « bonjour » (au plus suivi d'un retour à la ligne)
    expect((textarea() as HTMLTextAreaElement).value.startsWith('bonjour')).toBe(true)

    const chat = region('Chat actif')
    expect(within(chat).getByText(EMPTY_CHAT)).toBeInTheDocument()
    expect(within(chat).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(chat).queryByText('bonjour')).not.toBeInTheDocument()
  })
})

describe('CA7 — panneau Artifacts/Diff', () => {
  it('CA7 — n’affiche que l’empty state, au démarrage', () => {
    render(<App />)

    expect(region('Artifacts et diff').textContent).toBe(EMPTY_ARTIFACTS)
  })

  it('CA7 — n’affiche que l’empty state après changement de projet, sélection de chat et saisie', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(projectButton(1))
    await user.click(chatButton(titlesOf(1)[0]))
    await user.type(within(region('Chat actif')).getByRole('textbox'), 'bonjour')

    expect(region('Artifacts et diff').textContent).toBe(EMPTY_ARTIFACTS)
  })
})
