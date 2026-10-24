import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { C7Adapter } from '../../src/adapters/c7/index.js';
import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type ProcessCommands,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import { FakeEngine, FakeWorld } from '../../src/contract/fake/index.js';
import {
  BulkRuns,
  DefinitionPanel,
  DiagramCache,
  EngineLane,
  SharedDefinitions,
  EnginePanel,
  InstancePanel,
  MigrationPanel,
  StatePublisher,
  type MigrationTarget,
  type Panel,
  type PanelContext,
  type PanelEffects,
} from '../../src/core/index.js';
import { MessageGuards, type EngineBadge } from '../../src/core/protocol/index.js';
import { renderWebviewHtml } from '@miragon/modeler-shell/vscode/extension';

const PORT = Number(process.env.PULSE_DEV_PORT ?? '5180');
const ENGINE_URL = process.env.PULSE_DEV_ENGINE ?? 'fake';
const DIST = process.env.PULSE_DEV_DIST ?? 'packages/extension/dist';
const OPERATE_CLI = process.env.PULSE_ENGINE_CLI ?? 'node_modules/@miragon/operate/dist/operate.js';
const ORIGIN = `http://localhost:${PORT}`;
const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

interface Channel {
  readonly events: ServerResponse[];
  readonly backlog: string[];
}

interface Session {
  readonly channel: Channel;
  readonly panel: Panel;
}

const sessions = new Map<string, Session>();

interface DevEngine {
  readonly runtime: ProcessRuntime;
  readonly commands: ProcessCommands;
}

async function createEngine(): Promise<DevEngine> {
  if (ENGINE_URL === 'fake') {
    const engine = new FakeEngine(FakeWorld.seed().state);
    return { runtime: engine, commands: engine };
  }
  const configPath = join(tmpdir(), 'pulse-dev-engine-cli-config.json');
  await writeFile(configPath, JSON.stringify({ profiles: {} }));
  const adapter = C7Adapter.create({ cliPath: OPERATE_CLI, configPath });
  const connection = { endpoint: ENGINE_URL, credentials: { kind: 'none' as const } };
  return { runtime: adapter.runtime(connection), commands: adapter.commands(connection) };
}

const { runtime, commands } = await createEngine();
const diagrams = new DiagramCache(runtime);
const definitions = new SharedDefinitions(runtime, new EngineLane());
const bulkRuns = new BulkRuns();
const engine: EngineBadge = {
  name: ENGINE_URL === 'fake' ? 'fake' : 'local-operaton',
  environment: 'local',
  host: ENGINE_URL === 'fake' ? 'in memory' : new URL(ENGINE_URL).host,
  access: { writable: true, note: 'The dev host writes without asking.' },
};

function send(channel: Channel, message: unknown): void {
  const line = `data: ${JSON.stringify(message)}\n\n`;
  if (channel.events.length === 0) {
    channel.backlog.push(line);
    return;
  }
  for (const response of channel.events) {
    response.write(line);
  }
}

function migrationUrl({ bpmnProcessId, sourceDefinitionId, instanceIds }: MigrationTarget): string {
  const query = new URLSearchParams({
    panel: 'migration',
    process: bpmnProcessId,
    source: sourceDefinitionId,
    ids: instanceIds.join(','),
  });
  return `/?${query.toString()}`;
}

function effects(channel: Channel): PanelEffects {
  const navigate = (url: string, toSide: boolean) => {
    send(channel, { type: 'dev.navigate', url, toSide });
  };
  const confirmed = <Answer>(request: unknown, answer: Answer): Promise<Answer> => {
    send(channel, { type: 'dev.confirm', request });
    return Promise.resolve(answer);
  };
  const noted = (type: string) => (detail?: unknown) => {
    send(channel, { type, detail });
  };
  return {
    openInstance: (instanceId, { toSide }) => {
      navigate(`/?panel=instance&instance=${encodeURIComponent(instanceId)}`, toSide);
    },
    openDefinition: (bpmnProcessId, definitionId, { toSide }) => {
      navigate(
        `/?panel=definition&process=${encodeURIComponent(bpmnProcessId)}&definition=${encodeURIComponent(definitionId)}`,
        toSide,
      );
    },
    openLatestDefinition: (bpmnProcessId, { toSide }) => {
      navigate(`/?panel=definition&process=${encodeURIComponent(bpmnProcessId)}`, toSide);
    },
    openMigration: (target) => {
      navigate(migrationUrl(target), false);
    },
    pickInstance: (_title, choices) => Promise.resolve(choices[0]?.instanceId),
    openWebUi: (target) => {
      send(channel, { type: 'dev.webUi', target });
    },
    goBack: noted('dev.back'),
    showIncidentDetails: (title, details) => {
      send(channel, { type: 'dev.document', title, text: details.text });
    },
    copyToClipboard: (text, label) => {
      send(channel, { type: 'dev.copied', text, label });
    },
    editConnection: noted('dev.editConnection'),
    setCredentials: noted('dev.setCredentials'),
    reportProblem: (problem) => {
      send(channel, { type: 'dev.problem', problem });
    },
    confirmWrite: (request) => confirmed(request, true),
    confirmBulk: (request) => confirmed(request, {}),
    reportBulkOutcome: noted('dev.bulkOutcome'),
    openModel: (location, elementId) => {
      send(channel, { type: 'dev.openModel', location, elementId });
    },
    openSource: (location) => {
      send(channel, { type: 'dev.openSource', location });
    },
    reportWritten: (message) => {
      send(channel, { type: 'dev.written', message });
    },
    turnOnLiveUpdates: (environment) => {
      send(channel, { type: 'dev.turnOnLiveUpdates', environment });
    },
  };
}

function createSession(query: URLSearchParams): string {
  const id = randomUUID();
  const channel: Channel = { events: [], backlog: [] };
  const publisher = new StatePublisher((message) => {
    send(channel, message);
  });
  const context: PanelContext = {
    runtime,
    engine,
    diagrams,
    definitions,
    effects: effects(channel),
    publish: (state) => {
      publisher.publish(state);
    },
    now: () => new Date(),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    commands,
    bulkRuns,
  };
  sessions.set(id, { channel, panel: panelFor(query, context) });
  return id;
}

function panelFor(query: URLSearchParams, context: PanelContext): Panel {
  const instance = query.get('instance');
  const definition = query.get('definition');
  if (query.get('panel') === 'engine') {
    return new EnginePanel(context);
  }
  const source = query.get('source');
  if (query.get('panel') === 'migration' && source !== null) {
    return new MigrationPanel(context, {
      bpmnProcessId: BpmnProcessId(query.get('process') ?? 'pulse-order'),
      sourceDefinitionId: DefinitionId(source),
      instanceIds: (query.get('ids') ?? '')
        .split(',')
        .filter((id) => id !== '')
        .map((id) => InstanceId(id)),
    });
  }
  return query.get('panel') === 'instance' && instance !== null
    ? new InstancePanel(context, InstanceId(instance))
    : new DefinitionPanel(context, {
        bpmnProcessId: BpmnProcessId(query.get('process') ?? 'pulse-order'),
        ...(definition === null ? {} : { definitionId: definition as never }),
      });
}

const BRIDGE = (sessionId: string) => `
window.pulseDev = { documents: [], copied: [], problems: [] };
const source = new EventSource('/events?session=${sessionId}');
source.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'dev.back') { history.back(); return; }
  if (message.type === 'dev.navigate') { message.toSide ? window.open(message.url) : (location.href = message.url); return; }
  if (message.type === 'dev.document') { window.pulseDev.documents.push(message); return; }
  if (message.type === 'dev.copied') { window.pulseDev.copied.push(message); return; }
  if (message.type === 'dev.problem') { window.pulseDev.problems.push(message.problem); return; }
  window.postMessage(message, '*');
};
let state;
window.acquireVsCodeApi = () => ({
  postMessage: (intent) => fetch('/intent?session=${sessionId}', { method: 'POST', body: JSON.stringify(intent) }),
  getState: () => state,
  setState: (next) => { state = next; },
});
`;

function page(query: URLSearchParams): string {
  const sessionId = createSession(query);
  const theme = query.get('theme') === 'dark' ? 'dark' : 'light';
  return renderWebviewHtml({
    cspSource: ORIGIN,
    scriptUri: `${ORIGIN}/webview.js`,
    styleUris: [`${ORIGIN}/webview.css`],
    title: 'Pulse dev host',
    lang: 'en',
    appearance: {
      theme,
      ...(query.get('contrast') === 'high' ? { kontrast: 'hoch' as const } : {}),
    },
    nonce: 'cHVsc2VkZXZob3N0MDAwMA==',
    body: `<div id="pulse"></div><script nonce="cHVsc2VkZXZob3N0MDAwMA==" src="${ORIGIN}/bridge.js?session=${sessionId}"></script>`,
  }).replace("default-src 'none';", `default-src 'none'; connect-src ${ORIGIN};`);
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

type Handler = (
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

function sessionOf(url: URL): Session | undefined {
  return sessions.get(url.searchParams.get('session') ?? '');
}

const ROUTES: Readonly<Record<string, Handler>> = {
  '/': (url, _request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(page(url.searchParams));
  },
  '/bridge.js': (url, _request, response) => {
    response
      .writeHead(200, { 'Content-Type': 'text/javascript' })
      .end(BRIDGE(url.searchParams.get('session') ?? ''));
  },
  '/events': (url, _request, response) => {
    const session = sessionOf(url);
    if (session === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    session.channel.events.push(response);
    for (const line of session.channel.backlog.splice(0)) {
      response.write(line);
    }
  },
  '/intent': async (url, request, response) => {
    const intent: unknown = JSON.parse(await body(request));
    response.writeHead(204).end();
    const session = sessionOf(url);
    if (session !== undefined && MessageGuards.isWebviewIntent(intent)) {
      await session.panel.handle(intent);
    }
  },
};

async function serveAsset(url: URL, response: ServerResponse): Promise<void> {
  const file = await readFile(join(DIST, url.pathname)).catch(() => undefined);
  const type = TYPES[extname(url.pathname)] ?? 'application/octet-stream';
  response.writeHead(file === undefined ? 404 : 200, { 'Content-Type': type }).end(file);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', ORIGIN);
  const handler = ROUTES[url.pathname];
  await (handler === undefined ? serveAsset(url, response) : handler(url, request, response));
}

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    response.writeHead(500).end(String(error));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Pulse dev host on ${ORIGIN} against ${ENGINE_URL}`);
});
