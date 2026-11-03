import { describe, expect, it } from "vitest"
import { attribute, userFacingTexts } from "./render-scan.js"

describe("userFacingTexts", () => {
  it("drops script and style elements until none is left, also one a removal joins", () => {
    const html = "<p>shown</p><scr<script>a</script>ipt>hidden</script><style>b{}</style>"
    expect(userFacingTexts(html).map(({ value }) => value)).toEqual(["shown"])
  })
})

describe("attribute", () => {
  it("matches the attribute name literally, regex characters included", () => {
    expect(attribute('<a data-x.y="1">', "data-x.y")).toBe("1")
    expect(attribute('<a data-xzy="1">', "data-x.y")).toBeUndefined()
    expect(attribute('<a aria-label="Open">', "aria-label")).toBe("Open")
  })
})
