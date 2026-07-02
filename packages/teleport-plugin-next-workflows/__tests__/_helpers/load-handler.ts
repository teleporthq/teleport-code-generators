import { nodeRegistry } from '../../src'

// Shared loader for re-evaluating a runtime handler in the test process.
//
// Each entry in `nodeRegistry` exposes its handler via `generateHandler()`,
// which returns the .toString() of a TS-compiled async function. ts-jest's
// default ES5 emit downlevels async/await into calls to module-scope helpers
// `__awaiter` and `__generator`. Those helpers are emitted at the top of
// every compiled module that USES async syntax — but this helper file does
// not, so ts-jest skips them here and the `new Function(...)` invocation
// below would fail with "ReferenceError: __awaiter is not defined".
//
// We embed the canonical TS-emit polyfills inline so the helper is
// self-contained: any caller, even from a file that doesn't trigger helper
// emission, gets a working handler back.
//
// (The polyfills are the verbatim TS 4.x emit, kept in sync with the
// upstream `__awaiter` / `__generator` definitions tslib ships.)
const TS_EMIT_HELPERS = `var __assign = (this && this.__assign) || function () {
  __assign = Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
  function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
  return new (P || (P = Promise))(function (resolve, reject) {
    function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
    function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
    function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
    step((generator = generator.apply(thisArg, _arguments)).next());
  });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
  var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
  function verb(n) { return function (v) { return step([n, v]); }; }
  function step(op) {
    if (f) throw new TypeError("Generator is already executing.");
    while (g && (g = 0, op[0] && (_ = 0)), _) try {
      if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0: case 1: t = op; break;
        case 4: _.label++; return { value: op[1], done: false };
        case 5: _.label++; y = op[1]; op = [0]; continue;
        case 7: op = _.ops.pop(); _.trys.pop(); continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
          if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
          if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
          if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
          if (t[2]) _.ops.pop();
          _.trys.pop(); continue;
      }
      op = body.call(thisArg, _);
    } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
    if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
  }
};
`

export type HandlerFn = (config: unknown, context: Record<string, unknown>) => Promise<unknown>

/**
 * Convert a kebab-case node type ("general-delay") into the underscore-cased
 * symbol the handler is bound to in its compiled source ("general_delay").
 * The codegen pipeline does the same transformation in api-route-generator.
 */
const handlerSymbolFor = (nodeType: string): string => nodeType.replace(/-/g, '_')

/**
 * Load a handler by node-type string and return it as a callable async fn.
 * Throws if the type isn't registered. The returned function captures the
 * eval scope, so `__awaiter`/`__generator` references inside it resolve to
 * the helpers piped in here.
 */
export const loadHandler = (nodeType: string): HandlerFn => {
  const generator = nodeRegistry[nodeType]
  if (!generator) {
    throw new Error(`No handler registered for node type: ${nodeType}`)
  }
  const src = generator.generateHandler()
  const symbol = handlerSymbolFor(nodeType)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${TS_EMIT_HELPERS}\n${src}\nreturn ${symbol};`)
  return factory() as HandlerFn
}
