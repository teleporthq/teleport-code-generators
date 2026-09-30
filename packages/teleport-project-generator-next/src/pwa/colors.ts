const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * The colour when it is a plain `#rgb` / `#rrggbb` hex, else `fallback`. The
 * value lands in the manifest, a `<meta>` tag, the worker and a stylesheet, so
 * nothing but a hex literal is allowed through — the editor resolves design
 * tokens to hex before they reach the UIDL.
 */
const sanitizeHexColor = (value: string | undefined, fallback: string): string =>
  value && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : fallback

const expandHex = (hex: string): string =>
  hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex

const channelLuminance = (channel: number): number => {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a hex colour already passed through `sanitizeHexColor`. */
const relativeLuminance = (hex: string): number => {
  const full = expandHex(hex)
  const r = parseInt(full.slice(1, 3), 16)
  const g = parseInt(full.slice(3, 5), 16)
  const b = parseInt(full.slice(5, 7), 16)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

const contrastRatio = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const DARK_TEXT = '#111827'
const LIGHT_TEXT = '#ffffff'

/** Near-black or white, whichever reads better on `background`. */
const readableTextColor = (background: string): string => {
  const luminance = relativeLuminance(background)
  const onDark = contrastRatio(luminance, relativeLuminance(LIGHT_TEXT))
  const onLight = contrastRatio(luminance, relativeLuminance(DARK_TEXT))
  return onDark >= onLight ? LIGHT_TEXT : DARK_TEXT
}

const DEFAULT_THEME_COLOR = '#111827'
const DEFAULT_BACKGROUND_COLOR = '#ffffff'

export interface AppColors {
  themeColor: string
  themeTextColor: string
  backgroundColor: string
  backgroundTextColor: string
}

export const resolveAppColors = (app: {
  themeColor: string
  backgroundColor: string
}): AppColors => {
  const themeColor = sanitizeHexColor(app.themeColor, DEFAULT_THEME_COLOR)
  const backgroundColor = sanitizeHexColor(app.backgroundColor, DEFAULT_BACKGROUND_COLOR)
  return {
    themeColor,
    themeTextColor: readableTextColor(themeColor),
    backgroundColor,
    backgroundTextColor: readableTextColor(backgroundColor),
  }
}
