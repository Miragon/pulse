/** Assertions on CLI runs shared by the engine scenarios. */

import { expect } from 'vitest';
import type { CliError, CliResult } from './cli.js';

export function expectExit(result: CliResult, code: number): CliResult {
  expect(result.code, result.diagnostics).toBe(code);
  return result;
}

export function expectSuccess(result: CliResult): CliResult {
  return expectExit(result, 0);
}

/** Asserts a failed run with the given error code and exit code; returns the parsed error. */
export function expectError(result: CliResult, code: string, exitCode: number): CliError {
  expectExit(result, exitCode);
  const error = result.errorJson();
  expect(error, result.diagnostics).toMatchObject({ code, exitCode });
  return error;
}

export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`${what} is missing; an earlier step of the scenario failed`);
  }
  return value;
}
