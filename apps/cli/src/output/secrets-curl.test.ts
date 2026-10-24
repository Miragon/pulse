/**
 * shellQuote and the curl command of a request preview (secrets.ts), checked by parsing the command
 * back into shell words: what the shell would send is what the preview says.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { MultipartPartPreview, RequestPreview } from "../operation/result.js"
import { curlCommand, shellQuote } from "./secrets.js"

/** Splits a command line into words like a POSIX shell: single quotes and backslash escapes. */
function shellWords(line: string): string[] {
  const words: string[] = []
  let word = ""
  let inWord = false
  let index = 0
  while (index < line.length) {
    const char = line[index]!
    if (char === "'") {
      const end = line.indexOf("'", index + 1)
      if (end < 0) throw new Error(`unterminated quote in ${line}`)
      word += line.slice(index + 1, end)
      inWord = true
      index = end + 1
    } else if (char === "\\") {
      word += line[index + 1] ?? ""
      inWord = true
      index += 2
    } else if (char === " ") {
      if (inWord) words.push(word)
      word = ""
      inWord = false
      index += 1
    } else {
      word += char
      inWord = true
      index += 1
    }
  }
  if (inWord) words.push(word)
  return words
}

/** Leading blanks, then a double-quoted word (with \\ and \" escapes) or text up to a stop char. */
function curlWord(input: string, stop: RegExp): { word: string; rest: string } {
  const text = input.replace(/^[\t-\r ]+/, "")
  const quoted = /^"((?:\\.|[^"\\])*)"/.exec(text)
  if (quoted !== null) {
    return {
      word: quoted[1]!.replace(/\\([\\"])/g, "$1"),
      rest: text.slice(quoted[0].length),
    }
  }
  const end = text.search(stop) < 0 ? text.length : text.search(stop)
  return { word: text.slice(0, end).replace(/[\t-\r ]+$/, ""), rest: text.slice(end) }
}

type SentPart = { name: string; value: string } | { name: string; path: string; fileName: string }

/** What curl sends for one form option, modelled on curl's tool_formparse.c. */
function curlFormPart(option: string, arg: string): SentPart {
  const name = arg.slice(0, arg.indexOf("="))
  const content = arg.slice(name.length + 1)
  if (option === "--form-string") return { name, value: content }
  if (content.startsWith("<")) throw new Error(`curl reads the value from a file: ${arg}`)
  if (!content.startsWith("@")) {
    const { word, rest } = curlWord(content, /;/)
    if (rest !== "") throw new Error(`curl parses options from the value: ${arg}`)
    return { name, value: word }
  }
  const { word: path, rest } = curlWord(content.slice(1), /[;,]/)
  if (rest === "") return { name, path, fileName: path.slice(path.lastIndexOf("/") + 1) }
  if (!rest.startsWith(";filename=")) throw new Error(`unexpected file options: ${arg}`)
  const { word: fileName, rest: tail } = curlWord(rest.slice(";filename=".length), /[;,]/)
  if (tail !== "") throw new Error(`unexpected data after the file name: ${arg}`)
  return { name, path, fileName }
}

/** The parts curl sends for the form options of a curl command line. */
function sentParts(line: string): SentPart[] {
  const words = shellWords(line)
  const parts: SentPart[] = []
  for (let index = 0; index < words.length; index += 1) {
    const option = words[index]!
    if (option === "-F" || option === "--form-string") {
      parts.push(curlFormPart(option, words[index + 1]!))
      index += 1
    }
  }
  return parts
}

function request(overrides: Partial<RequestPreview> = {}): RequestPreview {
  return {
    method: "GET",
    url: "http://localhost:8080/engine-rest/task",
    headers: {},
    ...overrides,
  }
}

describe("shellQuote", () => {
  it("wraps text in single quotes and escapes embedded single quotes", () => {
    expect(shellQuote("abc")).toBe("'abc'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote("")).toBe("''")
    expect(shellQuote("''")).toBe("''\\'''\\'''")
  })

  it("round-trips through a POSIX shell word parser (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(shellWords(shellQuote(text))).toEqual([text])
      }),
    )
  })
})

describe("curlCommand", () => {
  it("omits -X for GET and quotes URL and headers", () => {
    expect(curlCommand(request({ headers: { Accept: "application/json" } }))).toBe(
      "curl 'http://localhost:8080/engine-rest/task' -H 'Accept: application/json'",
    )
  })

  it("adds -X and --data-raw with compact JSON for JSON bodies", () => {
    const preview = request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { name: "it's", n: 1 },
    })
    expect(curlCommand(preview)).toBe(
      "curl -X POST 'http://localhost:8080/engine-rest/task' -H 'Content-Type: application/json' --data-raw '{\"name\":\"it'\\''s\",\"n\":1}'",
    )
  })

  it("renders requests without headers and body", () => {
    expect(curlCommand(request({ method: "DELETE" }))).toBe(
      "curl -X DELETE 'http://localhost:8080/engine-rest/task'",
    )
  })

  it("writes headers with blank values as Name; because curl drops Name: with no value", () => {
    const header = (value: string) =>
      curlCommand(request({ headers: { "X-Empty": value } })).split(" -H ")[1]
    for (const value of ["", " ", "\t", "\r\n", " \t "]) expect(header(value)).toBe("'X-Empty;'")
    for (const value of ["a", " a ", "\u00a0", "\v", "\f"]) {
      expect(header(value)).toBe(shellQuote(`X-Empty: ${value}`))
    }
  })

  it("uses --head for HEAD requests, which -X HEAD would make hang", () => {
    expect(curlCommand(request({ method: "HEAD" }))).toBe(
      "curl --head 'http://localhost:8080/engine-rest/task'",
    )
    expect(curlCommand(request({ method: "head" }))).toBe(
      "curl -X head 'http://localhost:8080/engine-rest/task'",
    )
  })

  it("quotes methods that are not plain words", () => {
    expect(curlCommand(request({ method: "M ETHOD" }))).toBe(
      "curl -X 'M ETHOD' 'http://localhost:8080/engine-rest/task'",
    )
    expect(curlCommand(request({ method: "PATCH_2-x" }))).toBe(
      "curl -X PATCH_2-x 'http://localhost:8080/engine-rest/task'",
    )
    expect(curlCommand(request({ method: "get" }))).toBe(
      "curl -X get 'http://localhost:8080/engine-rest/task'",
    )
  })

  it("renders JSON scalars and null bodies", () => {
    expect(curlCommand(request({ method: "PUT", body: null }))).toContain("--data-raw 'null'")
    expect(curlCommand(request({ method: "PUT", body: "text" }))).toContain(`--data-raw '"text"'`)
    expect(curlCommand(request({ method: "PUT", body: false }))).toContain("--data-raw 'false'")
  })

  it("renders multipart previews as -F options", () => {
    const body: MultipartPartPreview[] = [
      { name: "deployment-name", value: "my deployment" },
      { name: "data", fileName: "order.bpmn", bytes: 1234 },
    ]
    expect(curlCommand(request({ method: "POST", body }))).toBe(
      "curl -X POST 'http://localhost:8080/engine-rest/task' -F 'deployment-name=my deployment' -F 'data=@order.bpmn'",
    )
  })

  it("uses --form-string for values curl -F would interpret", () => {
    const parts = (value: string) =>
      curlCommand(request({ method: "POST", body: [{ name: "n", value }] }))
    expect(parts("@file")).toContain("--form-string 'n=@file'")
    expect(parts("<file")).toContain("--form-string 'n=<file'")
    expect(parts('"quoted"')).toContain(`--form-string 'n="quoted"'`)
    expect(parts("a;type=text/x")).toContain("--form-string 'n=a;type=text/x'")
    expect(parts('a@b<c"d')).toContain(`-F 'n=a@b<c"d'`)
    expect(parts("")).toContain("-F 'n='")
  })

  it("uses --form-string for values with blanks at either end, which curl -F strips", () => {
    const option = (value: string) =>
      curlCommand(request({ method: "POST", body: [{ name: "n", value }] })).split(" ")[4]
    for (const value of [" a", "a ", "\ta", "a\t", "\na", "a\n", "\va", "\fa", "\ra", "a\r"]) {
      expect(option(value)).toBe("--form-string")
    }
    for (const value of ["a b", "a\tb", "\u00a0a", "a\u00a0", "\u000ea", "a\u0008"]) {
      expect(option(value)).toBe("-F")
    }
  })

  it('double-quotes file names with ; , " or \\ and with blanks at either end', () => {
    const file = (fileName: string) =>
      curlCommand(request({ method: "POST", body: [{ name: "data", fileName, bytes: 1 }] }))
    expect(file("a;b.bpmn")).toContain(`-F 'data=@"a;b.bpmn"'`)
    expect(file("a,b.bpmn")).toContain(`-F 'data=@"a,b.bpmn"'`)
    expect(file('a"b.bpmn')).toContain(`-F 'data=@"a\\"b.bpmn"'`)
    expect(file("a\\b.bpmn")).toContain(`-F 'data=@"a\\\\b.bpmn"'`)
    expect(file(" a.bpmn")).toContain(`-F 'data=@" a.bpmn"'`)
    expect(file("a.bpmn\t")).toContain(`-F 'data=@"a.bpmn\t"'`)
    expect(file("a b.bpmn")).toContain("-F 'data=@a b.bpmn'")
  })

  it("adds ;filename= for paths, because curl sends only the base name", () => {
    const file = (fileName: string) =>
      curlCommand(request({ method: "POST", body: [{ name: "data", fileName, bytes: 1 }] }))
    expect(file("sub/a b.bpmn")).toContain("-F 'data=@sub/a b.bpmn;filename=sub/a b.bpmn'")
    expect(file("d;x/a.bpmn")).toContain(`-F 'data=@"d;x/a.bpmn";filename="d;x/a.bpmn"'`)
    expect(file("a.bpmn")).toContain("-F 'data=@a.bpmn'")
  })

  it("treats arrays as JSON when the content type is JSON or not every item is a part", () => {
    const parts = [{ name: "a", value: "b" }]
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      curlCommand(request({ method: "POST", body, headers }))
    expect(json(parts, { "content-type": "Application/JSON" })).toContain(
      `--data-raw '[{"name":"a","value":"b"}]'`,
    )
    expect(json([])).toContain("--data-raw '[]'")
    expect(json([...parts, "x"])).toContain("--data-raw")
    expect(json([...parts, null])).toContain("--data-raw")
    expect(json([{ name: 1, value: "b" }])).toContain("--data-raw")
    expect(json([{ name: "a", value: 1 }])).toContain("--data-raw")
    expect(json([{ name: "a", fileName: "f" }])).toContain("--data-raw")
    expect(json([{ name: "a", bytes: 1 }])).toContain("--data-raw")
    expect(json({ name: "a", value: "b" })).toContain("--data-raw")
  })

  it("treats part lists as multipart unless a content-type header says JSON", () => {
    const body = [{ name: "a", value: "b" }]
    const multipart = (headers: Record<string, string>) =>
      curlCommand(request({ method: "POST", body, headers }))
    expect(multipart({ Accept: "application/json" })).toContain("-F 'a=b'")
    expect(multipart({ "Content-Type": "multipart/form-data" })).toContain("-F 'a=b'")
    expect(multipart({ "X-Content-Type": "application/json" })).toContain("-F 'a=b'")
  })

  it("round-trips every argument through a POSIX shell word parser (property)", () => {
    const text = fc.string({ unit: "binary" })
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom("GET", "HEAD", "POST", "DELETE"), text),
        text,
        fc.dictionary(text, text),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (method, url, headers, body) => {
          const allHeaders = { ...headers, "Content-Type": "application/json" }
          const preview: RequestPreview =
            body === undefined
              ? { method, url, headers: allHeaders }
              : { method, url, headers: allHeaders, body }
          const expected = [
            "curl",
            ...(method === "GET" ? [] : method === "HEAD" ? ["--head"] : ["-X", method]),
            url,
            ...Object.entries(allHeaders).flatMap(([name, value]) => [
              "-H",
              /^[\t\n\r ]*$/.test(value) ? `${name};` : `${name}: ${value}`,
            ]),
            ...(body === undefined ? [] : ["--data-raw", JSON.stringify(body)]),
          ]
          expect(shellWords(curlCommand(preview))).toEqual(expected)
        },
      ),
    )
  })

  it("makes curl send exactly the previewed parts (property)", () => {
    const text = fc.string({ unit: "binary" })
    const name = text.filter((value) => !value.includes("="))
    const part = fc.oneof(
      fc.record({ name, value: text }),
      fc.record({ name, fileName: text, bytes: fc.nat() }),
    )
    fc.assert(
      fc.property(fc.array(part, { minLength: 1, maxLength: 4 }), (parts) => {
        const line = curlCommand(request({ method: "POST", body: parts }))
        const expected = parts.map((item) =>
          "fileName" in item
            ? { name: item.name, path: item.fileName, fileName: item.fileName }
            : { name: item.name, value: item.value },
        )
        expect(sentParts(line)).toEqual(expected)
        expect(shellWords(line).slice(0, 4)).toEqual([
          "curl",
          "-X",
          "POST",
          "http://localhost:8080/engine-rest/task",
        ])
      }),
    )
  })

  it("models curl -F parsing in the test oracle", () => {
    expect(sentParts(`curl -F 'n= a b ' -F 'n="q\\"x"'`)).toEqual([
      { name: "n", value: "a b" },
      { name: "n", value: 'q"x' },
    ])
    expect(sentParts("curl -F 'f=@sub/a.bpmn' -F 'f=@\"unclosed'")).toEqual([
      { name: "f", path: "sub/a.bpmn", fileName: "a.bpmn" },
      { name: "f", path: '"unclosed', fileName: '"unclosed' },
    ])
    expect(() => sentParts("curl -F 'f=@\"un;closed'")).toThrow("unexpected file options")
    expect(() => sentParts("curl -F 'n=a;type=x'")).toThrow("curl parses options")
    expect(() => sentParts("curl -F 'n=<x'")).toThrow("curl reads the value from a file")
  })
})
