import type * as vscode from "vscode"
import { describe, expect, test } from "vitest"
import { CredentialStore } from "../../src/host/connections/credential-store.js"
import { EngineBadges } from "../../src/host/connections/engine-badges.js"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host/connections/engine-target.js"
import { EnvironmentClassifier } from "../../src/host/connections/environment-classifier.js"
import { TargetPolicy } from "../../src/host/connections/target-policy.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"

const FILE = "/work/.pulse-cli.json"
const NONE = { user: undefined, workspace: [] }

function userSaid(user: Record<string, string>) {
  return { user, workspace: [] }
}

function remote(name: string, endpoint: string): EngineTarget {
  return { ...LOCAL_TARGET, name, endpoint, source: { kind: "file", path: FILE } }
}

describe("parsing the profiles of .pulse-cli.json", () => {
  test("reads each profile as an engine with url and auth", () => {
    const content = JSON.stringify({
      defaultProfile: "dev",
      profiles: {
        dev: { url: "https://dev.example.com/engine-rest" },
        "prod-eu": {
          url: "https://prod.example.com/engine-rest",
          flavor: "operaton",
          engine: "default",
          auth: { type: "basic", username: "demo" },
          readOnly: true,
        },
      },
    })

    expect(new TargetsParser(FILE).parse(content)).toEqual({
      targets: [
        {
          name: "dev",
          engine: "c7",
          endpoint: "https://dev.example.com/engine-rest",
          auth: { kind: "none" },
          source: { kind: "file", path: FILE },
        },
        {
          name: "prod-eu",
          engine: "c7",
          endpoint: "https://prod.example.com/engine-rest",
          auth: { kind: "basic" },
          source: { kind: "file", path: FILE },
          readOnly: true,
        },
      ],
      problems: [],
    })
  })

  test("reads the cockpit of a profile and refuses one that is no plain web URL", () => {
    const content = JSON.stringify({
      profiles: {
        dev: {
          url: "http://localhost:18090/engine-rest",
          cockpitUrl: "http://localhost:18090/operaton/app/cockpit/default/",
        },
        file: { url: "http://localhost:18091/engine-rest", cockpitUrl: "file:///etc/passwd" },
        secret: {
          url: "http://localhost:18092/engine-rest",
          cockpitUrl: "https://demo:demo@cockpit.example.com/camunda/app/cockpit/default/",
        },
      },
    })

    const parsed = new TargetsParser(FILE).parse(content)

    expect(parsed.targets).toEqual([
      expect.objectContaining({
        name: "dev",
        webUiUrl: "http://localhost:18090/operaton/app/cockpit/default/",
      }),
    ])
    expect(parsed.problems.map((problem) => problem.detail())).toEqual([
      `${FILE}: profile "file" needs a cockpitUrl that is an http or https URL without credentials`,
      `${FILE}: profile "secret" needs a cockpitUrl that is an http or https URL without credentials`,
    ])
  })

  test("skips profiles Pulse cannot serve and says why", () => {
    const content = JSON.stringify({
      profiles: {
        ok: { url: "http://localhost:8088/engine-rest", auth: { type: "oauth" } },
        cluster: { url: "http://localhost:8088/v2", flavor: "camunda8" },
        named: { url: "http://localhost:8080/engine-rest", engine: "orders" },
        "bad-url": { url: "not a url" },
        bearer: { url: "http://localhost:8080/engine-rest", auth: { type: "bearer" } },
        nonsense: "nonsense",
      },
    })

    const parsed = new TargetsParser(FILE).parse(content)

    expect(parsed.targets.map((target) => target.name)).toEqual(["ok"])
    expect(parsed.targets[0]?.auth).toEqual({ kind: "oauth2" })
    expect(parsed.problems.map((problem) => problem.detail())).toEqual([
      `${FILE}: profile "cluster" uses the flavor camunda8, which Pulse does not support yet`,
      `${FILE}: profile "named" names a process engine other than "default", which Pulse does not support yet`,
      `${FILE}: profile "bad-url" needs a valid url without credentials and an auth type Pulse supports (none, basic or oauth)`,
      `${FILE}: profile "bearer" needs a valid url without credentials and an auth type Pulse supports (none, basic or oauth)`,
      `${FILE}: profile "nonsense" is not an object`,
    ])
  })

  test("reports a malformed file instead of failing", () => {
    expect(new TargetsParser(FILE).parse("{")).toEqual({
      targets: [],
      problems: [{ path: FILE, message: "the file is not valid JSON" }],
    })
    expect(new TargetsParser(FILE).parse("{}").problems).toEqual([
      { path: FILE, message: 'the file needs a "profiles" object' },
    ])
  })

  test("names the broken file and what is wrong, for the error item in the Engines tree", () => {
    const [problem] = new TargetsParser(FILE).parse("{").problems

    expect(problem?.label()).toBe(".pulse-cli.json: the file is not valid JSON")
    expect(problem?.detail()).toBe(`${FILE}: the file is not valid JSON`)
    expect(problem?.path).toBe(FILE)
  })
})

describe("the environment of a target", () => {
  test("is local for loopback hosts", () => {
    for (const endpoint of [
      "http://localhost:8080/engine-rest",
      "http://127.0.0.1:8080/engine-rest",
      "http://[::1]:8080/engine-rest",
    ]) {
      expect(EnvironmentClassifier.classify(remote("x", endpoint), NONE)).toBe("local")
    }
  })

  test("is not local for the container host, as for writes", () => {
    const docker = remote("docker", "http://host.docker.internal:8080/engine-rest")
    expect(EnvironmentClassifier.classify(docker, NONE)).toBe("unclassified")
    expect(EnvironmentClassifier.classify(docker, userSaid({ docker: "test" }))).toBe("test")
  })

  test("is never local for a remote host, whatever the settings say", () => {
    const prod = remote("prod-eu", "https://prod.example.com/engine-rest")
    expect(EnvironmentClassifier.classify(prod, userSaid({ "prod-eu": "local" }))).toBe(
      "unclassified",
    )
    expect(
      EnvironmentClassifier.classify(
        remote("tricky", "http://localhost.evil.com/engine-rest"),
        NONE,
      ),
    ).toBe("unclassified")
  })

  test("may be raised by a workspace but never lowered by it", () => {
    const prod = remote("prod-eu", "https://prod.example.com/engine-rest")
    const local = remote("dev", "http://localhost:8080/engine-rest")
    expect(
      EnvironmentClassifier.classify(prod, { user: undefined, workspace: [{ "prod-eu": "test" }] }),
    ).toBe("unclassified")
    expect(
      EnvironmentClassifier.classify(prod, {
        user: { "prod-eu": "production" },
        workspace: [{ "prod-eu": "test" }],
      }),
    ).toBe("production")
    expect(
      EnvironmentClassifier.classify(local, { user: undefined, workspace: [{ dev: "test" }] }),
    ).toBe("test")
    expect(EnvironmentClassifier.classify(prod, userSaid({ "prod-eu": "test" }))).toBe("test")
  })

  test("is production only when configured, never guessed from the name", () => {
    const prod = remote("prod-eu", "https://prod.example.com/engine-rest")
    expect(EnvironmentClassifier.classify(prod, NONE)).toBe("unclassified")
    expect(EnvironmentClassifier.classify(prod, userSaid({ "prod-eu": "production" }))).toBe(
      "production",
    )
    expect(EnvironmentClassifier.classify(prod, userSaid({ "prod-eu": "nonsense" }))).toBe(
      "unclassified",
    )
  })

  test("shapes the badge with the host of the endpoint", () => {
    const prod = remote("prod-eu", "https://prod.example.com:8443/engine-rest")
    expect(EngineBadges.of(prod, "production", "Operaton 2.1.5")).toEqual({
      name: "prod-eu",
      environment: "production",
      host: "prod.example.com:8443",
      product: "Operaton 2.1.5",
    })
  })
})

describe("the secret scope", () => {
  function inMemorySecrets() {
    const stored = new Map<string, string>()
    const secrets: Pick<vscode.SecretStorage, "get" | "store"> = {
      get: (key) => Promise.resolve(stored.get(key)),
      store: (key, value) => {
        stored.set(key, value)
        return Promise.resolve()
      },
    }
    return { stored, store: new CredentialStore(secrets as vscode.SecretStorage) }
  }

  test("follows the modeler scheme of file path and target name", async () => {
    const { stored, store } = inMemorySecrets()
    await store.write(remote("dev", "http://x"), "demo", "demo")
    await store.write(LOCAL_TARGET, "demo", "demo")
    expect([...stored.keys()].filter((key) => key.endsWith(".username"))).toEqual([
      `pulse.connection.${FILE}::dev.username`,
      "pulse.connection.default::local.username",
    ])
  })
})

describe("the target policy", () => {
  const basic = (name: string, endpoint: string): EngineTarget => ({
    ...remote(name, endpoint),
    auth: { kind: "basic" },
  })

  test("refuses endpoints that carry credentials", () => {
    const parsed = new TargetsParser(FILE).parse(
      JSON.stringify({
        profiles: { x: { url: "https://user:secret@x.example.com/engine-rest" } },
      }),
    )
    expect(parsed.targets).toEqual([])
  })

  test("refuses credentials saved for another endpoint", () => {
    expect(
      TargetPolicy.refusal(basic("prod-eu", "https://evil.example.com/engine-rest"), {
        kind: "savedForAnotherEndpoint",
        savedFor: "https://prod.example.com",
      }),
    ).toContain("changed since its credentials were saved for https://prod.example.com")
  })

  test("refuses basic authentication over plain HTTP to a remote host", () => {
    expect(
      TargetPolicy.refusal(basic("dev", "http://dev.example.com/engine-rest"), { kind: "none" }),
    ).toContain("plain HTTP")
    expect(
      TargetPolicy.refusal(basic("local", "http://localhost:8080/engine-rest"), { kind: "none" }),
    ).toBeUndefined()
  })

  test("refuses OAuth2 until it is supported", () => {
    expect(
      TargetPolicy.refusal(
        { ...remote("o", "https://o.example.com"), auth: { kind: "oauth2" } },
        { kind: "none" },
      ),
    ).toContain("OAuth2")
  })
})
