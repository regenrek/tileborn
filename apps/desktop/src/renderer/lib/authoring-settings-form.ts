/**
 * Generic mechanism for plugin-contributed authoring settings forms. Mirrors the
 * catalog-driven palette projection / player-model policy precedent: a game-mode
 * plugin DECLARES its settings fields + how to (de)serialize and validate a
 * draft, and the generic editor inspector RENDERS the form purely from that
 * declaration — never naming any plugin-specific field. The plugin owns the
 * field set, labels, per-field UI hints, and the parse/validate policy.
 */
export interface AuthoringSettingsFieldDescriptor {
  /** Field key within the settings object (also the draft + test-id key). */
  readonly key: string;
  readonly label: string;
  /** Minimum value surfaced to the numeric input. */
  readonly min: number;
  /** Numeric input step (per-field UI hint owned by the contribution). */
  readonly step: number;
}

export interface AuthoringSettingsForm<TSettings> {
  readonly fields: readonly AuthoringSettingsFieldDescriptor[];
  /** Convert a typed settings object into a string draft keyed by field. */
  readonly toDraft: (settings: TSettings) => Record<string, string>;
  /**
   * Parse + validate a string draft back into a typed settings object. Returns
   * `undefined` when the draft is invalid (the editor then blocks the save).
   */
  readonly parseDraft: (draft: Record<string, string>) => TSettings | undefined;
  /** Message shown when {@link parseDraft} rejects the current draft. */
  readonly invalidMessage: string;
}
