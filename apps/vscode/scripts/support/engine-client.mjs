import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const INTEGER_LIMIT = 2_147_483_647;

export function engineDate(date) {
  return date.toISOString().replace('Z', '+0000');
}

function numberValue(value) {
  const integer = Number.isInteger(value) && Math.abs(value) <= INTEGER_LIMIT;
  return { type: integer ? 'Integer' : 'Double', value };
}

function typedValue(value) {
  if (value === null) {
    return { type: 'Null', value: null };
  }
  if (value instanceof Date) {
    return { type: 'Date', value: engineDate(value) };
  }
  const byType = {
    bigint: () => ({ type: 'Long', value: JSON.rawJSON(String(value)) }),
    boolean: () => ({ type: 'Boolean', value }),
    string: () => ({ type: 'String', value }),
    number: () => numberValue(value),
  };
  return byType[typeof value]?.() ?? { type: 'Json', value: JSON.stringify(value) };
}

export function typedVariables(variables) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, typedValue(value)]),
  );
}

function authorization(credentials) {
  if (credentials === undefined) {
    return {};
  }
  const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function requestInit(method, headers, body) {
  if (body === undefined || body instanceof FormData) {
    return { method, headers, body };
  }
  return {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function deploymentForm(name, files) {
  const form = new FormData();
  form.append('deployment-name', name);
  for (const file of files) {
    const xml = await readFile(file, 'utf8');
    form.append(basename(file), new Blob([xml], { type: 'text/xml' }), basename(file));
  }
  return form;
}

export function engineClient(endpoint, credentials) {
  const headers = authorization(credentials);

  async function call(method, path, body) {
    const response = await fetch(`${endpoint}${path}`, requestInit(method, headers, body));
    if (!response.ok) {
      throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? undefined : response.json();
  }

  return {
    endpoint,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    delete: (path) => call('DELETE', path),
    isReady: async () => (await fetch(`${endpoint}/process-definition/count`, { headers })).ok,
    async deploy(name, files) {
      const created = await call('POST', '/deployment/create', await deploymentForm(name, files));
      return Object.values(created.deployedProcessDefinitions);
    },
  };
}
