/**
 * 管线探查业务规则的端到端校验。由 scripts/run-verify.cjs 打包后执行，
 * 执行时已经注入了内存版 window.localStorage。
 */
import {
  advanceUtility,
  CONSTRUCTION_ORG,
  effectiveClearance,
  ownerOptions,
  PIPELINE_OWNERS,
  queryRelocationTodos,
  queryUtilities,
  submitRelocationPlan,
  submitSurvey,
  surveysOf,
  plansOf,
  unrecoveredCount,
  utilityStatusCounts,
} from '../src/api/utility-service'
import { database, storageKey } from '../src/data/local-store'

type Assert = (condition: unknown, message: string) => void
type Ctx = { assert: Assert; reset: () => void }

export function run(ctx: Ctx): void {
  const { assert } = ctx

  console.log('— 种子数据与口径 —')
  const owners = ownerOptions()
  for (const owner of PIPELINE_OWNERS) {
    assert(owners.includes(owner), `权属单位下拉包含「${owner}」`)
  }
  const all = queryUtilities({})
  assert(all.total === 10, `种子台账共 10 条，实际 ${all.total}`)
  const counts = utilityStatusCounts()
  assert(counts['待探查'] === 4, `待探查 4 条，实际 ${counts['待探查']}`)
  assert(counts['已探明'] === 3, `已探明 3 条，实际 ${counts['已探明']}`)
  assert(counts['迁改中'] === 2, `迁改中 2 条，实际 ${counts['迁改中']}`)
  assert(counts['已恢复'] === 1, `已恢复 1 条，实际 ${counts['已恢复']}`)
  assert(unrecoveredCount() === 4, `未恢复（需迁改且未恢复）4 条，实际 ${unrecoveredCount()}`)
  const todosAll = queryRelocationTodos({})
  assert(todosAll.total === 4, `进度节点迁改待办 4 条，实际 ${todosAll.total}`)
  assert(
    todosAll.total === unrecoveredCount(),
    '进度页待办数与管线页未恢复管线数一致（共用同一份取数）',
  )

  console.log('— 净距口径：实测 > 设计 > 历史台账 —')
  const find = (id: number) =>
    database().rows.utility.find((row) => Number(row.id) === id)!
  assert(effectiveClearance(find(1)) === 1.8, 'UTIL-0001 有实测，净距按实测 1.8')
  assert(effectiveClearance(find(2)) === 3.2, 'UTIL-0002 未探查，净距回退设计 3.2')

  console.log('— 条件叠加取交集 —')
  const intersection = queryUtilities({ pipelineType: '排水', owner: '市排水公司' })
  assert(intersection.total === 2, `排水+市排水公司交集 2 条，实际 ${intersection.total}`)
  const rangeOnly = queryUtilities({ clearanceMax: '1.2' })
  assert(rangeOnly.total === 3, `净距 ≤ 1.2 命中 3 条（0.9/1.2/1.1），实际 ${rangeOnly.total}`)
  const stacked = queryUtilities({
    pipelineType: '排水',
    clearanceMax: '1.0',
  })
  assert(stacked.total === 1, `排水 且 净距≤1.0 交集 1 条，实际 ${stacked.total}`)
  const depthBand = queryUtilities({ depthMin: '2.0', depthMax: '3.0' })
  assert(depthBand.total === 4, `埋深 2.0~3.0 命中 4 条，实际 ${depthBand.total}`)

  console.log('— 一条都命中不了：写清哪一格没对上 —')
  const none = queryUtilities({ pipelineType: '燃气', owner: '市自来水集团' })
  assert(none.total === 0, '燃气 + 自来水集团 交集 0 条')
  assert(none.noMatchReasons.length >= 1, '给出至少一格未命中原因')
  assert(
    none.noMatchReasons.some((reason) => reason.includes('权属单位')),
    '未命中原因点名了「权属单位」那一格',
  )
  const noneRange = queryUtilities({ clearanceMin: '99' })
  assert(
    noneRange.noMatchReasons.some((reason) => reason.includes('与隧道净距')),
    '离谱净距下限时点名「与隧道净距」格',
  )

  console.log('— 越权提交一律退回 —')
  const asWater = submitRelocationPlan(2, { title: '抢提交', content: '越权' }, '市自来水集团')
  assert(!asWater.ok, '自来水集团不能给燃气公司管线递方案')
  assert(asWater.message.includes('跨单位'), '退回理由写明跨单位')
  const asBuilder = submitRelocationPlan(1, { title: '施工方代办', content: '越权' }, CONSTRUCTION_ORG)
  assert(!asBuilder.ok, '施工单位不能提交迁改方案，只能查看')
  const asSupervisor = submitRelocationPlan(
    1,
    { title: '监理代办', content: '越权' },
    '城建设计监理公司',
  )
  assert(!asSupervisor.ok, '监理只读，不能提交迁改方案')
  const planBefore = plansOf(1).length
  assert(planBefore === 0, `被退回后半条都没落（UTIL-0001 方案仍为 ${planBefore} 份）`)

  console.log('— 权属单位提交自家管线方案 —')
  const okPlan = submitRelocationPlan(
    1,
    { title: '给水管悬吊保护', content: 'DN400 给水管采用钢梁悬吊，加密沉降监测。' },
    '市自来水集团',
  )
  assert(okPlan.ok, '市自来水集团给自家 UTIL-0001 提交方案成功')
  const dupPlan = submitRelocationPlan(
    1,
    { title: '给水管悬吊保护', content: 'DN400 给水管采用钢梁悬吊，加密沉降监测。' },
    '市自来水集团',
  )
  assert(!dupPlan.ok, '同一份方案重复递被拒绝')
  assert(plansOf(1).length === 1, '方案只有 1 份，重复提交不会翻倍')
  const todoWithPlan = queryRelocationTodos({}).items.find((todo) => todo.utilityId === 1)
  assert(todoWithPlan?.planTitle === '给水管悬吊保护', '待办明细同步显示新方案标题')

  console.log('— 探查结论：仅施工单位、去重、写不成就不落半条 —')
  const ownerTriesSurvey = submitSurvey(
    2,
    {
      surveyedAt: '2026-10-01',
      pipelineType: '燃气',
      depthM: '1.6',
      diameter: 'DN200',
      measuredClearanceM: '2.9',
      designedClearanceM: '3.2',
      needRelocation: true,
      remark: '',
    },
    '市燃气集团',
  )
  assert(!ownerTriesSurvey.ok, '权属单位不能替施工方提交探查结论')
  const badSurvey = submitSurvey(
    2,
    {
      surveyedAt: '',
      pipelineType: '燃气',
      depthM: '1.6',
      diameter: 'DN200',
      measuredClearanceM: '',
      designedClearanceM: '',
      needRelocation: true,
      remark: '',
    },
    CONSTRUCTION_ORG,
  )
  assert(!badSurvey.ok, '日期缺失 + 两份净距都空：校验拒绝')
  assert(surveysOf(2).length === 0, '校验失败后半条探查记录都没落')
  const goodSurvey = submitSurvey(
    2,
    {
      surveyedAt: '2026-10-01',
      pipelineType: '燃气',
      depthM: '1.6',
      diameter: 'DN200',
      measuredClearanceM: '2.9',
      designedClearanceM: '3.2',
      needRelocation: true,
      remark: '燃气主管，需迁改',
    },
    CONSTRUCTION_ORG,
  )
  assert(goodSurvey.ok, '施工单位提交探查结论成功')
  assert(surveysOf(2).length === 1, 'UTIL-0002 记录 1 条探查结论')
  const dupSurvey = submitSurvey(
    2,
    {
      surveyedAt: '2026-10-01',
      pipelineType: '燃气',
      depthM: '1.6',
      diameter: 'DN200',
      measuredClearanceM: '2.9',
      designedClearanceM: '3.2',
      needRelocation: true,
      remark: '燃气主管，需迁改',
    },
    CONSTRUCTION_ORG,
  )
  assert(!dupSurvey.ok, '同一天同一份结论重复递只记一次')
  assert(surveysOf(2).length === 1, '重复探查后仍只有 1 条记录')
  assert(effectiveClearance(find(2)) === 2.9, '探查后净距按最新实测 2.9 算（不再用设计 3.2）')
  const row2 = find(2)
  assert(String(row2.status) === '已探明', '待探查管线提交结论后流转为已探明')

  console.log('— 探查结论同步迁改待办，两处未恢复数对齐 —')
  assert(unrecoveredCount() === 5, `UTIL-0002 需迁改后未恢复数变 5，实际 ${unrecoveredCount()}`)
  assert(
    queryRelocationTodos({}).total === unrecoveredCount(),
    '同步后进度页待办数仍与管线页一致',
  )

  console.log('— 最新说法办：新探查结论改口径，待办跟着走 —')
  const revised = submitSurvey(
    2,
    {
      surveyedAt: '2026-10-03',
      pipelineType: '燃气',
      depthM: '1.7',
      diameter: 'DN200',
      measuredClearanceM: '3.4',
      designedClearanceM: '3.2',
      needRelocation: false,
      remark: '复测净距足够，无需迁改',
    },
    CONSTRUCTION_ORG,
  )
  assert(revised.ok, '复测给出无需迁改的新结论')
  assert(effectiveClearance(find(2)) === 3.4, '净距按 10-03 最新实测 3.4')
  assert(unrecoveredCount() === 4, '结论变无需迁改后待办移除，未恢复数回到 4')
  assert(
    queryRelocationTodos({}).total === 4,
    '进度页待办同步移除，两处仍一致',
  )

  console.log('— 状态流转约束与恢复后待办核销 —')
  const skipSurvey = advanceUtility(8, '安排迁改')
  assert(!skipSurvey.ok, '待探查管线不能直接安排迁改')
  const arrangeNoNeed = advanceUtility(6, '安排迁改')
  assert(!arrangeNoNeed.ok, '无需迁改的已探明管线不能安排迁改')
  const arrange = advanceUtility(1, '安排迁改')
  assert(arrange.ok, 'UTIL-0001 已探明且需迁改，可以安排迁改')
  const recoverEarly = advanceUtility(1, '确认恢复')
  assert(recoverEarly.ok, '迁改中管线确认恢复')
  assert(String(find(1).status) === '已恢复', 'UTIL-0001 已恢复')
  assert(unrecoveredCount() === 3, `恢复核销后未恢复数 3，实际 ${unrecoveredCount()}`)
  assert(
    queryRelocationTodos({}).total === 3,
    '恢复后进度页待办同步核销，两处一致',
  )
  const recoverAgain = advanceUtility(1, '确认恢复')
  assert(!recoverAgain.ok, '重复恢复被拒绝')

  console.log('— 其它入口过滤口径对齐 —')
  const todoFilter = queryRelocationTodos({ owner: '市排水公司' })
  const utilFilter = queryUtilities({ owner: '市排水公司' })
  const expectedTodo = utilFilter.items.filter(
    (row) => Boolean(row.needRelocation) && String(row.status) !== '已恢复',
  ).length
  assert(
    todoFilter.total === expectedTodo,
    `进度页按权属过滤待办 ${todoFilter.total} 条 == 管线页同条件未恢复 ${expectedTodo} 条`,
  )

  console.log('— 整份库原子落库（localStorage 一次写入完整结构）—')
  const raw = JSON.parse(window.localStorage.getItem(storageKey()) as string)
  assert(Array.isArray(raw.rows.utility) && raw.rows.utility.length === 10, '库里 utility 行表完整 10 条')
  assert(Array.isArray(raw.utilitySurveys), '探查记录分片存在')
  assert(Array.isArray(raw.relocationPlans), '迁改方案分片存在')
  assert(Array.isArray(raw.relocationTodos), '迁改待办分片存在')
  assert(
    raw.relocationTodos.length === unrecoveredCount(),
    '落库待办分片与未恢复计数一致（无半条残留）',
  )
}
