"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var jss_preset_default_1 = __importDefault(require("jss-preset-default"));
var jss_1 = __importDefault(require("jss"));
jss_1.default.setup(jss_preset_default_1.default());
var getContentOfStyleKey = function (styleValue) {
    switch (styleValue.type) {
        case 'static':
            return styleValue.content;
        case 'nested-style':
            return getContentOfStyleObject(styleValue.content);
        default:
            throw new Error("getContentOfStyleKey received unsupported " + JSON.stringify(styleValue, null, 2) + " UIDLNodeStyleValue value");
    }
};
var getContentOfStyleObject = function (styleObject) {
    return Object.keys(styleObject).reduce(function (acc, key) {
        acc[key] = getContentOfStyleKey(styleObject[key]);
        return acc;
    }, {});
};
exports.createCSSClass = function (className, styleObject) {
    var _a;
    return jss_1.default
        .createStyleSheet((_a = {},
        _a["." + className] = getContentOfStyleObject(styleObject),
        _a), {
        generateClassName: function () { return className; },
    })
        .toString();
};
exports.createCSSClassFromStringMap = function (className, styleObject) {
    var _a;
    return jss_1.default
        .createStyleSheet((_a = {},
        _a["." + className] = styleObject,
        _a), {
        generateClassName: function () { return className; },
    })
        .toString();
};
//# sourceMappingURL=jss-utils.js.map