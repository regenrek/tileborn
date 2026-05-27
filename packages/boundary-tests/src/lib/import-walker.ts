import fs from "node:fs";
import ts from "typescript";

export type CollectedImport = {
  readonly moduleSpecifier: string;
  readonly line: number;
};

const lineNumber = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const pushStringLiteralImport = (
  imports: CollectedImport[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  literal: ts.StringLiteralLike,
): void => {
  imports.push({
    moduleSpecifier: literal.text,
    line: lineNumber(sourceFile, node),
  });
};

/** Collect static and dynamic import module specifiers from a TypeScript source file. */
export function collectImports(sourceFile: ts.SourceFile): CollectedImport[] {
  const imports: CollectedImport[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      pushStringLiteralImport(imports, sourceFile, node, node.moduleSpecifier);
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      pushStringLiteralImport(imports, sourceFile, node, node.moduleSpecifier);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument !== undefined && ts.isStringLiteral(firstArgument)) {
        pushStringLiteralImport(imports, sourceFile, node, firstArgument);
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const firstArgument = node.arguments[0];
      if (firstArgument !== undefined && ts.isStringLiteral(firstArgument)) {
        pushStringLiteralImport(imports, sourceFile, node, firstArgument);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

export function parseSourceFile(filePath: string): ts.SourceFile {
  const sourceText = fs.readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath));
}

const scriptKindForPath = (filePath: string): ts.ScriptKind => {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};
