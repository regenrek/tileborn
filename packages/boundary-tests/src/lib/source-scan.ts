import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });

/**
 * Source text of a parsed file with all comments removed, produced by reprinting
 * the parsed AST. Used by token scans (forbidden literals, ambient entropy,
 * balance numbers) so a token mentioned only in a JSDoc/`//` comment — e.g. a
 * rule that documents "no `Math.random` here" — does not count as a violation.
 * String, numeric, and template literals are preserved, so a real `Math.random`
 * call or a `damage = 25` literal in *code* still trips the scan.
 */
export const sourceWithoutComments = (sourceFile: ts.SourceFile): string =>
  printer.printFile(sourceFile);
