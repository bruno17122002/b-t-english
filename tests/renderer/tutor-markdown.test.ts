import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownLite, plainText } from '../../src/modules/tutor/renderer/lib/markdownLite'

describe('markdown-lite parser', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ])
    expect(parseInline('__strong__ and _soft_')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'strong' }] },
      { type: 'text', text: ' and ' },
      { type: 'italic', children: [{ type: 'text', text: 'soft' }] },
    ])
  })

  it('nests italic inside bold and bold inside italic', () => {
    expect(parseInline('**very *good***')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'very ' }, { type: 'italic', children: [{ type: 'text', text: 'good' }] }] },
    ])
    expect(parseInline('*a **b** c*')).toEqual([
      {
        type: 'italic',
        children: [{ type: 'text', text: 'a ' }, { type: 'bold', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' c' }],
      },
    ])
  })

  it('keeps unmatched markers, maths and snake_case literally', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }])
    expect(parseInline('**open only')).toEqual([{ type: 'text', text: '**open only' }])
    expect(parseInline('a * b * c')).toEqual([{ type: 'text', text: 'a * b * c' }])
    expect(parseInline('use snake_case_names here')).toEqual([{ type: 'text', text: 'use snake_case_names here' }])
  })

  it('never produces HTML: tags stay plain text', () => {
    const blocks = parseMarkdownLite('<img src=x onerror=alert(1)> **<b>hi</b>**')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '<img src=x onerror=alert(1)> ' },
          { type: 'bold', children: [{ type: 'text', text: '<b>hi</b>' }] },
        ],
      },
    ])
  })

  it('splits paragraphs, line breaks and lists', () => {
    const blocks = parseMarkdownLite('Hello!\nHow are you?\n\nTips:\n- one\n* **two**\n• three\n\n1. first\n2) second\nAfter')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'list', 'list', 'paragraph'])
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Hello!' }, { type: 'br' }, { type: 'text', text: 'How are you?' }],
    })
    const ul = blocks[2]
    expect(ul?.type === 'list' && !ul.ordered && ul.items.length).toBe(3)
    const ol = blocks[3]
    expect(ol?.type === 'list' && ol.ordered && ol.items.length).toBe(2)
    expect(plainText(blocks)).toBe('Hello!\nHow are you?\n\nTips:\n\none\ntwo\nthree\n\nfirst\nsecond\n\nAfter')
  })

  it('turns headings into bold paragraphs and handles CRLF and continuation lines', () => {
    const blocks = parseMarkdownLite('## Title\r\n- item one\r\n   continues here\r\n')
    expect(blocks[0]).toEqual({ type: 'paragraph', children: [{ type: 'bold', children: [{ type: 'text', text: 'Title' }] }] })
    expect(blocks[1]).toEqual({ type: 'list', ordered: false, items: [[{ type: 'text', text: 'item one continues here' }]] })
  })

  it('returns no blocks for empty input', () => {
    expect(parseMarkdownLite('')).toEqual([])
    expect(parseMarkdownLite('\n\n  \n')).toEqual([])
  })
})
