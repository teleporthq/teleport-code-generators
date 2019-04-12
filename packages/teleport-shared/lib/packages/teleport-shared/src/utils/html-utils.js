"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHTMLNode = function (tagName, children) {
    if (children === void 0) { children = []; }
    return {
        type: 'element',
        tagName: tagName,
        properties: {},
        children: children,
    };
};
exports.createTextNode = function (content) {
    return {
        type: 'text',
        value: content,
    };
};
exports.addBooleanAttributeToNode = function (node, key) {
    node.properties[key] = '';
    /* adding empty string as @starptech/prettyhtml-hast-to-html which we are currently
    using for generating HTML supports boolean way of adding attributes only for HTML
    attributes but not for Vue*/
};
exports.addAttributeToNode = function (node, key, value) {
    node.properties[key] = value;
};
exports.addClassToNode = function (node, className) {
    node.properties.class = className;
};
exports.addChildNode = function (node, child) {
    node.children.push(child);
};
exports.addTextNode = function (node, text) {
    node.children.push(exports.createTextNode(text));
};
//# sourceMappingURL=html-utils.js.map