/**
 * Pure utility functions for building glob patterns used in file scanning.
 * All functions are free of VSCode API / side effects — fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Default exclude lists
// ---------------------------------------------------------------------------

/** Default exclude patterns for Mapper scanning. */
export const MAPPER_DEFAULT_EXCLUDE = [
  '**/node_modules/**', '**/target/**', '**/build/**', '**/out/**', '**/dist/**',
  '.git/**', '**/.gradle/**', '**/src/test/**', '**/src/test-**/**',
] as const;

/** Default exclude patterns for Dataset scanning. */
export const DATASET_DEFAULT_EXCLUDE = [
  '**/node_modules/**', '**/target/**', '**/build/**', '**/dist/**',
  '**/out/**', '.git/**', '**/.gradle/**',
] as const;

// ---------------------------------------------------------------------------
// makeGlob
// ---------------------------------------------------------------------------

/**
 * Build a single glob pattern from one or more folder patterns and a file
 * extension glob (e.g. '*.java').
 *
 * Each folder pattern emits two sub-patterns:
 *   - `folder/ext`        — direct children
 *   - `folder/**\/ext`    — all descendants
 *
 * This avoids missing files directly in the folder on some glob engines.
 * Trailing slashes and trailing `/**` or `/*` are stripped before expansion
 * so that `*\/mapper/**` and `*\/mapper` produce identical output.
 */
export function makeGlob(folders: string[], ext: string): string {
  const patterns: string[] = [];
  for (const f of folders) {
    const p = f.replace(/\\/g, '/').replace(/\/+$/, '').replace(/\/\*+$/, '');
    if (p.endsWith('*')) {
      // Still a wildcard after stripping — keep as-is (e.g. "**/mapper*")
      patterns.push(`${p}/${ext}`);
    } else {
      patterns.push(`${p}/${ext}`);
      patterns.push(`${p}/**/${ext}`);
    }
  }
  return patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;
}

// ---------------------------------------------------------------------------
// buildExcludeGlob
// ---------------------------------------------------------------------------

/**
 * Combine default exclude parts with user-supplied extra patterns into a
 * single brace-expansion glob string.
 *
 * User-supplied patterns are appended after the defaults.  Since VSCode's
 * findFiles applies the exclude as a single pattern, all entries are equally
 * authoritative — the resulting string excludes anything matched by either
 * the defaults or the user's extras.
 */
export function buildExcludeGlob(
  defaultParts: readonly string[],
  extraPatterns: string[]
): string {
  const all = [...defaultParts, ...extraPatterns];
  return `{${all.join(',')}}`;
}
