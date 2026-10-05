<template>
  <section class="page" data-module="utility">
    <header class="page-head">
      <div>
        <h2>管线探查管理</h2>
        <p class="page-desc">
          按管线类型、权属单位筛选，按埋设深度、与隧道净距过滤；条件叠加取交集，翻页条件不丢。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地下管线</button>
        <button class="btn" type="button" @click="exportRows">导出管线探查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 四个进度一键切换；角标数始终按全量台账算，不受筛选影响 -->
    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        class="tab"
        :class="{ active: activeStatus === tab.value }"
        @click="switchStatus(tab.value)"
      >
        {{ tab.label }}
        <span class="tab-count">{{ tab.count }}</span>
      </button>
    </nav>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>管线编号/管径</span>
        <input v-model="form.keyword" placeholder="按编号或管径检索" />
      </label>
      <label class="filter-item">
        <span>管线类型</span>
        <select v-model="form.pipelineType">
          <option value="">全部类型</option>
          <option v-for="type in PIPELINE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="form.owner">
          <option value="">全部单位</option>
          <option v-for="owner in owners" :key="owner" :value="owner">{{ owner }}</option>
        </select>
      </label>
      <label class="filter-item range-item">
        <span>埋设深度（米）</span>
        <span class="range-inputs">
          <input v-model="form.depthMin" inputmode="decimal" placeholder="下限" />
          <em>至</em>
          <input v-model="form.depthMax" inputmode="decimal" placeholder="上限" />
        </span>
      </label>
      <label class="filter-item range-item">
        <span>与隧道净距（米）</span>
        <span class="range-inputs">
          <input v-model="form.clearanceMin" inputmode="decimal" placeholder="下限" />
          <em>至</em>
          <input v-model="form.clearanceMax" inputmode="decimal" placeholder="上限" />
        </span>
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 条件分项命中数：一条都没命中时，写清是哪一格没对上 -->
    <div v-if="criteria.length" class="criteria-row">
      <span
        v-for="criterion in criteria"
        :key="criterion.label"
        class="criterion-chip"
        :class="{ miss: criterion.matched === 0 }"
      >
        {{ criterion.label }}「{{ criterion.expected }}」命中 {{ criterion.matched }} 条
      </span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>管线编号</th>
          <th>管线类型</th>
          <th>埋设深度（米）</th>
          <th>管线管径</th>
          <th>与隧道净距（米）</th>
          <th>权属单位</th>
          <th>探查日期</th>
          <th>迁改方案</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pageRows" :key="String(row.id)">
          <td>
            <RouterLink class="link" :to="detailLink(row.id)">{{ row['管线编号'] }}</RouterLink>
          </td>
          <td>{{ row['管线类型'] }}</td>
          <td>{{ row['埋设深度'] }}</td>
          <td>{{ row['管线管径'] }}</td>
          <td>{{ formatClearance(row) }}</td>
          <td>{{ row['权属单位'] }}</td>
          <td>{{ row['探查日期'] || '—' }}</td>
          <td>{{ row['迁改方案'] === '—' ? '方案未提交' : row['迁改方案'] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待探查'"
              class="link"
              type="button"
              @click="openSurvey(row)"
            >
              提交探查
            </button>
            <button
              v-if="canArrange(row)"
              class="link"
              type="button"
              @click="runAction('安排迁改', row)"
            >
              安排迁改
            </button>
            <button
              v-if="String(row.status) === '迁改中'"
              class="link"
              type="button"
              @click="runAction('确认恢复', row)"
            >
              确认恢复
            </button>
            <RouterLink class="link" :to="detailLink(row.id)">详情/迁改方案</RouterLink>
          </td>
        </tr>
        <tr v-if="!pageRows.length">
          <td colspan="10" class="empty-state">
            <template v-if="total === 0">
              <p>当前条件下一条管线都没命中：</p>
              <ul v-if="noMatchReasons.length" class="miss-list">
                <li v-for="reason in noMatchReasons" :key="reason">{{ reason }}</li>
              </ul>
              <p v-else>台账里还没有管线探查记录，可先登记地下管线。</p>
            </template>
            <template v-else>这一页没有记录，请翻回前一页。</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pager">
      <span>共 {{ total }} 条管线探查记录，第 {{ page }} / {{ totalPages }} 页（每页 {{ pageSize }} 条，条件随翻页保留）</span>
      <span class="pager-actions">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button
          v-for="num in totalPages"
          :key="num"
          class="btn"
          type="button"
          :class="{ primary: num === page }"
          @click="goPage(num)"
        >
          {{ num }}
        </button>
        <button class="btn" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 提交探查结论 -->
    <div v-if="surveyTarget" class="modal-mask" @click.self="surveyTarget = null">
      <form class="modal" @submit.prevent="confirmSurvey">
        <h3>提交探查结论 · {{ surveyTarget['管线编号'] }}</h3>
        <p class="modal-tip">
          净距口径：优先取本次实测净距，未测时取设计净距；历史台账无两份时沿用历史值。
          同一条管线重复递相同结论只记一次。
        </p>
        <label class="modal-field">
          <span>探查日期</span>
          <input v-model="surveyForm.surveyedAt" type="date" required />
        </label>
        <label class="modal-field">
          <span>管线类型</span>
          <select v-model="surveyForm.pipelineType" required>
            <option v-for="type in PIPELINE_TYPES" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>埋设深度（米）</span>
          <input v-model="surveyForm.depthM" inputmode="decimal" required />
        </label>
        <label class="modal-field">
          <span>管线管径</span>
          <input v-model="surveyForm.diameter" />
        </label>
        <label class="modal-field">
          <span>实测净距（米）</span>
          <input v-model="surveyForm.measuredClearanceM" inputmode="decimal" />
        </label>
        <label class="modal-field">
          <span>设计净距（米）</span>
          <input v-model="surveyForm.designedClearanceM" inputmode="decimal" />
        </label>
        <label class="modal-field check-field">
          <input v-model="surveyForm.needRelocation" type="checkbox" />
          <span>探查结论：需要迁改（勾上才会进入进度节点的迁改待办）</span>
        </label>
        <label class="modal-field">
          <span>备注</span>
          <textarea v-model="surveyForm.remark" rows="2"></textarea>
        </label>
        <p v-if="surveyError" class="error-text">{{ surveyError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="surveyTarget = null">取消</button>
          <button class="btn primary" type="submit">确认提交</button>
        </div>
      </form>
    </div>

    <RelocationTodoPanel :key="'todo-' + todoVersion" :compact="true" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  advanceUtility,
  CONSTRUCTION_ORG,
  effectiveClearance,
  PIPELINE_TYPES,
  ownerOptions,
  queryUtilities,
  submitSurvey,
  unrecoveredCount,
  utilityStatusCounts,
  type UtilityQuery,
} from '@/api/utility-service'
import RelocationTodoPanel from '@/components/RelocationTodoPanel.vue'
import { useSessionStore } from '@/stores/session'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('utility')
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const owners = ownerOptions()

const pageSize = 5
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const criteria = ref<ReturnType<typeof queryUtilities>['criteria']>([])
const noMatchReasons = ref<string[]>([])

const form = reactive({
  keyword: '',
  pipelineType: '',
  owner: '',
  depthMin: '',
  depthMax: '',
  clearanceMin: '',
  clearanceMax: '',
})
const page = ref(1)
const todoVersion = ref(0)

const surveyTarget = ref<EntryRow | null>(null)
const surveyError = ref('')
const surveyForm = reactive({
  surveyedAt: '',
  pipelineType: '给水',
  depthM: '',
  diameter: '',
  measuredClearanceM: '',
  designedClearanceM: '',
  needRelocation: true,
  remark: '',
})

const activeStatus = computed(() => String(route.query.status ?? ''))

const statusCounts = ref(utilityStatusCounts())
const tabs = computed(() => [
  { label: '全部', value: '', count: statusCounts.value['全部'] ?? 0 },
  { label: '待探查', value: '待探查', count: statusCounts.value['待探查'] ?? 0 },
  { label: '已探明', value: '已探明', count: statusCounts.value['已探明'] ?? 0 },
  { label: '迁改中', value: '迁改中', count: statusCounts.value['迁改中'] ?? 0 },
  { label: '已恢复', value: '已恢复', count: statusCounts.value['已恢复'] ?? 0 },
])

const stats = computed(() => [
  { label: '待探查管线', value: statusCounts.value['待探查'] ?? 0 },
  { label: '迁改中管线', value: statusCounts.value['迁改中'] ?? 0 },
  { label: '已恢复管线', value: statusCounts.value['已恢复'] ?? 0 },
  { label: '未恢复管线（迁改待办）', value: unrecoveredCount() },
])

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const pageRows = computed(() =>
  rows.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)

function buildQuery(): UtilityQuery {
  return {
    keyword: form.keyword,
    pipelineType: form.pipelineType,
    owner: form.owner,
    status: activeStatus.value,
    depthMin: form.depthMin,
    depthMax: form.depthMax,
    clearanceMin: form.clearanceMin,
    clearanceMax: form.clearanceMax,
  }
}

function syncFormFromRoute() {
  form.keyword = String(route.query.keyword ?? '')
  form.pipelineType = String(route.query.pipelineType ?? '')
  form.owner = String(route.query.owner ?? '')
  form.depthMin = String(route.query.depthMin ?? '')
  form.depthMax = String(route.query.depthMax ?? '')
  form.clearanceMin = String(route.query.clearanceMin ?? '')
  form.clearanceMax = String(route.query.clearanceMax ?? '')
  page.value = Math.max(1, Number(route.query.page ?? 1) || 1)
}

function reload() {
  errorMessage.value = ''
  statusCounts.value = utilityStatusCounts()
  const payload = queryUtilities(buildQuery())
  rows.value = payload.items
  total.value = payload.total
  criteria.value = payload.criteria
  noMatchReasons.value = payload.noMatchReasons
  if (page.value > totalPages.value) {
    page.value = totalPages.value
  }
  // 台账一变，共用待办面板跟着按同一口径重取。
  todoVersion.value += 1
}

// 翻页、页签切换都走路由 query：刷新、浏览器后退、从详情返回，条件原样保留。
function pushRoute(nextPage: number) {
  const query: Record<string, string> = { page: String(nextPage) }
  if (form.keyword.trim()) {
    query.keyword = form.keyword.trim()
  }
  if (form.pipelineType) {
    query.pipelineType = form.pipelineType
  }
  if (form.owner) {
    query.owner = form.owner
  }
  if (form.depthMin.trim()) {
    query.depthMin = form.depthMin.trim()
  }
  if (form.depthMax.trim()) {
    query.depthMax = form.depthMax.trim()
  }
  if (form.clearanceMin.trim()) {
    query.clearanceMin = form.clearanceMin.trim()
  }
  if (form.clearanceMax.trim()) {
    query.clearanceMax = form.clearanceMax.trim()
  }
  if (activeStatus.value) {
    query.status = activeStatus.value
  }
  router.replace({ name: 'utility', query })
}

function applyFilters() {
  pushRoute(1)
}

function resetFilters() {
  Object.assign(form, {
    keyword: '',
    pipelineType: '',
    owner: '',
    depthMin: '',
    depthMax: '',
    clearanceMin: '',
    clearanceMax: '',
  })
  router.replace({ name: 'utility', query: { status: activeStatus.value, page: '1' } })
}

function switchStatus(status: string) {
  router.replace({
    name: 'utility',
    query: { ...cleanQuery(), status, page: '1' },
  })
}

function cleanQuery(): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of [
    'keyword',
    'pipelineType',
    'owner',
    'depthMin',
    'depthMax',
    'clearanceMin',
    'clearanceMax',
  ] as const) {
    const value = String(route.query[key] ?? '').trim()
    if (value) {
      picked[key] = value
    }
  }
  return picked
}

function goPage(num: number) {
  if (num < 1 || num > totalPages.value) {
    return
  }
  pushRoute(num)
}

function detailLink(id: number | string) {
  return {
    name: 'utility-detail',
    params: { id: String(id) },
    query: { ...route.query },
  }
}

function formatClearance(row: EntryRow): string {
  const value = effectiveClearance(row)
  return value === null ? '—' : String(value)
}

function canArrange(row: EntryRow): boolean {
  return ['已探明'].includes(String(row.status)) && Boolean(row.needRelocation)
}

function openCreate() {
  errorMessage.value = '地下管线登记入口尚未接入审批流'
}

function exportRows() {
  downloadEntries(meta.key)
}

function openSurvey(row: EntryRow) {
  if (session.org !== CONSTRUCTION_ORG) {
    errorMessage.value = `当前值班单位是「${session.org}」，探查结论只能由施工单位（${CONSTRUCTION_ORG}）提交，其它单位仅可查看`
    return
  }
  surveyTarget.value = row
  surveyError.value = ''
  Object.assign(surveyForm, {
    surveyedAt: new Date().toISOString().slice(0, 10),
    pipelineType: String(row['管线类型'] ?? '给水') || '给水',
    depthM: String(row['埋设深度'] ?? ''),
    diameter: String(row['管线管径'] ?? ''),
    measuredClearanceM: '',
    designedClearanceM: String(row['设计净距'] ?? ''),
    needRelocation: true,
    remark: '',
  })
}

function confirmSurvey() {
  if (!surveyTarget.value) {
    return
  }
  const result = submitSurvey(
    Number(surveyTarget.value.id),
    { ...surveyForm },
    session.org,
  )
  if (!result.ok) {
    surveyError.value = result.message
    return
  }
  surveyTarget.value = null
  errorMessage.value = ''
  reload()
}

function runAction(action: '安排迁改' | '确认恢复', row: EntryRow) {
  const result = advanceUtility(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
}

watch(
  () => route.query,
  () => {
    syncFormFromRoute()
    reload()
  },
)

onMounted(() => {
  syncFormFromRoute()
  reload()
})
</script>

<style scoped>
.tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}
.tab.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.tab-count {
  margin-left: 4px;
  font-size: 12px;
  opacity: 0.8;
}
.range-inputs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.range-inputs input {
  width: 72px;
}
.range-inputs em {
  font-style: normal;
  color: var(--muted);
}
.criteria-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.criterion-chip {
  font-size: 12px;
  background: #eef2f7;
  border-radius: 4px;
  padding: 2px 8px;
  color: #334155;
}
.criterion-chip.miss {
  background: #fee4e2;
  color: #b42318;
}
.miss-list {
  margin: 4px 0;
  padding-left: 20px;
  color: #b42318;
}
.pager {
  flex-wrap: wrap;
  gap: 8px;
}
.pager-actions {
  display: inline-flex;
  gap: 4px;
}
.pager-actions .btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 60px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal h3 {
  margin: 0 0 6px;
}
.modal-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted);
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
.modal-field input,
.modal-field select,
.modal-field textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
}
.check-field {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
