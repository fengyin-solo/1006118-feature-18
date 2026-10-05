import type { EntryRow } from './types'

// 存量管线迁移：老数据没有「探查日期」和探查记录，这里按探查日期补录——
// 已探查过的管线（非「待探查」或自带探查日期）补一条「存量补录」探查记录，
// 原来的文本数值原样保留在记录里，行上的深度/净距仍按最新探查记录取值。
const SURVEY_KEY = 'utility-survey'
const MIGRATION_BASE_DATE = '2026-08-10'

export type UtilityMigration = {
  rows: EntryRow[]
  surveys: EntryRow[]
  changed: boolean
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function backfillDate(index: number): string {
  // 以基准日起按条目顺延，保证同一批存量数据每次迁移得到的日期一致。
  const day = new Date(`${MIGRATION_BASE_DATE}T00:00:00`)
  day.setDate(day.getDate() + index)
  return day.toISOString().slice(0, 10)
}

export function migrateUtilityRows(rows: EntryRow[], surveys: EntryRow[]): UtilityMigration {
  const nextRows = rows.map((row) => ({ ...row }))
  const nextSurveys = surveys.map((row) => ({ ...row }))
  let changed = false
  let nextSurveyId = nextSurveys.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1

  nextRows.forEach((row, index) => {
    const id = Number(row.id)
    const surveyed = String(row.status) !== '待探查' || !isBlank(row['探查日期'])
    if (!surveyed) {
      return
    }
    if (isBlank(row['探查日期'])) {
      row['探查日期'] = backfillDate(index)
      changed = true
    }
    const hasSurvey = nextSurveys.some((survey) => Number(survey['管线id']) === id)
    const hasReadings = !isBlank(row['埋设深度']) || !isBlank(row['与隧道净距'])
    if (!hasSurvey && hasReadings) {
      nextSurveys.push({
        id: nextSurveyId,
        status: '已登记',
        pending: false,
        abnormal: false,
        '管线id': id,
        '管线编号': String(row['管线编号'] ?? ''),
        '探查日期': String(row['探查日期']),
        '埋设深度': String(row['埋设深度'] ?? ''),
        '与隧道净距': String(row['与隧道净距'] ?? ''),
        '结论': '存量补录',
        '记录单位': '项目部',
      })
      nextSurveyId += 1
      changed = true
    }
    // 顺手把 pending 标志对齐到「已恢复才算办结」的口径，看板与待办才读得一致。
    const shouldPending = String(row.status) !== '已恢复'
    if (Boolean(row.pending) !== shouldPending) {
      row.pending = shouldPending
      changed = true
    }
  })

  return { rows: nextRows, surveys: nextSurveys, changed }
}

export function surveyStorageKey(): string {
  return SURVEY_KEY
}
