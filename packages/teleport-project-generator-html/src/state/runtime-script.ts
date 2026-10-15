import { StateBindings } from '@teleporthq/teleport-shared'

/**
 * The state runtime of a static HTML export (`tq-state.js`): one plain script
 * that reads the bindings the generator wrote (StateBindings in
 * teleport-shared) and keeps a page in step with what a visitor clicks.
 *
 * Every page root and component instance with bindings is a scope with its own
 * store, built from its `data-tq-state`. One delegated listener runs the
 * `data-tq-on-click` actions of the clicked element and of every clickable
 * element around it, the way a click bubbles through React handlers, then
 * re-renders: `hidden` follows `data-tq-if` and classes follow
 * `data-tq-class`. The generator already wrote the starting state into the
 * markup, so the first render changes nothing.
 *
 * Expressions are read by a small parser, never handed to `eval`, so a page
 * keeps working under a strict Content-Security-Policy.
 */
export const STATE_RUNTIME_SCRIPT = String.raw`(function () {
  if (window.__tqStateRuntime) {
    return
  }
  window.__tqStateRuntime = true

  var SCOPE = '${StateBindings.SCOPE_ATTR}'
  var STATE = '${StateBindings.STATE_ATTR}'
  var SLOT = '${StateBindings.SLOT_ATTR}'
  var IF = '${StateBindings.IF_ATTR}'
  var CLASS = '${StateBindings.CLASS_ATTR}'
  var CLICK = '${StateBindings.CLICK_ATTR}'

  var TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][\w$]*)|'((?:[^'\\]|\\[\s\S])*)'|(===|!==|<=|>=|&&|\|\||[!<>()+-]))/g
  var STATEMENT = /(?:[^;']|'(?:[^'\\]|\\[\s\S])*')+/g
  var ASSIGNMENT = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)([\s\S]*)$/
  var CLASS_BINDING = /^\s*([^\s:]+)\s*:([\s\S]*)$/
  var OPERABLE = /^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION|LABEL)$/
  var LEVELS = [['||'], ['&&'], ['===', '!==', '<', '<=', '>', '>='], ['+', '-']]
  var OPERATORS = {
    '||': function (a, b) { return a || b },
    '&&': function (a, b) { return a && b },
    '===': function (a, b) { return a === b },
    '!==': function (a, b) { return a !== b },
    '<': function (a, b) { return a < b },
    '<=': function (a, b) { return a <= b },
    '>': function (a, b) { return a > b },
    '>=': function (a, b) { return a >= b },
    '+': function (a, b) { return a + b },
    '-': function (a, b) { return a - b }
  }

  var unreadable = function (source) {
    return new Error('tq-state cannot read "' + source + '"')
  }

  var tokenize = function (source) {
    var text = source.trim()
    var tokens = []
    var at = 0
    while (at < text.length) {
      TOKEN.lastIndex = at
      var match = TOKEN.exec(text)
      if (!match || match.index !== at) {
        throw unreadable(source)
      }
      at = TOKEN.lastIndex
      if (match[1] !== undefined) {
        tokens.push({ value: Number(match[1]) })
      } else if (match[2] === 'true' || match[2] === 'false' || match[2] === 'null') {
        tokens.push({ value: match[2] === 'null' ? null : match[2] === 'true' })
      } else if (match[2] !== undefined) {
        tokens.push({ name: match[2] })
      } else if (match[3] !== undefined) {
        tokens.push({ value: match[3].replace(/\\([\s\S])/g, '$1') })
      } else {
        tokens.push({ op: match[4] })
      }
    }
    return tokens
  }

  var join = function (operate, left, right) {
    return function (values) {
      return operate(left(values), right(values))
    }
  }

  var compile = function (source) {
    var tokens = tokenize(source)
    var at = 0
    var constant = function (value) {
      return function () {
        return value
      }
    }
    var primary = function () {
      var token = tokens[at++]
      if (!token) {
        throw unreadable(source)
      }
      if (token.op === '(') {
        var inner = level(0)
        if (!tokens[at] || tokens[at++].op !== ')') {
          throw unreadable(source)
        }
        return inner
      }
      if (token.op === '-' && tokens[at] && typeof tokens[at].value === 'number') {
        return constant(-tokens[at++].value)
      }
      if ('value' in token) {
        return constant(token.value)
      }
      if (token.name) {
        return function (values) {
          return values[token.name]
        }
      }
      throw unreadable(source)
    }
    var unary = function () {
      if (tokens[at] && tokens[at].op === '!') {
        at++
        var operand = unary()
        return function (values) {
          return !operand(values)
        }
      }
      return primary()
    }
    var level = function (depth) {
      if (depth === LEVELS.length) {
        return unary()
      }
      var left = level(depth + 1)
      while (tokens[at] && LEVELS[depth].indexOf(tokens[at].op) !== -1) {
        left = join(OPERATORS[tokens[at++].op], left, level(depth + 1))
      }
      return left
    }
    var expression = level(0)
    if (at !== tokens.length) {
      throw unreadable(source)
    }
    return expression
  }

  var entries = function (pattern) {
    return function (source) {
      var parts = source.match(STATEMENT) || []
      return parts
        .filter(function (part) {
          return part.trim()
        })
        .map(function (part) {
          var match = pattern.exec(part)
          if (!match) {
            throw unreadable(part)
          }
          return { name: match[1], value: compile(match[2]) }
        })
    }
  }
  var assignments = entries(ASSIGNMENT)
  var classBindings = entries(CLASS_BINDING)

  var compiled = new WeakMap()
  var read = function (element, attribute, parse) {
    var cache = compiled.get(element)
    if (!cache) {
      cache = {}
      compiled.set(element, cache)
    }
    if (!(attribute in cache)) {
      try {
        cache[attribute] = parse(element.getAttribute(attribute) || '')
      } catch (error) {
        cache[attribute] = null
        console.warn(error.message)
      }
    }
    return cache[attribute]
  }

  var scopeOf = function (element) {
    var skip = 0
    for (var node = element; node; node = node.parentElement) {
      if (node !== element && node.hasAttribute(SCOPE)) {
        if (!skip) {
          return node
        }
        skip--
      }
      if (node.hasAttribute(SLOT)) {
        skip++
      }
    }
    return null
  }

  var stores = new WeakMap()
  var storeOf = function (scope) {
    var store = stores.get(scope)
    if (!store) {
      store = Object.create(null)
      ;(read(scope, STATE, assignments) || []).forEach(function (declaration) {
        store[declaration.name] = declaration.value(store)
      })
      stores.set(scope, store)
    }
    return store
  }

  var each = function (attribute, visit) {
    var elements = document.querySelectorAll('[' + attribute + ']')
    Array.prototype.forEach.call(elements, function (element) {
      var scope = scopeOf(element)
      if (scope) {
        visit(element, storeOf(scope))
      }
    })
  }

  var render = function () {
    each(IF, function (element, store) {
      var test = read(element, IF, compile)
      if (!test) {
        return
      }
      var hide = !test(store)
      if (hide !== element.hasAttribute('hidden')) {
        if (hide) {
          element.setAttribute('hidden', '')
        } else {
          element.removeAttribute('hidden')
        }
      }
    })
    each(CLASS, function (element, store) {
      ;(read(element, CLASS, classBindings) || []).forEach(function (binding) {
        var on = Boolean(binding.value(store))
        if (element.classList.contains(binding.name) !== on) {
          element.classList.toggle(binding.name, on)
        }
      })
    })
  }

  var act = function (element) {
    var actions = read(element, CLICK, assignments)
    var scope = scopeOf(element)
    if (!actions || !actions.length || !scope) {
      return false
    }
    var store = storeOf(scope)
    actions.forEach(function (action) {
      store[action.name] = action.value(store)
    })
    return true
  }

  document.addEventListener('click', function (event) {
    var changed = false
    var node = event.target
    if (node && node.nodeType !== 1) {
      node = node.parentElement
    }
    for (; node; node = node.parentElement) {
      if (node.hasAttribute(CLICK) && act(node)) {
        changed = true
      }
    }
    if (changed) {
      render()
    }
  })

  document.addEventListener('keydown', function (event) {
    var element = event.target
    if (
      (event.key !== 'Enter' && event.key !== ' ') ||
      event.repeat ||
      !element ||
      !element.hasAttribute ||
      !element.hasAttribute(CLICK) ||
      OPERABLE.test(element.tagName) ||
      (element.tagName === 'A' && element.hasAttribute('href'))
    ) {
      return
    }
    event.preventDefault()
    element.click()
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render)
  } else {
    render()
  }
})()
`

/** `hidden` must win over an author's `display: flex`, which the browser's own rule would lose to. */
export const STATE_RUNTIME_CSS = `[${StateBindings.IF_ATTR}][hidden] {
  display: none !important;
}
`
