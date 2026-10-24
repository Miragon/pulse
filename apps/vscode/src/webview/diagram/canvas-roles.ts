const LIGHT_PAPER = '#FFFFFF';
const LIGHT_INK = '#1D1D1D';

export const RENDERER_COLORS = {
  defaultFillColor: LIGHT_PAPER,
  defaultStrokeColor: LIGHT_INK,
  defaultLabelColor: LIGHT_INK,
} as const;

export const CANVAS_TEXT_STYLE = {
  defaultStyle: {
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif",
    fontSize: 12,
    lineHeight: 1.2,
  },
  externalStyle: { fontSize: 11, lineHeight: 1.2 },
} as const;

type Paint = 'fill' | 'stroke';

interface PaintRole {
  readonly paint: Paint;
  readonly color: string;
  readonly role: string;
}

const NAMED_COLORS: Readonly<Record<string, string>> = {
  white: 'rgb(255,255,255)',
  black: 'rgb(0,0,0)',
};

const PAINTED_PARTS = '.djs-visual *, defs marker *';

export class CanvasRoles {
  private static readonly roles: readonly PaintRole[] = [
    { paint: 'fill', color: CanvasRoles.normalizeColor(LIGHT_PAPER), role: 'cd-c-fill-plot' },
    { paint: 'fill', color: CanvasRoles.normalizeColor(LIGHT_INK), role: 'cd-c-fill-text' },
    { paint: 'stroke', color: CanvasRoles.normalizeColor(LIGHT_INK), role: 'cd-c-stroke-text' },
    { paint: 'stroke', color: CanvasRoles.normalizeColor(LIGHT_PAPER), role: 'cd-c-stroke-plot' },
  ];

  static assign(container: Element): number {
    let assigned = 0;
    for (const element of container.querySelectorAll<SVGElement>(PAINTED_PARTS)) {
      for (const { paint, color, role } of CanvasRoles.roles) {
        if (CanvasRoles.paintOf(element, paint) === color) {
          element.classList.add(role);
          assigned += 1;
        }
      }
    }
    return assigned;
  }

  private static paintOf(element: SVGElement, paint: Paint): string {
    const inline = element.style.getPropertyValue(paint);
    return CanvasRoles.normalizeColor(inline === '' ? (element.getAttribute(paint) ?? '') : inline);
  }

  private static normalizeColor(value: string): string {
    const color = value.trim().toLowerCase().replace(/\s+/g, '');
    if (color.startsWith('#')) {
      return CanvasRoles.hexToRgb(color);
    }
    return NAMED_COLORS[color] ?? color;
  }

  private static hexToRgb(hex: string): string {
    const digits = hex.slice(1);
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits;
    const channels = [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16));
    return `rgb(${channels.join(',')})`;
  }
}
