/** Display slug derived from a project name (create dialog preview only). */
export function deriveProjectSlug(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) {
    return 'untitled-project';
  }
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'untitled-project';
}
