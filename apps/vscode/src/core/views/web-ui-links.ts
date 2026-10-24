import type { EngineBadge, WebUiLink } from '../protocol/index.js';

interface WebUiField {
  readonly webUi?: WebUiLink;
}

export class WebUiLinks {
  static to(subject: string, engine: EngineBadge): WebUiField {
    return WebUiLinks.titled(engine, (webUi) => `Open ${subject} in ${webUi} on ${engine.name}`);
  }

  static toStartPage(engine: EngineBadge): WebUiField {
    return WebUiLinks.titled(engine, (webUi) => `Open ${webUi} on ${engine.name}`);
  }

  private static titled(engine: EngineBadge, title: (webUi: string) => string): WebUiField {
    if (engine.webUi === undefined) {
      return {};
    }
    return { webUi: { label: `Open in ${engine.webUi}`, title: title(engine.webUi) } };
  }
}
