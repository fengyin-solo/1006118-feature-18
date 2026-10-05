/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 数值范围过滤：min/max 任一为空都表示那一头不卡。 */
export type RangeFilter = {
  min?: string
  max?: string
}

/**
 * 列表查询条件：文本包含、精确相等、数值范围、状态，全部叠加取交集；
 * page/size 缺省表示不分页（保持 listEntries 的旧行为）。
 */
export type EntryQuery = {
  filters?: Record<string, string>
  exact?: Record<string, string>
  ranges?: Record<string, RangeFilter>
  status?: string
  page?: number
  size?: number
}

/** 探查记录：一条管线可探查多次，埋设深度/与隧道净距以探查日期最新的一条为准。 */
export type SurveyRecord = {
  管线id: number
  管线编号: string
  探查日期: string
  埋设深度: string
  与隧道净距: string
  结论: string
  记录单位: string
}
