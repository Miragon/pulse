import { useLayoutEffect, type CSSProperties, type ReactNode } from "react"
import { adoptHostFontVariables } from "@miragon/mcp-toolkit-ui"
import { declareServedFonts } from "./declare-served-fonts.js"
import { InlineFitBox, UNSTATED_BUDGET } from "./inline-fit.js"
import { useShellHost } from "./shell-host.js"

const HOST_FONTS_ID = "__mcp-host-fonts"

const FILL_STYLE: CSSProperties = {
  position: "relative",
  height: "100%",
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
}
const INLINE_STYLE: CSSProperties = { display: "contents" }

/**
 * Replaces mcp-use's `ThemeProvider`, which reset `color-scheme`. Host fonts go
 * into the fallback slot (`adoptHostFontVariables`), so Geist stays first. A
 * view that overflows a stated budget scrolls inside it instead of clipping.
 */
export function HostDocument({ children }: { children: ReactNode }) {
  const { styleVariables, fontCss, displayMode, maxHeight } = useShellHost()

  useLayoutEffect(() => {
    declareServedFonts()
  }, [])

  useLayoutEffect(() => {
    if (!styleVariables) return
    const root = document.documentElement
    for (const [name, value] of Object.entries(styleVariables)) {
      if (value !== undefined) root.style.setProperty(name, value)
    }
    adoptHostFontVariables(root.style, styleVariables)
  }, [styleVariables])

  useLayoutEffect(() => {
    if (!fontCss || document.getElementById(HOST_FONTS_ID)) return
    const style = document.createElement("style")
    style.id = HOST_FONTS_ID
    style.textContent = fontCss
    document.head.appendChild(style)
  }, [fontCss])

  const fill = displayMode === "fullscreen" || displayMode === "pip"
  useFillDocument(fill)

  let style = INLINE_STYLE
  if (fill) style = FILL_STYLE
  else if (maxHeight !== undefined) style = { maxHeight, overflowY: "auto" }
  return (
    <InlineFitBox active={!fill} budget={maxHeight ?? UNSTATED_BUDGET} style={style}>
      {children}
    </InlineFitBox>
  )
}

function useFillDocument(fill: boolean): void {
  useLayoutEffect(() => {
    if (!fill) return
    const elements = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ].filter((el): el is HTMLElement => el !== null)
    const previous = elements.map((el) => [el.style.height, el.style.minHeight] as const)
    for (const el of elements) {
      el.style.height = "100%"
      el.style.minHeight = "100%"
    }
    return () => {
      elements.forEach((el, i) => {
        el.style.height = previous[i][0]
        el.style.minHeight = previous[i][1]
      })
    }
  }, [fill])
}
