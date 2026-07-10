import { detectTransformationType } from '../src/transformations'

// Regression guard for the loose-substring misrouting bug.
//
// `detectTransformationType` picks the view-model transform applied to every
// fetched DB row. Historically it used loose substring matches
// (`lower.includes('products')` / `lower.includes('blog_posts')`), so a CUSTOM
// table whose name merely CONTAINED "products" (e.g. an inventory table named
// `products`, `store_products`, `wholesale_products`) was routed through
// `buildEcommerceProduct`, which emits only a fixed set of platform product
// fields and SILENTLY DROPS every custom column. The fix pins the match to the
// exact platform-managed table names (`teleport_products`,
// `teleport_blog_posts`), optionally schema-qualified.

describe('detectTransformationType — exact platform-table matching', () => {
  describe('ecommerce-product', () => {
    it('routes the real platform products table', () => {
      expect(detectTransformationType('teleport_products')).toBe('ecommerce-product')
    })

    it('routes the schema-qualified platform products table', () => {
      expect(detectTransformationType('public.teleport_products')).toBe('ecommerce-product')
    })

    it('is case-insensitive for the platform products table', () => {
      expect(detectTransformationType('TELEPORT_PRODUCTS')).toBe('ecommerce-product')
    })

    it('does NOT route a custom table named exactly "products"', () => {
      expect(detectTransformationType('products')).not.toBe('ecommerce-product')
      expect(detectTransformationType('products')).toBeNull()
    })

    it('does NOT route custom tables that merely contain "products"', () => {
      expect(detectTransformationType('store_products')).not.toBe('ecommerce-product')
      expect(detectTransformationType('store_products')).toBeNull()
      expect(detectTransformationType('wholesale_products')).not.toBe('ecommerce-product')
      expect(detectTransformationType('wholesale_products')).toBeNull()
      expect(detectTransformationType('product_inventory')).toBeNull()
    })
  })

  describe('blog-post', () => {
    it('routes the real platform blog-posts table', () => {
      expect(detectTransformationType('teleport_blog_posts')).toBe('blog-post')
    })

    it('routes the schema-qualified platform blog-posts table', () => {
      expect(detectTransformationType('public.teleport_blog_posts')).toBe('blog-post')
    })

    it('does NOT route a custom table named exactly "blog_posts"', () => {
      expect(detectTransformationType('blog_posts')).not.toBe('blog-post')
      expect(detectTransformationType('blog_posts')).toBeNull()
    })

    it('does NOT route custom tables that merely contain the blog terms', () => {
      expect(detectTransformationType('posts')).not.toBe('blog-post')
      expect(detectTransformationType('posts')).toBeNull()
      expect(detectTransformationType('articles')).not.toBe('blog-post')
      expect(detectTransformationType('articles')).toBeNull()
      expect(detectTransformationType('company_blog_posts')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('returns null for empty / falsy table names', () => {
      expect(detectTransformationType('')).toBeNull()
      expect(detectTransformationType(undefined as unknown as string)).toBeNull()
    })
  })
})
