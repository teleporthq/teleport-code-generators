import { stringAsTemplateLiteral } from '../../src/utils/ast-jsx-utils'

describe('AST JSX utils', () => {
  describe('stringAsTemplateLiteral', () => {
    it('returns TemplateLiteral', () => {
      const result = stringAsTemplateLiteral('randomString')

      expect(result.type).toBe('TemplateLiteral')
      expect(result.quasis[0].type).toBe('TemplateElement')
    })
  })
})
