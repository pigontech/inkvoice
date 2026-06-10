import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export interface CodeEditorHandle {
  insertAtCursor: (text: string) => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "css";
  className?: string;
}

const lightTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--muted)",
      color: "var(--muted-foreground)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--accent)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--accent)",
    },
    ".cm-selectionBackground": {
      backgroundColor: "var(--primary) !important",
      opacity: "0.15",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "var(--primary)",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "oklch(0.55 0.25 265 / 0.2) !important",
    },
  },
  { dark: false },
);

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, language, className },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: text } });
      view.focus();
    },
  }));

  const isDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  // Only re-create editor when language or theme changes — NOT on value changes,
  // which are handled by the sync effect below. Including `value` here would
  // teardown the editor on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!editorRef.current) return;

    const langExtension = language === "html" ? html() : css();

    const extensions = [
      basicSetup,
      langExtension,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
      isDark ? oneDark : lightTheme,
    ];

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, isDark]);

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={editorRef}
      className={cn(
        "overflow-hidden rounded-lg border border-input [&_.cm-editor]:h-full [&_.cm-editor.cm-focused]:outline-none",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        "transition-field",
        className,
      )}
    />
  );
});
