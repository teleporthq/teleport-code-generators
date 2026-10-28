/**
 * What the runtime draws itself: the pressed look of a Compare control (the
 * control is the project's own element; only its pressed state is the
 * runtime's), and the toast — above the tray docked at the bottom, even
 * opened across a phone's screen. The tray and the comparison page are the
 * project's components, styled by the owner.
 */
export const ITEM_COMPARISON_STYLES = [
  '[data-tq-compare-toggle][aria-pressed="true"]{background:var(--color-primary,#111)!important;color:var(--color-on-primary,#fff)!important;border-color:var(--color-primary,#111)!important}',
  '.tq-compare-toast{position:fixed;z-index:2147483001;left:50%;bottom:calc(140px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:#111;color:#fff;font-size:14px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)}',
  '@media print{[data-tq-compare-toggle],[data-tq-compare-tray],[data-tq-compare-tray-opener]{display:none!important}}',
].join('')
