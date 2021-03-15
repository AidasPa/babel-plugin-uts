// @ts-nocheck
import * as types from "@babel/types";
import * as babelParser from "@babel/parser";

const getCompiledClassExpression = (className: string) =>
  babelParser.parse(
    `const ${className}_COMPILED = require('uclass')()(global, ${className});`
  );

const getBootstrapExpression = () =>
  babelParser.parse(
    `Context.RunFile('aliases.js');Context.RunFile('polyfill/unrealengine.js');Context.RunFile('polyfill/timers.js');`
  );

const friendlyTypeAnnotation = (type: any) => {
  switch (type.typeAnnotation.typeAnnotation.type) {
    case "TSNumberKeyword":
      return "float";

    case "TSStringKeyword":
      return "string";

    default:
      return type.typeAnnotation.typeAnnotation.typeName.name;
  }
};

const formatClassMethodParams = (params: any[]) =>
  params.map((param) => {
    const type = friendlyTypeAnnotation(param);

    param.name = `${param.name} /*${type}*/`;
    return param;
  });

export = ({ types: t }: { types: typeof types }) => {
  const properties = [];

  const firstDecorator = (node) => node?.decorators?.[0];
  const decoratorName = (decorator) => decorator?.expression.callee.name;
  const decoratorArguments = (decorator) => {
    return decorator?.expression.arguments.map((arg) => {
      if (t.isStringLiteral(arg)) {
        return arg.value;
      }

      if (t.isIdentifier(arg)) {
        return arg.name;
      }
    });
  };

  let className = null;

  return {
    visitor: {
      ClassDeclaration(path: any) {
        className = path.node.id.name;
        const classBody: types.ClassBody = path.node.body;
        const isUClass = decoratorName(firstDecorator(path.node)) === "UCLASS";

        if (isUClass) {
          classBody.body.forEach((value: any) => {
            const firstDecoratorName = decoratorName(firstDecorator(value));
            const firstDecoratorArguments = decoratorArguments(
              firstDecorator(value)
            );

            if (t.isClassProperty(value)) {
              const isUProperty = firstDecoratorName === "UPROPERTY";
              if (isUProperty) {
                properties.push({
                  property: value,
                  decoratorArguments: firstDecoratorArguments,
                });
              }
            }

            if (t.isClassMethod(value)) {
              if (firstDecoratorName === "KEYBIND") {
                const [
                  keybindType,
                  keybindAction,
                  keybindEvent = false,
                ] = firstDecoratorArguments;

                value.params = formatClassMethodParams(value.params);

                if (keybindType === "BindAxis") {
                  t.addComment(
                    value.body,
                    "leading",
                    `AxisBinding[${keybindAction}, -bConsumeInput]`
                  );
                } else if (keybindType === "BindAction") {
                  t.addComment(
                    value.body,
                    "leading",
                    `ActionBinding[${keybindAction}, ${keybindEvent}]`
                  );
                }
              }

              if (firstDecoratorName === "UFUNCTION") {
                value.params = formatClassMethodParams(value.params);
                t.addComment(
                  value.body,
                  "leading",
                  firstDecoratorArguments.join("+")
                );
              }
            }

            if (value.kind === "constructor") {
              value.body.body = value.body.body.filter(
                (bodyNode: types.ExpressionStatement) =>
                  !t.isSuper(bodyNode.expression.callee)
              );
              value.params = [];

              value.key.name = "ctor";
            }

            value.decorators = [];
          });

          // create the properties method
          classBody.body.push(
            t.classMethod(
              "method",
              t.identifier("properties"),
              [],
              t.blockStatement(
                properties.map(({ property, decoratorArguments }) => {
                  const identifier = t.identifier(
                    property.key.name +
                      ` /*${decoratorArguments.join(
                        "+"
                      )}+${friendlyTypeAnnotation(property)}*/`
                  );

                  return t.expressionStatement(
                    t.memberExpression(t.thisExpression(), identifier)
                  );
                })
              )
            )
          );

          // clear the decorators because if we don't TS will do all kinds of crap
          path.node.decorators = [];

          // insert the compiled class
          path.insertAfter(getCompiledClassExpression(className));

          // insert the polyfills
          path.insertBefore(getBootstrapExpression().program.body);
        }
      },
      Identifier(path: any) {
        if (
          path.node.name === className &&
          !t.isClassDeclaration(path.parentPath.node) &&
          !t.isCallExpression(path.parentPath.node)
        ) {
          path.node.name = `${className}_COMPILED`;
        }
      },
    },
  };
};
