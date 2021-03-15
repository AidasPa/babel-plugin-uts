"use strict";
var babelParser = require("@babel/parser");
var getCompiledClassExpression = function (className) {
    return babelParser.parse("const " + className + "_COMPILED = require('uclass')()(global, " + className + ");");
};
var getBootstrapExpression = function () {
    return babelParser.parse("Context.RunFile('aliases.js');Context.RunFile('polyfill/unrealengine.js');Context.RunFile('polyfill/timers.js');");
};
var friendlyTypeAnnotation = function (type) {
    switch (type.typeAnnotation.typeAnnotation.type) {
        case "TSNumberKeyword":
            return "float";
        case "TSStringKeyword":
            return "string";
        default:
            return type.typeAnnotation.typeAnnotation.typeName.name;
    }
};
var formatClassMethodParams = function (params) {
    return params.map(function (param) {
        var type = friendlyTypeAnnotation(param);
        param.name = param.name + " /*" + type + "*/";
        return param;
    });
};
module.exports = function (_a) {
    var t = _a.types;
    var firstDecorator = function (node) { var _a; return (_a = node === null || node === void 0 ? void 0 : node.decorators) === null || _a === void 0 ? void 0 : _a[0]; };
    var decoratorName = function (decorator) { return decorator === null || decorator === void 0 ? void 0 : decorator.expression.callee.name; };
    var decoratorArguments = function (decorator) {
        return decorator === null || decorator === void 0 ? void 0 : decorator.expression.arguments.map(function (arg) {
            if (t.isStringLiteral(arg)) {
                return arg.value;
            }
            if (t.isIdentifier(arg)) {
                return arg.name;
            }
        });
    };
    var className = null;
    return {
        visitor: {
            ClassDeclaration: function (path) {
                var properties = [];
                className = path.node.id.name;
                var classBody = path.node.body;
                var isUClass = decoratorName(firstDecorator(path.node)) === "UCLASS";
                if (isUClass) {
                    classBody.body.forEach(function (value) {
                        var _a, _b;
                        var firstDecoratorName = decoratorName(firstDecorator(value));
                        var firstDecoratorArguments = decoratorArguments(firstDecorator(value));
                        if (t.isClassProperty(value)) {
                            var isUProperty = firstDecoratorName === "UPROPERTY";
                            var hasType = ((_b = (_a = value.typeAnnotation) === null || _a === void 0 ? void 0 : _a.typeAnnotation) === null || _b === void 0 ? void 0 : _b.type) || false;
                            if (isUProperty && hasType) {
                                properties.push({
                                    property: value,
                                    decoratorArguments: firstDecoratorArguments
                                });
                            }
                        }
                        if (t.isClassMethod(value)) {
                            if (firstDecoratorName === "KEYBIND") {
                                var keybindType = firstDecoratorArguments[0], keybindAction = firstDecoratorArguments[1], _c = firstDecoratorArguments[2], keybindEvent = _c === void 0 ? false : _c;
                                value.params = formatClassMethodParams(value.params);
                                if (keybindType === "BindAxis") {
                                    t.addComment(value.body, "leading", "AxisBinding[" + keybindAction + ", -bConsumeInput]");
                                }
                                else if (keybindType === "BindAction") {
                                    t.addComment(value.body, "leading", "ActionBinding[" + keybindAction + ", " + keybindEvent + "]");
                                }
                            }
                            if (firstDecoratorName === "UFUNCTION") {
                                value.params = formatClassMethodParams(value.params);
                                t.addComment(value.body, "leading", firstDecoratorArguments.join("+"));
                            }
                        }
                        if (value.kind === "constructor") {
                            value.body.body = value.body.body.filter(function (bodyNode) {
                                return !t.isSuper(bodyNode.expression.callee);
                            });
                            value.params = [];
                            value.key.name = "ctor";
                        }
                        value.decorators = [];
                    });
                    // create the properties method if we have some properties
                    if (properties.length > 0) {
                        classBody.body.push(t.classMethod("method", t.identifier("properties"), [], t.blockStatement(properties.map(function (_a) {
                            var property = _a.property, decoratorArguments = _a.decoratorArguments;
                            var identifier = t.identifier(property.key.name +
                                (" /*" + decoratorArguments.join("+") + "+" + friendlyTypeAnnotation(property) + "*/"));
                            return t.expressionStatement(t.memberExpression(t.thisExpression(), identifier));
                        }))));
                    }
                    // clear the decorators because if we don't TS will do all kinds of crap
                    path.node.decorators = [];
                    // insert the compiled class
                    path.insertAfter(getCompiledClassExpression(className));
                    // insert the polyfills
                    path.insertBefore(getBootstrapExpression().program.body);
                }
            },
            Identifier: function (path) {
                if (path.node.name === className &&
                    !t.isClassDeclaration(path.parentPath.node) &&
                    !t.isCallExpression(path.parentPath.node)) {
                    path.node.name = className + "_COMPILED";
                }
            }
        }
    };
};
