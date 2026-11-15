// Minimal declarations for the two CommonJS SPDX helpers used by check-licences.

declare module 'spdx-expression-parse' {
  export type SpdxNode =
    | { license: string; plus?: true; exception?: string }
    | { left: SpdxNode; conjunction: 'and' | 'or'; right: SpdxNode };
  export default function parse(expression: string): SpdxNode;
}

declare module 'spdx-satisfies' {
  export default function satisfies(expression: string, approved: string[]): boolean;
}
