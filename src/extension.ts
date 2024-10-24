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
        if (ts.isStringLiteral(node.initializer)) {
          // Handles className="..."
          classNameNodes.push(node);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          ts.isStringLiteral(node.initializer.expression)
        ) {
          // Handles className={"..."}
          classNameNodes.push(node);
        }
      }
      ts.forEachChild(node, findClassNames);
    }

    findClassNames(sourceFile);

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const classNameNode of classNameNodes) {
      const initializer = classNameNode.initializer!;
      let classNameText: string;
      let start: number;
      let end: number;

      if (ts.isStringLiteral(initializer)) {
        // className="..."
        classNameText = initializer.text;
        start = initializer.getStart(sourceFile);
        end = initializer.getEnd();
      } else if (
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        ts.isStringLiteral(initializer.expression)
      ) {
        // className={"..."}
        classNameText = initializer.expression.text;
        start = initializer.getStart(sourceFile);
        end = initializer.getEnd();
      } else {
        // Unsupported initializer
        continue;
      }

      // Process the class names
      const { baseClasses, mediaClasses } = separateClasses(classNameText);

      // Skip if there are no media classes
      if (mediaClasses.length === 0) {
        continue;
      }

      const classParts = [];
      if (baseClasses.length > 0) {
        classParts.push(`"${baseClasses.join(" ")}"`);
      }
      if (mediaClasses.length > 0) {
        classParts.push(`"${mediaClasses.join(" ")}"`);
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

function separateClasses(classNameText: string): {
  baseClasses: string[];
  mediaClasses: string[];
} {
  const classes = classNameText.split(/\s+/);
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
  const mediaClasses: string[] = [];

  for (const cls of classes) {
    if (mediaPrefixes.some((prefix) => cls.startsWith(prefix))) {
      mediaClasses.push(cls);
    } else {
      baseClasses.push(cls);
    }
  }

  return { baseClasses, mediaClasses };
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
