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
var ast_js_utils_1 = require("./ast-js-utils");
/**
 * Adds a class definition string to an existing string of classes
 */
exports.addClassStringOnJSXTag = function (jsxNode, classString, t) {
    if (t === void 0) { t = types; }
    var classAttribute = getClassAttribute(jsxNode, { createIfNotFound: true }, t);
    if (classAttribute.value && classAttribute.value.type === 'StringLiteral') {
        var classArray = classAttribute.value.value.split(' ');
        classArray.push(classString);
        classAttribute.value.value = classArray.join(' ').trim();
    }
    else {
        throw new Error('Attempted to set a class string literral on a jsx tag which had an invalid className attribute');
    }
};
/**
 * Gets the existing className declaration attribute or generates and returns
 * a newly created and assigned one to the given JSXNode
 */
var getClassAttribute = function (jsxNode, params, t) {
    if (params === void 0) { params = { createIfNotFound: false }; }
    if (t === void 0) { t = types; }
    var classNameAttribute = jsxNode.openingElement.attributes.find(function (attribute) {
        return attribute.type === 'JSXAttribute' && attribute.name.name === 'className';
    });
    if (!classNameAttribute && params.createIfNotFound) {
        var createdClassAttribute = t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral(''));
        jsxNode.openingElement.attributes.push(createdClassAttribute);
        return createdClassAttribute;
    }
    return classNameAttribute;
};
/**
 * Makes `${name}={${prefix}.${value}}` happen in AST
 *
 * @param jsxASTNode the jsx ast element
 * @param name the name of the prop
 * @param value the value of the prop (will be concatenated with props. before it)
 */
exports.addDynamicAttributeOnTag = function (jsxASTNode, name, value, prefix, t) {
    if (prefix === void 0) { prefix = ''; }
    if (t === void 0) { t = types; }
    var content = prefix === ''
        ? t.identifier(value)
        : t.memberExpression(t.identifier(prefix), t.identifier(value));
    jsxASTNode.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(content)));
};
// TODO: Use generateASTDefinitionForJSXTag instead?
exports.generateStyledJSXTag = function (templateLiteral, t) {
    if (t === void 0) { t = types; }
    if (typeof templateLiteral === 'string') {
        templateLiteral = stringAsTemplateLiteral(templateLiteral, t);
    }
    var jsxTagChild = t.jsxExpressionContainer(templateLiteral);
    var jsxTag = generateBasicJSXTag('style', [jsxTagChild, t.jsxText('\n')], t);
    exports.addAttributeToJSXTag(jsxTag, { name: 'jsx' }, t);
    return jsxTag;
};
var stringAsTemplateLiteral = function (str, t) {
    if (t === void 0) { t = types; }
    var formmattedString = "\n" + str + "\n  ";
    return t.templateLiteral([
        t.templateElement({
            raw: formmattedString,
            cooked: formmattedString,
        }, true),
    ], []);
};
var generateBasicJSXTag = function (tagName, children, t) {
    if (children === void 0) { children = []; }
    if (t === void 0) { t = types; }
    var jsxIdentifier = t.jsxIdentifier(tagName);
    var openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false);
    var closingDiv = t.jsxClosingElement(jsxIdentifier);
    var tag = t.jsxElement(openingDiv, closingDiv, children, false);
    return tag;
};
exports.addAttributeToJSXTag = function (jsxNode, attribute, t) {
    if (t === void 0) { t = types; }
    var nameOfAttribute = t.jsxIdentifier(attribute.name);
    var attributeDefinition;
    if (typeof attribute.value === 'boolean') {
        attributeDefinition = t.jsxAttribute(nameOfAttribute);
    }
    else {
        attributeDefinition = t.jsxAttribute(nameOfAttribute, getProperAttributeValueAssignment(attribute.value));
    }
    jsxNode.openingElement.attributes.push(attributeDefinition);
};
/**
 * node must be a AST node element of type JSXElement (babel-types) or
 * equivalent
 */
var getProperAttributeValueAssignment = function (value, t) {
    if (t === void 0) { t = types; }
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        return t.stringLiteral(value);
    }
    return t.jsxExpressionContainer(ast_js_utils_1.convertValueToLiteral(value));
};
/**
 * Generates the AST definiton (without start/end position) for a JSX tag
 * with an opening and closing tag.
 *
 * t is the babel-types api which generates the JSON structure representing the AST.
 * This is set as a parameter to allow us to remove babel-types at some point if we
 * decide to, and to allow easier unit testing of the utils.
 *
 * Requires the tagName, which is a string that will be used to generate the
 * tag.
 *
 * Example:
 * generateASTDefinitionForJSXTag("div") will generate the AST
 * equivalent of <div></div>
 */
exports.generateASTDefinitionForJSXTag = function (tagName, t) {
    if (t === void 0) { t = types; }
    var jsxIdentifier = t.jsxIdentifier(tagName);
    var openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false);
    var closingDiv = t.jsxClosingElement(jsxIdentifier);
    var tag = t.jsxElement(openingDiv, closingDiv, [], false);
    return tag;
};
exports.addChildJSXTag = function (tag, childNode) {
    tag.children.push(childNode, types.jsxText('\n'));
};
exports.addChildJSXText = function (tag, text, t) {
    if (t === void 0) { t = types; }
    tag.children.push(t.jsxText(text), types.jsxText('\n'));
};
// TODO: Replace with generic add attribute?
exports.addJSXTagStyles = function (tag, styleMap, t) {
    if (t === void 0) { t = types; }
    var styleObjectExpression = ast_js_utils_1.objectToObjectExpression(styleMap, t);
    var styleObjectExpressionContainer = t.jsxExpressionContainer(styleObjectExpression);
    var styleJSXAttr = t.jsxAttribute(t.jsxIdentifier('style'), styleObjectExpressionContainer);
    tag.openingElement.attributes.push(styleJSXAttr);
};
exports.createConditionalJSXExpression = function (content, conditionalExpression, conditionalIdentifier, t) {
    if (t === void 0) { t = types; }
    var contentNode;
    if (typeof content === 'string') {
        contentNode = t.stringLiteral(content);
    }
    else if (content.expression) {
        contentNode = content.expression;
    }
    else {
        contentNode = content;
    }
    var binaryExpression;
    // When the stateValue is an object we will compute a logical/binary expression on the left side
    var conditions = conditionalExpression.conditions, matchingCriteria = conditionalExpression.matchingCriteria;
    var binaryExpressions = conditions.map(function (condition) {
        return exports.createBinaryExpression(condition, conditionalIdentifier);
    });
    if (binaryExpressions.length === 1) {
        binaryExpression = binaryExpressions[0];
    }
    else {
        // the first two binary expressions are put together as a logical expression
        var firstExp = binaryExpressions[0], secondExp = binaryExpressions[1];
        var operation = matchingCriteria === 'all' ? '&&' : '||';
        var expression = t.logicalExpression(operation, firstExp, secondExp);
        // accumulate the rest of the expressions to the logical expression
        for (var index = 2; index < binaryExpressions.length; index++) {
            expression = t.logicalExpression(operation, expression, binaryExpressions[index]);
        }
        binaryExpression = expression;
    }
    return t.jsxExpressionContainer(t.logicalExpression('&&', binaryExpression, contentNode));
};
exports.createBinaryExpression = function (condition, conditionalIdentifier, t) {
    if (t === void 0) { t = types; }
    var operand = condition.operand, operation = condition.operation;
    var identifier = conditionalIdentifier.prefix
        ? t.memberExpression(t.identifier(conditionalIdentifier.prefix), t.identifier(conditionalIdentifier.key))
        : t.identifier(conditionalIdentifier.key);
    if (operation === '===') {
        if (operand === true) {
            return identifier;
        }
        if (operand === false) {
            return t.unaryExpression('!', identifier);
        }
    }
    if (operand !== undefined) {
        var stateValueIdentifier = ast_js_utils_1.convertValueToLiteral(operand, conditionalIdentifier.type);
        return t.binaryExpression(convertToBinaryOperator(operation), identifier, stateValueIdentifier);
    }
    else {
        return operation ? t.unaryExpression(convertToUnaryOperator(operation), identifier) : identifier;
    }
};
/**
 * Because of the restrictions of the AST Types we need to have a clear subset of binary operators we can use
 * @param operation - the operation defined in the UIDL for the current state branch
 */
var convertToBinaryOperator = function (operation) {
    var allowedOperations = ['===', '!==', '>=', '<=', '>', '<'];
    if (allowedOperations.includes(operation)) {
        return operation;
    }
    else {
        return '===';
    }
};
var convertToUnaryOperator = function (operation) {
    var allowedOperations = ['!'];
    if (allowedOperations.includes(operation)) {
        return operation;
    }
    else {
        return '!';
    }
};
exports.createTernaryOperation = function (stateKey, leftNode, rightNode, t) {
    if (t === void 0) { t = types; }
    return types.jsxExpressionContainer(types.conditionalExpression(types.identifier(stateKey), leftNode, rightNode));
};
//# sourceMappingURL=ast-jsx-utils.js.map