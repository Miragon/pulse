// Replaced by pulse-ui's OS-following theme once Miragon/pulse#661 lands.
//
// The theme bridge, inlined into the page before its root (src/page.html): Claude stamps the
// viewer's choice on the root element as data-theme="dark" or "light", and nothing for "system".
// pulse-ui reads `.dark` (and data-theme="dark") but follows no OS setting itself, so this toggles
// `.dark` from data-theme, or without it from the OS, and sets color-scheme over the artifact's
// light reset. It watches both, never writes data-theme and declares no token.
;(() => {
  const root = document.documentElement
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => {
    const theme = root.getAttribute("data-theme")
    const dark = theme === "dark" || (theme !== "light" && media.matches)
    root.classList.toggle("dark", dark)
    root.style.colorScheme = dark ? "dark" : "light"
  }
  apply()
  media.addEventListener("change", apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] })
})()
