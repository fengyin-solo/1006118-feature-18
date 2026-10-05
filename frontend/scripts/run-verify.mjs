// 数据层验收：把 scripts/verify.ts 连同 @/ 别名打包后跑在 node 里。
import { fileURLToPath, URL } from 'node:url'
import esbuild from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))

esbuild.buildSync({
  entryPoints: [fileURLToPath(new URL('./verify.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./.verify.bundle.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': `${root}/src` },
  logLevel: 'silent',
})

await import('./.verify.bundle.mjs')
