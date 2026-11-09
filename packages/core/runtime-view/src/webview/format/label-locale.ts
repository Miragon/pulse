import { setFormatLocale } from "@miragon/pulse-ui/format"

export class LabelLocale {
  private static readonly ENGLISH_24_HOURS = { language: "en", locale: "en-u-hc-h23" }

  static apply(): void {
    setFormatLocale(LabelLocale.ENGLISH_24_HOURS)
  }
}
