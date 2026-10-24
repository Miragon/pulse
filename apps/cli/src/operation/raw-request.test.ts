import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { apiPath, apiQuery, parseApiPath } from './raw-request.js';

function usage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).code).toBe('USAGE');
    return (error as OperateError).message;
  }
  throw new Error('expected a usage error');
}

describe('parseApiPath', () => {
  it('splits the path and its query and adds the leading slash', () => {
    expect(parseApiPath('/task')).toEqual({ path: '/task', query: '' });
    expect(parseApiPath('task?assignee=demo&x=1')).toEqual({
      path: '/task',
      query: 'assignee=demo&x=1',
    });
    expect(parseApiPath('/')).toEqual({ path: '/', query: '' });
    expect(parseApiPath('')).toEqual({ path: '/', query: '' });
  });

  it.each([
    '/process-instance/./delete',
    '/process-instance/delete/',
    '/process-instance/delete//',
    '/process-instance//delete',
    '//process-instance/delete',
    '/process-instance/%2e/delete',
    '/process-instance/%2E/delete',
    '/x/../process-instance/delete',
    '/x/%2e%2e/process-instance/delete',
    '/process-instance\\delete',
    '/../../process-instance/delete',
  ])('normalizes %s like the server does', (raw) => {
    expect(parseApiPath(raw).path).toBe('/process-instance/delete');
  });

  it('keeps the query of a normalized path', () => {
    expect(parseApiPath('/x/../task/?a=1/../b')).toEqual({ path: '/task', query: 'a=1/../b' });
  });

  it('refuses absolute URLs, fragments and matrix parameters', () => {
    expect(usage(() => parseApiPath('http://h/engine-rest/task'))).toBe(
      'Expected a path relative to the REST API root, got "http://h/engine-rest/task"',
    );
    expect(usage(() => parseApiPath('/process-instance/delete#x'))).toBe(
      'The path must not contain "#" or ";", got "/process-instance/delete#x"',
    );
    expect(usage(() => parseApiPath('/process-instance/delete;x=1'))).toContain('";"');
  });

  it('never leaves dot segments, repeated or trailing slashes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', '.', '..', '', '%2e', '%2E%2e', 'x y'), {
          maxLength: 8,
        }),
        (segments) => {
          const { path } = parseApiPath(segments.join('/'));
          expect(path.startsWith('/')).toBe(true);
          expect(path).not.toMatch(/\/\/|\/\.\.?(?:\/|$)|%2e/i);
          if (path !== '/') expect(path.endsWith('/')).toBe(false);
        },
      ),
    );
  });
});

describe('apiQuery', () => {
  it('builds the query string from the path query and --query pairs', () => {
    expect(apiQuery('', [])).toBe('');
    expect(apiQuery('a=1', [])).toBe('?a=1');
    expect(apiQuery('', ['b=x y', 'c=', 'd=1=2'])).toBe('?b=x+y&c=&d=1%3D2');
    expect(apiQuery('a=1', ['b=2'])).toBe('?a=1&b=2');
    expect(usage(() => apiQuery('', ['novalue']))).toBe(
      'Invalid --query "novalue": expected key=value',
    );
    expect(usage(() => apiQuery('', ['=x']))).toBe('Invalid --query "=x": expected key=value');
  });
});

describe('apiPath', () => {
  it('adds the engine prefix to engine scoped paths that name no engine', () => {
    expect(apiPath('/task', undefined, true)).toBe('/task');
    expect(apiPath('/task', '', true)).toBe('/task');
    expect(apiPath('/task', 'second', true)).toBe('/engine/second/task');
    expect(apiPath('/engines', 'a b', true)).toBe('/engine/a%20b/engines');
  });

  it('leaves paths that name an engine and engine independent operations alone', () => {
    expect(apiPath('/engine/other/task', 'second', true)).toBe('/engine/other/task');
    expect(apiPath('/engine', 'second', true)).toBe('/engine');
    expect(apiPath('/version', 'second', false)).toBe('/version');
  });
});
