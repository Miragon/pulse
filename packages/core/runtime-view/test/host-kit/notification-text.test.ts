import { describe, expect, test } from "vitest"
import { NotificationText } from "../../src/host-kit/notification-text.js"

describe("a notification text without links", () => {
  test.each([
    [
      "Login failed. [Sign in again](https://evil.example.com/login)",
      "Login failed. (Sign in again)(https://evil.example.com/login)",
    ],
    [
      "Retry failed: [details](command:workbench.action.terminal.new)",
      "Retry failed: (details)(command:workbench.action.terminal.new)",
    ],
  ])("defuses the markdown link in %j", (text, expected) => {
    expect(NotificationText.withoutLinks(text)).toBe(expected)
  })

  test("defuses every link of a text, not only the first", () => {
    expect(
      NotificationText.withoutLinks("[Retry](command:a) or [Sign in](https://evil.example.com)"),
    ).toBe("(Retry)(command:a) or (Sign in)(https://evil.example.com)")
  })

  test("leaves a bare URL as it is, which a notification shows as text", () => {
    const text = "The engine at https://prod.example.com/engine-rest refused the login."
    expect(NotificationText.withoutLinks(text)).toBe(text)
  })

  test("leaves a text without links as it is", () => {
    const text = "Incident 7f3c at ReviewInvoice: connection refused (localhost:8080)."
    expect(NotificationText.withoutLinks(text)).toBe(text)
  })
})
