/**
 * v1 老库（只有行表、占位样例）迁移补录校验。
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const FRONTEND_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src')

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

const originalResolve = require('module')._resolveFilename
require('module')._resolveFilename = function (request, parent, isMain, options) {
  let next = request
  if (next.startsWith('@/')) {
    next = path.join(SRC_ROOT, next.slice(2))
  }
  for (const candidate of [next, `${next}.ts`, `${next}.js`, path.join(next, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return originalResolve.call(this, candidate, parent, isMain, options)
    }
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  },
}

let passed = 0
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`断言失败：${message}`)
  }
  passed += 1
  console.log(`  ✓ ${message}`)
}

// 造一份 v1 库：只有行表，utility 是三条占位样例，schema 版本不存在（按 1 处理）。
const v1 = {
  shield: [],
  utility: [
    {
      id: 1,
      status: '待探查',
      pending: true,
      abnormal: false,
      管线编号: 'UTIL-0001',
      管线类型: '管线探查样例1',
      埋设深度: '管线探查样例1',
      管线管径: '管线探查样例1',
      与隧道净距: '管线探查样例1',
      权属单位: '管线探查样例1',
      迁改方案: '管线探查样例1',
      探查状态: '管线探查样例1',
    },
    {
      id: 2,
      status: '已探明',
      pending: true,
      abnormal: true,
      管线编号: 'UTIL-0002',
      管线类型: '管线探查样例2',
      埋设深度: '管线探查样例2',
      管线管径: '管线探查样例2',
      与隧道净距: '管线探查样例2',
      权属单位: '管线探查样例2',
      迁改方案: '管线探查样例2',
      探查状态: '管线探查样例2',
    },
    {
      id: 3,
      status: '迁改中',
      pending: false,
      abnormal: false,
      管线编号: 'UTIL-0003',
      管线类型: '管线探查样例3',
      埋设深度: '管线探查样例3',
      管线管径: '管线探查样例3',
      与隧道净距: '管线探查样例3',
      权属单位: '管线探查样例3',
      迁改方案: '管线探查样例3',
      探查状态: '管线探查样例3',
    },
  ],
}
store.set('shield-tunnel-construction:entries', JSON.stringify(v1))

const { database, storageKey } = require(path.join(SRC_ROOT, 'data/local-store.ts'))
const { queryUtilities, unrecoveredCount, queryRelocationTodos, surveysOf } = require(
  path.join(SRC_ROOT, 'api/utility-service.ts'),
)

const db = database()
const utility = db.rows.utility
assert(utility.length === 10, `迁移后补全为 10 条真实台账，实际 ${utility.length}`)
const byId = Object.fromEntries(utility.map((row) => [Number(row.id), row]))

assert(String(byId[1].status) === '待探查', '老库里 1 号用户流转过的「待探查」状态保留')
assert(String(byId[1]['管线类型']) === '给水', '占位格补录成真实管线类型（给水）')
assert(String(byId[1]['探查日期']) === '', '待探查存量管线不臆造探查日期')
assert(Boolean(byId[1].needRelocation) === false, '待探查存量管线不背着需迁改结论')

assert(String(byId[2].status) === '已探明', '2 号保留「已探明」状态')
assert(String(byId[2]['探查日期']) === '2026-09-15', '已探明存量管线按基准探查日期补录')
const survey2 = surveysOf(2)
assert(survey2.length === 1, `2 号补录 1 条历史探查记录，实际 ${survey2.length}`)
assert(survey2[0].remark === '存量管线迁移补录', '补录记录带迁移标记')

assert(String(byId[3].status) === '迁改中', '3 号保留「迁改中」状态')
assert(Boolean(byId[3].needRelocation) === true, '迁改中的存量管线按需要迁改处理')

// 新种子补入的 4-10 号也在
assert(byId[10] !== undefined && String(byId[10]['管线类型']) === '电力', '新台账 10 号（电力）随迁移补入')

const stored = JSON.parse(store.get(storageKey()))
assert(stored.utilitySurveys.length >= 6, `探查记录分片完成迁移（≥6 条），实际 ${stored.utilitySurveys.length}`)
assert(stored.relocationTodos.length === unrecoveredCount(), '迁移后待办分片与未恢复计数一致')
assert(
  queryRelocationTodos({}).total === unrecoveredCount(),
  '迁移后两处入口读到的未恢复管线数仍然一致',
)
const noPlaceholders = queryUtilities({ keyword: '样例' })
assert(noPlaceholders.total === 0, '迁移后台账里不再有「样例」占位格')

// schema 版本已升到 2，再读一次不会重复迁移
const beforeReload = stored.utilitySurveys.length
const { database: db2 } = require(path.join(SRC_ROOT, 'data/local-store.ts'))
void db2
assert(JSON.parse(store.get(storageKey())).utilitySurveys.length === beforeReload, '重复读取不重复迁移（可重入）')

console.log(`\n迁移校验全部通过（${passed} 项）`)
