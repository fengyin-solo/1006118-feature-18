import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveAll, saveRows } from '@/data/local-store'
import { surveyStorageKey } from '@/data/utility-migration'
import type {
  ActionResult,
  EntryQuery,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SurveyRecord,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 项目部是施工管理方：探查登记与状态流转由项目部或权属单位经办，迁改方案只认权属单位。
export const MANAGEMENT_ORG = '项目部'
const UTILITY_KEY = 'utility'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }
  const num = Number.parseFloat(String(value))
  return Number.isFinite(num) ? num : null
}

type Condition = {
  label: string
  test: (row: EntryRow) => boolean
}

// 所有查询条件都收敛到这里：列表取交集靠它，空结果诊断也靠它，两处不会各说各话。
function buildConditions(query: EntryQuery): Condition[] {
  const conditions: Condition[] = []
  for (const [field, raw] of Object.entries(query.filters ?? {})) {
    const value = raw.trim()
    if (!value) continue
    conditions.push({
      label: `${field}含「${value}」`,
      test: (row) => String(row[field] ?? '').includes(value),
    })
  }
  for (const [field, raw] of Object.entries(query.exact ?? {})) {
    const value = raw.trim()
    if (!value) continue
    conditions.push({
      label: `${field}＝${value}`,
      test: (row) => String(row[field] ?? '') === value,
    })
  }
  for (const [field, range] of Object.entries(query.ranges ?? {})) {
    const min = toNumber(range.min)
    const max = toNumber(range.max)
    if (min !== null) {
      conditions.push({
        label: `${field}≥${min}`,
        test: (row) => {
          const num = toNumber(row[field])
          return num !== null && num >= min
        },
      })
    }
    if (max !== null) {
      conditions.push({
        label: `${field}≤${max}`,
        test: (row) => {
          const num = toNumber(row[field])
          return num !== null && num <= max
        },
      })
    }
  }
  const status = query.status?.trim()
  if (status) {
    conditions.push({
      label: `状态＝${status}`,
      test: (row) => String(row.status) === status,
    })
  }
  return conditions
}

function applyQuery(rows: EntryRow[], query: EntryQuery): EntryRow[] {
  const conditions = buildConditions(query)
  if (conditions.length === 0) {
    return rows
  }
  return rows.filter((row) => conditions.every((condition) => condition.test(row)))
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  return applyQuery(rows, { filters })
}

export function queryEntries(key: string, query: EntryQuery = {}): PageResult {
  const matched = applyQuery(listRows(key), query)
  if (!query.size || query.size <= 0) {
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const size = query.size
  const pageCount = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
  return {
    items: matched.slice((page - 1) * size, page * size),
    total: matched.length,
    page,
    size,
  }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  return queryEntries(key, { filters })
}

// 一条都命中不了时，逐格回看：哪一格本身就没人对得上，或哪一格一叠加就把交集卡空。
export function explainEmptyQuery(key: string, query: EntryQuery): string[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const conditions = buildConditions(query)
  if (conditions.length === 0) {
    return []
  }
  const messages: string[] = []
  for (const condition of conditions) {
    if (!rows.some((row) => condition.test(row))) {
      messages.push(`「${condition.label}」没有一条${meta.entity}对得上`)
    }
  }
  if (messages.length > 0) {
    return messages
  }
  for (const condition of conditions) {
    const rest = conditions.filter((item) => item !== condition)
    const count = rows.filter((row) => rest.every((item) => item.test(row))).length
    if (count > 0) {
      messages.push(`「${condition.label}」一叠加就把结果卡空了，去掉它能对上 ${count} 条`)
    }
  }
  if (messages.length === 0) {
    messages.push('各条件叠加后没有交集，请放宽条件再查')
  }
  return messages
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

/** 全量行：页面做状态统计用，查询过滤仍走 queryEntries。 */
export function listModuleRows(key: string): EntryRow[] {
  return listRows(key)
}

// —— 管线探查：单位权限 ——

function ownerOf(row: EntryRow): string {
  return String(row['权属单位'] ?? '')
}

/** 探查登记、状态流转：项目部或该管线的权属单位才能动，其它单位只能查看。 */
function canOperatePipeline(row: EntryRow, org: string): boolean {
  return org === MANAGEMENT_ORG || ownerOf(row) === org
}

/** 迁改方案：只有权属单位自己能提交，跨单位一律退回。 */
function canSubmitPlan(row: EntryRow, org: string): boolean {
  return ownerOf(row) !== '' && ownerOf(row) === org
}

function rejectMessage(row: EntryRow, org: string, action: string): string {
  const owner = ownerOf(row) || '未登记权属单位'
  if (action === '提交迁改方案') {
    return `只有权属单位「${owner}」能提交迁改方案，当前单位「${org || '未登记'}」只能查看，已退回`
  }
  return `只有项目部或权属单位「${owner}」能改动这条管线，当前单位「${org || '未登记'}」只能查看，已退回`
}

export function runAction(key: string, id: number, action: string, org = ''): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === UTILITY_KEY && !canOperatePipeline(rows[index], org)) {
    return { ok: false, message: rejectMessage(rows[index], org, action) }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === UTILITY_KEY) {
    updated['探查状态'] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 提交迁改方案：仅权属单位；内容不变不重复登记；写不成就整体不落。 */
export function submitRelocationPlan(id: number, plan: string, org: string): ActionResult {
  const rows = listRows(UTILITY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地下管线` }
  }
  const row = rows[index]
  if (!canSubmitPlan(row, org)) {
    return { ok: false, message: rejectMessage(row, org, '提交迁改方案') }
  }
  const text = plan.trim()
  if (!text) {
    return { ok: false, message: '迁改方案不能为空' }
  }
  if (String(row['迁改方案'] ?? '').trim() === text) {
    return { ok: true, message: '迁改方案与已登记内容一致，不重复登记' }
  }
  const next = [...rows]
  next[index] = { ...row, '迁改方案': text }
  saveRows(UTILITY_KEY, next)
  return { ok: true, message: `迁改方案已登记到 ${row['管线编号']}` }
}

export function listSurveys(pipelineId: number): EntryRow[] {
  return listRows(surveyStorageKey())
    .filter((row) => Number(row['管线id']) === pipelineId)
    .sort((a, b) => String(b['探查日期']).localeCompare(String(a['探查日期'])))
}

/** 登记探查记录：同一条（同管线、同日期、同读数）重复递只记一次；两表一次写，不落半条。 */
export function recordSurvey(id: number, survey: SurveyRecord, org: string): ActionResult {
  const rows = listRows(UTILITY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地下管线` }
  }
  const row = rows[index]
  if (!canOperatePipeline(row, org)) {
    return { ok: false, message: rejectMessage(row, org, '登记探查记录') }
  }
  const date = survey.探查日期.trim()
  if (!date) {
    return { ok: false, message: '探查日期不能为空' }
  }
  if (toNumber(survey.埋设深度) === null || toNumber(survey.与隧道净距) === null) {
    return { ok: false, message: '埋设深度、与隧道净距要填数值，单位米' }
  }
  const surveys = listRows(surveyStorageKey())
  const duplicated = surveys.some(
    (item) =>
      Number(item['管线id']) === id &&
      String(item['探查日期']) === date &&
      String(item['埋设深度']) === survey.埋设深度.trim() &&
      String(item['与隧道净距']) === survey.与隧道净距.trim(),
  )
  if (duplicated) {
    return { ok: true, message: '这条探查记录已登记过，不重复记录' }
  }
  const nextSurveyId = surveys.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const record: EntryRow = {
    id: nextSurveyId,
    status: '已登记',
    pending: false,
    abnormal: false,
    '管线id': id,
    '管线编号': String(row['管线编号'] ?? ''),
    '探查日期': date,
    '埋设深度': survey.埋设深度.trim(),
    '与隧道净距': survey.与隧道净距.trim(),
    '结论': survey.结论.trim(),
    '记录单位': org,
  }
  // 行上的深度/净距始终跟着探查日期最新的记录走，历史记录原样留在探查记录里。
  let nextRow = row
  if (date >= String(row['探查日期'] ?? '')) {
    nextRow = {
      ...row,
      '探查日期': date,
      '埋设深度': record['埋设深度'],
      '与隧道净距': record['与隧道净距'],
    }
  }
  const nextRows = [...rows]
  nextRows[index] = nextRow
  saveAll({ [UTILITY_KEY]: nextRows, [surveyStorageKey()]: [...surveys, record] })
  return { ok: true, message: `探查记录已登记，${row['管线编号']} 最新读数按 ${date} 这份算` }
}

/** 未恢复管线：管线探查页与进度节点页都从这里取，两处数字必然对得上。 */
export function listUnrestoredPipelines(): EntryRow[] {
  return listRows(UTILITY_KEY).filter((row) => String(row.status) !== '已恢复')
}

export function countUnrestoredPipelines(): number {
  return listUnrestoredPipelines().length
}

/** 下拉选项从台账里收全，管线类型、权属单位有多少列多少。 */
export function listUtilityOptions(field: string): string[] {
  const values = new Set<string>()
  for (const row of listRows(UTILITY_KEY)) {
    const value = String(row[field] ?? '').trim()
    if (value) {
      values.add(value)
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 当前单位可切换的范围：项目部 + 台账里出现的权属单位 + 一个只读的外部单位。 */
export function listOrgOptions(): string[] {
  return [MANAGEMENT_ORG, ...listUtilityOptions('权属单位'), '监理单位']
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
