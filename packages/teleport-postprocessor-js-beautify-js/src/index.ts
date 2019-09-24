import { js as beautifyJS } from 'js-beautify'

import { PostProcessor, FileType } from '@teleporthq/teleport-types'

export const createPostProcessor = () => {
  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[FileType.JS]) {
      const result = beautifyJS(codeChunks[FileType.JS], {
        indent_size: 2,
        indent_char: ' ',
        max_preserve_newlines: 5,
        preserve_newlines: true,
        keep_array_indentation: false,
        break_chained_methods: false,
        // @ts-ignore
        indent_scripts: 'keep',
        brace_style: 'expand',
        space_before_conditional: false,
        unescape_strings: true,
        jslint_happy: true,
        end_with_newline: true,
        wrap_line_length: 80,
        indent_inner_html: false,
        comma_first: false,
        e4x: true,
        indent_empty_lines: false,
      })
      codeChunks[FileType.JS] = result
    } else {
      console.warn('No code chunk of type JS found, js-beautify did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
