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

/** 管线探查结论：同一条管线重复递两次相同结论只记一次。 */
export type UtilitySurvey = {
  id: number
  utilityId: number
  surveyedAt: string
  pipelineType: string
  depthM: string
  diameter: string
  measuredClearanceM: string
  designedClearanceM: string
  owner: string
  needRelocation: boolean
  remark: string
  submittedBy: string
}

/** 迁改方案：只有管线的权属单位能提交，跨单位提交一律退回。 */
export type RelocationPlan = {
  id: number
  utilityId: number
  title: string
  content: string
  submittedBy: string
  owner: string
  submittedAt: string
}

/**
 * 进度节点上的迁改待办：由探查结论同步而来，是两处入口的唯一数据源。
 * recovered 为 false 即「未恢复管线」。
 */
export type RelocationTodo = {
  key: string
  utilityId: number
  pipelineNo: string
  pipelineType: string
  owner: string
  status: string
  clearanceM: number | null
  planTitle: string
  needRelocation: boolean
  updatedAt: string
}
