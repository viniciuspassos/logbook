// Finds every function-like node in a TS/TSX source with its line span, using the
// TypeScript compiler API, so diffCoverage can tell which functions a diff touched.
import ts from 'typescript'

export interface FnSpan {
  name: string
  /** Line of the function's name (or of the arrow/expression itself); what istanbul calls `decl`. */
  startLine: number
  /** Column of the same position; breaks ties between functions starting on one line. */
  startColumn: number
  endLine: number
  /** First line including decorators and modifiers: an edit there still modifies the function. */
  firstLine: number
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

/** A readable name: its own, else the variable/property it is assigned to, else a placeholder. */
function nameOf(node: FunctionLike): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (node.name) return node.name.getText()
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText()
  }
  return '(anonymous)'
}

export function findFunctions(sourceText: string, fileName: string): FnSpan[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind)
  const spans: FnSpan[] = []
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body) {
      const lineOf = (position: number) => source.getLineAndCharacterOfPosition(position).line + 1
      const anchor = (node.name ?? node).getStart(source)
      spans.push({
        name: nameOf(node),
        startLine: lineOf(anchor),
        startColumn: source.getLineAndCharacterOfPosition(anchor).character,
        endLine: lineOf(node.getEnd()),
        firstLine: lineOf(node.getStart(source)),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return spans
}

/** Functions whose span contains at least one changed line. */
export function modifiedFunctions(spans: FnSpan[], changed: Set<number>): FnSpan[] {
  return spans.filter((span) => {
    for (let line = span.firstLine; line <= span.endLine; line++) {
      if (changed.has(line)) return true
    }
    return false
  })
}
