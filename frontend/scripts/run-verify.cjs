/**
 * 不依赖 esbuild 原生二进制：用 typescript 的 transpileModule 即时转译，
 * 自己解析 @/ 别名与扩展名。只跑纯 TS 领域代码（不碰 .vue）。
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const FRONTEND_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src')

const originalTsExt = require.extensions['.ts']
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      sourceMap: false,
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
  const candidates = [
    next,
    `${next}.ts`,
    `${next}.js`,
    path.join(next, 'index.ts'),
    path.join(next, 'index.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return originalResolve.call(this, candidate, parent, isMain, options)
    }
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

async function main() {
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  }
  globalThis.window = { localStorage }

  let passed = 0
  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(`断言失败：${message}`)
    }
    passed += 1
    console.log(`  ✓ ${message}`)
  }

  const { run } = require(path.join(__dirname, 'verify-utility.ts'))
  run({ assert })
  console.log(`\n全部断言通过（${passed} 项）`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
