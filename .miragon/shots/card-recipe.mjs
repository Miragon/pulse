import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const VISIBLE_RATIO = 1.215
const BLEED_RATIO = 1.32

export default class CardRecipe {
  constructor({ page, image, crop, viewport = [1010, 820], zoom = 2, height = 1700 }, { resolve }) {
    this.page = page
    this.image = image
    this.crop = crop
    this.viewport = viewport
    this.zoom = zoom
    this.height = height
    this.resolve = resolve
  }

  async capture(window) {
    const clip = this.page ? await this.showPage(window.page) : await this.showImage(window.page)
    await window.hero(clip)
  }

  async showPage(page) {
    const [width, height] = this.viewport
    await page.setViewportSize({ width: width * this.zoom, height: height * this.zoom })
    const [file, query = ""] = this.page.split("?")
    await page.goto(`${pathToFileURL(this.resolve(file)).href}?${query}`)
    await page.addStyleTag({ content: `html { zoom: ${this.zoom} }` })
    await page.waitForTimeout(1500)
    return { x: 0, y: 0, width: width * this.zoom, height: height * this.zoom }
  }

  async showImage(page) {
    const [x, y, width, height] = this.crop
    const cardHeight = this.height
    const visible = Math.round(cardHeight * VISIBLE_RATIO)
    const cardWidth = Math.round(cardHeight * BLEED_RATIO)
    const left = Math.round((visible - width) / 2)
    const top = Math.round((cardHeight - height) / 2)
    const source = `data:image/png;base64,${readFileSync(this.resolve(this.image)).toString("base64")}`
    await page.setViewportSize({ width: cardWidth, height: cardHeight })
    await page.setContent(`<body style="margin:0;background:#fff">
      <div style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;
        background:url(${source}) -${x}px -${y}px no-repeat"></div></body>`)
    await page.waitForTimeout(300)
    return { x: 0, y: 0, width: cardWidth, height: cardHeight }
  }
}
