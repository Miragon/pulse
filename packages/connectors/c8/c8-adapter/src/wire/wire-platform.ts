export interface WirePlatform {
  readonly send: typeof fetch
  now(): number
}
