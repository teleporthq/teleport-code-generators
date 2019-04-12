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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
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
var _this = this;
Object.defineProperty(exports, "__esModule", { value: true });
var html_to_string_1 = require("../../../../src/core/builder/generators/html-to-string");
var html_utils_1 = require("./html-utils");
var uidl_utils_1 = require("./uidl-utils");
var string_utils_1 = require("./string-utils");
var constants_1 = require("../constants");
exports.createHtmlIndexFile = function (uidl, options) {
    var _a = options.assetsPrefix, assetsPrefix = _a === void 0 ? '' : _a, _b = options.fileName, fileName = _b === void 0 ? 'index' : _b, appRootOverride = options.appRootOverride;
    var _c = uidl.globals, settings = _c.settings, meta = _c.meta, assets = _c.assets, manifest = _c.manifest;
    var htmlNode = html_utils_1.createHTMLNode('html');
    var headNode = html_utils_1.createHTMLNode('head');
    var bodyNode = html_utils_1.createHTMLNode('body');
    html_utils_1.addChildNode(htmlNode, headNode);
    html_utils_1.addChildNode(htmlNode, bodyNode);
    // Vue and React use a standard <div id="app"/> in the body tag.
    // Nuxt has an internal templating so requires an override
    if (appRootOverride) {
        html_utils_1.addTextNode(bodyNode, appRootOverride);
    }
    else {
        var appRootNode = html_utils_1.createHTMLNode('div');
        html_utils_1.addAttributeToNode(appRootNode, 'id', 'app');
        html_utils_1.addChildNode(bodyNode, appRootNode);
    }
    if (settings.language) {
        html_utils_1.addAttributeToNode(htmlNode, 'lang', settings.language);
    }
    if (settings.title) {
        var titleTag = html_utils_1.createHTMLNode('title');
        html_utils_1.addTextNode(titleTag, settings.title);
        html_utils_1.addChildNode(headNode, titleTag);
    }
    if (manifest) {
        var linkTag = html_utils_1.createHTMLNode('link'); // , { selfClosing: true })
        html_utils_1.addAttributeToNode(linkTag, 'rel', 'manifest');
        html_utils_1.addAttributeToNode(linkTag, 'href', '/static/manifest.json');
        html_utils_1.addChildNode(headNode, linkTag);
    }
    meta.forEach(function (metaItem) {
        var metaTag = html_utils_1.createHTMLNode('meta'); // , { selfClosing: true })
        Object.keys(metaItem).forEach(function (key) {
            var prefixedURL = uidl_utils_1.prefixPlaygroundAssetsURL(assetsPrefix, metaItem[key]);
            html_utils_1.addAttributeToNode(metaTag, key, prefixedURL);
        });
        html_utils_1.addChildNode(headNode, metaTag);
    });
    assets.forEach(function (asset) {
        var assetPath = uidl_utils_1.prefixPlaygroundAssetsURL(assetsPrefix, asset.path);
        // link stylesheet (external css, font)
        if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
            var linkTag = html_utils_1.createHTMLNode('link'); // , { selfClosing: true })
            html_utils_1.addAttributeToNode(linkTag, 'rel', 'stylesheet');
            html_utils_1.addAttributeToNode(linkTag, 'href', assetPath);
            html_utils_1.addChildNode(headNode, linkTag);
        }
        // inline style
        if (asset.type === 'style' && asset.content) {
            var styleTag = html_utils_1.createHTMLNode('style');
            html_utils_1.addTextNode(styleTag, asset.content);
            html_utils_1.addChildNode(headNode, styleTag);
        }
        // script (external or inline)
        if (asset.type === 'script') {
            var scriptInBody = (asset.meta && asset.meta.target === 'body') || false;
            var scriptTag = html_utils_1.createHTMLNode('script');
            // addTextNode(scriptTag, ' ') // To ensure tag is not automatically self-closing, which causes problems in the <head>
            html_utils_1.addAttributeToNode(scriptTag, 'type', 'text/javascript');
            if (assetPath) {
                html_utils_1.addAttributeToNode(scriptTag, 'src', assetPath);
                if (asset.meta && asset.meta.defer) {
                    html_utils_1.addBooleanAttributeToNode(scriptTag, 'defer');
                }
                if (asset.meta && asset.meta.async) {
                    html_utils_1.addBooleanAttributeToNode(scriptTag, 'async');
                }
            }
            else if (asset.content) {
                html_utils_1.addTextNode(scriptTag, asset.content);
            }
            if (scriptInBody) {
                html_utils_1.addChildNode(bodyNode, scriptTag);
            }
            else {
                html_utils_1.addChildNode(headNode, scriptTag);
            }
        }
        // icon
        if (asset.type === 'icon' && assetPath) {
            var iconTag_1 = html_utils_1.createHTMLNode('link'); // , { selfClosing: true })
            html_utils_1.addAttributeToNode(iconTag_1, 'rel', 'shortcut icon');
            html_utils_1.addAttributeToNode(iconTag_1, 'href', assetPath);
            if (typeof asset.meta === 'object') {
                var assetMeta_1 = asset.meta;
                Object.keys(assetMeta_1).forEach(function (metaKey) {
                    html_utils_1.addAttributeToNode(iconTag_1, metaKey, assetMeta_1[metaKey]);
                });
            }
            html_utils_1.addChildNode(headNode, iconTag_1);
        }
    });
    var htmlInnerString = html_to_string_1.generator(htmlNode);
    var content = "\n    <!DOCTYPE html>\n    " + htmlInnerString;
    return exports.createFile(fileName, constants_1.FILE_TYPE.HTML, content);
};
// Creates a manifest json file with the UIDL having priority over the default values
exports.createManifestJSONFile = function (uidl, assetsPrefix) {
    var manifest = uidl.globals.manifest;
    var projectName = uidl.name;
    var defaultManifest = {
        short_name: projectName,
        name: projectName,
        display: 'standalone',
        start_url: '/',
    };
    var icons = manifest.icons.map(function (icon) {
        var src = uidl_utils_1.prefixPlaygroundAssetsURL(assetsPrefix, icon.src);
        return __assign({}, icon, { src: src });
    });
    var content = __assign({}, defaultManifest, manifest, { icons: icons });
    return exports.createFile('manifest', constants_1.FILE_TYPE.JSON, JSON.stringify(content, null, 2));
};
exports.createPackageJSONFile = function (packageJSONTemplate, overwrites) {
    var projectName = overwrites.projectName, dependencies = overwrites.dependencies;
    var content = __assign({}, packageJSONTemplate, { name: string_utils_1.slugify(projectName), dependencies: __assign({}, packageJSONTemplate.dependencies, dependencies) });
    return exports.createFile('package', constants_1.FILE_TYPE.JSON, JSON.stringify(content, null, 2));
};
exports.createPageOutputs = function (params) { return __awaiter(_this, void 0, void 0, function () {
    var componentUIDL, metadataOptions, pageName, node, routeDefinitions, _a, componentName, fileName, pageUIDL;
    return __generator(this, function (_b) {
        componentUIDL = params.componentUIDL, metadataOptions = params.metadataOptions;
        pageName = componentUIDL.name, node = componentUIDL.node;
        routeDefinitions = componentUIDL.stateDefinitions.route;
        _a = uidl_utils_1.extractPageMetadata(routeDefinitions, pageName, __assign({}, metadataOptions)), componentName = _a.componentName, fileName = _a.fileName;
        pageUIDL = {
            name: componentName,
            node: node,
            meta: {
                fileName: fileName,
            },
        };
        return [2 /*return*/, exports.createComponentOutputs(__assign({}, params, { componentUIDL: pageUIDL }))];
    });
}); };
exports.createComponentOutputs = function (params) { return __awaiter(_this, void 0, void 0, function () {
    var componentGenerator, componentUIDL, componentOptions, files, dependencies, compiledComponent, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                componentGenerator = params.componentGenerator, componentUIDL = params.componentUIDL, componentOptions = params.componentOptions;
                files = [];
                dependencies = {};
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, componentGenerator.generateComponent(componentUIDL, __assign({}, componentOptions, { skipValidation: true }))];
            case 2:
                compiledComponent = _a.sent();
                files = compiledComponent.files;
                dependencies = compiledComponent.dependencies;
                return [3 /*break*/, 4];
            case 3:
                error_1 = _a.sent();
                console.warn("Error on generating \"" + componentUIDL.name + "\" component\n", error_1.stack);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/, { files: files, dependencies: dependencies }];
        }
    });
}); };
exports.joinGeneratorOutputs = function (generatorOutputs) {
    return generatorOutputs.reduce(function (result, generatorOutput) {
        var dependencies = result.dependencies, files = result.files;
        return {
            files: files.concat(generatorOutput.files),
            dependencies: __assign({}, dependencies, generatorOutput.dependencies),
        };
    }, { dependencies: {}, files: [] });
};
exports.createFile = function (name, fileType, content) {
    return { name: name, fileType: fileType, content: content };
};
exports.createFolder = function (name, files, subFolders) {
    if (files === void 0) { files = []; }
    if (subFolders === void 0) { subFolders = []; }
    return {
        name: name,
        files: files,
        subFolders: subFolders,
    };
};
//# sourceMappingURL=project-utils.js.map