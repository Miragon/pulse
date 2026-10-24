/**
 * The OAuth topology of design §16.14.1: Keycloak (realm imported from a fixture) and an unmodified
 * engine on one Docker network, with an Envoy `jwt_authn` gateway in front of the engine that
 * checks the Bearer token (the engines have no OAuth resource server of their own).
 *
 * ```
 * operate ──http://localhost:<envoy>/engine-rest──▶ Envoy ──http://engine-<name>:8080──▶ engine
 *    └──discovery, token, revoke──▶ Keycloak (alias keycloak) ◀──JWKS── Envoy
 * ```
 *
 * Keycloak in dev mode builds the issuer from the request's Host header, so the tokens carry the
 * host-side URL the CLI used. Envoy fetches the JWKS through the network alias but expects exactly
 * that host-side issuer, which is only known once Keycloak's port is mapped.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import {
  ENGINE_NAMES,
  type EngineName,
  isEngineEnabled,
  type RunningEngine,
  startEngine,
} from './engines.js';

const KEYCLOAK_IMAGE = 'quay.io/keycloak/keycloak:26.8.0';
const ENVOY_IMAGE = 'envoyproxy/envoy:v1.39.3';
/** Port of Keycloak and of the Envoy listener inside their containers. */
const HTTP_PORT = 8080;
const REALM = 'operate';
const STARTUP_TIMEOUT_MS = 180_000;
const ENVOY_STARTUP_TIMEOUT_MS = 60_000;
/** Timeout of the `beforeAll` that starts the topology: image pulls plus startups. */
export const TOPOLOGY_START_TIMEOUT_MS = 300_000;
/** Host names that reach the mapped ports of the Docker host on this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export interface OAuthTopology {
  readonly engine: EngineName;
  /** Host name of the mapped ports (`localhost` with a local Docker). */
  readonly host: string;
  /** Keycloak's mapped port. */
  readonly keycloakPort: number;
  /** Keycloak's root URL from the host, e.g. `http://localhost:32770`. */
  readonly keycloakUrl: string;
  /** The issuer every profile uses and Envoy expects: `<keycloakUrl>/realms/operate`. */
  readonly issuer: string;
  /** REST API root behind the gateway, e.g. `http://localhost:32771/engine-rest`. */
  readonly url: string;
  /** Stops Envoy, the engine, Keycloak and the network (in that order). */
  stop(): Promise<void>;
}

/**
 * The engine of the OAuth scenario: the first enabled one. The gateway checks the token, so one
 * engine is enough; every CI leg (one engine each) runs the scenario against its engine.
 */
export function oauthEngine(): EngineName | undefined {
  return ENGINE_NAMES.find((name) => isEngineEnabled(name));
}

async function startKeycloak(network: StartedNetwork): Promise<StartedTestContainer> {
  const realm = await readFile(fixture('keycloak-realm.json'), 'utf8');
  return new GenericContainer(KEYCLOAK_IMAGE)
    .withNetwork(network)
    .withNetworkAliases('keycloak')
    .withExposedPorts(HTTP_PORT)
    .withEnvironment({ KC_BOOTSTRAP_ADMIN_USERNAME: 'admin', KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin' })
    .withCopyContentToContainer([
      { content: realm, target: `/opt/keycloak/data/import/realm-${REALM}.json` },
    ])
    .withCommand(['start-dev', '--import-realm'])
    .withWaitStrategy(
      Wait.forHttp(`/realms/${REALM}/.well-known/openid-configuration`, HTTP_PORT).forStatusCode(
        200,
      ),
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
}

async function startEnvoy(
  network: StartedNetwork,
  issuer: string,
  upstream: string,
): Promise<StartedTestContainer> {
  const template = await readFile(fixture('envoy.yaml'), 'utf8');
  const config = template.replaceAll('${ISSUER}', issuer).replaceAll('${UPSTREAM}', upstream);
  return (
    new GenericContainer(ENVOY_IMAGE)
      .withNetwork(network)
      .withExposedPorts(HTTP_PORT)
      // the image's CMD is `envoy -c /etc/envoy/envoy.yaml`
      .withCopyContentToContainer([{ content: config, target: '/etc/envoy/envoy.yaml' }])
      // a request without a token is refused once the listener and the JWKS are ready
      .withWaitStrategy(Wait.forHttp('/engine-rest/version', HTTP_PORT).forStatusCode(401))
      .withStartupTimeout(ENVOY_STARTUP_TIMEOUT_MS)
      .start()
  );
}

/** Stops whatever was started, newest first, and reports the first failure after trying all. */
async function stopAll(stoppers: readonly (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const stop of [...stoppers].reverse()) {
    try {
      await stop();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new Error('Cannot stop the OAuth topology', { cause: failures[0] });
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}

/**
 * Starts Keycloak and the engine in parallel, then Envoy (its configuration needs the issuer).
 * Anything already started is stopped again when a later step fails.
 */
export async function startOAuthTopology(engine: EngineName): Promise<OAuthTopology> {
  const network = await new Network().start();
  const stoppers: (() => Promise<unknown>)[] = [() => network.stop()];
  try {
    const upstream = `engine-${engine}`;
    const [keycloakResult, engineResult] = await Promise.allSettled([
      startKeycloak(network),
      startEngine(engine, { network, alias: upstream }),
    ]);
    // stopped in reverse order: Envoy, engine, Keycloak, network
    const startedKeycloak = fulfilled(keycloakResult);
    if (startedKeycloak !== undefined) stoppers.push(() => startedKeycloak.stop());
    const started: RunningEngine | undefined = fulfilled(engineResult);
    if (started !== undefined) stoppers.push(() => started.stop());
    if (keycloakResult.status === 'rejected') throw keycloakResult.reason;
    if (engineResult.status === 'rejected') throw engineResult.reason;
    const keycloak = keycloakResult.value;
    const host = keycloak.getHost();
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `The Docker host is "${host}", not this machine: operate accepts http issuers only on ` +
          'loopback hosts, so the OAuth integration test needs a local Docker daemon',
      );
    }
    const keycloakPort = keycloak.getMappedPort(HTTP_PORT);
    const keycloakUrl = `http://${host}:${keycloakPort}`;
    const issuer = `${keycloakUrl}/realms/${REALM}`;
    const envoy = await startEnvoy(network, issuer, upstream);
    stoppers.push(() => envoy.stop());
    const url = `http://${envoy.getHost()}:${envoy.getMappedPort(HTTP_PORT)}/engine-rest`;
    return { engine, host, keycloakPort, keycloakUrl, issuer, url, stop: () => stopAll(stoppers) };
  } catch (error) {
    await stopAll(stoppers).catch(() => undefined);
    throw error;
  }
}
