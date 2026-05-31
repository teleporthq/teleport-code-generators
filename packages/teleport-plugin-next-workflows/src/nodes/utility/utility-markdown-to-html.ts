import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_markdown_to_html(config: any, context: Record<string, unknown>) {
  const markdown = config.markdown || ''
  const gfm = config.gfm !== undefined ? config.gfm : true
  const breaks = config.breaks !== undefined ? config.breaks : false
  const sanitize = config.sanitize !== undefined ? config.sanitize : false
  const headerIds = config.headerIds !== undefined ? config.headerIds : true

  if (!markdown) {
    return { html: '' }
  }

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const marked = __nodeRequire('marked')
    const parse = marked.parse || marked

    const options: Record<string, any> = {
      gfm,
      breaks,
      headerIds,
    }

    let html = parse(markdown, options)

    if (sanitize) {
      html = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
        .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
        .replace(/<embed[^>]*>/gi, '')
        .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
        .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
        .replace(/javascript\s*:/gi, '')
        .replace(/data\s*:[^;]+;base64/gi, 'data:blocked')
    }

    return { html }
  } catch (err: unknown) {
    return { html: null, error: (err as Error).message }
  }
}

export const utilityMarkdownToHtml: NodeHandlerGenerator = {
  nodeType: 'utility-markdown-to-html',
  executionEnv: 'server',
  dependencies: {
    marked: '^4.3.0',
  },
  generateHandler(): string {
    return handlerToString(utility_markdown_to_html)
  },
}
