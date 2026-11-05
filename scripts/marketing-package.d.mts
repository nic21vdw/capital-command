export type PackageProblem = { file: string; line: number; kind: string; match: string };
export const PACKAGE_NAME: string;
export const OWNER_ONLY_PATHS: string[];
export const LEAK_TERMS: RegExp[];
export const SECRET_PATTERNS: RegExp[];
export function isOwnerOnly(file: string): boolean;
export function findLeaks(file: string, text: string): PackageProblem[];
export function auditPackage(root: string): PackageProblem[];
export function trimPackageScripts(
  pkg: { name?: string; scripts?: Record<string, string> } & Record<string, unknown>,
  root: string
): { name: string; private: true; scripts: Record<string, string> } & Record<string, unknown>;
export function stagePackage(options: { repo: string; out: string; ref?: string }): PackageProblem[];
