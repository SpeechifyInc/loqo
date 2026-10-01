import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

/** Token colours are CSS variables, so the editor follows the app's light and dark schemes. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: tags.regexp, color: 'var(--code-regexp)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-literal)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
]);

const theme = EditorView.theme({
  '&': { border: '1px solid var(--input)', borderRadius: 'calc(var(--radius) - 2px)', color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5', maxHeight: '28rem', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent)', outline: '1px solid var(--border)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklab, var(--info) 25%, transparent)' },
});

const editability = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

type Props = { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean };

/**
 * JavaScript/TypeScript editor. CodeMirror builds its DOM itself and never parses the text as
 * markup, so the code stays inert. Controlled: a `value` that differs from the document (a reset,
 * a reload) replaces it.
 */
export const CodeEditor = ({ value, onChange, label, readOnly = false }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const changed = useRef(onChange);
  changed.current = onChange;

  // Created once; later props reach the view through the two effects below.
  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          indentOnInput(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          javascript({ typescript: true }),
          syntaxHighlighting(highlight),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          editable.current.of(editability(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(editability(readOnly)) });
  }, [readOnly]);

  // Size containment keeps long lines from widening the surrounding layout; they scroll inside the editor.
  return <div ref={host} className="min-w-0 font-mono text-xs [contain:inline-size]" />;
};
