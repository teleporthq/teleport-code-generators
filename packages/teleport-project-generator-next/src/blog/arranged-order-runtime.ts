/**
 * Manual Order as the generated modules run it, written once: the category
 * pages arrange a category's posts with it, and the live site index orders
 * each category's posts in llms.txt / llms-full.txt by the same places.
 * `arrangeCategoryPosts(posts, category)` reads the post view model's
 * `categories`, `sortOrder` and `createdAt`.
 */
export const ARRANGED_ORDER_RUNTIME = `// Manual Order. A post's place (sortOrder) is among the posts of its PRIMARY
// category — the first of its categories the taxonomy still has. A category
// page lists its own posts, then each subcategory's in the tree's order, depth
// first; within one, the posts whose primary category it is by their place
// (the ones never arranged after them, newest first), then the posts filed
// there through a second category, newest first.
// MUST mirror groupCategoryPosts in teleport-gui
// apps/gui/app/project-page/features/blog/utils/arranged-order.ts.
function subtreeInOrder(category) {
  var ids = []
  var visit = function (node) {
    ids.push(node.id)
    ;(node.children || []).forEach(visit)
  }
  visit(category)
  return ids
}

function postPlace(post) {
  var raw = post.sortOrder
  if (raw === null || raw === undefined || raw === '') return null
  var value = Number(raw)
  return isFinite(value) ? value : null
}

function postTime(post) {
  var raw = post.createdAt
  if (typeof raw === 'number') return raw
  var parsed = Date.parse(String(raw))
  return isNaN(parsed) ? 0 : parsed
}

function newestFirst(a, b) {
  var byDate = postTime(b) - postTime(a)
  if (byDate !== 0) return byDate
  var idA = String(a.id)
  var idB = String(b.id)
  return idA < idB ? 1 : idA > idB ? -1 : 0
}

function byPlace(a, b) {
  var placeA = postPlace(a)
  var placeB = postPlace(b)
  if (placeA !== placeB) {
    if (placeA === null) return 1
    if (placeB === null) return -1
    return placeA - placeB
  }
  return newestFirst(a, b)
}

function arrangeCategoryPosts(posts, category) {
  var order = subtreeInOrder(category)
  var groups = {}
  order.forEach(function (id) {
    groups[id] = { own: [], others: [] }
  })
  posts.forEach(function (post) {
    var ids = (Array.isArray(post.categories) ? post.categories : [])
      .map(function (entry) {
        return entry && entry.id
      })
      .filter(Boolean)
    if (ids[0] && groups[ids[0]]) {
      groups[ids[0]].own.push(post)
      return
    }
    var shownThrough = ids.filter(function (id) {
      return !!groups[id]
    })[0]
    groups[shownThrough || category.id].others.push(post)
  })
  var arranged = []
  order.forEach(function (id) {
    arranged = arranged.concat(groups[id].own.sort(byPlace), groups[id].others.sort(newestFirst))
  })
  return arranged
}`
