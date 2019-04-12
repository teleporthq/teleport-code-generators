"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var types = __importStar(require("@babel/types"));
/**
 * A tricky way to pass down custom configuration into
 * the objectToObjectExpression values, to allow for member expressions like
 * Proptypes.String.isRequired to be handled by the function.
 */
var ParsedASTNode = /** @class */ (function () {
    function ParsedASTNode(ast) {
        this.ast = ast;
    }
    return ParsedASTNode;
}());
exports.ParsedASTNode = ParsedASTNode;
exports.objectToObjectExpression = function (objectMap, t) {
    if (t === void 0) { t = types; }
    var props = Object.keys(objectMap).reduce(function (acc, key) {
        var keyIdentifier = t.stringLiteral(key);
        var value = objectMap[key];
        var computedLiteralValue = null;
        if (value instanceof ParsedASTNode) {
            computedLiteralValue = value.ast;
        }
        else if (typeof value === 'boolean') {
            computedLiteralValue = t.booleanLiteral(value);
        }
        else if (typeof value === 'string') {
            computedLiteralValue = t.stringLiteral(value);
        }
        else if (typeof value === 'number') {
            computedLiteralValue = t.numericLiteral(value);
        }
        else if (Array.isArray(value)) {
            computedLiteralValue = t.arrayExpression(value.map(function (element) { return exports.convertValueToLiteral(element); }));
        }
        else if (value === Object) {
            computedLiteralValue = t.identifier('Object');
        }
        else if (typeof value === 'object') {
            computedLiteralValue = exports.objectToObjectExpression(value, t);
        }
        else if (value === String) {
            computedLiteralValue = t.identifier('String');
        }
        else if (value === Number) {
            computedLiteralValue = t.identifier('Number');
        }
        else if (value === Array) {
            computedLiteralValue = t.identifier('Array');
        }
        if (computedLiteralValue) {
            acc.push(t.objectProperty(keyIdentifier, computedLiteralValue));
        }
        return acc;
    }, []);
    var objectExpression = t.objectExpression(props);
    return objectExpression;
};
exports.convertValueToLiteral = function (value, explicitType, t) {
    if (explicitType === void 0) { explicitType = ''; }
    if (t === void 0) { t = types; }
    if (Array.isArray(value)) {
        return t.arrayExpression(value.map(function (val) { return exports.convertValueToLiteral(val); }));
    }
    var typeToCompare = explicitType ? explicitType : typeof value;
    switch (typeToCompare) {
        case 'string':
            return t.stringLiteral(value);
        case 'boolean':
            return t.booleanLiteral(value);
        case 'number':
            return t.numericLiteral(value);
        case 'object':
            return exports.objectToObjectExpression(value);
        default:
            return t.identifier(value.toString());
    }
};
exports.makeConstAssign = function (constName, asignment, t) {
    if (asignment === void 0) { asignment = null; }
    if (t === void 0) { t = types; }
    var declarator = t.variableDeclarator(t.identifier(constName), asignment);
    var constAsignment = t.variableDeclaration('const', [declarator]);
    return constAsignment;
};
exports.makeDefaultExport = function (name, t) {
    if (t === void 0) { t = types; }
    return t.exportDefaultDeclaration(t.identifier(name));
};
/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
exports.makeGenericImportStatement = function (path, imports, t) {
    if (t === void 0) { t = types; }
    // Only one of the imports can be the default one so this is a fail safe for invalid UIDL data
    var defaultImport = imports.find(function (imp) { return !imp.namedImport; }); // only one import can be default
    var importASTs = [];
    if (defaultImport) {
        var namedImports = imports.filter(function (imp) { return imp.identifier !== defaultImport.identifier; });
        // Default import needs to be the first in the array
        importASTs = [
            t.importDefaultSpecifier(t.identifier(defaultImport.identifier))
        ].concat(namedImports.map(function (imp) {
            return t.importSpecifier(t.identifier(imp.identifier), t.identifier(imp.originalName));
        }));
    }
    else {
        // No default import, so array order doesn't matter
        importASTs = imports.map(function (imp) {
            return t.importSpecifier(t.identifier(imp.identifier), t.identifier(imp.originalName));
        });
    }
    return t.importDeclaration(importASTs, t.stringLiteral(path));
};
//# sourceMappingURL=ast-js-utils.js.map