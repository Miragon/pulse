import type { ElementImplementation, SourceLocation } from "../model/local-sources.js"

export interface CodeLocator {
  locate(implementation: ElementImplementation): Promise<SourceLocation | undefined>
}
