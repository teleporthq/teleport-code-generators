import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_pdf_generate(config: any, context: Record<string, unknown>) {
  const html = config.html || ''
  const template = config.template || ''
  const data = config.data || {}
  const margins = config.margins || {}
  const orientation = config.orientation || 'portrait'
  const pageSize = config.pageSize || 'A4'
  const title = config.title || ''
  const content = config.content || []

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const PDFDocument = __nodeRequire('pdfkit')

    const pageSizes: Record<string, number[]> = {
      A4: [595.28, 841.89],
      A3: [841.89, 1190.55],
      A5: [419.53, 595.28],
      Letter: [612, 792],
      Legal: [612, 1008],
    }

    let size = pageSizes[pageSize] || pageSizes.A4
    if (orientation === 'landscape') {
      size = [size[1], size[0]]
    }

    const marginTop = margins.top !== undefined ? Number(margins.top) : 50
    const marginBottom = margins.bottom !== undefined ? Number(margins.bottom) : 50
    const marginLeft = margins.left !== undefined ? Number(margins.left) : 50
    const marginRight = margins.right !== undefined ? Number(margins.right) : 50

    const doc = new PDFDocument({
      size,
      margins: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    })

    const chunks: any[] = []
    doc.on('data', function (chunk: any) {
      chunks.push(chunk)
    })

    const pdfPromise = new Promise<Buffer>(function (resolve) {
      doc.on('end', function () {
        resolve((globalThis as any).Buffer.concat(chunks))
      })
    })

    if (title) {
      doc.fontSize(20).text(title, { align: 'center' })
      doc.moveDown(1)
    }

    const htmlOrTemplate = template || html
    if (htmlOrTemplate) {
      let rendered = htmlOrTemplate
      const dataKeys = Object.keys(data)
      for (let dk = 0; dk < dataKeys.length; dk++) {
        const placeholder = '{{' + dataKeys[dk] + '}}'
        rendered = rendered.split(placeholder).join(String(data[dataKeys[dk]]))
      }

      let stripped = rendered
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '  \u2022 ')
        .replace(/<[^>]+>/g, '')

      stripped = stripped
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')

      doc.fontSize(12).text(stripped.trim(), { align: 'left' })
    }

    if (content && content.length > 0) {
      for (let ci = 0; ci < content.length; ci++) {
        const block = content[ci]
        if (!block) {
          continue
        }

        const fontSize = block.fontSize !== undefined ? Number(block.fontSize) : 12
        const align = block.align || 'left'
        const color = block.color || '#000000'

        doc.fontSize(fontSize).fillColor(color)

        switch (block.type) {
          case 'heading':
            doc.fontSize(
              block.level === 1 ? 24 : block.level === 2 ? 20 : block.level === 3 ? 16 : fontSize
            )
            doc.text(block.text || '', { align })
            doc.moveDown(0.5)
            break
          case 'paragraph':
            doc.text(block.text || '', { align })
            doc.moveDown(0.5)
            break
          case 'list':
            const items = block.items || []
            for (let li = 0; li < items.length; li++) {
              doc.text('  \u2022 ' + items[li], { align })
            }
            doc.moveDown(0.5)
            break
          case 'table':
            const rows = block.rows || []
            const colWidths = block.colWidths || []
            const tableX = marginLeft
            for (let ri = 0; ri < rows.length; ri++) {
              const row = rows[ri]
              let cellX = tableX
              for (let rci = 0; rci < row.length; rci++) {
                const cw = colWidths[rci] || 100
                doc.text(String(row[rci] || ''), cellX, doc.y, { width: cw, align: 'left' })
                cellX += cw + 10
              }
              doc.moveDown(0.3)
            }
            doc.moveDown(0.5)
            break
          case 'spacer':
            doc.moveDown(block.lines || 1)
            break
          case 'line':
            doc
              .moveTo(marginLeft, doc.y)
              .lineTo(size[0] - marginRight, doc.y)
              .stroke()
            doc.moveDown(0.5)
            break
          default:
            if (block.text) {
              doc.text(block.text, { align })
              doc.moveDown(0.3)
            }
        }
      }
    }

    doc.end()
    const pdfBuffer = await pdfPromise
    const pdfBase64 = 'data:application/pdf;base64,' + pdfBuffer.toString('base64')

    return { pdfUrl: null, pdfData: pdfBase64, size: pdfBuffer.length }
  } catch (err: unknown) {
    return { pdfUrl: null, pdfData: null, error: (err as Error).message }
  }
}
export const utilityPdfGenerate: NodeHandlerGenerator = {
  nodeType: 'utility-pdf-generate',
  executionEnv: 'server',
  dependencies: {
    pdfkit: '^0.14.0',
  },
  generateHandler(): string {
    return handlerToString(utility_pdf_generate)
  },
}
