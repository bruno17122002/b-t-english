// Renders a markdown-lite tree with React elements only (no dangerouslySetInnerHTML).
import { Fragment, useMemo, type ReactNode } from 'react'
import { InteractiveText } from '@/components/learning'
import { parseMarkdownLite, type Inline } from '../lib/markdownLite'

export function RichText({ text, interactive, sourceRef }: { text: string; interactive?: boolean; sourceRef?: string }) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text])
  // Word popovers render block elements, which are not allowed inside <p>.
  const Para = interactive ? 'div' : 'p'
  const renderInline = (nodes: Inline[], keyPrefix: string): ReactNode[] =>
    nodes.map((n, i) => {
      const key = `${keyPrefix}.${i}`
      switch (n.type) {
        case 'text':
          return interactive ? (
            <InteractiveText key={key} text={n.text} sourceModule="tutor" sourceRef={sourceRef} />
          ) : (
            <Fragment key={key}>{n.text}</Fragment>
          )
        case 'bold':
          return (
            <strong key={key} className="font-semibold text-text">
              {renderInline(n.children, key)}
            </strong>
          )
        case 'italic':
          return <em key={key}>{renderInline(n.children, key)}</em>
        case 'code':
          return (
            <code key={key} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">
              {n.text}
            </code>
          )
        case 'br':
          return <br key={key} />
      }
    })
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b, i) =>
        b.type === 'paragraph' ? (
          <Para key={i}>{renderInline(b.children, String(i))}</Para>
        ) : b.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{renderInline(it, `${i}.${j}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{renderInline(it, `${i}.${j}`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
