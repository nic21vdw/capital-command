export const LADDER_AGREEMENT = 2;

export type Ladder = {
  start(kind: string): number;
  refused(kind: string, index: number, mediaId: string): void;
  accepted(kind: string, index: number): void;
  exhausted(kind: string): boolean;
};

type KindState = { index: number; exhausted: boolean; refusals: Map<number, Set<string>>; proven: Set<number> };

export function createLadder(size: number, agreement: number = LADDER_AGREEMENT): Ladder {
  const kinds = new Map<string, KindState>();

  function stateOf(kind: string): KindState {
    let state = kinds.get(kind);
    if (!state) {
      state = { index: 0, exhausted: false, refusals: new Map(), proven: new Set() };
      kinds.set(kind, state);
    }
    return state;
  }

  return {
    start: (kind) => stateOf(kind).index,
    exhausted: (kind) => stateOf(kind).exhausted,
    refused(kind, index, mediaId) {
      const state = stateOf(kind);
      if (index < state.index || state.proven.has(index)) return;
      const seen = state.refusals.get(index) ?? new Set<string>();
      seen.add(mediaId);
      state.refusals.set(index, seen);
      for (;;) {
        const agreed = state.refusals.get(state.index);
        if (!agreed || agreed.size < agreement) return;
        if (state.index >= size - 1) {
          state.exhausted = state.proven.size === 0;
          return;
        }
        state.index += 1;
      }
    },
    accepted(kind, index) {
      const state = stateOf(kind);
      state.proven.add(index);
      state.refusals.delete(index);
    }
  };
}
