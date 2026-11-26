export {}

declare module "vitest" {
  export interface ProvidedContext {
    readonly runsOnCi: boolean
  }
}
