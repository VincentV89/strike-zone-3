/**
 * Pure import-graph checker (check:imports). `analyzeImports(files, table)`
 * parses each file with the TypeScript compiler API and returns every
 * violation at once (business-logic-model, Import-graph check steps 1-12).
 */
import ts from 'typescript';
import {
  AI_PREFIX,
  RING_POLICIES,
  SIM_WORLD_PREFIX,
  type ComponentSpec,
  type EdgeKind,
  type RingPolicy,
} from './component-table';

export interface SourceFile {
  /** Repo-relative path with forward slashes, e.g. `src/core/rng.ts`. */
  path: string;
  text: string;
}

export type ViolationKind =
  | 'undeclared-edge'
  | 'type-edge-used-at-runtime'
  | 'ring-violation'
  | 'contracts-runtime-code'
  | 'perception-bypass'
  | 'cycle'
  | 'unmapped-file'
  | 'unresolved-import'
  | 'package-not-allowed'
  | 'table-invalid';

export interface Violation {
  kind: ViolationKind;
  message: string;
  file?: string;
  line?: number;
  path?: string[];
}

export interface ImportEdge {
  fromFile: string;
  toFile: string | null;
  packageName: string | null;
  fromComponent: string;
  toComponent: string | null;
  kind: EdgeKind;
  line: number;
}

interface RawImport {
  specifier: string;
  kind: EdgeKind;
  line: number;
}

const ASSET_EXTENSIONS = /\.(css|svg|png|jpe?g|gif|webp|json|wasm|glb|ktx2)(\?.*)?$/;

export function componentOf(path: string, table: readonly ComponentSpec[]): ComponentSpec | null {
  let best: ComponentSpec | null = null;
  let bestLen = -1;
  for (const c of table) {
    for (const p of c.prefixes) {
      if ((path === p || path.startsWith(`${p}/`)) && p.length > bestLen) {
        best = c;
        bestLen = p.length;
      }
    }
  }
  return best;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function importDeclKind(node: ts.ImportDeclaration): EdgeKind {
  const clause = node.importClause;
  if (clause === undefined) return 'R'; // side-effect import
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return 'T';
  if (clause.name !== undefined) return 'R';
  const bindings = clause.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return 'R';
  const elements = bindings.elements;
  return elements.length > 0 && elements.every((e) => e.isTypeOnly) ? 'T' : 'R';
}

function exportDeclKind(node: ts.ExportDeclaration): EdgeKind {
  if (node.isTypeOnly) return 'T';
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return 'R';
  return clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly) ? 'T' : 'R';
}

function collectImports(sf: ts.SourceFile): RawImport[] {
  const out: RawImport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({
        specifier: node.moduleSpecifier.text,
        kind: importDeclKind(node),
        line: lineOf(sf, node),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push({
        specifier: node.moduleSpecifier.text,
        kind: exportDeclKind(node),
        line: lineOf(sf, node),
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      out.push({
        specifier: node.moduleReference.expression.text,
        kind: node.isTypeOnly ? 'T' : 'R',
        line: lineOf(sf, node),
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push({ specifier: node.arguments[0].text, kind: 'R', line: lineOf(sf, node) });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      out.push({ specifier: node.argument.literal.text, kind: 'T', line: lineOf(sf, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function normalizePath(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function resolveRelative(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const dir = fromFile.split('/').slice(0, -1);
  const base = normalizePath([...dir, ...specifier.split('/')]);
  const candidates = [base, `${base}.ts`, `${base}/index.ts`];
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
  return candidates.find((c) => known.has(c)) ?? null;
}

function packageAllowed(specifier: string, policy: RingPolicy | undefined): boolean {
  if (policy === undefined) return false;
  return policy.allowedPackages.some((allowed) =>
    allowed.endsWith('/*') ? specifier.startsWith(allowed.slice(0, -1)) : specifier === allowed,
  );
}

/** A contracts file may hold only types, type-only imports/exports, contracts re-exports and `as const` tables. */
function contractsRuntimeStatements(
  sf: ts.SourceFile,
  path: string,
  known: ReadonlySet<string>,
  table: readonly ComponentSpec[],
): number[] {
  const bad: number[] = [];
  const contractsId = componentOf(path, table)?.id;
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
    if (ts.isImportDeclaration(st) && importDeclKind(st) === 'T') continue;
    if (ts.isExportDeclaration(st)) {
      if (exportDeclKind(st) === 'T') continue;
      const spec = st.moduleSpecifier;
      if (spec !== undefined && ts.isStringLiteral(spec) && spec.text.startsWith('.')) {
        const target = resolveRelative(path, spec.text, known);
        if (target !== null && componentOf(target, table)?.id === contractsId) continue;
      }
    }
    if (isAsConstTable(st)) continue;
    bad.push(lineOf(sf, st));
  }
  return bad;
}

function isAsConstTable(st: ts.Statement): boolean {
  if (!ts.isVariableStatement(st)) return false;
  const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
  if (!exported || !isConst || st.declarationList.declarations.length !== 1) return false;
  const init = st.declarationList.declarations[0]?.initializer;
  if (init === undefined || !ts.isAsExpression(init)) return false;
  const isConstAssertion =
    ts.isTypeReferenceNode(init.type) &&
    ts.isIdentifier(init.type.typeName) &&
    init.type.typeName.text === 'const';
  return (
    isConstAssertion &&
    (ts.isArrayLiteralExpression(init.expression) || ts.isObjectLiteralExpression(init.expression))
  );
}

/** Tarjan's strongly connected components over an adjacency map. */
export function stronglyConnected(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];

  const strong = (v: string): void => {
    indices.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  };

  for (const v of graph.keys()) if (!indices.has(v)) strong(v);
  return result;
}

function cycleViolations(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  label: string,
): Violation[] {
  return stronglyConnected(graph)
    .filter((scc) => scc.length > 1)
    .map((scc) => {
      const path = [...scc].sort();
      return { kind: 'cycle', message: `${label} cycle: ${path.join(' <-> ')}`, path };
    });
}

/** Table self-check: deps name real components, no self-edges, declared graph acyclic. */
export function checkTable(table: readonly ComponentSpec[]): Violation[] {
  const out: Violation[] = [];
  const ids = new Set(table.map((c) => c.id));
  if (ids.size !== table.length)
    out.push({ kind: 'table-invalid', message: 'duplicate component id' });
  const graph = new Map<string, Set<string>>();
  for (const c of table) {
    const targets = new Set<string>();
    for (const dep of Object.keys(c.deps)) {
      if (!ids.has(dep))
        out.push({ kind: 'table-invalid', message: `${c.id} depends on unknown ${dep}` });
      if (dep === c.id) out.push({ kind: 'table-invalid', message: `${c.id} depends on itself` });
      targets.add(dep);
    }
    graph.set(c.id, targets);
  }
  for (const v of cycleViolations(graph, 'declared table'))
    out.push({ ...v, kind: 'table-invalid' });
  return out;
}

export function analyzeImports(
  files: readonly SourceFile[],
  table: readonly ComponentSpec[],
): Violation[] {
  const violations: Violation[] = [...checkTable(table)];
  const known = new Set(files.map((f) => f.path));
  const byId = new Map(table.map((c) => [c.id, c]));
  const actual = new Map<string, Set<string>>();

  for (const file of files) {
    const from = componentOf(file.path, table);
    if (from === null) {
      violations.push({
        kind: 'unmapped-file',
        message: `${file.path} maps to no component`,
        file: file.path,
      });
      continue;
    }
    const sf = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const policy = RING_POLICIES.find((p) => p.ring === from.ring);

    if (from.id === 'contracts') {
      for (const line of contractsRuntimeStatements(sf, file.path, known, table)) {
        violations.push({
          kind: 'contracts-runtime-code',
          message: `${file.path}:${String(line)} contracts may hold only types and as-const tables`,
          file: file.path,
          line,
        });
      }
    }

    for (const imp of collectImports(sf)) {
      const at = { file: file.path, line: imp.line };
      if (!imp.specifier.startsWith('.')) {
        if (imp.specifier.startsWith('node:') || !packageAllowed(imp.specifier, policy)) {
          const kind: ViolationKind =
            from.ring === 'sim' ? 'ring-violation' : 'package-not-allowed';
          violations.push({
            kind,
            message: `${file.path}:${String(imp.line)} imports package '${imp.specifier}', not allowed in the ${from.ring} ring`,
            ...at,
          });
        }
        continue;
      }
      if (ASSET_EXTENSIONS.test(imp.specifier)) {
        if (from.ring === 'sim') {
          violations.push({
            kind: 'ring-violation',
            message: `${file.path}:${String(imp.line)} sim-ring file imports asset '${imp.specifier}'`,
            ...at,
          });
        }
        continue;
      }
      const target = resolveRelative(file.path, imp.specifier, known);
      if (target === null) {
        violations.push({
          kind: 'unresolved-import',
          message: `${file.path}:${String(imp.line)} cannot resolve '${imp.specifier}'`,
          ...at,
        });
        continue;
      }
      const to = componentOf(target, table);
      if (to === null || to.id === from.id) continue; // unmapped target is reported on its own

      if (
        file.path.startsWith(`${AI_PREFIX}/`) &&
        (target === `${SIM_WORLD_PREFIX}.ts` || target.startsWith(`${SIM_WORLD_PREFIX}/`))
      ) {
        violations.push({
          kind: 'perception-bypass',
          message: `${file.path}:${String(imp.line)} bot AI must not import the sim world (ADR-005); use bot-perception`,
          ...at,
        });
      }
      if (from.ring === 'sim' && byId.get(to.id)?.ring !== 'sim') {
        violations.push({
          kind: 'ring-violation',
          message: `${file.path}:${String(imp.line)} sim-ring ${from.id} imports ${to.ring}-ring ${to.id}`,
          ...at,
        });
      }

      const declared = from.deps[to.id];
      if (declared === undefined) {
        violations.push({
          kind: 'undeclared-edge',
          message: `${file.path}:${String(imp.line)} ${from.id} -> ${to.id} is not declared`,
          ...at,
        });
      } else if (declared === 'T' && imp.kind === 'R') {
        violations.push({
          kind: 'type-edge-used-at-runtime',
          message: `${file.path}:${String(imp.line)} ${from.id} -> ${to.id} is declared type-only but imported at runtime`,
          ...at,
        });
      }

      const targets = actual.get(from.id) ?? new Set<string>();
      targets.add(to.id);
      actual.set(from.id, targets);
    }
  }

  violations.push(...cycleViolations(actual, 'component'));
  return violations;
}
