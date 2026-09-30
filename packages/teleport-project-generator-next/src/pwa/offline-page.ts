import { AppColors } from './colors'
import { PwaMessages } from './messages'
import { escapeHtml } from './source-literals'

/**
 * The page the worker answers with when a page cannot be fetched and has no
 * cached copy. It lives INSIDE the worker rather than as a precached file, so
 * it exists even for a site that precaches nothing (a password-protected one)
 * and can never be stale or evicted. Self-contained: no stylesheet, font or
 * image it would have to fetch while offline. It reloads itself as soon as the
 * connection is back.
 */
export const buildOfflinePageHtml = (params: {
  appName: string
  locale: string
  rightToLeft: boolean
  messages: PwaMessages
  colors: AppColors
}): string => {
  const { appName, locale, rightToLeft, messages, colors } = params

  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${rightToLeft ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${colors.themeColor}">
<title>${escapeHtml(messages.offlineTitle)} · ${escapeHtml(appName)}</title>
<style>
body{margin:0;min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:${
    colors.backgroundColor
  };color:${colors.backgroundTextColor}}
main{max-width:360px}
.app{margin:0 0 24px;font-size:14px;font-weight:600;opacity:.7}
h1{margin:0 0 8px;font-size:24px;line-height:1.25}
p{margin:0 0 24px;line-height:1.5}
button{font:inherit;font-weight:600;padding:12px 24px;border:0;border-radius:999px;cursor:pointer;background:${
    colors.themeColor
  };color:${colors.themeTextColor}}
button:focus-visible{outline:3px solid ${colors.themeColor};outline-offset:3px}
</style>
</head>
<body>
<main>
<p class="app">${escapeHtml(appName)}</p>
<h1>${escapeHtml(messages.offlineTitle)}</h1>
<p>${escapeHtml(messages.offlineBody)}</p>
<button type="button" onclick="location.reload()">${escapeHtml(messages.offlineRetry)}</button>
</main>
<script>addEventListener('online',function(){location.reload()})</script>
</body>
</html>
`
}
