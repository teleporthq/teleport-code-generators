"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var standalone_1 = require("prettier/standalone");
var parser_html_1 = __importDefault(require("prettier/parser-html"));
var parser_postcss_1 = __importDefault(require("prettier/parser-postcss"));
var prettyhtml_hast_to_html_1 = __importDefault(require("@starptech/prettyhtml-hast-to-html"));
var constants_1 = require("../../../shared/constants");
exports.generator = function (htmlObject) {
    var unformatedString = prettyhtml_hast_to_html_1.default(htmlObject);
    var formatted = standalone_1.format(unformatedString, __assign({}, constants_1.PRETTIER_CONFIG, { htmlWhitespaceSensitivity: 'ignore', plugins: [parser_html_1.default, parser_postcss_1.default], parser: 'html' }));
    return formatted;
};
//# sourceMappingURL=html-to-string.js.map