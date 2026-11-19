import type { Environment } from "../../core/protocol/index.js"
import type { EngineTarget } from "./engine-target.js"
import type { EnvironmentSettings } from "./environment-settings.js"
import { TargetHosts } from "./target-hosts.js"

const RANKS: Readonly<Record<Environment, number>> = {
  local: 0,
  test: 1,
  unclassified: 2,
  production: 3,
}

export class EnvironmentClassifier {
  static classify(target: EngineTarget, settings: EnvironmentSettings): Environment {
    const loopback = TargetHosts.isLoopback(target)
    const environmentIn = (scope: EnvironmentSettings["user"]) =>
      EnvironmentClassifier.environmentOf(scope?.[target.name], loopback)
    const own = environmentIn(settings.user) ?? (loopback ? "local" : "unclassified")
    const raised = [
      EnvironmentClassifier.namedByProfile(target),
      ...settings.workspace.map(environmentIn),
    ]
    return raised.reduce<Environment>(
      (environment, raise) => EnvironmentClassifier.higher(environment, raise),
      own,
    )
  }

  static namedByProfile(target: EngineTarget): Environment | undefined {
    const named = target.environment
    if (named === undefined || named === "local") {
      return undefined
    }
    return named === "test" || named === "production" ? named : "unclassified"
  }

  private static environmentOf(value: unknown, loopback: boolean): Environment | undefined {
    if (value !== "local" && value !== "test" && value !== "production") {
      return undefined
    }
    return value === "local" && !loopback ? undefined : value
  }

  private static higher(left: Environment, right: Environment | undefined): Environment {
    return right !== undefined && RANKS[right] > RANKS[left] ? right : left
  }
}
