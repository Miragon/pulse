import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  EXE_TARGETS,
  exeTarget,
  injectOptions,
  SEA_RESOURCE,
  SEA_SENTINEL_FUSE,
  seaConfig,
  sharedLibraries,
} from "./sea.js"

describe("exeTarget", () => {
  it.each([
    ["linux", "x64", "pulse-cli-linux-x64", false],
    ["linux", "arm64", "pulse-cli-linux-arm64", false],
    ["darwin", "x64", "pulse-cli-macos-x64", true],
    ["darwin", "arm64", "pulse-cli-macos-arm64", true],
    ["win32", "x64", "pulse-cli-windows-x64.exe", false],
  ])("%s %s builds %s", (platform, arch, fileName, macho) => {
    expect(exeTarget(platform, arch)).toEqual({ fileName, macho })
  })

  it("covers every release target with a distinct asset name", () => {
    const names = EXE_TARGETS.map((key) => {
      const [platform = "", arch = ""] = key.split("-")
      return exeTarget(platform, arch).fileName
    })
    expect(new Set(names).size).toBe(EXE_TARGETS.length)
    for (const name of names) {
      expect(name).toMatch(/^pulse-cli-(?:linux|macos|windows)-(?:x64|arm64)(?:\.exe)?$/)
    }
  })

  it.each([
    ["win32", "arm64"],
    ["linux", "ia32"],
    ["freebsd", "x64"],
    ["macos", "arm64"],
  ])("refuses %s %s, naming the targets", (platform, arch) => {
    expect(() => exeTarget(platform, arch)).toThrow(
      `No standalone executable for ${platform}-${arch}; targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64`,
    )
  })

  it("accepts exactly the release targets", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("linux", "darwin", "win32", "freebsd", "aix", "sunos"),
        fc.constantFrom("x64", "arm64", "ia32", "arm", "riscv64", "s390x"),
        (platform, arch) => {
          const build = () => exeTarget(platform, arch).fileName
          if (EXE_TARGETS.includes(`${platform}-${arch}`)) expect(build()).toContain(`-${arch}`)
          else expect(build).toThrow(/^No standalone executable/)
        },
      ),
    )
  })
})

describe("seaConfig", () => {
  it("builds a CommonJS blob with code cache and without the experimental warning", () => {
    expect(seaConfig("build/standalone/pulse-cli.cjs", "build/sea/sea-prep.blob")).toEqual({
      main: "build/standalone/pulse-cli.cjs",
      output: "build/sea/sea-prep.blob",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
    })
  })
})

describe("injectOptions", () => {
  it("names the Mach-O segment only for macOS binaries", () => {
    expect(injectOptions(exeTarget("darwin", "arm64"))).toEqual({
      sentinelFuse: SEA_SENTINEL_FUSE,
      machoSegmentName: "NODE_SEA",
    })
    expect(injectOptions(exeTarget("linux", "x64"))).toEqual({ sentinelFuse: SEA_SENTINEL_FUSE })
    expect(injectOptions(exeTarget("win32", "x64"))).toEqual({ sentinelFuse: SEA_SENTINEL_FUSE })
  })

  it("uses the resource name and sentinel fuse that Node.js looks for at start-up", () => {
    expect(SEA_RESOURCE).toBe("NODE_SEA_BLOB")
    expect(SEA_SENTINEL_FUSE).toBe("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2")
  })
})

describe("sharedLibraries", () => {
  it("finds nothing in an official build, which embeds every library", () => {
    expect(
      sharedLibraries({
        node_shared: false,
        node_shared_openssl: false,
        node_shared_libuv: false,
        node_use_openssl: true,
        node_use_node_code_cache: true,
        host_arch: "arm64",
      }),
    ).toEqual([])
  })

  it("names the libraries of a Homebrew or distribution build (libnode is node_shared)", () => {
    expect(
      sharedLibraries({
        node_shared: true,
        node_shared_openssl: true,
        node_shared_zlib: false,
        node_shared_libuv: true,
        node_use_openssl: true,
      }),
    ).toEqual(["node_shared", "node_shared_openssl", "node_shared_libuv"])
  })

  it("counts only flags that are true, not other values", () => {
    expect(
      sharedLibraries({ node_shared_cares: "true", node_shared_zlib: 1, node_shared_brotli: null }),
    ).toEqual([])
  })

  it("returns exactly the node_shared flags that are on", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.oneof(
            fc.string(),
            fc.string().map((name) => `node_shared${name}`),
          ),
          fc.oneof(fc.boolean(), fc.integer(), fc.string()),
        ),
        (variables) => {
          const expected = Object.keys(variables).filter(
            (key) => key.startsWith("node_shared") && variables[key] === true,
          )
          expect(sharedLibraries(variables)).toEqual(expected)
        },
      ),
    )
  })
})
