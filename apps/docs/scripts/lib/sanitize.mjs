/**
 * Neutralize private-product tokens for the public OSS docs site.
 */
export const sanitizePublicDocs = (markdown) => {
  return markdown
    .replace(/\b[Pp]etwars\b/g, 'private product')
    .replace(/\bgrassland\b/g, 'example tile template')
    .replace(/\btiled-source:\b/g, 'legacy:')
    .replace(/\berw\b/g, 'legacy terrain rules')
    .replace(/\bopen-editor\b/g, 'legacy editor packages')
    .replace(/@petwars\/[^\s`]+/g, '@tileborne/*');
};

export const starlightFrontmatter = ({ title, description, sidebar }) => {
  const lines = ['---', `title: ${JSON.stringify(title)}`];
  if (description) {
    lines.push(`description: ${JSON.stringify(description)}`);
  }
  if (sidebar) {
    lines.push(`sidebar:`);
    if (sidebar.order !== undefined) {
      lines.push(`  order: ${sidebar.order}`);
    }
    if (sidebar.label) {
      lines.push(`  label: ${JSON.stringify(sidebar.label)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
};
