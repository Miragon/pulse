/**
 * Gradle without a local JDK: when the playground engine jar needs a build, and how a Gradle
 * build runs, on a local JDK 21 or in a JDK 21 container (pure; scripts/local-gradle.test.mjs).
 */
import path from "node:path"

/** The jar the engine image copies (playground/cibseven-example/Dockerfile). */
export const ENGINE_JAR = "playground/cibseven-example/build/libs/cibseven-example.jar"

/**
 * What the jar is built from: the example and the engine plugin it includes as a composite
 * build, with the version catalog both read. Build output inside them is skipped.
 */
export const ENGINE_JAR_SOURCES = [
  "playground/cibseven-example/src",
  "playground/cibseven-example/build.gradle.kts",
  "playground/cibseven-example/settings.gradle.kts",
  "playground/cibseven-example/gradle.properties",
  "playground/cibseven-example/gradle/wrapper/gradle-wrapper.properties",
  "engine-plugins/cibseven-history-metrics/src",
  "engine-plugins/cibseven-history-metrics/build.gradle.kts",
  "engine-plugins/build.gradle.kts",
  "engine-plugins/settings.gradle.kts",
  "engine-plugins/gradle.properties",
  "engine-plugins/gradle/libs.versions.toml",
]

/** The JDK image a container build runs in, and the volume that keeps its Gradle cache. */
export const JDK_IMAGE = "eclipse-temurin:21-jdk"
export const GRADLE_CACHE_VOLUME = "pulse-gradle-cache"

/** Both Gradle builds set `jvmToolchain(21)` and no toolchain resolver: only a JDK 21 builds. */
export const JDK_MAJOR = 21

/** The jar needs a build when it is missing or older than its newest source. */
export const jarIsStale = (jarMtimeMs, newestSourceMtimeMs) =>
  jarMtimeMs === undefined || newestSourceMtimeMs > jarMtimeMs

/** The major version in `java -version` output (`"21.0.4"` → 21, `"1.8.0_292"` → 8). */
export function parseJavaMajor(versionOutput) {
  const version = /version "([^"]+)"/.exec(versionOutput ?? "")?.[1]
  if (version === undefined) return undefined
  const [first, second] = version.split(/[.+_-]/).map(Number)
  return first === 1 ? second : first
}

/**
 * Where Gradle runs: `{ kind: "local", javaHome? }` on a JDK 21 found as JAVA_HOME, by macOS's
 * java_home or as `java` on the PATH, else `{ kind: "container", reason }`.
 * `forceContainer` (--jdk-container) skips the local JDK.
 */
export function pickJdk({ forceContainer, javaHome, javaHomeMajor, macJdk21, pathMajor }) {
  if (forceContainer) return { kind: "container", reason: "--jdk-container" }
  if (javaHome && javaHomeMajor === JDK_MAJOR) return { kind: "local", javaHome }
  if (macJdk21) return { kind: "local", javaHome: macJdk21 }
  if (!javaHome && pathMajor === JDK_MAJOR) return { kind: "local" }
  const found = javaHomeMajor ?? pathMajor
  return {
    kind: "container",
    reason: found === undefined ? "no local JDK" : `the local JDK is ${found}, not ${JDK_MAJOR}`,
  }
}

/** The Gradle builds a container build writes into. */
const GRADLE_PROJECTS = ["engine-plugins", "playground/cibseven-example"]

/** What Gradle writes there: its build, project-cache and Kotlin dirs and what is in them. */
const BUILD_OUTPUT = [".gradle", "build", ".kotlin"]
  .flatMap((dir) => [`-name ${dir}`, `-path '*/${dir}/*'`])
  .join(" -o ")

/**
 * The command that runs `tasks` in the Gradle build `project` (relative to `repoRoot`):
 * `{ command, args, cwd, env }`. A container build mounts the whole repository (the example
 * includes ../../engine-plugins) and keeps Gradle's cache in a named volume. `--init` with
 * TINI_KILL_PROCESS_GROUP lets Ctrl-C reach Gradle (a shell as PID 1 ignores SIGINT).
 * On Linux the container's root writes the build output as root; the hand-back gives it to the
 * caller's user, also after Ctrl-C. Under a user namespace (rootless Docker, Docker Desktop for
 * Linux) the repository itself shows as uid 0 and the output is already the caller's, so the
 * hand-back skips it (a chown there would give the caller's sources to a subuid).
 */
export function gradleCommand(jdk, { repoRoot, project, tasks, platform, uid, gid }) {
  if (jdk.kind === "local") {
    const cwd = path.join(repoRoot, project)
    const env = jdk.javaHome ? { JAVA_HOME: jdk.javaHome } : {}
    return platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/c", "gradlew.bat", ...tasks, "--no-daemon"], cwd, env }
      : { command: "./gradlew", args: [...tasks, "--no-daemon"], cwd, env }
  }
  const gradle = `sh ./gradlew ${tasks.join(" ")} --no-daemon`
  const script =
    platform === "linux" && uid !== undefined
      ? [
          `handback() { [ "$(stat -c %u /repo)" = 0 ] || find ${GRADLE_PROJECTS.map((dir) => `/repo/${dir}`).join(" ")} -user 0 \\( ${BUILD_OUTPUT} \\) -exec chown ${uid}:${gid} {} +; }`,
          "trap 'handback; exit 130' INT TERM",
          `${gradle}; status=$?; handback; exit $status`,
        ].join("; ")
      : gradle
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--init",
      "--env",
      "TINI_KILL_PROCESS_GROUP=1",
      "--mount",
      `type=bind,source=${repoRoot},target=/repo`,
      "--mount",
      `type=volume,source=${GRADLE_CACHE_VOLUME},target=/root/.gradle`,
      "--workdir",
      `/repo/${project}`,
      JDK_IMAGE,
      "sh",
      "-c",
      script,
    ],
    cwd: repoRoot,
    env: {},
  }
}

/**
 * The note for a stack that runs while the jar here is missing or older than its sources
 * (stack:up reuses a running stack as it is). Without a jar here, nothing says which checkout
 * built the running engine (another worktree, or this one before its build output went): every
 * worktree shares the stack, so that note never tells it to stop it.
 */
export const staleJarNote = (jarMtimeMs) =>
  jarMtimeMs === undefined
    ? "This checkout has no engine jar, so the running engine may not match its engine plugin " +
      "and example (another checkout, a worktree say, may have built it). The playground is " +
      "shared and keeps running as it is."
    : "The engine jar here is older than its sources, so the running engine may lack changes " +
      "to the engine plugin or the example; pnpm stack:down && pnpm stack:up rebuilds and " +
      "redeploys it."

/** One line on where Gradle runs. */
export const describeJdk = (jdk) =>
  jdk.kind === "local"
    ? `local JDK ${JDK_MAJOR}${jdk.javaHome ? ` (${jdk.javaHome})` : ""}`
    : `${JDK_IMAGE} container, ${jdk.reason}`
