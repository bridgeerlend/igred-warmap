import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

export class ValidationFailure extends Error {
  constructor(
    readonly file: string,
    readonly issues: unknown,
  ) {
    super(`${file} failed schema validation:\n${JSON.stringify(issues, null, 2)}`);
    this.name = 'ValidationFailure';
  }
}

/**
 * Reads a published artifact. A file that no longer matches its schema is treated as
 * absent rather than trusted, so a corrupt file cannot poison a run.
 */
export function readArtifact<T extends z.ZodTypeAny>(
  file: string,
  schema: T,
): { value: z.infer<T> } | { value: undefined; reason: 'missing' | 'invalid'; detail?: string } {
  if (!existsSync(file)) return { value: undefined, reason: 'missing' };
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    if (parsed.success) return { value: parsed.data };
    return { value: undefined, reason: 'invalid', detail: JSON.stringify(parsed.error.issues).slice(0, 500) };
  } catch (error) {
    return { value: undefined, reason: 'invalid', detail: (error as Error).message };
  }
}

/**
 * Validates before writing and writes through a temp file, so a crashed run can never
 * leave a half-written or unvalidated artifact behind for the map to fetch.
 */
export function writeArtifact<T extends z.ZodTypeAny>(
  file: string,
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationFailure(file, parsed.error.issues);

  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf-8');
  renameSync(temporary, file);
  return parsed.data;
}
