export interface EditorHistory<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export type EditorHistoryAction<T> =
  | { readonly type: 'commit'; readonly value: T }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'reset'; readonly value: T };

export const createEditorHistory = <T>(value: T): EditorHistory<T> => ({
  past: [],
  present: value,
  future: [],
});

export const reduceEditorHistory = <T>(
  state: EditorHistory<T>,
  action: EditorHistoryAction<T>,
): EditorHistory<T> => {
  if (action.type === 'reset') return createEditorHistory(action.value);
  if (action.type === 'commit') {
    if (Object.is(action.value, state.present)) return state;
    return { past: [...state.past, state.present].slice(-100), present: action.value, future: [] };
  }
  if (action.type === 'undo') {
    const present = state.past.at(-1);
    return present === undefined
      ? state
      : { past: state.past.slice(0, -1), present, future: [state.present, ...state.future] };
  }
  const present = state.future[0];
  return present === undefined
    ? state
    : { past: [...state.past, state.present].slice(-100), present, future: state.future.slice(1) };
};
