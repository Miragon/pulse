import { createContext, useContext, type ReactNode } from "react"
import { Button, useLocale, Icon } from "@miragon/pulse-ui"
import { Maximize2, Minimize2 } from "lucide-react"
import { kitLabels } from "./kit-labels.js"

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

/** The view frame's fullscreen switch (a chrome button, CI §8); nothing where the host offers no fullscreen. */
export function DisplayModeToggle() {
  const { displayMode, canFullscreen, request } = useDisplayModeControl()
  const words = kitLabels(useLocale())
  if (!canFullscreen) return null
  const fullscreen = displayMode === "fullscreen"
  const label = fullscreen ? words.exitFullscreen : words.enterFullscreen
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className="shadow-1"
      aria-label={label}
      title={label}
      onClick={() => request(fullscreen ? "inline" : "fullscreen")}
    >
      <Icon icon={fullscreen ? Minimize2 : Maximize2} dense />
    </Button>
  )
}

/** #344 N159: no picture-in-picture, since no view is laid out for a small floating frame. */
export const SHELL_VIEW_CONFIG = { displayModes: ["inline", "fullscreen"] } as const
