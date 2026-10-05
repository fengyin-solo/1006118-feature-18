import { SEED_PLANS, SEED_ROWS, SEED_SURVEYS, SEED_TODOS } from './seed'
import type { EntryRow, RelocationPlan, RelocationTodo, UtilitySurvey } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
const VERSION_KEY = 'shield-tunnel-construction:schema-version'
const CURRENT_VERSION = 2

export type Database = {
  rows: Record<string, EntryRow[]>
  utilitySurveys: UtilitySurvey[]
  relocationPlans: RelocationPlan[]
  relocationTodos: RelocationTodo[]
}

// 管线探查补录时用的基准探查日期：存量记录没有探查日期，统一补到迁移日之前最近一次台账盘点。
const LEGACY_SURVEY_DATE = '2026-09-15'
const DEPTH_MATCH = /管线探查样例(\d+)/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toSeedDatabase(): Database {
  return {
    rows: clone(SEED_ROWS),
    utilitySurveys: clone(SEED_SURVEYS),
    relocationPlans: clone(SEED_PLANS),
    relocationTodos: clone(SEED_TODOS),
  }
}

/**
 * 存量管线按探查日期迁移补录（schema v1 -> v2）：
 * - 早期示例数据把各格写成了「管线探查样例N」，按编号换补成真实台账；
 * - 已探明/迁改中的存量管线补一条历史探查记录，净距沿用台账原值；
 * - 待探查管线只补探查日期，不臆造探查结论；
 * - 需要迁改的存量管线同步出迁改待办；
 * - 净距口径（实测优先、其次设计、再次台账原值）在数据层就固化下来。
 */
function migrateV1ToV2(raw: Record<string, EntryRow[]>): Database {
  const next = toSeedDatabase()
  const legacyRows = raw.utility ?? []
  const freshSeeds = new Map((next.rows.utility ?? []).map((row) => [Number(row.id), row]))

  const migratedUtility: EntryRow[] = []
  const legacyIds = new Set<number>()
  const surveys: UtilitySurvey[] = []
  const todos: RelocationTodo[] = []
  let surveyId = 0

  for (const legacy of legacyRows) {
    const legacyId = Number(legacy.id)
    legacyIds.add(legacyId)
    const isPlaceholder = DEPTH_MATCH.test(String(legacy['管线类型'] ?? ''))
    const seed = freshSeeds.get(legacyId)
    let row: EntryRow
    if (isPlaceholder && seed) {
      // 占位样例行：保留用户已经流转过的状态，其余格按真实种子补录。
      row = {
        ...seed,
        status: legacy.status,
        pending: legacy.pending,
        abnormal: legacy.abnormal,
      }
      // 状态与探查结论对齐：待探查不能背着「需要迁改」的结论，已探明不能没有探查日期。
      if (String(legacy.status) === '待探查') {
        row.needRelocation = false
        row['探查日期'] = ''
        row['实测净距'] = ''
        row['净距依据'] = '设计图纸'
      } else if (!String(row['探查日期'] ?? '').trim()) {
        row['探查日期'] = LEGACY_SURVEY_DATE
      }
    } else if (isPlaceholder) {
      row = legacy
    } else {
      // 用户真实登记的行：只补缺的格，绝不覆盖。
      row = { ...legacy }
      if (!String(row['探查日期'] ?? '').trim()) {
        row['探查日期'] = LEGACY_SURVEY_DATE
      }
      const clearance = String(row['与隧道净距'] ?? '').trim()
      if (clearance && Number.isNaN(Number(clearance)) === false) {
        if (!String(row['实测净距'] ?? '').trim()) {
          row['实测净距'] = clearance
          row['净距依据'] = '历史探查记录'
        }
      }
    }
    migratedUtility.push(row)

    // 已探明之后的存量管线，探查结论按迁移基准日补录一条。
    const explored = ['已探明', '迁改中', '已恢复'].includes(String(row.status))
    if (explored) {
      surveyId += 1
      const clearanceText = String(row['实测净距'] ?? row['与隧道净距'] ?? '').trim()
      const survey: UtilitySurvey = {
        id: surveyId,
        utilityId: legacyId,
        surveyedAt: String(row['探查日期'] ?? LEGACY_SURVEY_DATE),
        pipelineType: String(row['管线类型'] ?? ''),
        depthM: String(row['埋设深度'] ?? ''),
        diameter: String(row['管线管径'] ?? ''),
        measuredClearanceM:
          clearanceText && !Number.isNaN(Number(clearanceText)) ? clearanceText : '',
        designedClearanceM: '',
        owner: String(row['权属单位'] ?? ''),
        needRelocation: Boolean(row.needRelocation),
        remark: '存量管线迁移补录',
        submittedBy: '台账迁移',
      }
      surveys.push(survey)
    }
    if (Boolean(row.needRelocation) && String(row.status) !== '已恢复') {
      todos.push(buildLegacyTodo(row, LEGACY_SURVEY_DATE))
    }
  }

  // 旧台账没有、新种子里有的管线，按新行整笔补录（连同种子探查记录与待办）。
  for (const seed of next.rows.utility ?? []) {
    if (!legacyIds.has(Number(seed.id))) {
      migratedUtility.push(seed)
    }
  }
  migratedUtility.sort((a, b) => Number(a.id) - Number(b.id))
  for (const survey of next.utilitySurveys) {
    if (!legacyIds.has(Number(survey.utilityId))) {
      surveyId += 1
      surveys.push({ ...survey, id: surveyId })
    }
  }
  for (const todo of next.relocationTodos) {
    if (!legacyIds.has(Number(todo.utilityId))) {
      todos.push(todo)
    }
  }

  next.rows.utility = migratedUtility
  next.utilitySurveys = surveys.sort((a, b) => a.id - b.id)
  next.relocationTodos = todos
  // 其它模块沿用旧库里的行（含用户改动），种子里新增的模块字段不动。
  for (const [key, rows] of Object.entries(raw)) {
    if (key === 'utility') {
      continue
    }
    next.rows[key] = rows
  }
  return next
}

function buildLegacyTodo(row: EntryRow, updatedAt: string): RelocationTodo {
  const clearanceText = String(row['实测净距'] ?? row['与隧道净距'] ?? '').trim()
  return {
    key: `utility-${row.id}`,
    utilityId: Number(row.id),
    pipelineNo: String(row['管线编号'] ?? ''),
    pipelineType: String(row['管线类型'] ?? ''),
    owner: String(row['权属单位'] ?? ''),
    status: String(row.status),
    clearanceM: clearanceText && !Number.isNaN(Number(clearanceText)) ? Number(clearanceText) : null,
    planTitle: String(row['迁改方案'] ?? '').trim(),
    needRelocation: true,
    updatedAt,
  }
}

/** 与 utility-service 同一净距口径（本地内联一份，避免数据层反向依赖服务层）。 */
function resolveClearance(row: EntryRow, surveys: UtilitySurvey[]): number | null {
  const own = surveys
    .filter((item) => item.utilityId === Number(row.id))
    .sort((a, b) => (a.surveyedAt < b.surveyedAt ? 1 : -1))[0]
  const candidates = own
    ? [own.measuredClearanceM, own.designedClearanceM]
    : [String(row['实测净距'] ?? ''), String(row['设计净距'] ?? ''), String(row['与隧道净距'] ?? '')]
  for (const raw of candidates) {
    const text = String(raw ?? '').trim()
    if (text !== '' && !Number.isNaN(Number(text))) {
      return Number(text)
    }
  }
  return null
}

/**
 * 按探查结论重算整份迁改待办：读库时也跑一遍，保证「进度节点待办数」
 * 与「管线台账未恢复数」无论如何都对得上，且同一条管线只有一条待办。
 */
function reconcileTodos(db: Database): RelocationTodo[] {
  const todos: RelocationTodo[] = []
  for (const row of db.rows.utility ?? []) {
    if (!Boolean(row.needRelocation) || String(row.status) === '已恢复') {
      continue
    }
    const survey = db.utilitySurveys
      .filter((item) => item.utilityId === Number(row.id))
      .sort((a, b) => (a.surveyedAt < b.surveyedAt ? 1 : -1))[0]
    const plan = db.relocationPlans
      .filter((item) => item.utilityId === Number(row.id))
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))[0]
    const rowPlan = String(row['迁改方案'] ?? '').trim()
    todos.push({
      key: `utility-${row.id}`,
      utilityId: Number(row.id),
      pipelineNo: String(row['管线编号'] ?? ''),
      pipelineType: String(row['管线类型'] ?? ''),
      owner: String(row['权属单位'] ?? ''),
      status: String(row.status),
      clearanceM: resolveClearance(row, db.utilitySurveys),
      planTitle: plan?.title ?? (rowPlan === '—' ? '' : rowPlan),
      needRelocation: true,
      updatedAt: survey?.surveyedAt ?? String(row['探查日期'] ?? ''),
    })
  }
  return todos.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

function readStorage(): Database {
  const fallback = reconcile(toSeedDatabase())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    let db: Database
    if (version < 2) {
      // 老库只有行表，按探查日期迁移补录后整体落库（只写一次）。
      db = migrateV1ToV2(parsed as Record<string, EntryRow[]>)
    } else {
      db = normalizeDatabase(parsed)
    }
    const reconciled = reconcile(db)
    if (JSON.stringify(reconciled.relocationTodos) !== JSON.stringify(db.relocationTodos)) {
      persist(reconciled)
    }
    return reconciled
  } catch {
    persist(fallback)
    return fallback
  }
}

/** 读出的库统一按台账口径校准一次迁改待办，两处未恢复数恒等。 */
function reconcile(db: Database): Database {
  return { ...db, relocationTodos: reconcileTodos(db) }
}

/** 供领域服务在写完台账后按同一口径重建待办。 */
export function rebuildTodoSlice(db: Database): RelocationTodo[] {
  return reconcileTodos(db)
}

function normalizeDatabase(parsed: Record<string, unknown>): Database {
  const seed = toSeedDatabase()
  const rowMap = (parsed.rows ?? parsed) as Record<string, EntryRow[]>
  return {
    rows: { ...seed.rows, ...rowMap },
    utilitySurveys: Array.isArray(parsed.utilitySurveys)
      ? (parsed.utilitySurveys as UtilitySurvey[])
      : [],
    relocationPlans: Array.isArray(parsed.relocationPlans)
      ? (parsed.relocationPlans as RelocationPlan[])
      : [],
    relocationTodos: Array.isArray(parsed.relocationTodos)
      ? (parsed.relocationTodos as RelocationTodo[])
      : [],
  }
}

function persist(db: Database): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
  }
}

let cache: Database | null = null

/** 供领域服务读取整份库（含探查记录、方案、待办等分片）。 */
export function database(): Database {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return database().rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const db = database()
  commit({ ...db, rows: { ...db.rows, [key]: rows } })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function getSurveys(): UtilitySurvey[] {
  return database().utilitySurveys
}

export function getPlans(): RelocationPlan[] {
  return database().relocationPlans
}

export function getTodos(): RelocationTodo[] {
  return database().relocationTodos
}

/**
 * 原子提交：先在内存里拼好整份新库，再一次性落 localStorage。
 * 任何一次写操作要么整份生效，要么半条都不落。
 */
export function commit(next: Database): void {
  cache = next
  persist(next)
}

export function storageKey(): string {
  return STORAGE_KEY
}
