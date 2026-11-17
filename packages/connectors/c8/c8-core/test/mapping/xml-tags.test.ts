import { describe, expect, test } from "vitest"
import { XmlTags } from "../../src/mapping/xml-tags.js"

const names = (xml: string) =>
  XmlTags.of(xml).map(({ name, closing }) => (closing ? `/${name}` : name))

describe("the tags of an XML text", () => {
  test("names each tag by its local name, says whether it closes or is empty, and keeps its text", () => {
    expect(
      XmlTags.of('<bpmn:callActivity id="Call">text > here</bpmn:callActivity ><br/><a />'),
    ).toStrictEqual([
      { name: "callActivity", closing: false, empty: false, text: 'bpmn:callActivity id="Call"' },
      { name: "callActivity", closing: true, empty: false, text: "bpmn:callActivity " },
      { name: "br", closing: false, empty: true, text: "br/" },
      { name: "a", closing: false, empty: true, text: "a /" },
    ])
  })

  test("reads letters, digits, _, ., - and the prefix's colon as the name", () => {
    expect(names("<ns.v-1:receive_Task.2-b a=1><x:y:z/><1/>")).toEqual([
      "receive_Task.2-b",
      "y:z",
      "1",
    ])
  })

  test("reads a tag that names no element with an empty name", () => {
    expect(XmlTags.of('<!DOCTYPE x><  a id="y">')).toStrictEqual([
      { name: "", closing: false, empty: false, text: "!DOCTYPE x" },
      { name: "", closing: false, empty: false, text: '  a id="y"' },
    ])
  })

  test("skips a comment, a CDATA section and a processing instruction, each to its own end", () => {
    expect(
      names(
        '<?xml version="1.0"?><a><!-- <b> ?> ]]> <--><c/><![CDATA[ <d> --> ?> <]]></a>' +
          "<?pulse <e> --> ]]> <?><f/><!--> <g/> --><?> <h/> ?>x]]><![CDATA[ <i/> ]]><j/>",
      ),
    ).toEqual(["a", "c", "/a", "f", "j"])
  })

  test("reads a quoted > as part of the tag, a quote of the other kind inside a value too", () => {
    expect(XmlTags.of(`<a b="x > 'y'" c='p > "q"'><d e=">"/>`)).toStrictEqual([
      { name: "a", closing: false, empty: false, text: `a b="x > 'y'" c='p > "q"'` },
      { name: "d", closing: false, empty: true, text: 'd e=">"/' },
    ])
  })

  test.each([
    ["a comment", "<!-- <b/>"],
    ["a CDATA section", "<![CDATA[ <b/>"],
    ["a processing instruction", "<?pulse <b/>"],
    ["a tag", '<b id="x" <c/'],
    ["a quoted value", '<b id="x > <c/> <d/>'],
    ["a value in single quotes", "<b id='x > <c/> <d/>"],
  ])("ends at %s that never ends, with the tags before it", (_, unended) => {
    expect(names(`<a/><!---->${unended}`)).toEqual(["a"])
  })

  test("reads a text of up to 4 Mi characters, and no tag of a longer one", () => {
    const longest = 4 * 1024 * 1024
    const padded = (length: number) => `<a/>${" ".repeat(length - 4)}`

    expect(names(padded(longest))).toEqual(["a"])
    expect(names(padded(longest + 1))).toEqual([])
  })

  test("finds no tag in a text without one", () => {
    expect(XmlTags.of("")).toStrictEqual([])
    expect(XmlTags.of("a > b")).toStrictEqual([])
  })
})

describe("the elements of an XML text", () => {
  const CALLS: ReadonlySet<string> = new Set(["call"])

  test("gives each element its tags up to its own closing tag, and an empty one none", () => {
    const elements = XmlTags.elements(
      '<x:call id="a"><in/><y></y></x:call><other/><call id="b"/><call id="c"></call>',
      CALLS,
    )

    expect(elements.map(({ tag, body }) => [tag.text, body.map((inner) => inner.text)])).toEqual([
      ['x:call id="a"', ["in/", "y", "y"]],
      ['call id="b"/', []],
      ['call id="c"', []],
    ])
  })

  test("ends an element at the first closing tag of its name, so elements never overlap", () => {
    const elements = XmlTags.elements(
      '<call id="outer"><call id="inner"></call><b/></call><call id="next"></call>',
      CALLS,
    )

    expect(elements.map(({ tag, body }) => [tag.text, body.length])).toEqual([
      ['call id="outer"', 1],
      ['call id="next"', 0],
    ])
  })

  test("leaves out an element that never closes, and a closing tag without its start", () => {
    expect(XmlTags.elements('</call><call id="open"><b/>', CALLS)).toStrictEqual([])
  })
})
