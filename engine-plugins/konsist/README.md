# konsist: architecture tests

Shared [Konsist](https://github.com/LemonAppDev/konsist) base classes that encode the architectural conventions of the `engine-plugins/` subprojects as JUnit tests. Rules live here once so every subproject can pick them up with a two-line `@Nested` wrapper.

## Phase 1 scope

One rule, in `ArchitectureTest`:

- **Every class resides in a declared package under the module root**: guards against stray files landing outside the expected namespace.

This is intentionally minimal. Phase 2 adds more rules (no-wildcard-imports, engine-adapter architecture, shared-layer isolation, …) once module shapes stabilize.

## Consuming from a subproject

1. In the subproject's `build.gradle.kts`:
   ```kotlin
   dependencies {
       testImplementation(project(":konsist"))
   }
   ```
2. Add `src/test/kotlin/<rootPackage>/KonsistArchitectureTest.kt`. Pass the Gradle module name (so Konsist scopes to that module only) and the root package to enforce:

   ```kotlin
   package io.miragon.mcp.cibseven

   import io.miragon.mcp.konsist.ArchitectureTest
   import org.junit.jupiter.api.Nested

   class KonsistArchitectureTest {
       @Nested
       inner class Guidelines : ArchitectureTest("cibseven-history-metrics", "io.miragon.mcp.cibseven")
   }
   ```

3. `./gradlew :<subproject>:test` runs the Konsist checks alongside regular unit tests.

## Adding a new rule

Prefer adding tests to `ArchitectureTest` or a new abstract class rather than spreading bespoke Konsist code across subprojects: the monorepo pattern only pays off if the rules are shared.

1. Either add a `@Test fun` to an existing abstract class, or create a new one (e.g. `EngineAdapterArchitectureTest(rootPackage: String, engineName: String, otherEngines: List<String>)`) in `src/main/kotlin/io/miragon/mcp/konsist/`.
2. In the consuming subproject's `KonsistArchitectureTest`, add another `@Nested inner class` that extends the new base and passes the right parameters.
3. Run `./gradlew :<subproject>:test` to verify.

Candidate additions tracked in the Phase 2 section of the guardrails plan:

- `NoWildcardImportsTest`: ban `import foo.*` (except `java.util.*`)
- `EngineAdapterArchitectureTest`: forbid cross-engine imports, enforce single `*MetricsPlugin`, handler implements `HistoryEventHandler`
- `SharedInfrastructureTest`: shared module does not import any engine package
- `ConfigurationPropertiesTest`: `@ConfigurationProperties` prefixes follow the agreed namespace
