// 魔导书 Grimoire v7 — 图库搜索语法解析核心（渲染器与主进程共用）
// 语义参考 TagStudio query_lang（GPL-3.0，仅参考语义）与 SD Image Sorter 查询语法
// （MIT，仅参考语义）的 clean-room 子集，未复制上游任何代码。
//
// 解析规则（冻结契约）：
//   - 空白分隔即隐式 AND；显式 AND 关键字与隐式 AND 等价（只作分隔符）。
//   - OR 与左右相邻操作数先成组，再被外层隐式 AND 连接（冻结示例：
//     `a OR b c` → and[or[a, b], c]）；parenthesized 分组可表达其他结合方式。
//   - NOT 关键字与紧贴 token 的 `-` 前缀等价，仅作用于紧随其后的单个操作数；
//     `-` 只有紧贴后续 token 时才视为 NOT（`a-b` 是普通词）。
//   - `( )` 分组；未闭合括号报错并尽力保留已闭合部分。
//   - `"…"` 引号整体包裹值（文本词或 key:"值"），内部支持 \" 转义；未闭合报错。
//   - `key:value` 与 `[key=value]` 等价；key 限定 tag/parent/namespace/source/
//     favorite/rating/sort/order/limit/name，其中 name 解析为 text 节点；
//     rating 的 `4..5` 等区间字符串原样保留；tag 值内的 * 通配原样保留。
//   - 未知谓词键、已知键缺值：追加中文诊断并丢弃该节点，不影响其余部分。
//   - 单节点不包裹 and；空文本/空白 token 丢弃；无任何有效节点时 ast 为 null。
//
// 未定义情形的裁决（规范未声明，取宽容退化策略）：悬空 NOT/OR 忽略；顶层多余
// `)` 忽略；不成形的 `[…]`（无 `]`、无 `=`、键形非法）退化为字面文本词。

export type SearchSyntaxNode =
  | { kind: 'and'; children: SearchSyntaxNode[] }
  | { kind: 'or'; children: SearchSyntaxNode[] }
  | { kind: 'not'; child: SearchSyntaxNode }
  | { kind: 'text'; value: string }                                // 文件名/普通词
  | { kind: 'tag'; value: string }                                 // tag:值（可含 * 通配）
  | { kind: 'parent'; value: string }                              // parent:值
  | { kind: 'namespace'; value: string }                           // namespace:值
  | { kind: 'attr'; key: string; value: string }                   // source|favorite|rating|sort|order|limit 及 [key=value]

export interface SearchSyntaxParseResult {
  ast: SearchSyntaxNode | null
  errors: string[]      // 人类可读诊断（中文），解析失败/未知谓词时填写；ast 仍可为部分（null 表示无可执行节点）
}

type Token =
  | { kind: 'lparen' | 'rparen' | 'and' | 'or' | 'not' | 'minus' }
  | { kind: 'text'; value: string }
  | { kind: 'predicate'; key: string; value: string }

const WHITESPACE_RE = /\s/
const KEY_START_RE = /[A-Za-z_]/
const KEY_CHAR_RE = /[A-Za-z0-9_-]/
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/
const KEYWORD_RE = /^(and|or|not)$/i

// key 到节点形态的映射：name 不产生独立谓词节点，而是按文件名/标题做普通文本搜索。
const KNOWN_KEYS = new Set(['tag', 'parent', 'namespace', 'name', 'source', 'favorite', 'rating', 'sort', 'order', 'limit'])

function isWhitespace(ch: string): boolean {
  return WHITESPACE_RE.test(ch)
}

// 引号串扫描：从 start 处的 `"` 开始，返回去引号后的内容与结束下标；`\"` 是唯一转义。
function readQuoted(text: string, start: number): { value: string; end: number; closed: boolean } {
  let i = start + 1
  let value = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && text[i + 1] === '"') {
      value += '"'
      i += 2
      continue
    }
    if (ch === '"') return { value, end: i + 1, closed: true }
    value += ch
    i++
  }
  return { value, end: text.length, closed: false }
}

// 普通词扫描：读到空白或括号为止（引号/冒号在词中间只是普通字符）。
function readWordEnd(text: string, start: number): number {
  let i = start
  while (i < text.length && !isWhitespace(text[i]) && text[i] !== '(' && text[i] !== ')') i++
  return i
}

// `[key=value]` 扫描：引号段内跳过 `]`，返回原文内层内容；找不到闭合 `]` 返回 null。
function readBracket(text: string, start: number): { inner: string; end: number } | null {
  let i = start + 1
  let inner = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') {
      const quoted = readQuoted(text, i)
      if (!quoted.closed) return null
      inner += text.slice(i, quoted.end)
      i = quoted.end
      continue
    }
    if (ch === ']') return { inner, end: i + 1 }
    inner += ch
    i++
  }
  return null
}

// 解析 `[key=value]` 内层；value 可再带引号。形态不成形返回 null（调用方退化为字面文本词）。
function parseBracketPredicate(inner: string): Token | null {
  const trimmed = inner.trim()
  const eq = trimmed.indexOf('=')
  if (eq <= 0) return null
  const key = trimmed.slice(0, eq).trim()
  if (!KEY_RE.test(key)) return null
  const raw = trimmed.slice(eq + 1).trim()
  if (raw.startsWith('"')) {
    return { kind: 'predicate', key, value: readQuoted(raw, 0).value }
  }
  return { kind: 'predicate', key, value: raw }
}

function tokenize(text: string, errors: string[]): Token[] {
  const tokens: Token[] = []
  const length = text.length
  let i = 0
  while (i < length) {
    const ch = text[i]
    if (isWhitespace(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    // `-` 仅当紧贴后续 token 时才拆成 NOT；词中间的 `-`（如 a-b）在普通词扫描里保留。
    if (ch === '-' && i + 1 < length && !isWhitespace(text[i + 1])) {
      tokens.push({ kind: 'minus' })
      i++
      continue
    }
    if (ch === '"') {
      const quoted = readQuoted(text, i)
      if (!quoted.closed) errors.push('引号未闭合')
      tokens.push({ kind: 'text', value: quoted.value })
      i = quoted.end
      continue
    }
    if (ch === '[') {
      const bracket = readBracket(text, i)
      const predicate = bracket ? parseBracketPredicate(bracket.inner) : null
      if (bracket && predicate) {
        tokens.push(predicate)
        i = bracket.end
      } else if (bracket) {
        tokens.push({ kind: 'text', value: text.slice(i, bracket.end) })
        i = bracket.end
      } else {
        const end = readWordEnd(text, i)
        tokens.push({ kind: 'text', value: text.slice(i, end) })
        i = end
      }
      continue
    }
    // 键形前缀 + `:` → 谓词 token；引号值只能在冒号后整体出现（key:"值"）。
    if (KEY_START_RE.test(ch)) {
      let j = i
      while (j < length && KEY_CHAR_RE.test(text[j])) j++
      if (j < length && text[j] === ':') {
        const key = text.slice(i, j)
        let k = j + 1
        let value: string
        if (k < length && text[k] === '"') {
          const quoted = readQuoted(text, k)
          if (!quoted.closed) errors.push('引号未闭合')
          value = quoted.value
          k = quoted.end
        } else {
          const start = k
          while (k < length && !isWhitespace(text[k]) && text[k] !== '(' && text[k] !== ')') k++
          value = text.slice(start, k)
        }
        tokens.push({ kind: 'predicate', key, value })
        i = k
        continue
      }
    }
    const end = readWordEnd(text, i)
    const word = text.slice(i, end)
    if (KEYWORD_RE.test(word)) {
      tokens.push({ kind: word.toLowerCase() as 'and' | 'or' | 'not' })
    } else {
      tokens.push({ kind: 'text', value: word })
    }
    i = end
  }
  return tokens
}

interface ParserState {
  tokens: Token[]
  pos: number
  errors: string[]
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.pos]
}

function dispatchPredicate(key: string, value: string, errors: string[]): SearchSyntaxNode | null {
  if (!KNOWN_KEYS.has(key)) {
    errors.push(`未知谓词键：${key}`)
    return null
  }
  // 裸空值与引号包裹的空值（tag:""）都视为缺值，节点丢弃。
  if (value.trim() === '') {
    errors.push(`谓词缺少数值：${key}`)
    return null
  }
  if (key === 'tag' || key === 'parent' || key === 'namespace') return { kind: key, value }
  if (key === 'name') return { kind: 'text', value }
  return { kind: 'attr', key, value }
}

// 隐式/显式 AND 层：收集操作数，单节点不包裹 and。insideParen 时遇到 `)` 即结束分组。
function parseExpression(state: ParserState, insideParen: boolean): SearchSyntaxNode | null {
  const children: SearchSyntaxNode[] = []
  while (true) {
    const token = peek(state)
    if (!token) break
    if (token.kind === 'and') {
      state.pos++
      continue
    }
    if (token.kind === 'rparen') {
      if (insideParen) break
      state.pos++ // 顶层多余的 `)`：宽容忽略
      continue
    }
    const before = state.pos
    const node = parseOrChain(state)
    if (node) children.push(node)
    if (state.pos === before) state.pos++ // 防御：任何零消耗 token 都强制丢弃，避免死循环
  }
  if (!children.length) return null
  return children.length === 1 ? children[0] : { kind: 'and', children }
}

// OR 层：与左右相邻操作数成组（冻结示例 `a OR b c` → and[or[a, b], c]）；链式 OR 扁平为多子节点。
function parseOrChain(state: ParserState): SearchSyntaxNode | null {
  const first = parseUnary(state)
  if (!first) return null
  const children: SearchSyntaxNode[] = [first]
  while (peek(state)?.kind === 'or') {
    state.pos++
    const right = parseUnary(state)
    if (!right) break // 悬空 OR：忽略连接符，保留已解析的左链
    children.push(right)
  }
  return children.length === 1 ? children[0] : { kind: 'or', children }
}

// NOT 层：NOT 关键字与紧贴的 `-` 等价，作用于紧随其后的单个操作数（含括号分组整体）。
function parseUnary(state: ParserState): SearchSyntaxNode | null {
  const token = peek(state)
  if (token && (token.kind === 'not' || token.kind === 'minus')) {
    state.pos++
    const child = parseUnary(state)
    return child ? { kind: 'not', child } : null // 悬空 NOT/-：整体丢弃
  }
  return parsePrimary(state)
}

function parsePrimary(state: ParserState): SearchSyntaxNode | null {
  const token = peek(state)
  if (!token) return null
  if (token.kind === 'lparen') {
    state.pos++
    const inner = parseExpression(state, true)
    if (peek(state)?.kind === 'rparen') {
      state.pos++
    } else {
      state.errors.push('括号未闭合')
    }
    return inner
  }
  if (token.kind === 'text') {
    state.pos++
    if (token.value.trim() === '') return null // 空文本/纯空白 token 丢弃
    return { kind: 'text', value: token.value }
  }
  if (token.kind === 'predicate') {
    state.pos++
    return dispatchPredicate(token.key, token.value, state.errors)
  }
  return null // and/or 由上层处理；rparen 由上层终止
}

export function parseSearchSyntax(text: string): SearchSyntaxParseResult {
  const errors: string[] = []
  const source = typeof text === 'string' ? text : ''
  const tokens = tokenize(source, errors)
  const ast = parseExpression({ tokens, pos: 0, errors }, false)
  return { ast, errors }
}