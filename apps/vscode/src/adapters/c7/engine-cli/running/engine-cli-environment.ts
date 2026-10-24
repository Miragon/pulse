export type EngineCliCredentials =
  | { readonly kind: 'none' }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | { readonly kind: 'bearer'; readonly token: string };

export interface EngineCliConnection {
  readonly url: string;
  readonly credentials: EngineCliCredentials;
  readonly configPath: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export type EngineCliAccess = 'read' | 'write';

const OPERATE_VARIABLE = /^OPERATE_/i;
const NODE_VARIABLE = /^NODE_/i;
const TRUSTED_CERTIFICATE_VARIABLES: ReadonlySet<string> = new Set([
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
]);
const LIBRARY_INJECTION_VARIABLES: ReadonlySet<string> = new Set([
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
]);

export class EngineCliEnvironment {
  static of(
    connection: EngineCliConnection,
    base: Environment,
    access: EngineCliAccess = 'read',
  ): Record<string, string> {
    return {
      ...EngineCliEnvironment.inheritedVariables(base),
      ELECTRON_RUN_AS_NODE: '1',
      OPERATE_URL: connection.url,
      OPERATE_OUTPUT: 'json',
      ...(access === 'read' ? { OPERATE_READ_ONLY: '1' } : {}),
      OPERATE_CONFIG: connection.configPath,
      ...EngineCliEnvironment.credentialVariables(connection.credentials),
    };
  }

  private static credentialVariables(credentials: EngineCliCredentials): Record<string, string> {
    switch (credentials.kind) {
      case 'none':
        return { OPERATE_AUTH: 'none' };
      case 'basic':
        return {
          OPERATE_AUTH: 'basic',
          OPERATE_USERNAME: credentials.username,
          OPERATE_PASSWORD: credentials.password,
        };
      case 'bearer':
        return { OPERATE_AUTH: 'bearer', OPERATE_TOKEN: credentials.token };
    }
  }

  private static isInheritable(name: string): boolean {
    const upperName = name.toUpperCase();
    if (OPERATE_VARIABLE.test(name) || LIBRARY_INJECTION_VARIABLES.has(upperName)) {
      return false;
    }
    return !NODE_VARIABLE.test(name) || TRUSTED_CERTIFICATE_VARIABLES.has(upperName);
  }

  private static inheritedVariables(base: Environment): Record<string, string> {
    return Object.fromEntries(
      Object.entries(base).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && EngineCliEnvironment.isInheritable(entry[0]),
      ),
    );
  }
}
