/* tslint:disable:no-string-literal */
import { resolvePageTransition, buildViewTransitionCSS } from '../../src/view-transition/preset-css'

describe('View Transition preset CSS', () => {
  describe('book-flip preset (default)', () => {
    it('resolves default regions: main-page animates, navbar + page-stack freeze', () => {
      const resolved = resolvePageTransition({ preset: 'book-flip' })
      expect(resolved.preset).toEqual('book-flip')
      expect(resolved.regions['navbar'].role).toEqual('freeze')
      expect(resolved.regions['page-stack'].role).toEqual('freeze')
      expect(resolved.regions['main-page'].role).toEqual('animate')
      expect(resolved.regions['main-page'].exit?.name).toEqual('tlp-page-flip-exit')
      expect(resolved.regions['main-page'].enter?.name).toEqual('tlp-page-reveal')
    })

    it('builds CSS with root crossfade kill, frozen region rules, keyframes, and reduced-motion guard', () => {
      const css = buildViewTransitionCSS(resolvePageTransition({ preset: 'book-flip' }))

      expect(css).toContain('::view-transition-old(root)')
      expect(css).toContain('::view-transition-new(root)')
      expect(css).toContain('animation: none')

      expect(css).toContain('::view-transition-old(navbar)')
      expect(css).toContain('::view-transition-old(page-stack)')

      expect(css).toContain('@keyframes tlp-page-flip-exit')
      expect(css).toContain('@keyframes tlp-page-reveal')
      expect(css).toContain('perspective(800px) rotateY(-90deg)')

      expect(css).toContain('@media (prefers-reduced-motion: no-preference)')
      expect(css).toContain('::view-transition-old(main-page)')
      expect(css).toContain('::view-transition-new(main-page)')
      expect(css).toContain('transform-origin: left center')
    })

    it('omits reduced-motion media query when reducedMotion=respect-preset', () => {
      const css = buildViewTransitionCSS(
        resolvePageTransition({ preset: 'book-flip', reducedMotion: 'respect-preset' })
      )
      expect(css).not.toContain('@media (prefers-reduced-motion')
    })
  })

  describe('overrides', () => {
    it('applies top-level duration + easing to resolved animations', () => {
      const resolved = resolvePageTransition({
        preset: 'fade',
        duration: { exit: 100, enter: 50 },
        easing: { exit: 'linear', enter: 'linear' },
        enterDelay: 100,
      })
      expect(resolved.regions['main-page'].exit?.duration).toEqual(100)
      expect(resolved.regions['main-page'].exit?.easing).toEqual('linear')
      expect(resolved.regions['main-page'].enter?.duration).toEqual(50)
      expect(resolved.regions['main-page'].enter?.delay).toEqual(100)
    })

    it('converts region override with role=freeze into animation:none CSS', () => {
      const css = buildViewTransitionCSS(
        resolvePageTransition({
          preset: 'fade',
          regions: { sidebar: { role: 'freeze' } },
        })
      )
      expect(css).toContain('::view-transition-old(sidebar)')
    })

    it('appends customCSS at the end', () => {
      const css = buildViewTransitionCSS(
        resolvePageTransition({
          preset: 'fade',
          customCSS: '.my-custom { color: red; }',
        })
      )
      expect(css.trim().endsWith('.my-custom { color: red; }')).toEqual(true)
    })
  })

  describe('custom preset', () => {
    it('throws if animate region has no keyframes', () => {
      expect(() =>
        resolvePageTransition({
          preset: 'custom',
          regions: {
            'main-page': { role: 'animate' },
          },
        })
      ).toThrow(/no keyframes/i)
    })

    it('accepts user-supplied keyframes for a custom animate region', () => {
      const resolved = resolvePageTransition({
        preset: 'custom',
        regions: {
          'main-page': {
            role: 'animate',
            exit: {
              name: 'my-exit',
              duration: 250,
              easing: 'ease',
              keyframes: {
                from: { opacity: '1' },
                to: { opacity: '0' },
              },
            },
            enter: {
              name: 'my-enter',
              duration: 250,
              easing: 'ease',
              delay: 250,
              keyframes: {
                from: { opacity: '0' },
                to: { opacity: '1' },
              },
            },
          },
        },
      })
      expect(resolved.regions['main-page'].exit?.name).toEqual('my-exit')
      expect(resolved.regions['main-page'].enter?.delay).toEqual(250)

      const css = buildViewTransitionCSS(resolved)
      expect(css).toContain('@keyframes my-exit')
      expect(css).toContain('@keyframes my-enter')
    })
  })
})
