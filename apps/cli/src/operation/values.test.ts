import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { DATE_TIME_HINT } from './dates.js';
import { convertScalar } from './values.js';

function caught(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

const INT32 = 'an integer between -2147483648 and 2147483647';
const INT64 = 'an integer between -9223372036854775808 and 9223372036854775807';
const SAFE = 'an integer between -9007199254740991 and 9007199254740991';

describe('convertScalar', () => {
  it('keeps plain strings', () => {
    expect(convertScalar({ type: 'string' }, ' a b ', '--x')).toBe(' a b ');
    expect(convertScalar({ type: 'string' }, '', '--x')).toBe('');
    expect(convertScalar({ type: 'object' }, '{}', '--x')).toBe('{}');
  });

  it('converts integers', () => {
    expect(convertScalar({ type: 'integer' }, '42', '--n')).toBe(42);
    expect(convertScalar({ type: 'integer' }, '-7', '--n')).toBe(-7);
    expect(convertScalar({ type: 'integer' }, '007', '--n')).toBe(7);
    expect(convertScalar({ type: 'integer', format: 'int32' }, '2147483647', '--n')).toBe(
      2147483647,
    );
    expect(convertScalar({ type: 'integer', format: 'int32' }, '-2147483648', '--n')).toBe(
      -2147483648,
    );
    expect(convertScalar({ type: 'integer', format: 'int64' }, '2147483648', '--n')).toBe(
      2147483648,
    );
    expect(convertScalar({ type: 'integer' }, '9007199254740991', '--n')).toBe(9007199254740991);
    expect(convertScalar({ type: 'integer' }, '-9007199254740991', '--n')).toBe(-9007199254740991);
  });

  it('converts int64 values beyond 2^53 exactly, as BigInt', () => {
    const long = { type: 'integer', format: 'int64' };
    expect(convertScalar(long, '9223372036854775807', '--n')).toBe(9223372036854775807n);
    expect(convertScalar(long, '-9223372036854775808', '--n')).toBe(-9223372036854775808n);
    expect(convertScalar(long, '-9007199254740992', '--n')).toBe(-9007199254740992n);
    expect(convertScalar({ type: 'integer', format: 'int16' }, '-32768', '--n')).toBe(-32768);
  });

  it.each([
    ['1.5', undefined, 'an integer'],
    ['', undefined, 'an integer'],
    [' 1', undefined, 'an integer'],
    ['1e3', undefined, 'an integer'],
    ['0x10', undefined, 'an integer'],
    ['abc', 'int32', 'an integer'],
    ['9007199254740992', undefined, SAFE],
    ['9223372036854775808', 'int64', INT64],
    ['2147483648', 'int32', INT32],
    ['-2147483649', 'int32', INT32],
  ])('rejects the integer %j (format %s)', (raw, format, expected) => {
    const spec = format === undefined ? { type: 'integer' } : { type: 'integer', format };
    const error = caught(() => convertScalar(spec, raw, '--max-results'));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(`--max-results expects ${expected}, got "${raw}"`);
    expect(error.details).toEqual({});
  });

  it('adds the given hint to type errors', () => {
    const error = caught(() => convertScalar({ type: 'number' }, 'x', '--var a', 'Example: a'));
    expect(error.details.hint).toBe('Example: a');
  });

  it('accepts every int32 integer for int32 and rejects the rest', () => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }), (n) => {
        expect(convertScalar({ type: 'integer', format: 'int32' }, String(n), '--n')).toBe(n);
      }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 2 ** 31, max: Number.MAX_SAFE_INTEGER }),
        fc.boolean(),
        (n, negative) => {
          const raw = String(negative ? -n - 1 : n);
          expect(() => convertScalar({ type: 'integer', format: 'int32' }, raw, '--n')).toThrow(
            OperateError,
          );
        },
      ),
    );
  });

  it('converts numbers', () => {
    expect(convertScalar({ type: 'number' }, '1.5', '--x')).toBe(1.5);
    expect(convertScalar({ type: 'number' }, '-3', '--x')).toBe(-3);
    expect(convertScalar({ type: 'number' }, '1e3', '--x')).toBe(1000);
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        expect(convertScalar({ type: 'number' }, String(x), '--x')).toBe(Number(String(x)));
      }),
    );
  });

  it.each(['', '  ', 'abc', 'Infinity', '-Infinity', 'NaN'])('rejects the number %j', (raw) => {
    expect(caught(() => convertScalar({ type: 'number' }, raw, '--x')).message).toBe(
      `--x expects a number, got "${raw}"`,
    );
  });

  it('converts booleans case-insensitively', () => {
    expect(convertScalar({ type: 'boolean' }, 'true', '--b')).toBe(true);
    expect(convertScalar({ type: 'boolean' }, 'FALSE', '--b')).toBe(false);
    expect(convertScalar({ type: 'boolean' }, 'True', '--b')).toBe(true);
  });

  it.each(['', 'yes', '1', 'truthy'])('rejects the boolean %j', (raw) => {
    expect(caught(() => convertScalar({ type: 'boolean' }, raw, '--b')).message).toBe(
      `--b expects true or false, got "${raw}"`,
    );
  });

  it('checks enums before the type and lists the choices', () => {
    const spec = { type: 'string', enum: ['asc', 'desc'] };
    expect(convertScalar(spec, 'asc', '--sort-order')).toBe('asc');
    expect(convertScalar(spec, 'desc', '--sort-order')).toBe('desc');
    const error = caught(() => convertScalar(spec, 'ASC', '--sort-order'));
    expect(error.message).toBe('--sort-order expects one of asc, desc, got "ASC"');
    expect(convertScalar({ type: 'integer', enum: ['1', '2'] }, '2', '--n')).toBe('2');
  });

  it('normalizes date-times', () => {
    expect(convertScalar({ type: 'string', format: 'date-time' }, '2024-05-01', '--after')).toBe(
      '2024-05-01T00:00:00.000+0000',
    );
    const error = caught(() =>
      convertScalar({ type: 'string', format: 'date-time' }, 'tomorrow', '--after'),
    );
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('--after expects a date-time, got "tomorrow"');
    expect(error.details.hint).toBe(DATE_TIME_HINT);
  });

  it('ignores other formats', () => {
    expect(convertScalar({ type: 'string', format: 'binary' }, 'x', '--x')).toBe('x');
  });

  it('uses the label as given', () => {
    expect(
      caught(() => convertScalar({ type: 'string', enum: ['a'] }, 'b', '<metrics-name>')).message,
    ).toBe('<metrics-name> expects one of a, got "b"');
  });
});
