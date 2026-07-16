export const BEHAVIOR_REFERENCE_DEFAULT_PAGE_SIZE = 32;
export const BEHAVIOR_REFERENCE_MAX_PAGE_SIZE = 64;

export interface PageableBehaviorReferenceOption {
  readonly id: string;
  readonly label: string;
}

export const paginateBehaviorReferenceOptions = <T extends PageableBehaviorReferenceOption>(
  options: readonly T[],
  input: {
    readonly query?: string | undefined;
    readonly offset?: number | undefined;
    readonly limit?: number | undefined;
  },
) => {
  const query = input.query?.trim() ?? '';
  const normalizedQuery = query.toLocaleLowerCase();
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.max(
    1,
    Math.min(BEHAVIOR_REFERENCE_MAX_PAGE_SIZE, Math.trunc(input.limit ?? BEHAVIOR_REFERENCE_DEFAULT_PAGE_SIZE)),
  );
  const matches = options.filter(({ id, label }) =>
      normalizedQuery.length === 0 ||
      id.toLocaleLowerCase().includes(normalizedQuery) ||
      label.toLocaleLowerCase().includes(normalizedQuery),
    );
  return {
    query,
    offset,
    limit,
    total: matches.length,
    options: matches.slice(offset, offset + limit),
  };
};
