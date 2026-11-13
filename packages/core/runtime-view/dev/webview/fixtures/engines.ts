import type { EngineBadge } from "../../../src/core/protocol/index.js"

export const LOCAL_ENGINE: EngineBadge = {
  name: "local",
  environment: "local",
  host: "localhost:8080",
  product: "Operaton 2.1.5",
}

export const PROD_ENGINE: EngineBadge = {
  name: "prod-eu",
  environment: "production",
  host: "operaton.prod-eu.acme.internal",
  product: "Operaton 2.1.5",
}

export const AS_OF = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 55_000).toISOString()

export function minutesBefore(minutes: number): string {
  return new Date(Date.parse(AS_OF) - minutes * 60_000).toISOString()
}

export function minutesAfter(minutes: number): string {
  return new Date(Date.parse(AS_OF) + minutes * 60_000).toISOString()
}
