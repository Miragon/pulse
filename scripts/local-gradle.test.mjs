import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  ENGINE_JAR,
  ENGINE_JAR_SOURCES,
  GRADLE_CACHE_VOLUME,
  gradleCommand,
  JDK_IMAGE,
  jarIsStale,
  parseJavaMajor,
  pickJdk,
  staleJarNote,
} from "./local-gradle.mjs"

const repoFile = (rel) => new URL(`../${rel}`, import.meta.url)

describe("the engine jar", () => {
  it("is the jar the engine image copies", () => {
    const dockerfile = readFileSync(repoFile("playground/cibseven-example/Dockerfile"), "utf8")
    const copied = /COPY (\S+) app\.jar/.exec(dockerfile)?.[1]
    assert.equal(`playground/cibseven-example/${copied}`, ENGINE_JAR)
  })

  it("is built from sources that exist", () => {
    for (const source of ENGINE_JAR_SOURCES) assert.ok(existsSync(repoFile(source)), source)
  })

  it("needs a build when missing or older than its newest source", () => {
    assert.equal(jarIsStale(undefined, 0), true)
    assert.equal(jarIsStale(1000, 2000), true)
    assert.equal(jarIsStale(2000, 2000), false)
    assert.equal(jarIsStale(3000, 2000), false)
  })

  it("says when a running engine may lack this checkout's changes", () => {
    assert.match(staleJarNote(1000), /older than its sources/)
    assert.match(staleJarNote(1000), /pnpm stack:down && pnpm stack:up/)
  })

  it("never tells a checkout without a jar to stop the stack every worktree shares", () => {
    assert.match(staleJarNote(undefined), /no engine jar, so the running engine may not match/)
    assert.match(staleJarNote(undefined), /shared and keeps running/)
    assert.doesNotMatch(staleJarNote(undefined), /stack:down/)
  })

  it("keeps the wrapper and the shell scripts LF on every checkout (sh runs them in Linux)", () => {
    const rules = readFileSync(repoFile(".gitattributes"), "utf8").split("\n")
    assert.ok(rules.includes("gradlew text eol=lf"))
    assert.ok(rules.includes("*.sh text eol=lf"))
  })
})

describe("the JDK", () => {
  it("reads the major version of java -version", () => {
    assert.equal(parseJavaMajor('openjdk version "21.0.11" 2026-04-21 LTS'), 21)
    assert.equal(parseJavaMajor('openjdk version "25" 2025-09-16'), 25)
    assert.equal(parseJavaMajor('java version "1.8.0_292"'), 8)
    assert.equal(parseJavaMajor(undefined), undefined)
    assert.equal(parseJavaMajor("command not found"), undefined)
  })

  it("is the local JDK 21 when there is one", () => {
    assert.deepEqual(pickJdk({ javaHome: "/jdk21", javaHomeMajor: 21 }), {
      kind: "local",
      javaHome: "/jdk21",
    })
    assert.deepEqual(pickJdk({ javaHome: "/jdk25", javaHomeMajor: 25, macJdk21: "/mac21" }), {
      kind: "local",
      javaHome: "/mac21",
    })
    assert.deepEqual(pickJdk({ pathMajor: 21 }), { kind: "local" })
  })

  it("is a container without a local JDK 21: jvmToolchain(21) accepts no other", () => {
    assert.deepEqual(pickJdk({}), { kind: "container", reason: "no local JDK" })
    assert.deepEqual(pickJdk({ pathMajor: 25 }), {
      kind: "container",
      reason: "the local JDK is 25, not 21",
    })
    // gradlew prefers JAVA_HOME over the PATH, so a JDK 21 on the PATH does not help.
    assert.equal(
      pickJdk({ javaHome: "/jdk17", javaHomeMajor: 17, pathMajor: 21 }).kind,
      "container",
    )
    assert.deepEqual(pickJdk({ forceContainer: true, javaHome: "/jdk21", javaHomeMajor: 21 }), {
      kind: "container",
      reason: "--jdk-container",
    })
  })

  it("names JDK 21 in the image and in both Gradle builds", () => {
    assert.match(JDK_IMAGE, /:21-jdk$/)
    for (const build of [
      "playground/cibseven-example/build.gradle.kts",
      "engine-plugins/build.gradle.kts",
    ]) {
      assert.match(readFileSync(repoFile(build), "utf8"), /jvmToolchain\(21\)/, build)
    }
  })
})

describe("gradleCommand", () => {
  const where = { repoRoot: "/repo-root", project: "engine-plugins", tasks: ["build"] }

  it("runs the wrapper on the local JDK", () => {
    assert.deepEqual(
      gradleCommand({ kind: "local", javaHome: "/jdk21" }, { ...where, platform: "darwin" }),
      {
        command: "./gradlew",
        args: ["build", "--no-daemon"],
        cwd: "/repo-root/engine-plugins",
        env: { JAVA_HOME: "/jdk21" },
      },
    )
  })

  it("goes through cmd.exe on Windows, which cannot spawn a .bat without a shell", () => {
    const { command, args } = gradleCommand({ kind: "local" }, { ...where, platform: "win32" })
    assert.equal(command, "cmd.exe")
    assert.deepEqual(args, ["/d", "/c", "gradlew.bat", "build", "--no-daemon"])
  })

  it("mounts the repository and a cache volume into the JDK container", () => {
    const { command, args } = gradleCommand(
      { kind: "container", reason: "no local JDK" },
      { ...where, platform: "darwin" },
    )
    assert.equal(command, "docker")
    assert.deepEqual(args.slice(0, 11), [
      "run",
      "--rm",
      "--init",
      "--env",
      "TINI_KILL_PROCESS_GROUP=1",
      "--mount",
      "type=bind,source=/repo-root,target=/repo",
      "--mount",
      `type=volume,source=${GRADLE_CACHE_VOLUME},target=/root/.gradle`,
      "--workdir",
      "/repo/engine-plugins",
    ])
    assert.deepEqual(args.slice(11), [JDK_IMAGE, "sh", "-c", "sh ./gradlew build --no-daemon"])
  })

  describe("on Linux, where the container's root writes the build output", () => {
    const script = gradleCommand(
      { kind: "container", reason: "no local JDK" },
      { ...where, platform: "linux", uid: 1000, gid: 1001 },
    ).args.at(-1)

    it("hands the output back to the caller and keeps Gradle's exit code", () => {
      assert.match(
        script,
        /sh \.\/gradlew build --no-daemon; status=\$\?; handback; exit \$status$/,
      )
      assert.match(script, /-user 0 .* -exec chown 1000:1001 \{\} \+/)
    })

    it("hands back after Ctrl-C too", () => {
      assert.match(script, /trap 'handback; exit 130' INT TERM; sh \.\/gradlew/)
    })

    it("touches only build output, and nothing under a user namespace", () => {
      // Rootless Docker shows the caller's own repository as uid 0: a chown would give it away.
      assert.match(script, /handback\(\) \{ \[ "\$\(stat -c %u \/repo\)" = 0 \] \|\| find /)
      assert.match(script, /\\\( -name \.gradle -o -path '\*\/\.gradle\/\*' -o -name build -o /)
    })
  })
})
