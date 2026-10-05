<template>
  <section class="page" data-module="utility">
    <header class="page-head">
      <div>
        <h2>管线探查管理</h2>
        <p class="page-desc">维护地下管线，围绕管线编号、管线类型、埋设深度、管线管径做登记、筛选与状态流转。</p>
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

    <div class="status-tabs">
      <button
        v-for="tab in statusTabs"
        :key="tab.label"
        class="tab-btn"
        :class="{ active: statusFilter === tab.status }"
        type="button"
        @click="switchStatus(tab.status)"
      >
        {{ tab.label }}（{{ tab.count }}）
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>管线编号</span>
        <input v-model="draft.code" placeholder="按管线编号检索" />
      </label>
      <label class="filter-item">
        <span>管线类型</span>
        <select v-model="draft.type">
          <option value="">全部类型</option>
          <option v-for="option in typeOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="draft.owner">
          <option value="">全部单位</option>
          <option v-for="option in ownerOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>埋设深度（米）</span>
        <span class="range-inputs">
          <input v-model="draft.depthMin" type="number" step="0.1" min="0" placeholder="最小" />
          <em>—</em>
          <input v-model="draft.depthMax" type="number" step="0.1" min="0" placeholder="最大" />
        </span>
      </label>
      <label class="filter-item">
        <span>与隧道净距（米）</span>
        <span class="range-inputs">
          <input v-model="draft.clearMin" type="number" step="0.1" min="0" placeholder="最小" />
          <em>—</em>
          <input v-model="draft.clearMax" type="number" step="0.1" min="0" placeholder="最大" />
        </span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <template v-if="missMessages.length">
              <p>一条管线都没命中，没对上的条件：</p>
              <p v-for="message in missMessages" :key="message" class="miss-line">{{ message }}</p>
            </template>
            <template v-else>暂无管线探查数据，可先登记地下管线</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线探查记录 · 未恢复 {{ unrestoredCount }} 条（与进度节点迁改待办同源）</span>
      <span class="pager">
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn ghost" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <select :value="size" @change="onSizeChange">
          <option v-for="option in [5, 10, 20]" :key="option" :value="option">每页 {{ option }} 条</option>
        </select>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  countUnrestoredPipelines,
  downloadEntries,
  explainEmptyQuery,
  listModuleRows,
  listUtilityOptions,
  moduleMeta,
  queryEntries,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryQuery, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('utility')
const columns = ["管线编号", "管线类型", "埋设深度", "管线管径", "与隧道净距", "权属单位", "迁改方案", "探查日期", "探查状态"]
const actions = ["提交探查", "安排迁改", "确认恢复"]
const statuses = ["待探查", "已探明", "迁改中", "已恢复"]

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(5)
const statusFilter = ref('')
const errorMessage = ref('')
const missMessages = ref<string[]>([])
const typeOptions = ref<string[]>([])
const ownerOptions = ref<string[]>([])
const allRowsSnapshot = ref<EntryRow[]>([])
const unrestoredCount = ref(0)

// 表单草稿：查询条件以 URL 为准，翻页、切状态、详情往返都丢不了。
const draft = reactive({
  code: '',
  type: '',
  owner: '',
  depthMin: '',
  depthMax: '',
  clearMin: '',
  clearMax: '',
})

const stats = computed(() => {
  const all = allRowsSnapshot.value
  return [
    ...statuses.map((status) => ({
      label: `${status}管线`,
      value: all.filter((row) => String(row.status) === status).length,
    })),
    { label: '未恢复管线', value: unrestoredCount.value },
  ]
})

const statusTabs = computed(() => {
  const all = allRowsSnapshot.value
  return [
    { label: '全部', status: '', count: all.length },
    ...statuses.map((status) => ({
      label: status,
      status,
      count: all.filter((row) => String(row.status) === status).length,
    })),
  ]
})

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function currentQuery(): EntryQuery {
  return {
    filters: draft.code.trim() ? { 管线编号: draft.code.trim() } : {},
    exact: {
      ...(draft.type ? { 管线类型: draft.type } : {}),
      ...(draft.owner ? { 权属单位: draft.owner } : {}),
    },
    ranges: {
      埋设深度: { min: draft.depthMin, max: draft.depthMax },
      与隧道净距: { min: draft.clearMin, max: draft.clearMax },
    },
    status: statusFilter.value || undefined,
    page: page.value,
    size: size.value,
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const query = currentQuery()
    const payload = queryEntries(meta.key, query)
    if (payload.page !== page.value) {
      // 页码超出范围被收敛时，地址栏一起改过来，翻页基准才一致。
      pushQuery({ page: payload.page })
      return
    }
    rows.value = payload.items
    total.value = payload.total
    allRowsSnapshot.value = listModuleRows(meta.key)
    unrestoredCount.value = countUnrestoredPipelines()
    missMessages.value = payload.items.length === 0 ? explainEmptyQuery(meta.key, query) : []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管线探查列表读取失败'
  }
}

function readQueryText(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

function syncFromRoute() {
  draft.code = readQueryText('code')
  draft.type = readQueryText('type')
  draft.owner = readQueryText('owner')
  draft.depthMin = readQueryText('depthMin')
  draft.depthMax = readQueryText('depthMax')
  draft.clearMin = readQueryText('clearMin')
  draft.clearMax = readQueryText('clearMax')
  statusFilter.value = readQueryText('status')
  page.value = Number(readQueryText('page')) || 1
  size.value = Number(readQueryText('size')) || 5
  typeOptions.value = listUtilityOptions('管线类型')
  ownerOptions.value = listUtilityOptions('权属单位')
  reload()
}

function pushQuery(patch: Record<string, string | number | undefined>) {
  const next: Record<string, string> = {}
  const merged = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue
    next[key] = String(value)
  }
  router.replace({ name: 'utility', query: next })
}

function applyFilters() {
  pushQuery({
    code: draft.code.trim() || undefined,
    type: draft.type || undefined,
    owner: draft.owner || undefined,
    depthMin: draft.depthMin || undefined,
    depthMax: draft.depthMax || undefined,
    clearMin: draft.clearMin || undefined,
    clearMax: draft.clearMax || undefined,
    page: 1,
  })
}

function resetFilters() {
  router.replace({ name: 'utility', query: {} })
}

function switchStatus(status: string) {
  pushQuery({ status: status || undefined, page: 1 })
}

function goPage(target: number) {
  pushQuery({ page: target })
}

function onSizeChange(event: Event) {
  pushQuery({ size: (event.target as HTMLSelectElement).value, page: 1 })
}

function openDetail(row: EntryRow) {
  // 把当前查询条件一起带过去，从详情返回时条件原样还在。
  router.push({ name: 'utility-detail', params: { id: Number(row.id) }, query: route.query })
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '地下管线登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.org)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

watch(() => route.query, syncFromRoute, { immediate: true, deep: true })
</script>
