import { adaptDataWidget, type WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { SettingsPageWidget, ShellSettingsWidget } from "./shell-settings.js"
import { SHELL_SETTINGS_PAGE_WIDGET, SHELL_SETTINGS_WIDGET } from "../shell-settings-contract.js"

/** The shell's entries of a host widget registry, as one spread. */
export const shellWidgets = {
  // The page receives `shell:settings` data and leaves it to the section.
  [SHELL_SETTINGS_WIDGET]: adaptDataWidget(ShellSettingsWidget, "shell:settings"),
  [SHELL_SETTINGS_PAGE_WIDGET]: adaptDataWidget(SettingsPageWidget, "shell:settings"),
} satisfies Record<string, WidgetComponent>
