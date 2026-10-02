import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom has no ResizeObserver (required by react-resizable-panels).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// jsdom has no IntersectionObserver, and shadcn's Message Scroller (@shadcn/react) observes its live edge
// with one. The stub never reports an intersection: scrolling is not tested in jsdom.
class IntersectionObserverStub {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver

// jsdom does not implement `Element.scrollTo`, which the Message Scroller calls to follow the live edge.
// (This file also runs for the node-environment tests of src/main, where there is no `Element`.)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollTo ??= function scrollTo(): void {}
}

afterEach(() => {
  cleanup()
})
