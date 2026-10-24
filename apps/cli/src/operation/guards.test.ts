import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Effect } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import { checkEffect, type GuardOptions } from './guards.js';

const base: GuardOptions = { readOnly: false, yes: false, dryRun: false };
const EFFECTS: readonly Effect[] = ['read', 'write', 'delete', 'bulk'];

function caught(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('checkEffect', () => {
  it('allows read and write without flags', () => {
    expect(() => {
      checkEffect('read', 'operate task list', base);
    }).not.toThrow();
    expect(() => {
      checkEffect('write', 'operate task claim', base);
    }).not.toThrow();
  });

  it.each(['delete', 'bulk'] as const)('requires confirmation for %s', (effect) => {
    const error = caught(() => {
      checkEffect(effect, 'operate process-instance delete', base);
    });
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      `\`operate process-instance delete\` is a ${effect} operation and needs confirmation`,
    );
    expect(error.details).toEqual({
      hint: 'Re-run with --yes to confirm, or --dry-run to preview.',
    });
  });

  it.each(['delete', 'bulk'] as const)('accepts %s with --yes or --dry-run', (effect) => {
    expect(() => {
      checkEffect(effect, 'x', { ...base, yes: true });
    }).not.toThrow();
    expect(() => {
      checkEffect(effect, 'x', { ...base, dryRun: true });
    }).not.toThrow();
  });

  it.each(['write', 'delete', 'bulk'] as const)('refuses %s in read-only mode', (effect) => {
    const error = caught(() => {
      checkEffect(effect, 'operate job set-retries', {
        ...base,
        readOnly: true,
        yes: true,
        readOnlySource: 'profile "prod"',
      });
    });
    expect(error.code).toBe('READ_ONLY');
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      `\`operate job set-retries\` is a ${effect} operation and read-only mode is enabled`,
    );
    expect(error.details).toEqual({
      hint: 'Read-only mode is enabled by profile "prod". Use --dry-run to preview the request.',
    });
  });

  it('explains every read-only source when the source is unknown', () => {
    const error = caught(() => {
      checkEffect('write', 'x', { ...base, readOnly: true });
    });
    expect(error.details.hint).toBe(
      'Read-only mode is enabled (--read-only, OPERATE_READ_ONLY or the profile setting readOnly). Use --dry-run to preview the request.',
    );
  });

  it('checks read-only before confirmation', () => {
    expect(
      caught(() => {
        checkEffect('delete', 'x', { ...base, readOnly: true });
      }).code,
    ).toBe('READ_ONLY');
  });

  it('allows reads in read-only mode and every effect with --dry-run', () => {
    expect(() => {
      checkEffect('read', 'x', { ...base, readOnly: true });
    }).not.toThrow();
    fc.assert(
      fc.property(
        fc.constantFrom(...EFFECTS),
        fc.boolean(),
        fc.boolean(),
        (effect, readOnly, yes) => {
          expect(() => {
            checkEffect(effect, 'x', { readOnly, yes, dryRun: true });
          }).not.toThrow();
        },
      ),
    );
  });

  it('throws exactly when a guard applies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EFFECTS),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (effect, readOnly, yes, dryRun) => {
          const blockedByReadOnly = readOnly && effect !== 'read';
          const needsConfirmation = (effect === 'delete' || effect === 'bulk') && !yes;
          const expected = dryRun
            ? undefined
            : blockedByReadOnly
              ? 'READ_ONLY'
              : needsConfirmation
                ? 'CONFIRMATION_REQUIRED'
                : undefined;
          let code: string | undefined;
          try {
            checkEffect(effect, 'x', { readOnly, yes, dryRun });
          } catch (error) {
            code = (error as OperateError).code;
          }
          expect(code).toBe(expected);
        },
      ),
    );
  });
});
