import type { ReactNode } from 'react';
import { createElement } from 'react';

/** Subsequence indices used by cmdk-style fuzzy matching. */
export function fuzzyMatchIndices(text: string, query: string): readonly number[] | null {
  if (!query.trim()) {
    return [];
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  const indices: number[] = [];
  let queryIndex = 0;
  for (
    let textIndex = 0;
    textIndex < lowerText.length && queryIndex < lowerQuery.length;
    textIndex += 1
  ) {
    if (lowerText[textIndex] === lowerQuery[queryIndex]) {
      indices.push(textIndex);
      queryIndex += 1;
    }
  }
  return queryIndex === lowerQuery.length ? indices : null;
}

export function highlightFuzzyMatch(text: string, query: string): ReactNode {
  const indices = fuzzyMatchIndices(text, query);
  if (!indices || indices.length === 0) {
    return text;
  }
  const highlightSet = new Set(indices);
  const parts: ReactNode[] = [];
  let chunk = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (highlightSet.has(index)) {
      if (chunk) {
        parts.push(chunk);
        chunk = '';
      }
      parts.push(
        createElement(
          'span',
          {
            key: `match-${index}`,
            className:
              'font-semibold text-primary underline decoration-primary/40 underline-offset-2',
          },
          char,
        ),
      );
    } else {
      chunk += char;
    }
  }
  if (chunk) {
    parts.push(chunk);
  }
  return parts;
}

export function focusAdjacentCommandGroup(
  listRoot: HTMLElement | null,
  direction: 'next' | 'previous',
): void {
  if (!listRoot) {
    return;
  }
  const itemSelector = '[cmdk-item]:not([aria-disabled="true"])';
  const groups = Array.from(listRoot.querySelectorAll<HTMLElement>('[cmdk-group]')).filter(
    (group) => group.querySelector(itemSelector),
  );
  if (groups.length === 0) {
    return;
  }
  const selectedItem = listRoot.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
  const currentGroupIndex = selectedItem
    ? groups.findIndex((group) => group.contains(selectedItem))
    : -1;
  const startIndex =
    currentGroupIndex === -1
      ? direction === 'next'
        ? 0
        : groups.length - 1
      : direction === 'next'
        ? (currentGroupIndex + 1) % groups.length
        : (currentGroupIndex - 1 + groups.length) % groups.length;
  for (let offset = 0; offset < groups.length; offset += 1) {
    const group = groups[(startIndex + offset) % groups.length];
    if (!group) {
      continue;
    }
    const item = group.querySelector<HTMLElement>(itemSelector);
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
      item.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      item.focus();
      return;
    }
  }
}

export function rankRecentCommands(
  recentCommandIds: readonly string[],
  commandUseCounts: Readonly<Record<string, number>>,
  limit = 6,
): readonly string[] {
  const seen = new Set<string>();
  const ranked: Array<{ id: string; score: number }> = [];
  recentCommandIds.forEach((id, index) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    ranked.push({ id, score: 1_000 - index + (commandUseCounts[id] ?? 0) * 10 });
  });
  for (const [id, count] of Object.entries(commandUseCounts)) {
    if (seen.has(id) || count <= 0) {
      continue;
    }
    seen.add(id);
    ranked.push({ id, score: count * 10 });
  }
  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.id);
}
