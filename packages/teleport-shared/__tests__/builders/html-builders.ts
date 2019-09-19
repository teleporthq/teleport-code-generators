import { createHTMLNode, createTextNode } from '../../src/builders/hast-builders'

describe('HTML Builders', () => {
  describe('createHTMLNode', () => {
    it('should create html node', () => {
      const htmlNode = createHTMLNode('span', ['span'])

      expect(htmlNode).toHaveProperty('type')
      expect(htmlNode).toHaveProperty('tagName')
      expect(htmlNode).toHaveProperty('properties')
      expect(htmlNode).toHaveProperty('children')
      expect(htmlNode.type).toBe('element')
      expect(htmlNode.tagName).toBe('span')
      expect(htmlNode.properties).toEqual({})
      expect(htmlNode.children).toEqual(['span'])
    })
  })
  describe('createTextNode', () => {
    it('should create  text node', () => {
      const textNode = createTextNode('test')

      expect(textNode).toHaveProperty('type')
      expect(textNode).toHaveProperty('value')
      expect(textNode.type).toEqual('text')
      expect(textNode.value).toEqual('test')
    })
  })
})
