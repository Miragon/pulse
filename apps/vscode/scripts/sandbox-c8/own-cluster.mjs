import { clientCredentialsLogin, clusterClient } from "../support/cluster-client.mjs"

const NEEDED = ["CAMUNDA_OAUTH_URL", "CAMUNDA_CLIENT_ID", "CAMUNDA_CLIENT_SECRET"]

function restAddressOf(environment) {
  const { CAMUNDA_CLUSTER_REGION: region, CAMUNDA_CLUSTER_ID: cluster } = environment
  if (region !== undefined && cluster !== undefined) {
    return `https://${region}.api.camunda.io/${cluster}/v2`
  }
  const address = environment.CAMUNDA_REST_ADDRESS?.replace(/\/+$/, "")
  return address === undefined || address.endsWith("/v2") ? address : `${address}/v2`
}

export function ownCluster(environment) {
  const endpoint = restAddressOf(environment)
  const missing = NEEDED.filter((name) => environment[name] === undefined)
  if (endpoint === undefined || missing.length > 0) {
    throw new Error(
      `Set the API client's connection information first: CAMUNDA_CLUSTER_REGION and CAMUNDA_CLUSTER_ID (or CAMUNDA_REST_ADDRESS), ${NEEDED.join(", ")} and, when it has one, CAMUNDA_TOKEN_AUDIENCE. Missing: ${[...(endpoint === undefined ? ["the cluster's address"] : []), ...missing].join(", ")}.`,
    )
  }
  const login = clientCredentialsLogin({
    tokenEndpoint: environment.CAMUNDA_OAUTH_URL,
    clientId: environment.CAMUNDA_CLIENT_ID,
    clientSecret: environment.CAMUNDA_CLIENT_SECRET,
    audience: environment.CAMUNDA_TOKEN_AUDIENCE,
  })
  return clusterClient(endpoint, login)
}
