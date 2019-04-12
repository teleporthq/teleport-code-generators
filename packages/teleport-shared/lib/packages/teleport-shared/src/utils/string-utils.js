"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cammelCaseToDashCase = function (name) {
    var ret = '';
    var prevLowercase = false;
    for (var _i = 0, name_1 = name; _i < name_1.length; _i++) {
        var s = name_1[_i];
        var isUppercase = s.toUpperCase() === s;
        if (isUppercase && prevLowercase) {
            ret += '-';
        }
        ret += s;
        prevLowercase = !isUppercase;
    }
    return ret.replace(/-+/g, '-').toLowerCase();
};
exports.stringToCamelCase = function (str) {
    return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, function (_, chr) { return chr.toUpperCase(); });
};
exports.capitalize = function (str) { return str[0].toUpperCase() + str.slice(1); };
exports.stringToUpperCamelCase = function (str) { return exports.capitalize(exports.stringToCamelCase(str)); };
// Replaces all ocurrences of non alpha-numeric characters in the string (except _)
exports.sanitizeVariableName = function (str) { return str.replace(/\W/g, ''); };
exports.slugify = function (str) {
    if (str == null) {
        return null; // Check for undefined or null
    }
    return str
        .toLowerCase()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w\-]+/g, '') // Remove all non-word chars
        .replace(/\-\-+/g, '-') // Replace multiple - with single -
        .replace(/^-+/, '') // Trim - from start of text
        .replace(/-+$/, '') // Trim - from end of text
        .replace(/&/g, '-and-'); // Replace & with 'and'
};
exports.addSpacesToEachLine = function (spaces, str) {
    // indent the first line
    var respaced = spaces + str;
    // add indent to all the other lines
    return respaced.replace(/\n/g, "\n" + spaces);
};
exports.removeLastEmptyLine = function (str) {
    return str.replace(/\n$/g, '');
};
//# sourceMappingURL=string-utils.js.map