"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var ajv_1 = __importDefault(require("ajv"));
var component_json_1 = __importDefault(require("@teleporthq/teleport-uidl-definitions/lib/schemas/component.json"));
var project_json_1 = __importDefault(require("@teleporthq/teleport-uidl-definitions/lib/schemas/project.json"));
var Validator = /** @class */ (function () {
    function Validator() {
        var ajv = new ajv_1.default({
            allErrors: true,
            verbose: true,
        });
        this.componentValidator = ajv.compile(component_json_1.default);
        this.projectValidator = ajv.compile(project_json_1.default);
    }
    Validator.prototype.validateComponent = function (input) {
        var valid = this.componentValidator(input);
        if (!valid && this.componentValidator.errors) {
            return { valid: false, errorMsg: formatErrors(this.componentValidator.errors) };
        }
        return { valid: true, errorMsg: '' };
    };
    Validator.prototype.validateProject = function (input) {
        var valid = this.projectValidator(input);
        if (!valid && this.projectValidator.errors) {
            return { valid: false, errorMsg: formatErrors(this.projectValidator.errors) };
        }
        return { valid: true, errorMsg: '' };
    };
    return Validator;
}());
exports.default = Validator;
var formatErrors = function (errors) {
    var listOfErrors = [];
    errors.forEach(function (error) {
        var message = error.keyword === 'type'
            ? "\n - Path " + error.dataPath + ": " + error.message + ". Received " + typeof error.data
            : "\n - Path " + error.dataPath + ": " + error.message + ". " + JSON.stringify(error.params);
        listOfErrors.push(message);
    });
    return "UIDL Validation error. Please check the following: " + listOfErrors;
};
//# sourceMappingURL=index.js.map