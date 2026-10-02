// Types of the fake SDK `query` (query.mjs): it lets the unit tests import it under `strict`.
export interface FakeQuery extends AsyncGenerator<Record<string, unknown>, void> {
  interrupt(): Promise<void>
  close(): void
}

export function query(params: { prompt: AsyncIterable<unknown>; options?: Record<string, unknown> }): FakeQuery
