/**
 * 管线探查领域服务：管线探查页与进度节点页的迁改待办共用这一份实现。
 * 两处入口的「未恢复管线数」都由这里同一函数算出，不会出现两边对不上的情况。
 */
import {
  commit,
  database,
  getPlans,
  getSurveys,
  listRows,
  rebuildTodoSlice,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  RelocationPlan,
  RelocationTodo,
  UtilitySurvey,
} from '@/data/types'

// 施工单位：负责现场探查与迁改组织，不是管线权属单位，只能看方案、不能递方案。
export const CONSTRUCTION_ORG = '中铁盾构项目部'
// 监理：只读。
export const SUPERVISION_ORG = '城建设计监理公司'

/**
 * 能选的权属单位全在这：目录里的管线权属单位 + 历史台账里出现过的单位，
 * 下拉不再漏单位。只有这个集合里的单位能提交迁改方案。
 */
export const PIPELINE_OWNERS = [
  '市自来水集团',
  '市排水公司',
  '市燃气集团',
  '市供电公司',
  '市电信公司',
  '市热力集团',
] as const

export const PIPELINE_TYPES = ['给水', '排水', '燃气', '电力', '通信', '热力', '其他'] as const

export const UTILITY_STATUSES = ['待探查', '已探明', '迁改中', '已恢复'] as const

// 「未恢复」口径：已确认要迁改但还没走完恢复的管线。
export function isUnrecovered(row: EntryRow): boolean {
  return Boolean(row.needRelocation) && String(row.status) !== '已恢复'
}

export function isPipelineOwner(org: string): boolean {
  return (PIPELINE_OWNERS as readonly string[]).includes(org)
}

/**
 * 净距按哪一份算：以最新一条探查结论的实测净距为准；没有实测值时退到同条结论的
 * 设计净距；都没有（如待探查管线或历史台账）再退回台账里的历史净距原值。
 * 这样既让多次探查「按最新的说法办」，又兼容只有一份历史探查记录的存量数据。
 */
export function effectiveClearance(row: EntryRow): number | null {
  const latest = latestSurvey(Number(row.id))
  const candidates = latest
    ? [latest.measuredClearanceM, latest.designedClearanceM]
    : [String(row['实测净距'] ?? ''), String(row['设计净距'] ?? ''), String(row['与隧道净距'] ?? '')]
  for (const raw of candidates) {
    const value = Number(String(raw ?? '').trim())
    if (raw !== '' && raw !== undefined && !Number.isNaN(value)) {
      return value
    }
  }
  return null
}

/** 净距取值来源，用于详情页写清当前按哪份算。 */
export function clearanceSource(row: EntryRow): string {
  const latest = latestSurvey(Number(row.id))
  const scope = latest ? '最新探查结论' : '台账'
  const measured = latest ? latest.measuredClearanceM : String(row['实测净距'] ?? '')
  const designed = latest ? latest.designedClearanceM : String(row['设计净距'] ?? '')
  if (String(measured ?? '').trim() !== '' && !Number.isNaN(Number(measured))) {
    return `${scope}·实测净距`
  }
  if (String(designed ?? '').trim() !== '' && !Number.isNaN(Number(designed))) {
    return `${scope}·设计净距`
  }
  return '历史探查记录'
}

export function surveysOf(utilityId: number): UtilitySurvey[] {
  return getSurveys()
    .filter((item) => item.utilityId === utilityId)
    .sort((a, b) => (a.surveyedAt < b.surveyedAt ? 1 : -1))
}

export function latestSurvey(utilityId: number): UtilitySurvey | null {
  return surveysOf(utilityId)[0] ?? null
}

export function plansOf(utilityId: number): RelocationPlan[] {
  return getPlans()
    .filter((item) => item.utilityId === utilityId)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
}

export function latestPlan(utilityId: number): RelocationPlan | null {
  return plansOf(utilityId)[0] ?? null
}

/** 台账上出现过、但不在标准目录里的单位（兼容历史登记）。 */
export function ownerOptions(): string[] {
  const known = new Set<string>(PIPELINE_OWNERS)
  for (const row of listRows('utility')) {
    const owner = String(row['权属单位'] ?? '').trim()
    if (owner) {
      known.add(owner)
    }
  }
  return [...known]
}

export type UtilityQuery = {
  keyword?: string
  pipelineType?: string
  owner?: string
  status?: string
  depthMin?: string
  depthMax?: string
  clearanceMin?: string
  clearanceMax?: string
}

type AppliedCriterion = {
  label: string
  expected: string
  matched: number
  predicate: (row: EntryRow) => boolean
}

export type UtilityQueryResult = {
  items: EntryRow[]
  total: number
  criteria: AppliedCriterion[]
  /** 一条都命中不了时，写清是哪一格没对上。 */
  noMatchReasons: string[]
}

function parseRange(value?: string): number | null {
  const text = String(value ?? '').trim()
  if (text === '') {
    return null
  }
  const num = Number(text)
  return Number.isNaN(num) ? null : num
}

/**
 * 两份取数共用的过滤实现：
 * 管线探查列表与进度节点迁改待办都走 queryUtilities，条件叠加取交集。
 */
export function queryUtilities(query: UtilityQuery): UtilityQueryResult {
  const all = listRows('utility')
  const type = query.pipelineType?.trim() ?? ''
  const owner = query.owner?.trim() ?? ''
  const status = query.status?.trim() ?? ''
  const keyword = query.keyword?.trim() ?? ''
  const depthMin = parseRange(query.depthMin)
  const depthMax = parseRange(query.depthMax)
  const clearanceMin = parseRange(query.clearanceMin)
  const clearanceMax = parseRange(query.clearanceMax)

  const criteria: AppliedCriterion[] = []
  const register = (
    label: string,
    expected: string,
    active: boolean,
    predicate: (row: EntryRow) => boolean,
  ) => {
    if (!active) {
      return
    }
    criteria.push({ label, expected, matched: all.filter(predicate).length, predicate })
  }

  register(
    '管线编号/管径关键词',
    keyword,
    keyword !== '',
    (row) =>
      String(row['管线编号'] ?? '').includes(keyword) ||
      String(row['管线管径'] ?? '').includes(keyword),
  )
  register('管线类型', type, type !== '', (row) => String(row['管线类型'] ?? '') === type)
  register('权属单位', owner, owner !== '', (row) => String(row['权属单位'] ?? '') === owner)
  register('探查进度', status, status !== '', (row) => String(row.status) === status)
  register(
    '埋设深度下限（米）',
    `≥ ${depthMin ?? 0}`,
    depthMin !== null,
    (row) => {
      const depth = Number(String(row['埋设深度'] ?? '').trim())
      return !Number.isNaN(depth) && depth >= (depthMin ?? 0)
    },
  )
  register(
    '埋设深度上限（米）',
    `≤ ${depthMax ?? 0}`,
    depthMax !== null,
    (row) => {
      const depth = Number(String(row['埋设深度'] ?? '').trim())
      return !Number.isNaN(depth) && depth <= (depthMax ?? 0)
    },
  )
  register(
    '与隧道净距下限（米）',
    `≥ ${clearanceMin ?? 0}`,
    clearanceMin !== null,
    (row) => {
      const clearance = effectiveClearance(row)
      return clearance !== null && clearance >= (clearanceMin ?? 0)
    },
  )
  register(
    '与隧道净距上限（米）',
    `≤ ${clearanceMax ?? 0}`,
    clearanceMax !== null,
    (row) => {
      const clearance = effectiveClearance(row)
      return clearance !== null && clearance <= (clearanceMax ?? 0)
    },
  )

  // 条件叠加取交集：所有已启用条件同时满足才留下。
  const items = all.filter((row) => criteria.every((criterion) => criterion.predicate(row)))
  const noMatchReasons = criteria
    .filter((criterion) => criterion.matched === 0)
    .map((criterion) => `${criterion.label}「${criterion.expected}」一格没有对上任何管线`)

  // 单列都有数据、但条件叠加后交集为 0：按累加顺序定位是加到哪一格后被清空的。
  if (items.length === 0 && criteria.length > 1) {
    let carrying = all
    for (let index = 0; index < criteria.length; index += 1) {
      const before = carrying.length
      carrying = carrying.filter(criteria[index].predicate)
      if (before > 0 && carrying.length === 0) {
        noMatchReasons.push(
          `各格单独都有管线，但叠加到${criteria[index].label}「${criteria[index].expected}」后交集为 0：这一格与前面条件对不上同一条管线`,
        )
        break
      }
    }
  }

  return { items, total: items.length, criteria, noMatchReasons }
}

/** 进度统计：四个进度一键切换时页签上的角标，以及未恢复口径，都从全量台账算。 */
export function utilityStatusCounts(): Record<string, number> {
  const counts: Record<string, number> = { 全部: listRows('utility').length }
  for (const status of UTILITY_STATUSES) {
    counts[status] = 0
  }
  for (const row of listRows('utility')) {
    const status = String(row.status)
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

export function unrecoveredCount(): number {
  return listRows('utility').filter(isUnrecovered).length
}

export type TodoQuery = {
  owner?: string
  pipelineType?: string
  status?: string
  keyword?: string
}

/** 由探查结论重建迁改待办：已恢复或结论为无需迁改的不落待办。 */
function syncTodos(): void {
  const db = database()
  commit({ ...db, relocationTodos: rebuildTodoSlice(db) })
}

/**
 * 进度节点迁改待办取数：直接复用 queryUtilities 的字段匹配，
 * 明细与管线探查页对齐，未恢复管线数与 unrecoveredCount() 恒等。
 */
export function queryRelocationTodos(query: TodoQuery = {}): {
  items: RelocationTodo[]
  total: number
} {
  const result = queryUtilities({
    keyword: query.keyword,
    pipelineType: query.pipelineType,
    owner: query.owner,
    status: query.status,
  })
  const matchedIds = new Set(result.items.map((row) => Number(row.id)))
  const todos = getStoredTodos().filter((todo) => matchedIds.has(todo.utilityId))
  return { items: todos, total: todos.length }
}

function getStoredTodos(): RelocationTodo[] {
  return database().relocationTodos
}

export type SurveyInput = {
  surveyedAt: string
  pipelineType: string
  depthM: string
  diameter: string
  measuredClearanceM: string
  designedClearanceM: string
  needRelocation: boolean
  remark: string
}

/**
 * 提交探查结论：只有施工单位能递；同一条管线重复递两次相同结论只记一次。
 * 先完成全部校验，再整份落库；写不成就半条都不落。
 */
export function submitSurvey(
  utilityId: number,
  input: SurveyInput,
  operator: string,
): ActionResult {
  const rows = listRows('utility')
  const index = rows.findIndex((row) => Number(row.id) === utilityId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${utilityId} 的地下管线` }
  }
  if (operator !== CONSTRUCTION_ORG) {
    return { ok: false, message: '只有施工单位（中铁盾构项目部）能提交探查结论，当前单位仅可查看' }
  }
  if (!input.surveyedAt.trim()) {
    return { ok: false, message: '探查日期没填，探查结论不落库' }
  }
  if (!input.pipelineType.trim()) {
    return { ok: false, message: '管线类型没填，探查结论不落库' }
  }
  const depth = Number(input.depthM.trim())
  if (input.depthM.trim() === '' || Number.isNaN(depth) || depth < 0) {
    return { ok: false, message: '埋设深度得是不小于 0 的数字（米），探查结论不落库' }
  }
  const measured = input.measuredClearanceM.trim()
  const designed = input.designedClearanceM.trim()
  if (!measured && !designed) {
    return { ok: false, message: '实测净距和设计净距至少填一份，探查结论不落库' }
  }
  for (const [label, raw] of [['实测净距', measured], ['设计净距', designed]] as const) {
    if (raw && (Number.isNaN(Number(raw)) || Number(raw) < 0)) {
      return { ok: false, message: `${label}得是不小于 0 的数字（米），探查结论不落库` }
    }
  }

  const row = rows[index]
  const surveys = getSurveys()
  // 重复提交判定：同一条管线 + 同一天 + 同一份结论，只记一次，不翻倍。
  const duplicate = surveys.some(
    (item) =>
      item.utilityId === utilityId &&
      item.surveyedAt === input.surveyedAt.trim() &&
      item.pipelineType === input.pipelineType.trim() &&
      item.depthM === input.depthM.trim() &&
      item.measuredClearanceM === measured &&
      item.designedClearanceM === designed &&
      item.needRelocation === input.needRelocation,
  )
  if (duplicate) {
    return { ok: false, message: '这条探查结论已经递过了，重复提交不会再记一条' }
  }

  const nextId = surveys.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const survey: UtilitySurvey = {
    id: nextId,
    utilityId,
    surveyedAt: input.surveyedAt.trim(),
    pipelineType: input.pipelineType.trim(),
    depthM: input.depthM.trim(),
    diameter: input.diameter.trim(),
    measuredClearanceM: measured,
    designedClearanceM: designed,
    owner: String(row['权属单位'] ?? ''),
    needRelocation: input.needRelocation,
    remark: input.remark.trim(),
    submittedBy: operator,
  }

  // 「按谁的说法办」：以最新一条探查结论为准，台账格同步成最新口径。
  const updated: EntryRow = {
    ...row,
    管线类型: survey.pipelineType,
    埋设深度: survey.depthM,
    管线管径: survey.diameter || String(row['管线管径'] ?? ''),
    实测净距: measured,
    设计净距: designed,
    净距依据: measured ? '探查实测' : designed ? '设计图纸' : '历史探查记录',
    探查日期: survey.surveyedAt,
    needRelocation: survey.needRelocation,
    探查状态: '已探明',
    // 已恢复的管线若再次探查，状态不倒退，只更新结论。
    status: String(row.status) === '待探查' ? '已探明' : String(row.status),
  }
  if (updated.status !== '已恢复') {
    updated.pending = true
  }

  // 行表、探查记录一起拼好再一次落库：半条都不会落。
  const nextRows = [...rows]
  nextRows[index] = updated
  const db = database()
  commit({ ...db, rows: { ...db.rows, utility: nextRows }, utilitySurveys: [...surveys, survey] })
  syncTodos()
  return { ok: true, message: `探查结论已记录，管线 ${String(updated['管线编号'])} 按 ${survey.surveyedAt} 的最新结论办` }
}

export type PlanInput = {
  title: string
  content: string
}

/**
 * 提交迁改方案：只有这条管线的权属单位能提交；其它单位（含施工单位、监理、
 * 别的权属单位）一律退回。完全相同的方案重复递不翻倍。
 */
export function submitRelocationPlan(
  utilityId: number,
  input: PlanInput,
  operator: string,
): ActionResult {
  const rows = listRows('utility')
  const row = rows.find((item) => Number(item.id) === utilityId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${utilityId} 的地下管线` }
  }
  const owner = String(row['权属单位'] ?? '').trim()
  if (!isPipelineOwner(operator)) {
    return { ok: false, message: '只有管线权属单位能提交迁改方案，施工单位与监理仅可查看' }
  }
  if (operator !== owner) {
    return { ok: false, message: `跨单位改动一律退回：这条管线归「${owner}」，不由「${operator}」提交` }
  }
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title) {
    return { ok: false, message: '迁改方案标题没填，方案不落库' }
  }
  if (!content) {
    return { ok: false, message: '迁改方案内容没填，方案不落库' }
  }

  const plans = getPlans()
  const duplicate = plans.some(
    (item) => item.utilityId === utilityId && item.title === title && item.content === content,
  )
  if (duplicate) {
    return { ok: false, message: '这份迁改方案已经递过了，重复提交不会翻倍' }
  }

  const nextId = plans.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const plan: RelocationPlan = {
    id: nextId,
    utilityId,
    title,
    content,
    submittedBy: operator,
    owner,
    submittedAt: today,
  }

  const nextRows = rows.map((item) =>
    Number(item.id) === utilityId ? { ...item, 迁改方案: title } : item,
  )
  const db = database()
  commit({
    ...db,
    rows: { ...db.rows, utility: nextRows },
    relocationPlans: [...plans, plan],
  })
  syncTodos()
  return { ok: true, message: `迁改方案「${title}」已由 ${operator} 提交` }
}

/**
 * 进度流转（提交探查/安排迁改/确认恢复）：保持原台账动作，
 * 每次流转后同步迁改待办，保证两处入口的未恢复数即时对上。
 */
export function advanceUtility(
  utilityId: number,
  action: '提交探查' | '安排迁改' | '确认恢复',
): ActionResult {
  const rows = listRows('utility')
  const index = rows.findIndex((row) => Number(row.id) === utilityId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${utilityId} 的地下管线` }
  }
  const row = rows[index]
  const current = String(row.status)
  const order: Record<string, number> = { 待探查: 0, 已探明: 1, 迁改中: 2, 已恢复: 3 }
  const targets = { 提交探查: '已探明', 安排迁改: '迁改中', 确认恢复: '已恢复' } as const
  const target = targets[action]

  if (action === '安排迁改' && current === '待探查') {
    return { ok: false, message: '还没探查的管线不能直接安排迁改，先提交探查结论' }
  }
  if (action === '安排迁改' && !Boolean(row.needRelocation)) {
    return { ok: false, message: '最新探查结论是无需迁改，不安排迁改' }
  }
  if (action === '确认恢复' && current !== '迁改中') {
    return { ok: false, message: '只有迁改中的管线能确认恢复' }
  }
  if (order[target] <= order[current]) {
    return { ok: false, message: `管线已经是「${current}」，不用重复操作` }
  }

  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== '已恢复',
    abnormal: false,
    探查状态: target,
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows('utility', nextRows)
  syncTodos()
  return { ok: true, message: `管线 ${String(row['管线编号'])} 已${action}，当前状态「${target}」` }
}
