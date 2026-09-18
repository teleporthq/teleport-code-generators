import { MORPH_NAME } from './view-transition-css'

/**
 * Which image flies from one page into the next, as SOURCE TEXT both exports
 * run in the browser (the static HTML export in its page head, the Next export
 * inside TqPageTransition).
 *
 * The pair is found when the visitor follows a link, not stamped at
 * generation time: the image inside the link that was clicked, or inside any
 * other visible link to the same page (a card whose title and picture both
 * link), flies to the image with the same address on the arriving page. So a
 * product card grows into its details hero, a project thumbnail into its case
 * study, with nothing to set up and no knowledge of how the data is bound.
 * Only one pair is ever named: two elements sharing a transition name would
 * cancel the whole transition. A picture the Next export serves through
 * next/image is matched by the picture it serves, not by the shared
 * `/_next/image` address every such picture has.
 *
 * Plain ES5 inside: the text runs untranspiled in a page head.
 */
export const morphHelpersSource = (): string => `var TQ_MORPH_NAME = '${MORPH_NAME}'
function tqMorphPath(url) {
  try {
    var parsed = new URL(url, location.href)
    return parsed.origin + parsed.pathname.replace(/\\/(index\\.html)?$/, '').replace(/\\.html$/, '') + parsed.search
  } catch (e) {
    return String(url)
  }
}
function tqMorphImageKey(url) {
  try {
    var parsed = new URL(url, location.href)
    var served = /\\/_next\\/image$/.test(parsed.pathname) ? parsed.searchParams.get('url') : null
    return served ? tqMorphImageKey(served) : parsed.origin + parsed.pathname
  } catch (e) {
    return String(url)
  }
}
function tqMorphVisible(element) {
  var rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
    rect.top < window.innerHeight && rect.left < window.innerWidth
}
function tqMorphClear() {
  var images = document.images
  for (var i = 0; i < images.length; i++) {
    if (images[i].style.viewTransitionName === TQ_MORPH_NAME) {
      images[i].style.viewTransitionName = ''
    }
  }
}
function tqMorphSource(destination, clicked) {
  var target = tqMorphPath(destination)
  var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]')).filter(function (anchor) {
    return tqMorphPath(anchor.href) === target
  })
  if (clicked && anchors.indexOf(clicked) > 0) {
    anchors.splice(anchors.indexOf(clicked), 1)
    anchors.unshift(clicked)
  }
  for (var i = 0; i < anchors.length; i++) {
    var image = anchors[i].querySelector('img')
    if (image && (image.currentSrc || image.src) && tqMorphVisible(image)) {
      return image
    }
  }
  return null
}
function tqMorphTarget(src) {
  var key = tqMorphImageKey(src)
  var loose = null
  var images = document.images
  for (var i = 0; i < images.length; i++) {
    var own = images[i].currentSrc || images[i].src
    if (!own || images[i].getBoundingClientRect().width === 0) {
      continue
    }
    if (own === src) {
      return images[i]
    }
    if (!loose && tqMorphImageKey(own) === key) {
      loose = images[i]
    }
  }
  return loose
}`
