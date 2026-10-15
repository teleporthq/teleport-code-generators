// The two-page site both page-transition checks navigate (verify-transitions.cjs
// for the static export, verify-next-transitions.cjs for the Next export), so
// the two exports are held to the same visits.
const path = require('path')
const fs = require('fs')
const CG = path.resolve(__dirname, '../../../..')
const s = (content) => ({ type: 'static', content })
const el = (elementType, name, attrs, style, children) => ({
  type: 'element',
  content: {
    elementType,
    name,
    attrs,
    style: Object.fromEntries(Object.entries(style).map(([k, v]) => [k, s(v)])),
    children,
  },
})
const linkTo = (id, label, routeName) => {
  const node = el('text', id, { id: s(id) }, { padding: '16px', fontSize: '24px' }, [
    { type: 'static', content: label },
  ])
  node.content.semanticType = 'span'
  node.content.abilities = { link: { type: 'navlink', content: { routeName: s(routeName) } } }
  return node
}
// A card whose picture links to About.
const pictureCard = (id, src) => {
  const card = el('container', id, { id: s(id) }, { width: '320px', padding: '12px' }, [
    el(
      'image',
      `${id}-photo`,
      { id: s(`${id}-photo`), src: s(src) },
      { width: '300px', height: '200px' },
      []
    ),
  ])
  card.content.abilities = { link: { type: 'navlink', content: { routeName: s('About') } } }
  return card
}
// Home: a text link to About and, with pictures, two cards linking there. About
// shows the first card's picture as its hero (a pair) and not the second's
// (a picture with nowhere to land). `tall`: both pages six screens long and a
// second link to About four screens down Home — where a reveal measured on the
// page instead of the screen gives itself away.
const siteWith = (pageTransition, withPictures = false, { tall = false } = {}) => {
  const uidl = JSON.parse(fs.readFileSync(CG + '/examples/uidl-samples/tests.json', 'utf8'))
  const [home, about] = uidl.root.node.content.children
  home.content.node.content.children = [
    el(
      'container',
      'hero',
      {},
      { height: tall ? '600vh' : '140vh', background: '#f4f1ea', padding: '40px' },
      [
        linkTo('to-about', 'About', 'About'),
        ...(withPictures
          ? [pictureCard('card', '/photo.svg'), pictureCard('stray', '/other.svg')]
          : []),
        ...(tall
          ? [
              el('container', 'spacer', {}, { height: '400vh' }, []),
              linkTo('to-about-low', 'About, from further down', 'About'),
            ]
          : []),
      ]
    ),
  ]
  about.content.node.content.children = [
    el(
      'container',
      'body',
      {},
      { height: tall ? '600vh' : '100vh', background: '#dde4ee', padding: '40px' },
      [
        linkTo('to-home', 'Home', 'Home'),
        ...(withPictures
          ? [
              el(
                'image',
                'hero-photo',
                { id: s('hero-photo'), src: s('/photo.svg') },
                { width: '100%', height: '420px' },
                []
              ),
            ]
          : []),
      ]
    ),
  ]
  uidl.globals.settings = { ...uidl.globals.settings, pageTransition }
  return uidl
}
const picture = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${fill}"/><circle cx="600" cy="400" r="220" fill="#f4f1ea"/></svg>`
const writePictures = (folder) => {
  fs.writeFileSync(path.join(folder, 'photo.svg'), picture('#c4553a'))
  fs.writeFileSync(path.join(folder, 'other.svg'), picture('#2f5d62'))
}

module.exports = { siteWith, writePictures }
