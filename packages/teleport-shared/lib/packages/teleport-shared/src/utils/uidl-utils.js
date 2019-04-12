"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var teleport_types_constants_1 = require("@teleporthq/teleport-types-constants");
/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
exports.extractPageMetadata = function (routeDefinitions, stateName, options) {
    if (options === void 0) { options = {
        usePathAsFileName: false,
        convertDefaultToIndex: false,
    }; }
    var defaultPage = routeDefinitions.defaultValue;
    var pageDefinitions = routeDefinitions.values || [];
    var pageDefinition = pageDefinitions.find(function (stateDef) { return stateDef.value === stateName; });
    // If not meta object is defined, the stateName is used
    if (!pageDefinition || !pageDefinition.meta) {
        return {
            fileName: options.convertDefaultToIndex && stateName === defaultPage ? 'index' : stateName,
            componentName: stateName,
            path: '/' + stateName,
        };
    }
    // In case the path is used as the url (next, nuxt), we override the filename from the path
    var fileNameFromMeta = options.usePathAsFileName
        ? pageDefinition.meta.path && pageDefinition.meta.path.slice(1)
        : pageDefinition.meta.fileName;
    return {
        fileName: options.convertDefaultToIndex && stateName === defaultPage
            ? 'index'
            : fileNameFromMeta || stateName,
        componentName: pageDefinition.meta.componentName || stateName,
        path: pageDefinition.meta.path || '/' + stateName,
    };
};
exports.extractRoutes = function (rootComponent) {
    // Assuming root element starts with a UIDLElementNode
    var rootElement = rootComponent.node.content;
    // Look for conditional nodes in the first level children of the root element
    return rootElement.children.filter(function (child) { return child.type === 'conditional' && child.content.reference.content.id === 'route'; });
};
exports.prefixPlaygroundAssetsURL = function (prefix, originalString) {
    if (!originalString || !originalString.startsWith(teleport_types_constants_1.ASSETS_IDENTIFIER)) {
        return originalString;
    }
    if (originalString.startsWith('/')) {
        return prefix + originalString;
    }
    return prefix + "/" + originalString;
};
// Clones existing objects while keeping the type cast
exports.cloneObject = function (node) { return JSON.parse(JSON.stringify(node)); };
// This function parses all the UIDLNodes in a tree structure
// enabling a function to be applied to each individual node
exports.traverseNodes = function (node, fn, parent) {
    if (parent === void 0) { parent = null; }
    fn(node, parent);
    switch (node.type) {
        case 'element':
            if (node.content.children) {
                node.content.children.forEach(function (child) {
                    exports.traverseNodes(child, fn, node);
                });
            }
            break;
        case 'repeat':
            exports.traverseNodes(node.content.node, fn, node);
            break;
        case 'conditional':
            exports.traverseNodes(node.content.node, fn, node);
            break;
        case 'slot':
            if (node.content.fallback) {
                exports.traverseNodes(node.content.fallback, fn, node);
            }
            break;
        case 'static':
        case 'dynamic':
            break;
        default:
            throw new Error("traverseNodes was given an unsupported node type " + JSON.stringify(node, null, 2));
    }
};
// Parses a node structure recursively and applies a function to each UIDLElement instance
exports.traverseElements = function (node, fn) {
    switch (node.type) {
        case 'element':
            fn(node.content);
            if (node.content.children) {
                node.content.children.forEach(function (child) {
                    exports.traverseElements(child, fn);
                });
            }
            break;
        case 'repeat':
            exports.traverseElements(node.content.node, fn);
            break;
        case 'conditional':
            exports.traverseElements(node.content.node, fn);
            break;
        case 'slot':
            if (node.content.fallback) {
                exports.traverseElements(node.content.fallback, fn);
            }
            break;
        case 'static':
        case 'dynamic':
            break;
        default:
            throw new Error("traverseElements was given an unsupported node type " + JSON.stringify(node, null, 2));
    }
};
exports.splitDynamicAndStaticStyles = function (style) {
    // const staticStyles: UIDLStyleDefinitions = {}
    // const dynamicStyles: UIDLStyleDefinitions = {}
    var responsePayload = { staticStyles: {}, dynamicStyles: {} };
    Object.keys(style).reduce(function (acc, styleKey) {
        var styleValue = style[styleKey];
        var staticStyles = acc.staticStyles, dynamicStyles = acc.dynamicStyles;
        switch (styleValue.type) {
            case 'dynamic':
                dynamicStyles[styleKey] = styleValue;
                return acc;
            case 'static':
                staticStyles[styleKey] = styleValue;
                return acc;
            case 'nested-style':
                var nestedResult = exports.splitDynamicAndStaticStyles(styleValue.content);
                if (Object.keys(nestedResult.dynamicStyles).length > 0) {
                    dynamicStyles[styleKey] = styleValue;
                    dynamicStyles[styleKey].content = nestedResult.dynamicStyles;
                }
                if (Object.keys(nestedResult.staticStyles).length > 0) {
                    staticStyles[styleKey] = styleValue;
                    staticStyles[styleKey].content = nestedResult.staticStyles;
                }
                return acc;
            default:
                throw new Error("splitDynamicAndStaticStyles encountered an unknown style definition " + JSON.stringify(styleValue, null, 2));
        }
        return acc;
    }, responsePayload);
    return responsePayload;
};
// TODO add tests
// return only the root level styles, ignoring any :hover or @media keys which can be nested structures
exports.cleanupNestedStyles = function (style) {
    return Object.keys(style).reduce(function (resultedStyles, styleKey) {
        var styleValue = style[styleKey];
        switch (styleValue.type) {
            case 'nested-style':
                return resultedStyles;
            default:
                resultedStyles[styleKey] = styleValue;
                return resultedStyles;
        }
    }, {});
};
// removes all the dynamic styles from the style object, including the nested structures
exports.cleanupDynamicStyles = function (style) {
    return Object.keys(style).reduce(function (resultedStyles, styleKey) {
        var styleValue = style[styleKey];
        switch (styleValue.type) {
            case 'dynamic':
                return resultedStyles;
            case 'nested-style':
                resultedStyles[styleKey] = styleValue;
                resultedStyles[styleKey].content = exports.cleanupDynamicStyles(styleValue.content);
                return resultedStyles;
            case 'static':
                resultedStyles[styleKey] = styleValue;
                return resultedStyles;
            default:
                throw new Error("cleanupDynamicStyles encountered an unknown style definition " + JSON.stringify(styleValue, null, 2));
        }
    }, {});
};
// Traverses the style object and applies the convert funtion to all the dynamic styles
exports.transformDynamicStyles = function (style, transform) {
    return Object.keys(style).reduce(function (resultedStyles, styleKey) {
        var styleValue = style[styleKey];
        switch (styleValue.type) {
            case 'dynamic':
                resultedStyles[styleKey] = transform(styleValue, styleKey);
                return resultedStyles;
            case 'nested-style':
                resultedStyles[styleKey] = exports.transformDynamicStyles(styleValue.content, transform);
                return resultedStyles;
            case 'static':
                resultedStyles[styleKey] = styleValue.content;
                return resultedStyles;
            default:
                throw new Error("transformDynamicStyles encountered an unknown style definition " + JSON.stringify(styleValue, null, 2));
        }
    }, {});
};
/**
 * Transform properties like
 * $props.something
 * $local.something
 * $state.something
 *
 * Into their json alternative which is used in beta release/0.6 and
 * later.
 */
exports.transformStringAssignmentToJson = function (declaration) {
    if (typeof declaration === 'number') {
        return {
            type: 'static',
            content: declaration,
        };
    }
    var parts = declaration.split('.');
    var prefix = parts[0];
    var path = parts.slice(1).join('.');
    if (['$props', '$state', '$local'].indexOf(prefix) !== -1) {
        var referenceType = 'prop';
        if (prefix !== '$props') {
            referenceType = prefix.replace('$', '');
        }
        return {
            type: 'dynamic',
            content: {
                referenceType: referenceType,
                id: path,
            },
        };
    }
    return {
        type: 'static',
        content: declaration,
    };
};
exports.transformStylesAssignmentsToJson = function (styleObject) {
    var newStyleObject = {};
    Object.keys(styleObject).reduce(function (acc, key) {
        var styleContentAtKey = styleObject[key];
        var entityType = typeof styleContentAtKey;
        if (['string', 'number'].indexOf(entityType) !== -1) {
            acc[key] = exports.transformStringAssignmentToJson(styleContentAtKey);
            return acc;
        }
        if (!Array.isArray(styleContentAtKey) && entityType === 'object') {
            // if this value is already properly declared, make sure it is not
            var _a = styleContentAtKey, type = _a.type, content = _a.content;
            if (['dynamic', 'static'].indexOf(type) !== -1) {
                acc[key] = styleContentAtKey;
                return acc;
            }
            if (type === 'nested-style') {
                acc[key] = {
                    type: 'nested-style',
                    content: exports.transformStylesAssignmentsToJson(content),
                };
                return acc;
            }
            // if the supported types of objects did not match the previous if statement
            // we are ready to begin parsing a new nested style
            acc[key] = {
                type: 'nested-style',
                content: exports.transformStylesAssignmentsToJson(styleContentAtKey),
            };
            return acc;
        }
        throw new Error("transformStylesAssignmentsToJson encountered a style value that is not supported " + JSON.stringify(styleContentAtKey, null, 2));
    }, newStyleObject);
    return newStyleObject;
};
exports.transformAttributesAssignmentsToJson = function (attributesObject) {
    var newStyleObject = {};
    Object.keys(attributesObject).reduce(function (acc, key) {
        var attributeContent = attributesObject[key];
        var entityType = typeof attributeContent;
        if (['string', 'number'].indexOf(entityType) !== -1) {
            acc[key] = exports.transformStringAssignmentToJson(attributeContent);
            return acc;
        }
        if (!Array.isArray(attributeContent) && entityType === 'object') {
            // if this value is already properly declared, make sure it is not
            var type = attributeContent.type;
            if (['dynamic', 'static'].indexOf(type) !== -1) {
                acc[key] = attributeContent;
                return acc;
            }
            throw new Error("transformAttributesAssignmentsToJson encountered a style value that is not supported " + JSON.stringify(attributeContent, null, 2));
        }
        throw new Error("transformAttributesAssignmentsToJson encountered a style value that is not supported " + JSON.stringify(attributeContent, null, 2));
    }, newStyleObject);
    return newStyleObject;
};
//# sourceMappingURL=uidl-utils.js.map