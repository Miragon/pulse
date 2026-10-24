import type { WebUiLink } from '../../core/protocol/index.js';
import { HeaderButton } from './header-button.js';
import { glyphs } from './lucide-glyphs.json';

export function WebUiButton({ link }: { readonly link: WebUiLink | undefined }) {
  if (link === undefined) {
    return null;
  }
  return (
    <HeaderButton
      icon={glyphs.ExternalLink}
      label={link.label}
      title={link.title}
      intent={{ type: 'openWebUi' }}
    />
  );
}
