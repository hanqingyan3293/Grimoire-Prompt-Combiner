import { describe, expect, it } from 'vitest'
import { parseSearchSyntax } from './tag-search-syntax'
import type { SearchSyntaxNode } from './tag-search-syntax'

const text = (value: string): SearchSyntaxNode => ({ kind: 'text', value })
const tag = (value: string): SearchSyntaxNode => ({ kind: 'tag', value })
const parent = (value: string): SearchSyntaxNode => ({ kind: 'parent', value })
const namespace = (value: string): SearchSyntaxNode => ({ kind: 'namespace', value })
const attr = (key: string, value: string): SearchSyntaxNode => ({ kind: 'attr', key, value })
const not = (child: SearchSyntaxNode): SearchSyntaxNode => ({ kind: 'not', child })
const and = (...children: SearchSyntaxNode[]): SearchSyntaxNode => ({ kind: 'and', children })
const or = (...children: SearchSyntaxNode[]): SearchSyntaxNode => ({ kind: 'or', children })

const ok = (ast: SearchSyntaxNode | null) => ({ ast, errors: [] })

describe('parseSearchSyntax', () => {
  it('解析单个文本词，不包裹 and 节点', () => {
    expect(parseSearchSyntax('cat')).toEqual(ok(text('cat')))
    expect(parseSearchSyntax('  cat  ')).toEqual(ok(text('cat')))
  })

  it('空白分隔即隐式 AND，多个词扁平收集', () => {
    expect(parseSearchSyntax('cat dog')).toEqual(ok(and(text('cat'), text('dog'))))
    expect(parseSearchSyntax('cat dog bird')).toEqual(ok(and(text('cat'), text('dog'), text('bird'))))
  })

  it('显式 AND 与隐式 AND 等价', () => {
    expect(parseSearchSyntax('cat AND dog')).toEqual(ok(and(text('cat'), text('dog'))))
    expect(parseSearchSyntax('cat AND dog bird')).toEqual(ok(and(text('cat'), text('dog'), text('bird'))))
  })

  it('AND/OR/NOT 关键字大小写不敏感', () => {
    expect(parseSearchSyntax('cat Or dog')).toEqual(ok(or(text('cat'), text('dog'))))
    expect(parseSearchSyntax('cat AND dog')).toEqual(parseSearchSyntax('cat and dog'))
    expect(parseSearchSyntax('not cat')).toEqual(ok(not(text('cat'))))
  })

  it('OR 与相邻操作数先成组，隐式 AND 在外层（冻结示例）', () => {
    expect(parseSearchSyntax('a OR b c')).toEqual(ok(and(or(text('a'), text('b')), text('c'))))
    expect(parseSearchSyntax('a b OR c')).toEqual(ok(and(text('a'), or(text('b'), text('c')))))
  })

  it('链式 OR 扁平化为多子节点', () => {
    expect(parseSearchSyntax('a OR b OR c')).toEqual(ok(or(text('a'), text('b'), text('c'))))
    expect(parseSearchSyntax('a OR b OR c d')).toEqual(ok(and(or(text('a'), text('b'), text('c')), text('d'))))
  })

  it('括号分组可覆盖默认结合顺序', () => {
    expect(parseSearchSyntax('(cat OR dog) bird')).toEqual(ok(and(or(text('cat'), text('dog')), text('bird'))))
    expect(parseSearchSyntax('cat (dog bird)')).toEqual(ok(and(text('cat'), and(text('dog'), text('bird')))))
    expect(parseSearchSyntax('(cat)')).toEqual(ok(text('cat')))
  })

  it('NOT 关键字作用于紧随的单个操作数', () => {
    expect(parseSearchSyntax('NOT cat')).toEqual(ok(not(text('cat'))))
    expect(parseSearchSyntax('cat NOT dog')).toEqual(ok(and(text('cat'), not(text('dog')))))
    expect(parseSearchSyntax('NOT (a OR b)')).toEqual(ok(not(or(text('a'), text('b')))))
  })

  it('- 前缀与 NOT 等价，且仅紧贴 token 时生效', () => {
    expect(parseSearchSyntax('-cat dog')).toEqual(ok(and(not(text('cat')), text('dog'))))
    expect(parseSearchSyntax('-tag:1g*')).toEqual(ok(not(tag('1g*'))))
    expect(parseSearchSyntax('a-b')).toEqual(ok(text('a-b')))
  })

  it('双引号包裹整体值并支持 \\" 转义', () => {
    expect(parseSearchSyntax('"blue eyes"')).toEqual(ok(text('blue eyes')))
    expect(parseSearchSyntax('"say \\"hi\\" now"')).toEqual(ok(text('say "hi" now')))
  })

  it('谓词值可带引号', () => {
    expect(parseSearchSyntax('tag:"blue eyes"')).toEqual(ok(tag('blue eyes')))
    expect(parseSearchSyntax('namespace:"artist name"')).toEqual(ok(namespace('artist name')))
  })

  it('tag: 谓词保留通配符 *', () => {
    expect(parseSearchSyntax('tag:1g*')).toEqual(ok(tag('1g*')))
    expect(parseSearchSyntax('tag:*')).toEqual(ok(tag('*')))
  })

  it('parent: 与 namespace: 谓词', () => {
    expect(parseSearchSyntax('parent:group*')).toEqual(ok(parent('group*')))
    expect(parseSearchSyntax('namespace:artist')).toEqual(ok(namespace('artist')))
  })

  it('rating: 区间字符串原样保留', () => {
    expect(parseSearchSyntax('rating:4..5')).toEqual(ok(attr('rating', '4..5')))
  })

  it('name: 归为文本节点（按文件名/标题搜索）', () => {
    expect(parseSearchSyntax('name:"cover art"')).toEqual(ok(text('cover art')))
    expect(parseSearchSyntax('name:IMG_0001')).toEqual(ok(text('IMG_0001')))
  })

  it('source/favorite/sort/order/limit 解析为 attr 节点', () => {
    expect(parseSearchSyntax('source:local favorite:true sort:rating order:asc limit:50')).toEqual(
      ok(and(
        attr('source', 'local'),
        attr('favorite', 'true'),
        attr('sort', 'rating'),
        attr('order', 'asc'),
        attr('limit', '50')
      ))
    )
  })

  it('[key=value] 与 key:value 等价，值可带引号', () => {
    expect(parseSearchSyntax('[rating=4..5]')).toEqual(ok(attr('rating', '4..5')))
    expect(parseSearchSyntax('[tag="blue eyes"]')).toEqual(ok(tag('blue eyes')))
    expect(parseSearchSyntax('cat [source=local]')).toEqual(ok(and(text('cat'), attr('source', 'local'))))
  })

  it('未知谓词键报错并丢弃节点，不影响其余部分', () => {
    expect(parseSearchSyntax('cat foo:bar dog [baz=1]')).toEqual({
      ast: and(text('cat'), text('dog')),
      errors: ['未知谓词键：foo', '未知谓词键：baz'],
    })
    expect(parseSearchSyntax('foo:bar')).toEqual({ ast: null, errors: ['未知谓词键：foo'] })
  })

  it('已知谓词缺值报错并丢弃节点', () => {
    expect(parseSearchSyntax('tag:')).toEqual({ ast: null, errors: ['谓词缺少数值：tag'] })
    expect(parseSearchSyntax('tag: cat')).toEqual({ ast: text('cat'), errors: ['谓词缺少数值：tag'] })
    expect(parseSearchSyntax('[sort=]')).toEqual({ ast: null, errors: ['谓词缺少数值：sort'] })
  })

  it('未闭合括号报错并尽力保留已闭合部分', () => {
    expect(parseSearchSyntax('(cat dog')).toEqual({ ast: and(text('cat'), text('dog')), errors: ['括号未闭合'] })
    expect(parseSearchSyntax('cat (dog')).toEqual({ ast: and(text('cat'), text('dog')), errors: ['括号未闭合'] })
  })

  it('未闭合引号报错并保留已读内容', () => {
    expect(parseSearchSyntax('"cat dog')).toEqual({ ast: text('cat dog'), errors: ['引号未闭合'] })
    expect(parseSearchSyntax('tag:"abc')).toEqual({ ast: tag('abc'), errors: ['引号未闭合'] })
  })

  it('空串与纯空白输入 → ast null 且无错误', () => {
    expect(parseSearchSyntax('')).toEqual({ ast: null, errors: [] })
    expect(parseSearchSyntax('   \t\n ')).toEqual({ ast: null, errors: [] })
  })
})