import { AppColors } from './colors'

/**
 * The install banner and the update prompt, drawn in the app's own colours.
 * Logical properties only, so a right-to-left page mirrors them; the entrance
 * animation is skipped for visitors who ask for reduced motion.
 */
export const buildClientStyles = (colors: AppColors): string =>
  [
    `.tq-pwa-toast{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));margin:0 auto;max-width:440px;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px;border-radius:16px;border:1px solid rgba(127,127,127,.25);background:${colors.backgroundColor};color:${colors.backgroundTextColor};box-shadow:0 12px 32px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.12);font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;text-align:start}`,
    '@media (prefers-reduced-motion:no-preference){.tq-pwa-toast{animation:tq-pwa-enter .25s ease-out}}',
    '@keyframes tq-pwa-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
    '.tq-pwa-icon{flex:none;width:40px;height:40px;border-radius:10px}',
    '.tq-pwa-copy{flex:1 1 180px;min-width:0}',
    '.tq-pwa-title{margin:0 0 2px;font-weight:600}',
    '.tq-pwa-toast-text{margin:0;flex:1 1 180px}',
    '.tq-pwa-actions{display:flex;gap:8px;margin-inline-start:auto}',
    '.tq-pwa-toast button{font:inherit;font-weight:600;border-radius:999px;padding:8px 16px;cursor:pointer;border:1px solid transparent}',
    `.tq-pwa-primary{background:${colors.themeColor};color:${colors.themeTextColor}}`,
    '.tq-pwa-secondary{background:transparent;color:inherit;border-color:rgba(127,127,127,.45)}',
    `.tq-pwa-toast button:focus-visible{outline:2px solid ${colors.themeColor};outline-offset:2px}`,
  ].join('')
