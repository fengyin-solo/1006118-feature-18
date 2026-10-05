/**
 * 数据层验收脚本：node scripts/run-verify.mjs
 * 覆盖：交集查询、数值范围、分页、空结果诊断、单位权限、幂等、原子写、存量迁移。
 */

// localStorage 替身：先正常工作，置 failing 后 setItem 抛错，用来验证「写不成就别落半条」。
const store = new Map<string, string>()
let failing = false
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: string) => {
      if (failing) throw new Error('QuotaExceededError')
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  },
}

const service = await import('@/api/local-service')
const { migrateUtilityRows } = await import('@/data/utility-migration')
const { SEED_ROWS } = await import('@/data/seed')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   - ${name}`)
  } else {
    failures += 1
    console.error(`FAIL - ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

// —— 查询：条件叠加取交集 ——
const byType = service.queryEntries('utility', { exact: { 管线类型: '给水管线' } })
check('按管线类型筛', byType.total === 3, byType.total)
const byTypeOwner = service.queryEntries('utility', {
  exact: { 管线类型: '给水管线', 权属单位: '市自来水公司' },
})
check('类型+权属单位取交集', byTypeOwner.total === 3, byTypeOwner.total)
const deep = service.queryEntries('utility', {
  exact: { 管线类型: '给水管线' },
  ranges: { 埋设深度: { min: '3' } },
})
check('交集再叠埋设深度', deep.total === 1 && deep.items[0]['管线编号'] === 'UTIL-0011', deep.items)
const near = service.queryEntries('utility', { ranges: { 与隧道净距: { max: '1' } } })
check('净距范围过滤', near.total === 2, near.items.map((r) => r['管线编号']))
const ranged = service.queryEntries('utility', {
  ranges: { 埋设深度: { min: '1.5', max: '2.5' } },
})
check('深度区间两端都卡', ranged.items.every((r) => {
  const d = Number.parseFloat(String(r['埋设深度']))
  return d >= 1.5 && d <= 2.5
}), ranged.items.map((r) => r['埋设深度']))

// —— 分页 ——
const page1 = service.queryEntries('utility', { page: 1, size: 5 })
const page3 = service.queryEntries('utility', { page: 3, size: 5 })
check('分页首页 5 条', page1.items.length === 5 && page1.total === 12)
check('分页末页 2 条', page3.items.length === 2 && page3.page === 3)
const clamped = service.queryEntries('utility', { page: 99, size: 5 })
check('页码超出收敛到末页', clamped.page === 3 && clamped.items.length === 2)
const pagedFilter = service.queryEntries('utility', {
  exact: { 权属单位: '市排水集团' },
  page: 1,
  size: 2,
})
check('带条件分页总数按条件算', pagedFilter.total === 3 && pagedFilter.items.length === 2)

// —— 空结果诊断 ——
const missOwner = service.explainEmptyQuery('utility', { exact: { 权属单位: '某不明单位' } })
check('单格没对上能指出来', missOwner.some((m) => m.includes('权属单位') && m.includes('没有一条')), missOwner)
const missCombo = service.explainEmptyQuery('utility', {
  exact: { 管线类型: '给水管线' },
  ranges: { 与隧道净距: { max: '1' } },
})
check('叠加卡空能指出哪一格', missCombo.some((m) => m.includes('管线类型') && m.includes('卡空')), missCombo)

// —— 状态一键切换 ——
const pendingRows = service.queryEntries('utility', { status: '待探查' })
check('按状态切', pendingRows.total === 3, pendingRows.items.map((r) => r['管线编号']))

// —— 未恢复数两处同源 ——
check('未恢复管线数', service.countUnrestoredPipelines() === 10, service.countUnrestoredPipelines())
check(
  '未恢复明细即状态过滤结果',
  service.listUnrestoredPipelines().every((r) => String(r.status) !== '已恢复'),
)

// —— 权限：迁改方案只认权属单位 ——
const planBefore = String(service.getEntry('utility', 2)?.['迁改方案'])
const crossOrg = service.submitRelocationPlan(2, '越权改的方案', '市电力公司')
check('跨单位提交被退回', !crossOrg.ok && crossOrg.message.includes('退回'), crossOrg)
check('退回后方案没动', String(service.getEntry('utility', 2)?.['迁改方案']) === planBefore)
const outsider = service.submitRelocationPlan(2, '外部单位方案', '监理单位')
check('非权属单位只能查看', !outsider.ok, outsider)
const ownOrg = service.submitRelocationPlan(2, '自来水公司复核后的方案', '市自来水公司')
check('权属单位提交成功', ownOrg.ok, ownOrg)
const again = service.submitRelocationPlan(2, '自来水公司复核后的方案', '市自来水公司')
check('同一方案重复递只记一次', again.ok && again.message.includes('不重复'), again)
check(
  '重复递不翻倍',
  String(service.getEntry('utility', 2)?.['迁改方案']) === '自来水公司复核后的方案',
)

// —— 权限：状态流转 ——
const rejected = service.runAction('utility', 4, '提交探查', '监理单位')
check('无关单位状态流转被拒', !rejected.ok && rejected.message.includes('只能查看'), rejected)
const moved = service.runAction('utility', 4, '提交探查', '项目部')
check('项目部提交探查成功', moved.ok, moved)
check('探查状态字段同步', String(service.getEntry('utility', 4)?.['探查状态']) === '已探明')
const otherModule = service.runAction('progress', 1, '开始节点')
check('其它模块动作不受单位限制', otherModule.ok, otherModule)

// —— 探查记录：判重、最新取值、原子写 ——
const surveyCountBefore = service.listSurveys(4).length
const recorded = service.recordSurvey(
  4,
  { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-09-10', 埋设深度: '4.3', 与隧道净距: '2.9', 结论: '开挖验证', 记录单位: '项目部' },
  '项目部',
)
check('登记探查记录成功', recorded.ok, recorded)
check('行上读数跟最新记录走', String(service.getEntry('utility', 4)?.['埋设深度']) === '4.3')
const dupSurvey = service.recordSurvey(
  4,
  { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-09-10', 埋设深度: '4.3', 与隧道净距: '2.9', 结论: '开挖验证', 记录单位: '项目部' },
  '项目部',
)
check('同一条探查重复递只记一次', dupSurvey.ok && dupSurvey.message.includes('不重复'), dupSurvey)
check('探查记录数没翻倍', service.listSurveys(4).length === surveyCountBefore + 1)
const older = service.recordSurvey(
  4,
  { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-07-01', 埋设深度: '9.9', 与隧道净距: '9.9', 结论: '补录旧记录', 记录单位: '项目部' },
  '项目部',
)
check('旧日期记录也能补登', older.ok, older)
check('行上读数仍按最新日期算', String(service.getEntry('utility', 4)?.['埋设深度']) === '4.3')
const badNumber = service.recordSurvey(
  4,
  { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-09-11', 埋设深度: '约4米', 与隧道净距: '2.9', 结论: '', 记录单位: '项目部' },
  '项目部',
)
check('非数值读数拒收', !badNumber.ok, badNumber)
const noRight = service.recordSurvey(
  4,
  { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-09-12', 埋设深度: '4.3', 与隧道净距: '2.9', 结论: '', 记录单位: '监理单位' },
  '监理单位',
)
check('无关单位登记探查被拒', !noRight.ok, noRight)

// —— 原子写：写不成就别落半条 ——
failing = true
let threw = false
try {
  service.submitRelocationPlan(1, '原子性测试方案', '市自来水公司')
} catch {
  threw = true
}
failing = false
check('写失败要抛出来', threw)
check('写失败不留半条', String(service.getEntry('utility', 1)?.['迁改方案']) !== '原子性测试方案')
const surveyCountAfterFail = service.listSurveys(4).length
failing = true
let surveyThrew = false
try {
  service.recordSurvey(
    4,
    { 管线id: 4, 管线编号: 'UTIL-0004', 探查日期: '2026-09-20', 埋设深度: '4.4', 与隧道净距: '3.0', 结论: '', 记录单位: '项目部' },
    '项目部',
  )
} catch {
  surveyThrew = true
}
failing = false
check('两表写失败也抛出来', surveyThrew)
check('探查记录没落半条', service.listSurveys(4).length === surveyCountAfterFail)
check('行上读数没落半条', String(service.getEntry('utility', 4)?.['埋设深度']) === '4.3')

// —— 存量迁移：按探查日期补录，兼容历史文本 ——
const legacy = [
  {
    id: 1, status: '已探明', pending: true, abnormal: false,
    管线编号: 'UTIL-1001', 管线类型: '给水管线', 埋设深度: '约2米', 管线管径: 'DN300',
    与隧道净距: '约4米', 权属单位: '市自来水公司', 迁改方案: '', 探查状态: '已探明',
  },
  {
    id: 2, status: '待探查', pending: true, abnormal: false,
    管线编号: 'UTIL-1002', 管线类型: '燃气管线', 埋设深度: '3.0', 管线管径: 'DN250',
    与隧道净距: '1.0', 权属单位: '市燃气集团', 迁改方案: '', 探查状态: '待探查',
  },
]
const migrated = migrateUtilityRows(legacy, [])
check('老数据迁移有改动', migrated.changed)
check('探查日期按序补录', migrated.rows[0]['探查日期'] === '2026-08-10', migrated.rows[0]['探查日期'])
check('历史文本原样进探查记录', migrated.surveys.some((s) => s['与隧道净距'] === '约4米' && s['结论'] === '存量补录'))
check('待探查且无日期的不补', migrated.rows[1]['探查日期'] === undefined || migrated.rows[1]['探查日期'] === '')
const remigrated = migrateUtilityRows(migrated.rows, migrated.surveys)
check('迁移幂等，再跑不再改', !remigrated.changed)

// —— 种子数据自洽 ——
check('种子里未恢复数能对上', SEED_ROWS['utility'].filter((r) => r.status !== '已恢复').length === 10)
check(
  '种子里探查记录挂得上管线',
  SEED_ROWS['utility-survey'].every((s) => SEED_ROWS['utility'].some((r) => Number(r.id) === Number(s['管线id']))),
)
check(
  '种子行读数与最新探查记录一致',
  SEED_ROWS['utility'].every((row) => {
    const surveys = SEED_ROWS['utility-survey']
      .filter((s) => Number(s['管线id']) === Number(row.id))
      .sort((a, b) => String(b['探查日期']).localeCompare(String(a['探查日期'])))
    if (!surveys.length) return true
    return String(row['与隧道净距']) === String(surveys[0]['与隧道净距'])
  }),
)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
