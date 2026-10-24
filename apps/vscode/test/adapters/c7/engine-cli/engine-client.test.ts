import { describe, expect, test } from 'vitest';
import {
  EngineCliClient,
  EngineCliFailure,
  EngineCliOutputError,
  type EngineClientOptions,
  type EngineCliCredentials,
  type EngineCliExit,
  type EngineCliInvocation,
} from '../../../../src/adapters/c7/engine-cli/index.js';
import { compactFixture, fixture } from '../support/fixtures.js';

const CLI_PATH = '/opt/pulse/engine-cli.js';
const CONFIG_PATH = '/tmp/pulse/engine-cli-config.json';

interface Recorded {
  readonly invocations: EngineCliInvocation[];
  readonly options: EngineClientOptions;
}

function recording(exit: Partial<EngineCliExit>, credentials?: EngineCliCredentials): Recorded {
  const invocations: EngineCliInvocation[] = [];
  return {
    invocations,
    options: {
      cliPath: CLI_PATH,
      nodePath: '/usr/bin/node',
      connection: {
        url: 'http://engine.test/engine-rest',
        credentials: credentials ?? { kind: 'none' },
        configPath: CONFIG_PATH,
      },
      timeoutMs: 1234,
      baseEnvironment: { PATH: '/usr/bin', OPERATE_PROFILE: 'prod', operate_url: 'http://evil' },
      spawner: {
        spawn: (invocation) => {
          invocations.push(invocation);
          return Promise.resolve({
            exitCode: 0,
            timedOut: false,
            stdout: '',
            stderr: '',
            ...exit,
          });
        },
      },
    },
  };
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('the engine CLI client', () => {
  test('runs the bundled CLI with VS Code’s own runtime and an isolated, read-only setup', async () => {
    const { invocations, options } = recording({ stdout: '{"version":"2.1.5"}' });

    await EngineCliClient.create(options).version();

    expect(invocations).toHaveLength(1);
    const [invocation] = invocations;
    expect(invocation?.command).toBe('/usr/bin/node');
    expect(invocation?.args).toEqual([CLI_PATH, 'version', 'get']);
    expect(invocation?.timeoutMs).toBe(1234);
    expect(invocation?.environment).toEqual({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      OPERATE_URL: 'http://engine.test/engine-rest',
      OPERATE_OUTPUT: 'json',
      OPERATE_READ_ONLY: '1',
      OPERATE_CONFIG: CONFIG_PATH,
      OPERATE_AUTH: 'none',
    });
  });

  test('passes basic credentials only through the environment', async () => {
    const { invocations, options } = recording(
      { stdout: '{"version":"2.1.5"}' },
      { kind: 'basic', username: 'demo', password: 's3cret' },
    );

    await EngineCliClient.create(options).version();

    const environment = invocations[0]?.environment;
    expect(environment).toMatchObject({
      OPERATE_AUTH: 'basic',
      OPERATE_USERNAME: 'demo',
      OPERATE_PASSWORD: 's3cret',
    });
    expect(invocations[0]?.args.join(' ')).not.toContain('s3cret');
  });

  test('passes a bearer token only through the environment', async () => {
    const { invocations, options } = recording(
      { stdout: '{"version":"2.1.5"}' },
      { kind: 'bearer', token: 'tok-123' },
    );

    await EngineCliClient.create(options).version();

    expect(invocations[0]?.environment).toMatchObject({
      OPERATE_AUTH: 'bearer',
      OPERATE_TOKEN: 'tok-123',
    });
    expect(invocations[0]?.args.join(' ')).not.toContain('tok-123');
  });

  test('turns the error line of the engine CLI into a typed failure with its exit code', async () => {
    const { options } = recording({
      exitCode: 5,
      stderr: `warning first\n${compactFixture('error-definition-missing.json')}\n`,
    });

    const error = await failureOf(EngineCliClient.create(options).diagramXml('nope:1:x'));

    expect(error).toBeInstanceOf(EngineCliFailure);
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      exitCode: 5,
      status: 404,
      engineType: 'InvalidRequestException',
    });
    expect(EngineCliFailure.isMissingResource(error)).toBe(true);
  });

  test('tells a missing resource from a wrong REST root', async () => {
    const routing = recording({ exitCode: 5, stderr: compactFixture('error-routing.json') });
    const gone = recording({ exitCode: 7, stderr: compactFixture('error-null-value.json') });
    const missingInstance = recording({
      exitCode: 5,
      stderr: compactFixture('error-instance-missing.json'),
    });

    const wrongRoot = await failureOf(EngineCliClient.create(routing.options).incidents({}));
    const vanished = await failureOf(
      EngineCliClient.create(gone.options).externalTaskErrorDetails('x'),
    );
    const unknown = await failureOf(EngineCliClient.create(missingInstance.options).inspect('x'));

    expect(EngineCliFailure.isMissingResource(wrongRoot)).toBe(false);
    expect(EngineCliFailure.isMissingResource(vanished)).toBe(true);
    expect(EngineCliFailure.isMissingResource(unknown)).toBe(true);
  });

  test('reports a timeout as its own failure', async () => {
    const { options } = recording({ exitCode: null, timedOut: true });

    const error = await failureOf(EngineCliClient.create(options).version());

    expect(error).toMatchObject({ code: 'TIMEOUT', exitCode: null });
  });

  test('reports output that is no engine CLI error line as a CLI failure', async () => {
    const { options } = recording({ exitCode: 1, stderr: 'Error: Cannot find module' });

    const error = await failureOf(EngineCliClient.create(options).version());

    expect(error).toMatchObject({ code: 'CLI_FAILED', exitCode: 1 });
    expect(String(error)).toContain('Cannot find module');
  });

  test('rejects output that does not match the view', async () => {
    const { options } = recording({ stdout: '{"product":{"name":"Operaton BPM Runtime"}}' });

    const error = await failureOf(EngineCliClient.create(options).product());

    expect(error).toBeInstanceOf(EngineCliOutputError);
  });

  test('refuses identifiers that the engine CLI would read as options', async () => {
    const { invocations, options } = recording({ stdout: '{}' });

    const error = await failureOf(EngineCliClient.create(options).inspect('--url=http://other'));

    expect(EngineCliFailure.isMissingResource(error)).toBe(true);
    expect(invocations).toHaveLength(0);
  });

  test('keeps integers beyond 2^53 exact in variable values', async () => {
    const view = JSON.parse(fixture('inspect-review.json')) as Record<string, unknown>;
    const stdout = JSON.stringify({ ...view, variables: { bigId: 1 } }).replace(
      '"bigId":1',
      '"bigId":9007199254740993',
    );
    const { options } = recording({ stdout });

    const inspected = await EngineCliClient.create(options).inspect('63d65e9e');

    expect(inspected.variables).toEqual([{ name: 'bigId', valueJson: '9007199254740993' }]);
  });

  test('builds the historic query with a stable order and an offset window', async () => {
    const { invocations, options } = recording({ stdout: '[]' });

    await EngineCliClient.create(options).historicInstances(
      { processDefinitionKey: 'pulse-order', unfinished: true },
      { firstResult: 10, maxResults: 6 },
    );

    const args = invocations[0]?.args ?? [];
    expect(args.slice(1, 5)).toEqual(['historic-process-instance', 'query', '--body', '-']);
    expect(JSON.parse(invocations[0]?.input ?? '{}')).toEqual({
      processDefinitionKey: 'pulse-order',
      unfinished: true,
      sorting: [
        { sortBy: 'startTime', sortOrder: 'desc' },
        { sortBy: 'instanceId', sortOrder: 'asc' },
      ],
    });
    expect(args.slice(5)).toEqual(['--first-result', '10', '--max-results', '6']);
  });
});
