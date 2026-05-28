import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_fullscreen(config: any) {
  const action = config.action || 'toggle'

  try {
    const isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement)

    if (action === 'enter' || (action === 'toggle' && !isFullscreen)) {
      const el = document.documentElement
      if (el.requestFullscreen) {
        await el.requestFullscreen()
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen()
      }
      return { isFullscreen: true }
    }

    if (action === 'exit' || (action === 'toggle' && isFullscreen)) {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen()
      }
      return { isFullscreen: false }
    }

    return { isFullscreen }
  } catch (err: unknown) {
    return { isFullscreen: false, error: (err as Error).message }
  }
}
export const browserFullscreen: NodeHandlerGenerator = {
  nodeType: 'browser-fullscreen',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_fullscreen)
  },
}
