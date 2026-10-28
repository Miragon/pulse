import type { Message } from "@miragon/mcp-toolkit-core"

/**
 * `one` when the count param is exactly 1, else `other`. Widgets pass the count already formatted:
 * "1" reads as one in every locale this module speaks, "1.234" and "1,234" as many.
 */
export function plural(param: string, one: string, other: string): Message {
  return (params) => {
    const template = String(params[param]) === "1" ? one : other
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = params[name] as string | number | undefined
      return value === undefined ? whole : String(value)
    })
  }
}
