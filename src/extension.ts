import * as vscode from "vscode";
import * as ts from "typescript";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tailwind-class-extractor.extractClasses",
      extractTailwindClasses
    )
  );
}

async function extractTailwindClasses() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  try {
    const document = editor.document;
    const text = document.getText();
    const selection = editor.selection;

    let sourceText: string;
    let offset = 0;

    if (!selection.isEmpty) {
      // There is a selection
      const startOffset = document.offsetAt(selection.start);
      const endOffset = document.offsetAt(selection.end);
      sourceText = text.substring(startOffset, endOffset);
      offset = startOffset;
    } else {
      // No selection, process the entire document
      sourceText = text;
    }

    const sourceFile = ts.createSourceFile(
      document.fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const classNameNodes: ts.JsxAttribute[] = [];

    function findClassNames(node: ts.Node) {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(sourceFile) === "className" &&
        node.initializer
      ) {
        classNameNodes.push(node);
      }
      ts.forEachChild(node, findClassNames);
    }

    findClassNames(sourceFile);

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const classNameNode of classNameNodes) {
      const initializer = classNameNode.initializer!;
      let classNames: string[] = [];
      let start: number;
      let end: number;

      if (ts.isStringLiteral(initializer)) {
        // className="..."
        classNames = initializer.text.split(/\s+/);
        start = initializer.getStart(sourceFile);
        end = initializer.getEnd();
      } else if (ts.isJsxExpression(initializer) && initializer.expression) {
        if (ts.isStringLiteral(initializer.expression)) {
          // className={"..."}
          classNames = initializer.expression.text.split(/\s+/);
          start = initializer.getStart(sourceFile);
          end = initializer.getEnd();
        } else if (ts.isCallExpression(initializer.expression)) {
          const callExpr = initializer.expression;
          const functionName = callExpr.expression.getText(sourceFile);

          if (functionName === "twJoin") {
            // className={twJoin("...", "...")}
            const args = callExpr.arguments;
            let canProcess = true;

            for (const arg of args) {
              if (ts.isStringLiteral(arg)) {
                classNames.push(...arg.text.split(/\s+/));
              } else {
                // Contains non-string arguments; skip processing
                canProcess = false;
                break;
              }
            }

            if (!canProcess) {
              continue;
            }

            start = initializer.getStart(sourceFile);
            end = initializer.getEnd();
          } else {
            // Unsupported function call; skip processing
            continue;
          }
        } else {
          // Unsupported initializer; skip processing
          continue;
        }
      } else {
        // Unsupported initializer; skip processing
        continue;
      }

      // Process the class names
      const { baseClasses, mediaClassesMap } = separateClasses(classNames);

      // Skip if there are no media classes (optional)
      if (Object.keys(mediaClassesMap).length === 0) {
        continue;
      }

      // Build the class parts
      const classParts = [];
      if (baseClasses.length > 0) {
        classParts.push(`"${baseClasses.join(" ")}"`);
      }

      // Add each group of media classes
      for (const prefix in mediaClassesMap) {
        const classes = mediaClassesMap[prefix];
        if (classes.length > 0) {
          classParts.push(`"${classes.join(" ")}"`);
        }
      }

      const newClassName = `{twJoin(
        ${classParts.join(",\n        ")}
      )}`;

      // Adjust positions based on the offset
      const adjustedStart = start + offset;
      const adjustedEnd = end + offset;

      const classNameRange = new vscode.Range(
        document.positionAt(adjustedStart),
        document.positionAt(adjustedEnd)
      );

      workspaceEdit.replace(document.uri, classNameRange, newClassName);
    }

    // Insert import if not present
    if (workspaceEdit.size > 0) {
      await ensureImportStatement(document, workspaceEdit);
    }

    await vscode.workspace.applyEdit(workspaceEdit);
  } catch (error: any) {
    vscode.window.showErrorMessage(
      "An error occurred while extracting Tailwind classes: " + error.message
    );
  }
}

function separateClasses(classNames: string[]): {
  baseClasses: string[];
  mediaClassesMap: { [prefix: string]: string[] };
} {
  const mediaPrefixes = [
    "mobile:",
    "tablet:",
    "desktop:",
    "sm:",
    "md:",
    "lg:",
    "xl:",
    "2xl:",
  ];

  const baseClasses: string[] = [];
  const mediaClassesMap: { [prefix: string]: string[] } = {};

  for (const cls of classNames) {
    const prefix = mediaPrefixes.find((p) => cls.startsWith(p));
    if (prefix) {
      if (!mediaClassesMap[prefix]) {
        mediaClassesMap[prefix] = [];
      }
      mediaClassesMap[prefix].push(cls);
    } else {
      baseClasses.push(cls);
    }
  }

  return { baseClasses, mediaClassesMap };
}

async function ensureImportStatement(
  document: vscode.TextDocument,
  workspaceEdit: vscode.WorkspaceEdit
) {
  const text = document.getText();
  const importStatement = 'import { twJoin } from "tailwind-merge";';

  if (!text.includes(importStatement)) {
    workspaceEdit.insert(
      document.uri,
      new vscode.Position(0, 0),
      `${importStatement}\n`
    );
  }
}
