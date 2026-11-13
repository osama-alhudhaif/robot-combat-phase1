import { parse } from 'acorn';

export interface SyntaxIssue { line: number; column: number; message: string; pos: number }

/** Checks a program for syntax errors without running any of it. */
export function checkSyntax(code: string): SyntaxIssue | null {
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    return null;
  } catch (e: any) {
    return { line: e.loc?.line ?? 1, column: e.loc?.column ?? 0, pos: e.pos ?? 0, message: String(e.message ?? e).replace(/\s*\(\d+:\d+\)$/, '') };
  }
}
