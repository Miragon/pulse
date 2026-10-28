import { createContext, useContext, type ReactNode } from "react"
import { Button, useToolkitMessages } from "@miragon/mcp-toolkit-ui"
import { Maximize2, Minimize2 } from "lucide-react"
import { Icon } from "./icon.js"

/** Outside a host nothing can be switched. */
export interface DisplayModeControl {
  displayMode: string
  canFullscreen: boolean
  request: (mode: "inline" | "fullscreen") => void
}

const NO_CONTROL: DisplayModeControl = {
  displayMode: "inline",
  canFullscreen: false,
  request: () => undefined,
}

const DisplayModeControlContext = createContext<DisplayModeControl>(NO_CONTROL)

export function DisplayModeControlProvider({
  control,
  children,
}: {
  control: DisplayModeControl
  children: ReactNode
}) {
  return (
    <DisplayModeControlContext.Provider value={control}>
      {children}
    </DisplayModeControlContext.Provider>
  )
}

export function useDisplayModeControl(): DisplayModeControl {
  return useContext(DisplayModeControlContext)
}

/** For a surface that hides the view's own chrome (#344 N109); nothing where the host offers no fullscreen. */
export function DisplayModeToggle() {
  const { displayMode, canFullscreen, request } = useDisplayModeControl()
  const words = useToolkitMessages().view
  if (!canFullscreen) return null
  const fullscreen = displayMode === "fullscreen"
  const label = fullscreen ? words.exitFullscreen : words.enterFullscreen
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => request(fullscreen ? "inline" : "fullscreen")}
    >
      <Icon icon={fullscreen ? Minimize2 : Maximize2} />
    </Button>
  )
}

/** #344 N159: no picture-in-picture, since no view is laid out for a small floating frame. */
export const SHELL_VIEW_CONFIG = { displayModes: ["inline", "fullscreen"] } as const
