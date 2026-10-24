import { describe, expect, it } from 'vitest';
import {
  BASE_URL,
  binary,
  connectionRefused,
  engineError,
  fakeServer,
  type FakeServer,
  json,
  noContent,
  type RecordedRequest,
  text,
} from '../../test/support/fake-fetch.js';
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from '../../test/support/fake-runtime.js';
import { findOperation, loadCatalog } from '../catalog/catalog.js';
import { operationDescription, operationSummary } from './operation.js';
import { run } from './run.js';

const TASKS = [
  { id: 't1', name: 'Approve', assignee: null, links: [] },
  { id: 't2', name: 'Review', assignee: 'demo', links: [] },
];
const XML = '<definitions id="d"/>';

function cli(server: FakeServer, args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime({ fetch: server.fetch, ...options }));
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

function only(server: FakeServer): RecordedRequest {
  expect(server.requests).toHaveLength(1);
  return server.requests[0]!;
}

function bodyOf(request: RecordedRequest): unknown {
  return JSON.parse(request.body as string);
}

describe('operation commands: output', () => {
  it('prints compact JSON with the --fields projection when stdout is a pipe', async () => {
    const server = fakeServer().on('GET', '/task', json(TASKS));
    const result = await cli(server, ['task', 'list', '--assignee', 'demo', '--fields', 'id,name']);
    expect(result).toMatchObject({
      code: 0,
      stdout: '[{"id":"t1","name":"Approve"},{"id":"t2","name":"Review"}]\n',
      stderr: '',
    });
    expect(only(server).url).toBe(`${BASE_URL}/task?assignee=demo`);
    expect(only(server).headers.accept).toBe('application/json');
  });

  it('prints a table on a terminal, limited to the terminal width', async () => {
    const server = fakeServer().on('GET', '/task', json(TASKS));
    const result = await cli(server, ['task', 'list'], { stdoutTTY: true, columns: 80 });
    expect(result.stdout).toBe('id  name     assignee\nt1  Approve\nt2  Review   demo\n');
  });

  it('prints pretty JSON on a terminal with -o json', async () => {
    const server = fakeServer().on('GET', '/task', json([{ id: 't1' }]));
    const result = await cli(server, ['task', 'list', '-o', 'json'], { stdoutTTY: true });
    expect(result.stdout).toBe('[\n  {\n    "id": "t1"\n  }\n]\n');
  });

  it('prints only the number of a count in a table', async () => {
    const server = fakeServer().on('GET', '/process-instance/count', json({ count: 7 }));
    const table = await cli(server, ['process-instance', 'count', '-o', 'table']);
    expect(table.stdout).toBe('7\n');
    const asJson = await cli(server, ['process-instance', 'count']);
    expect(asJson.stdout).toBe('{"count":7}\n');
  });

  it('prints a Done line on stderr for 204 responses', async () => {
    const server = fakeServer().on('POST', '/task/t1/claim', noContent());
    const result = await cli(server, ['task', 'claim', 't1', '--user-id', 'demo']);
    expect(result).toMatchObject({
      code: 0,
      stdout: '',
      stderr: 'Done: POST /task/t1/claim → 204 No Content\n',
    });
    expect(bodyOf(only(server))).toEqual({ userId: 'demo' });
    expect(only(server).headers['content-type']).toBe('application/json');
  });

  it('keeps the engine prefix and the query in the Done line', async () => {
    const server = fakeServer().on('DELETE', '/engine/e1/process-instance/p1', noContent());
    const result = await cli(server, [
      'process-instance',
      'delete',
      'p1',
      '--skip-custom-listeners',
      '--yes',
      '--engine',
      'e1',
    ]);
    expect(result.stderr).toBe(
      'Done: DELETE /engine/e1/process-instance/p1?skipCustomListeners=true → 204 No Content\n',
    );
  });

  it('prints text responses raw', async () => {
    const server = fakeServer().on('GET', '/task', text('plain', 'text/plain'));
    const result = await cli(server, ['task', 'list']);
    expect(result.stdout).toBe('plain\n');
  });
});

describe('operation commands: lossless numbers, field warnings, terminals', () => {
  const LONG = '{"type":"Long","value":9223372036854775807,"valueInfo":{}}';

  it('prints and writes Long values beyond 2^53 exactly', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-instance/p1/variables/big',
      text(LONG, 'application/json'),
    );
    const args = ['process-instance', 'get-variable', 'p1', 'big'];
    expect((await cli(server, args)).stdout).toBe(`${LONG}\n`);
    const table = await cli(server, [...args, '-o', 'table']);
    expect(table.stdout).toContain('9223372036854775807');
    const file = await cli(server, [...args, '--out-file', '/v.json']);
    expect(fileText(file.runtime, '/v.json')).toBe(LONG);
  });

  it('sends Long values of --body and --var exactly', async () => {
    const server = fakeServer().on(
      'POST',
      '/process-definition/key/order/start',
      json({ id: 'x' }),
    );
    await cli(server, [
      'process-definition',
      'start',
      'order',
      '--body',
      '{"variables":{"a":{"type":"Long","value":9007199254740993}}}',
      '--var',
      'b=9223372036854775807',
    ]);
    expect(only(server).body).toBe(
      '{"variables":{"a":{"type":"Long","value":9007199254740993},"b":{"value":9223372036854775807,"type":"Long"}}}',
    );
  });

  it('warns on stderr about --fields that match nothing, and still succeeds', async () => {
    const server = fakeServer().on('GET', '/task', json(TASKS));
    const result = await cli(server, ['task', 'list', '--fields', 'id,nme']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('[{"id":"t1"},{"id":"t2"}]\n');
    expect(result.stderr).toBe(
      'Warning: field "nme" not found in the response (fields: id, name, assignee, links)\n',
    );
    const empty = fakeServer().on('GET', '/task', json([]));
    expect((await cli(empty, ['task', 'list', '--fields', 'nme'])).stderr).toBe('');
  });

  it('replaces control characters of text responses on a terminal only', async () => {
    const hostile = 'hello \u001b]0;PWNED\u0007 \u001b[2J';
    const server = fakeServer().on(
      'GET',
      '/deployment/d1/resources/r1/data',
      text(hostile, 'text/plain'),
    );
    const args = ['deployment', 'get-resource-data', 'd1', 'r1'];
    const tty = await cli(server, args, { stdoutTTY: true });
    expect(tty.stdout).toBe('hello \ufffd]0;PWNED\ufffd \ufffd[2J\n');
    const pipe = await cli(server, args);
    expect(pipe.stdout).toBe(`${hostile}\n`);
  });

  it('uses 120 columns on a terminal that reports 0 columns', async () => {
    const server = fakeServer().on('GET', '/version', json({ version: '7.24.0' }));
    const result = await cli(server, ['version', 'get'], { stdoutTTY: true, columns: 0 });
    expect(result.stdout).toBe('FIELD    VALUE\nversion  7.24.0\n');
  });
});

describe('operation commands: unwrap', () => {
  const server = () =>
    fakeServer().on('GET', '/process-definition/key/order/xml', json({ id: 'p1', bpmn20Xml: XML }));

  it('prints the XML raw by default', async () => {
    const result = await cli(server(), ['process-definition', 'xml', 'order']);
    expect(result.stdout).toBe(`${XML}\n`);
  });

  it('prints the JSON with an explicit -o json, OPERATE_OUTPUT=json or --fields', async () => {
    const explicit = await cli(server(), ['process-definition', 'xml', 'order', '-o', 'json']);
    expect(explicit.stdout).toBe(`{"id":"p1","bpmn20Xml":${JSON.stringify(XML)}}\n`);
    const env = await cli(server(), ['process-definition', 'xml', 'order'], {
      env: { OPERATE_OUTPUT: 'json' },
    });
    expect(env.stdout).toBe(explicit.stdout);
    const fields = await cli(server(), ['process-definition', 'xml', 'order', '--fields', 'id']);
    expect(fields.stdout).toBe('{"id":"p1"}\n');
  });

  it('still unwraps with an explicit -o table', async () => {
    const result = await cli(server(), ['process-definition', 'xml', 'order', '-o', 'table']);
    expect(result.stdout).toBe(`${XML}\n`);
  });
});

describe('operation commands: dry-run and guards', () => {
  it('prints the request preview with curl and sends nothing', async () => {
    const server = fakeServer();
    const result = await cli(server, [
      'process-definition',
      'start',
      'order',
      '--business-key',
      'B-1',
      '--var',
      'amount=250',
      '--dry-run',
      '-H',
      'Authorization: Bearer secret',
    ]);
    expect(result.code).toBe(0);
    expect(server.requests).toEqual([]);
    const body = { businessKey: 'B-1', variables: { amount: { value: 250, type: 'Integer' } } };
    expect(JSON.parse(result.stdout)).toEqual({
      method: 'POST',
      url: `${BASE_URL}/process-definition/key/order/start`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ***',
      },
      body,
      curl: `curl -X POST '${BASE_URL}/process-definition/key/order/start' -H 'Accept: application/json' -H 'Content-Type: application/json' -H 'Authorization: Bearer ***' --data-raw '${JSON.stringify(body)}'`,
    });
  });

  it('prints only the curl command in table format and secrets with --show-secrets', async () => {
    const result = await cli(fakeServer(), [
      'task',
      'list',
      '--dry-run',
      '-o',
      'table',
      '-H',
      'X-Api-Key: k1',
      '--show-secrets',
    ]);
    expect(result.stdout).toBe(
      `curl '${BASE_URL}/task' -H 'Accept: application/json' -H 'X-Api-Key: k1'\n`,
    );
  });

  it('refuses delete operations without --yes and sends them with --yes', async () => {
    const server = fakeServer().on('DELETE', '/process-instance/p1', noContent());
    const refused = await cli(server, ['process-instance', 'delete', 'p1']);
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe('');
    expect(errorOf(refused.stderr)).toEqual({
      code: 'CONFIRMATION_REQUIRED',
      exitCode: 2,
      message: '`operate process-instance delete` is a delete operation and needs confirmation',
      hint: 'Re-run with --yes to confirm, or --dry-run to preview.',
    });
    expect(server.requests).toEqual([]);
    const confirmed = await cli(server, ['process-instance', 'delete', 'p1', '-y']);
    expect(confirmed.code).toBe(0);
    expect(only(server).method).toBe('DELETE');
    const preview = await cli(server, ['process-instance', 'delete', 'p1', '--dry-run']);
    expect(preview.code).toBe(0);
    expect(server.requests).toHaveLength(1);
  });

  it('refuses writes in read-only mode and names the source', async () => {
    const server = fakeServer().on('GET', '/task', json([]));
    const flag = await cli(server, ['task', 'claim', 't1', '--read-only']);
    expect(flag.code).toBe(2);
    expect(errorOf(flag.stderr)).toEqual({
      code: 'READ_ONLY',
      exitCode: 2,
      message: '`operate task claim` is a write operation and read-only mode is enabled',
      hint: 'Read-only mode is enabled by --read-only. Use --dry-run to preview the request.',
    });
    const env = await cli(server, ['task', 'claim', 't1'], { env: { OPERATE_READ_ONLY: 'yes' } });
    expect(errorOf(env.stderr).hint).toBe(
      'Read-only mode is enabled by OPERATE_READ_ONLY. Use --dry-run to preview the request.',
    );
    const config = JSON.stringify({ profiles: { prod: { readOnly: true } } });
    const profile = await cli(server, ['task', 'claim', 't1', '--profile', 'prod'], {
      files: { [CONFIG_PATH]: config },
    });
    expect(errorOf(profile.stderr).hint).toBe(
      'Read-only mode is enabled by profile "prod". Use --dry-run to preview the request.',
    );
    const read = await cli(server, ['task', 'list', '--read-only']);
    expect(read).toMatchObject({ code: 0, stdout: '[]\n' });
    expect(server.requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('validates the body before sending', async () => {
    const server = fakeServer();
    const result = await cli(server, ['task', 'claim', 't1', '--body', '{"userid":"x"}']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'VALIDATION' });
    expect(server.requests).toEqual([]);
    const skipped = await cli(server.on('POST', '/task/t1/claim', noContent()), [
      'task',
      'claim',
      't1',
      '--body',
      '{"userid":"x"}',
      '--no-validate',
    ]);
    expect(skipped.code).toBe(0);
    expect(bodyOf(only(server))).toEqual({ userid: 'x' });
  });
});

describe('operation commands: paging, engine and headers', () => {
  it('fetches every page with --all', async () => {
    const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }], [{ id: 'e' }]];
    const server = fakeServer().on('GET', '/process-instance', (request) =>
      json(pages[Number(request.query.get('firstResult')) / 2] ?? []),
    );
    const result = await cli(server, ['process-instance', 'list', '--all', '--max-results', '2']);
    expect(result.stdout).toBe('[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"}]\n');
    expect(server.requests.map((request) => request.query.toString())).toEqual([
      'firstResult=0&maxResults=2',
      'firstResult=2&maxResults=2',
      'firstResult=4&maxResults=2',
    ]);
  });

  it('adds the engine prefix and the configured headers', async () => {
    const server = fakeServer().on('GET', '/engine/second/task', json([]));
    const result = await cli(server, ['task', 'list', '--engine', 'second', '-H', 'X-Tenant: a'], {
      env: { OPERATE_URL: `${BASE_URL}/` },
    });
    expect(result.code).toBe(0);
    expect(only(server).url).toBe(`${BASE_URL}/engine/second/task`);
    expect(only(server).headers['x-tenant']).toBe('a');
  });

  it('sends presence flags that start with no- as true', async () => {
    const server = fakeServer().on('GET', '/job', json([]));
    await cli(server, ['job', 'list', '--no-retries-left', '--no-timers']);
    expect(only(server).query.toString()).toBe('timers=false&noRetriesLeft=true');
  });
});

describe('operation commands: binary responses and --out-file', () => {
  const data = new Uint8Array([0, 1, 2, 255]);
  const route = () =>
    fakeServer().on('GET', '/process-instance/p1/variables/file/data', binary(data));

  it('writes binary responses raw to a pipe', async () => {
    const result = await cli(route(), ['process-instance', 'get-variable-binary', 'p1', 'file']);
    expect(result.code).toBe(0);
    expect(result.runtime.stdout.bytes()).toEqual(data);
  });

  it('refuses binary responses on a terminal', async () => {
    const result = await cli(route(), ['process-instance', 'get-variable-binary', 'p1', 'file'], {
      stdoutTTY: true,
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      [
        'Error: Binary response (application/octet-stream); use --out-file <path>',
        '  Hint: Binary data is only written to stdout when it is redirected to a file or pipe.',
        '',
      ].join('\n'),
    );
  });

  it('writes the body to --out-file and prints a summary', async () => {
    const args = [
      'process-instance',
      'get-variable-binary',
      'p1',
      'file',
      '--out-file',
      '/tmp/f.bin',
    ];
    const result = await cli(route(), args);
    expect(result.stdout).toBe(
      '{"outFile":"/tmp/f.bin","bytes":4,"contentType":"application/octet-stream"}\n',
    );
    expect(result.runtime.files.get('/tmp/f.bin')?.data).toEqual(data);
    const table = await cli(route(), args, { stdoutTTY: true });
    expect(table.stdout).toBe('Wrote 4 bytes to /tmp/f.bin\n');
  });

  it('writes JSON, unwrapped XML, text and empty bodies to --out-file', async () => {
    const server = fakeServer()
      .on('GET', '/task', json([{ id: 't1' }]))
      .on('GET', '/process-definition/key/order/xml', json({ id: 'p1', bpmn20Xml: XML }))
      .on('GET', '/process-instance/count', text('näh', 'text/plain'))
      .on('POST', '/task/t1/claim', noContent());
    const list = await cli(server, ['task', 'list', '--out-file', '/o/list.json']);
    // the response body exactly as received
    expect(fileText(list.runtime, '/o/list.json')).toBe('[{"id":"t1"}]');
    expect(list.stdout).toBe(
      '{"outFile":"/o/list.json","bytes":13,"contentType":"application/json"}\n',
    );
    const xml = await cli(server, [
      'process-definition',
      'xml',
      'order',
      '--out-file',
      '/o/p.bpmn',
    ]);
    expect(fileText(xml.runtime, '/o/p.bpmn')).toBe(`${XML}\n`);
    expect(JSON.parse(xml.stdout)).toEqual({
      outFile: '/o/p.bpmn',
      bytes: XML.length + 1,
      contentType: 'application/xml',
    });
    const plain = await cli(server, ['process-instance', 'count', '--out-file', '/o/c.txt']);
    expect(fileText(plain.runtime, '/o/c.txt')).toBe('näh');
    expect(JSON.parse(plain.stdout)).toMatchObject({ bytes: 4, contentType: 'text/plain' });
    const none = await cli(server, ['task', 'claim', 't1', '--out-file', '/o/none']);
    expect(fileText(none.runtime, '/o/none')).toBe('');
    expect(none.stdout).toBe('{"outFile":"/o/none","bytes":0,"contentType":""}\n');
    expect(none.stderr).toBe('');
  });

  it('keeps the final newline of unwrapped XML in --out-file', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-definition/key/order/xml',
      json({ id: 'p1', bpmn20Xml: `${XML}\n` }),
    );
    const result = await cli(server, ['process-definition', 'xml', 'order', '--out-file', '/p']);
    expect(fileText(result.runtime, '/p')).toBe(`${XML}\n`);
    const empty = fakeServer().on(
      'GET',
      '/process-definition/key/order/xml',
      json({ id: 'p1', bpmn20Xml: '' }),
    );
    const none = await cli(empty, ['process-definition', 'xml', 'order', '--out-file', '/e']);
    expect(fileText(none.runtime, '/e')).toBe('');
  });

  it('writes the JSON of unwrap operations to --out-file with --fields', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-definition/key/order/xml',
      json({ id: 'p1', bpmn20Xml: XML }),
    );
    const args = ['process-definition', 'xml', 'order', '--fields', 'id', '--out-file', '/p'];
    const result = await cli(server, args, { stdoutTTY: true });
    expect(fileText(result.runtime, '/p')).toBe('{\n  "id": "p1"\n}\n');
    expect(result.stdout).toBe('Wrote 17 bytes to /p\n');
  });

  it('writes the combined pages of --all to --out-file', async () => {
    const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]];
    const server = fakeServer().on('GET', '/process-instance', (request) =>
      json(pages[Number(request.query.get('firstResult')) / 2] ?? []),
    );
    const args = ['process-instance', 'list', '--all', '--max-results', '2', '--out-file', '/a'];
    const result = await cli(server, args);
    expect(fileText(result.runtime, '/a')).toBe('[{"id":"a"},{"id":"b"},{"id":"c"}]\n');
  });

  it('warns about --fields of JSON responses written to --out-file, only for JSON', async () => {
    const server = fakeServer()
      .on('GET', '/task', json([{ id: 't1' }]))
      .on('GET', '/process-instance/count', text('7', 'text/plain'));
    const list = await cli(server, ['task', 'list', '--fields', 'id,nme', '--out-file', '/l']);
    expect(fileText(list.runtime, '/l')).toBe('[{"id":"t1"}]\n');
    expect(list.stderr).toBe('Warning: field "nme" not found in the response (fields: id)\n');
    const count = await cli(server, [
      'process-instance',
      'count',
      '--fields',
      'nme',
      '--out-file',
      '/c',
    ]);
    expect(fileText(count.runtime, '/c')).toBe('7');
    expect(count.stderr).toBe('');
  });

  it('reports any write failure of --out-file', async () => {
    const runtime = fakeRuntime({ fetch: fakeServer().on('GET', '/task', json([])).fetch });
    runtime.fs.writeFile = () => Promise.reject(new Error('disk full'));
    const failed = await execute(run, ['task', 'list', '--out-file', '/o'], runtime);
    expect(errorOf(failed.stderr).message).toBe('Cannot write /o: disk full');
    const odd = fakeRuntime({ fetch: fakeServer().on('GET', '/task', json([])).fetch });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
    odd.fs.writeFile = () => Promise.reject('quota');
    const result = await execute(run, ['task', 'list', '--out-file', '/o'], odd);
    expect(errorOf(result.stderr).message).toBe('Cannot write /o: quota');
  });

  it('prints the dry-run preview instead of writing --out-file', async () => {
    const result = await cli(fakeServer(), ['task', 'list', '--dry-run', '--out-file', '/o/x']);
    expect(JSON.parse(result.stdout)).toMatchObject({ method: 'GET' });
    expect(result.runtime.files.has('/o/x')).toBe(false);
  });

  it('reports a file that cannot be written as usage error', async () => {
    const runtime = fakeRuntime({ fetch: fakeServer().on('GET', '/task', json([])).fetch });
    runtime.dirs.add('/o');
    const result = await execute(run, ['task', 'list', '--out-file', '/o'], runtime);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: "Cannot write /o: EISDIR: no such file or directory, open '/o'",
      hint: 'Check the --out-file path.',
    });
  });
});

describe('operation commands: --verbose', () => {
  it('traces request and response on stderr with masked secrets', async () => {
    let clock = 1000;
    const server = fakeServer().on('GET', '/task', json([]));
    const result = await cli(
      server,
      ['task', 'list', '--verbose', '-H', 'Authorization: Bearer abc'],
      {
        now: () => (clock += 25),
      },
    );
    expect(result.stdout).toBe('[]\n');
    expect(result.stderr).toBe(
      [
        `> GET ${BASE_URL}/task`,
        '> Accept: application/json',
        '> Authorization: Bearer ***',
        '< 200 OK (25 ms, 2 bytes)',
        '',
      ].join('\n'),
    );
    const shown = await cli(server, [
      'task',
      'list',
      '--verbose',
      '--show-secrets',
      '-H',
      'Authorization: Bearer abc',
    ]);
    expect(shown.stderr).toContain('> Authorization: Bearer abc\n');
  });
});

describe('operation commands: errors', () => {
  it('maps HTTP 404 to exit code 5 with the engine error as JSON', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-instance/nope',
      engineError(404, 'InvalidRequestException', 'Process instance with id nope does not exist'),
    );
    const result = await cli(server, ['process-instance', 'get', 'nope']);
    expect(result.code).toBe(5);
    expect(result.stdout).toBe('');
    expect(errorOf(result.stderr)).toEqual({
      code: 'NOT_FOUND',
      exitCode: 5,
      message: 'HTTP 404 Not Found: Process instance with id nope does not exist',
      status: 404,
      engineType: 'InvalidRequestException',
      engineMessage: 'Process instance with id nope does not exist',
      hint: 'Check the id or key. List the existing ones with `operate process-instance list`.',
      request: { method: 'GET', url: `${BASE_URL}/process-instance/nope` },
    });
  });

  it('names the describe command in the hint of a rejected request', async () => {
    const server = fakeServer().on(
      'POST',
      '/process-definition/key/invoice/start',
      engineError(400, 'InvalidRequestException', "Unsupported value type 'Integr'"),
    );
    const result = await cli(server, ['process-definition', 'start', 'invoice', '--var', 'a=1']);
    expect(result.code).toBe(6);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'HTTP_CLIENT_ERROR',
      message: "HTTP 400 Bad Request: Unsupported value type 'Integr'",
      hint: 'The engine rejected the request. Check parameters and body with `operate describe process-definition start`.',
    });
  });

  it('names the command in the hints of every page request of --all', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-instance',
      engineError(400, 'InvalidRequestException', 'bad'),
    );
    const result = await cli(server, ['process-instance', 'list', '--all']);
    expect(errorOf(result.stderr)).toMatchObject({
      hint: 'The engine rejected the request. Check parameters and body with `operate describe process-instance list`.',
    });
  });

  it('maps network errors to exit code 8', async () => {
    const server = fakeServer().on('GET', '/task', () => {
      throw connectionRefused();
    });
    const result = await cli(server, ['task', 'list']);
    expect(result.code).toBe(8);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'NETWORK',
      exitCode: 8,
      message: `Cannot reach ${BASE_URL}/task (ECONNREFUSED)`,
    });
  });

  it('renders config errors in the format given on the command line', async () => {
    const result = await cli(fakeServer(), ['task', 'list', '--timeout', 'soon', '-o', 'table']);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/^Error: Timeout must be a positive number of milliseconds/);
  });

  it('renders later errors in the resolved format', async () => {
    const server = fakeServer().on(
      'GET',
      '/task',
      engineError(500, 'ProcessEngineException', 'boom'),
    );
    const result = await cli(server, ['task', 'list'], { env: { OPERATE_OUTPUT: 'table' } });
    expect(result.code).toBe(7);
    expect(result.stderr).toMatch(
      /^Error: HTTP 500 Internal Server Error: boom\n {2}Engine: ProcessEngineException\n/,
    );
  });
});

describe('operation commands: input', () => {
  it('names the example of deployment create when no file is given', async () => {
    const result = await cli(fakeServer(), ['deployment', 'create', '--deployment-name', 'x']);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'At least one resource file is required',
      hint: 'Example: operate deployment create order.bpmn approval.dmn --deployment-name orders',
    });
  });

  it('deploys resource files from the file system', async () => {
    const server = fakeServer().on('POST', '/deployment/create', json({ id: 'd1' }));
    const result = await cli(
      server,
      ['deployment', 'create', 'bpmn/order.bpmn', 'approval.dmn', '--deployment-name', 'it'],
      { files: { 'bpmn/order.bpmn': '<bpmn/>', 'approval.dmn': '<dmn/>' } },
    );
    expect(result).toMatchObject({ code: 0, stdout: '{"id":"d1"}\n' });
    const form = only(server).body as FormData;
    expect([...form.keys()]).toEqual(['deployment-name', 'order.bpmn', 'approval.dmn']);
    expect(await (form.get('order.bpmn') as File).text()).toBe('<bpmn/>');
  });

  it('reports a missing resource file as usage error', async () => {
    const result = await cli(fakeServer(), ['deployment', 'create', 'missing.bpmn']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({ message: 'File not found: missing.bpmn' });
  });

  it('reads --body from a file and from stdin', async () => {
    const body = { workerId: 'w1', maxTasks: 1, topics: [{ topicName: 't', lockDuration: 1000 }] };
    const server = fakeServer().on('POST', '/external-task/fetchAndLock', json([]));
    const fromFile = await cli(
      server,
      ['external-task', 'fetch-and-lock', '--body', '@body.json'],
      {
        files: { 'body.json': JSON.stringify(body) },
      },
    );
    expect(fromFile.code).toBe(0);
    const fromStdin = await cli(
      server,
      ['external-task', 'fetch-and-lock', '--body', '-', '--max-tasks', '5'],
      {
        stdin: JSON.stringify(body),
      },
    );
    expect(fromStdin.code).toBe(0);
    expect(server.requests.map(bodyOf)).toEqual([body, { ...body, maxTasks: 5 }]);
  });
});

describe('operationSummary and operationDescription', () => {
  const catalog = loadCatalog();
  const operation = findOperation(catalog, 'process-instance', 'delete')!;

  it('describes summary, method and path, effect and aliases', () => {
    expect(operationDescription(operation)).toBe(
      [
        operation.summary,
        '',
        'DELETE /process-instance/{id}',
        'Effect: delete (requires --yes)',
        'Aliases: delete-process-instance',
      ].join('\n'),
    );
    const claim = findOperation(catalog, 'task', 'claim')!;
    expect(operationDescription(claim)).toBe(
      'Claim a task for a user\n\nPOST /task/{id}/claim\nEffect: write',
    );
  });

  it('marks deprecated operations and falls back to method and path', () => {
    expect(operationSummary({ ...operation, deprecated: true })).toBe(
      `[deprecated] ${operation.summary}`,
    );
    expect(operationSummary({ ...operation, summary: '' })).toBe('DELETE /process-instance/{id}');
    expect(operationDescription({ ...operation, effect: 'bulk', aliases: [] })).toMatch(
      /\nEffect: bulk \(requires --yes\)$/,
    );
    expect(operationDescription({ ...operation, effect: 'read', aliases: [] })).toMatch(
      /Effect: read$/,
    );
  });
});
