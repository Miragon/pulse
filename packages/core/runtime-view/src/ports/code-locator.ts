import type { ElementImplementation, SourceLocation } from "./local-sources.js"

export interface CodeLocator {
  locate(implementation: ElementImplementation): Promise<SourceLocation | undefined>
}
