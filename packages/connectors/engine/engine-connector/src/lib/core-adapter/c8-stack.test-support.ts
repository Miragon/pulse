/**
 * The Camunda 8 stack of the connector's Camunda 8 suite, which c8-cluster.test-support.ts starts:
 * a trimmed copy of the C8 adapter's (packages/connectors/c8/c8-adapter/test/support/
 * cluster-settings.json and keycloak-realm.json), since no package shares a Node test helper with
 * another: one login that seeds the world and one that reads it, the reader's grants as the
 * adapter's. engines-config.test.ts holds every value here to the adapter's files, so a bump there
 * fails here until this copy follows.
 */

type Environment = Readonly<Record<string, string>>

/** The realm of the cluster's clients and the audience their tokens name. */
export const C8_REALM = "pulse"
export const C8_AUDIENCE = "camunda"

/** What the reader grants: the definitions, the instances and their tasks, as in the adapter's. */
const READ_GRANTS = "READ_PROCESS_DEFINITION,READ_PROCESS_INSTANCE,READ_USER_TASK"
const GRANTS_OF_READER = (type: "USER" | "CLIENT", id: string): Environment => ({
  CAMUNDA_SECURITY_INITIALIZATION_AUTHORIZATIONS_0_OWNER_TYPE: type,
  CAMUNDA_SECURITY_INITIALIZATION_AUTHORIZATIONS_0_OWNER_ID: id,
  CAMUNDA_SECURITY_INITIALIZATION_AUTHORIZATIONS_0_RESOURCE_TYPE: "PROCESS_DEFINITION",
  CAMUNDA_SECURITY_INITIALIZATION_AUTHORIZATIONS_0_RESOURCE_ID: "*",
  CAMUNDA_SECURITY_INITIALIZATION_AUTHORIZATIONS_0_PERMISSIONS: READ_GRANTS,
})

const USER = (index: number, name: string): Environment => {
  const prefix = `CAMUNDA_SECURITY_INITIALIZATION_USERS_${index}`
  return {
    [`${prefix}_USERNAME`]: name,
    [`${prefix}_PASSWORD`]: `${name}-password`,
    [`${prefix}_NAME`]: name,
    [`${prefix}_EMAIL`]: `${name}@example.com`,
  }
}

const STORAGE: Readonly<Record<string, Environment>> = {
  h2: {
    CAMUNDA_DATA_SECONDARYSTORAGE_TYPE: "rdbms",
    CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_URL: "jdbc:h2:mem:pulse;DB_CLOSE_DELAY=-1;MODE=PostgreSQL",
    CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_USERNAME: "sa",
    CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_PASSWORD: "",
    CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_FLUSHINTERVAL: "PT0S",
  },
  elasticsearch: {
    CAMUNDA_DATA_SECONDARYSTORAGE_TYPE: "elasticsearch",
    CAMUNDA_DATA_SECONDARYSTORAGE_ELASTICSEARCH_URL: "http://elasticsearch:9200",
  },
}

const SECURITY: Readonly<Record<string, Environment>> = {
  none: {
    CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI: "true",
    CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED: "false",
  },
  basic: {
    CAMUNDA_SECURITY_AUTHENTICATION_METHOD: "basic",
    CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI: "false",
    CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED: "true",
    ...USER(0, "seed"),
    ...USER(1, "reader"),
    CAMUNDA_SECURITY_INITIALIZATION_DEFAULTROLES_ADMIN_USERS_0: "seed",
    ...GRANTS_OF_READER("USER", "reader"),
  },
  oidc: {
    CAMUNDA_SECURITY_AUTHENTICATION_METHOD: "oidc",
    CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI: "false",
    CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED: "true",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_ISSUERURI: `http://keycloak:8080/realms/${C8_REALM}`,
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_CLIENTID: "camunda-app",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_CLIENTSECRET: "camunda-app-secret",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_REDIRECTURI: "http://localhost:8080/sso-callback",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_USERNAMECLAIM: "preferred_username",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_CLIENTIDCLAIM: "azp",
    CAMUNDA_SECURITY_AUTHENTICATION_OIDC_AUDIENCES: C8_AUDIENCE,
    CAMUNDA_SECURITY_INITIALIZATION_DEFAULTROLES_ADMIN_CLIENTS_0: "pulse-seed",
    ...GRANTS_OF_READER("CLIENT", "pulse-reader"),
  },
}

/** A client of the realm with a service account whose tokens name the cluster's audience. */
const SERVICE_CLIENT = (name: string) => ({
  clientId: `pulse-${name}`,
  secret: `${name}-secret`,
  enabled: true,
  publicClient: false,
  standardFlowEnabled: false,
  serviceAccountsEnabled: true,
  protocolMappers: [
    {
      name: "aud",
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      config: { "included.custom.audience": C8_AUDIENCE, "access.token.claim": "true" },
    },
  ],
})

/** The realm: the cluster's own client, the client that seeds the world and the one that reads it. */
const KEYCLOAK_REALM = {
  realm: C8_REALM,
  enabled: true,
  sslRequired: "none",
  accessTokenLifespan: 300,
  clients: [
    {
      clientId: "camunda-app",
      secret: "camunda-app-secret",
      enabled: true,
      publicClient: false,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      redirectUris: ["*"],
    },
    SERVICE_CLIENT("seed"),
    SERVICE_CLIENT("reader"),
  ],
}

/**
 * The stack in the shape of the adapter's cluster-settings.json (its images but the cluster's,
 * which `PULSE_ENGINE_IMAGE` names, and each container's environment), with the realm.
 */
export const C8_STACK = {
  images: {
    keycloak: "quay.io/keycloak/keycloak:26.8.2",
    elasticsearch: "docker.elastic.co/elasticsearch/elasticsearch:9.5.5",
  },
  camunda: { SPRING_PROFILES_ACTIVE: "broker,consolidated-auth,security" },
  keycloak: {
    KC_BOOTSTRAP_ADMIN_USERNAME: "admin",
    KC_BOOTSTRAP_ADMIN_PASSWORD: "admin",
    KC_HOSTNAME: "http://keycloak:8080",
  },
  elasticsearch: {
    "discovery.type": "single-node",
    "xpack.security.enabled": "false",
    "cluster.routing.allocation.disk.threshold_enabled": "false",
    ES_JAVA_OPTS: "-Xms1g -Xmx1g",
  },
  storage: STORAGE,
  security: SECURITY,
  realm: KEYCLOAK_REALM,
}
