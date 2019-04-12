"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.component = function (name, node) {
    return {
        name: name,
        node: node,
    };
};
exports.elementNode = function (elementType, attrs, children) {
    return {
        type: 'element',
        content: exports.element(elementType, attrs, children),
    };
};
exports.element = function (elementType, attrs, children) {
    return {
        elementType: elementType,
        name: elementType,
        attrs: attrs,
        children: children,
    };
};
exports.staticNode = function (content) {
    return {
        type: 'static',
        content: content,
    };
};
exports.dynamicNode = function (referenceType, id) {
    return {
        type: 'dynamic',
        content: {
            referenceType: referenceType,
            id: id,
        },
    };
};
exports.slotNode = function (fallback, name) {
    return {
        type: 'slot',
        content: {
            fallback: fallback,
            name: name,
        },
    };
};
//# sourceMappingURL=uidl-builders.js.map