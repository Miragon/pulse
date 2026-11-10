import { CORE_ROUTES, type Route } from "@miragon/pulse-c7-core"

const PLACEHOLDER = /\{[^}]+\}/
const TEXT = "text/plain"

export class CoreRequests {
  static pathOf(route: Route, pathArgs: readonly string[]): string {
    const [head = "", ...rest] = route.path.split(PLACEHOLDER)
    return rest.reduce(
      (built, part, index) => `${built}${encodeURIComponent(pathArgs[index] ?? "")}${part}`,
      head,
    )
  }

  static answersText(route: Route): boolean {
    return route.accepts.length > 0 && route.accepts.every((type) => type === TEXT)
  }

  static textPath(operationId: string, resourceId: string): string {
    const route = Object.hasOwn(CORE_ROUTES, operationId) ? CORE_ROUTES[operationId] : undefined
    if (route === undefined || !CoreRequests.answersText(route)) {
      throw new RangeError(`The operation ${operationId} reads no text`)
    }
    return CoreRequests.pathOf(route, [resourceId])
  }
}
