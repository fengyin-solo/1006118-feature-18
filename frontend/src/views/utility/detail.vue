<template>
  <section class="page" data-module="utility-detail">
    <header class="page-head">
      <div>
        <h2>管线详情 {{ row ? String(row['管线编号']) : '' }}</h2>
        <p class="page-desc">埋设深度与与隧道净距以探查日期最新的探查记录为准，历史记录原样保留。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回管线探查列表</button>
      </div>
    </header>

    <template v-if="row">
      <div class="detail-grid">
        <div v-for="column in columns" :key="column" class="detail-item">
          <span class="detail-label">{{ column }}</span>
          <strong class="detail-value">{{ displayCell(column) }}</strong>
        </div>
        <div class="detail-item">
          <span class="detail-label">当前状态</span>
          <strong class="detail-value">{{ row.status }}</strong>
        </div>
      </div>

      <section class="panel">
        <h3 class="panel-title">迁改方案</h3>
        <p class="panel-desc">只有权属单位「{{ row['权属单位'] }}」能提交迁改方案，当前单位「{{ store.org }}」。</p>
        <p class="plan-text">{{ String(row['迁改方案'] || '尚未登记迁改方案') }}</p>
        <template v-if="canSubmitPlan">
          <textarea v-model="planText" class="plan-input" rows="3" placeholder="填写迁改方案，提交后登记到这条管线"></textarea>
          <button class="btn primary" type="button" @click="submitPlan">提交迁改方案</button>
        </template>
        <p v-else class="hint-text">当前单位只能查看，跨单位的改动一律退回。</p>
      </section>

      <section class="panel">
        <h3 class="panel-title">探查记录</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>探查日期</th>
              <th>埋设深度（米）</th>
              <th>与隧道净距（米）</th>
              <th>结论</th>
              <th>记录单位</th>
              <th>取值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="survey in surveys" :key="String(survey.id)">
              <td>{{ survey['探查日期'] }}</td>
              <td>{{ survey['埋设深度'] }}</td>
              <td>{{ survey['与隧道净距'] }}</td>
              <td>{{ survey['结论'] }}</td>
              <td>{{ survey['记录单位'] }}</td>
              <td>{{ isLatest(survey) ? '最新取值' : '历史记录' }}</td>
            </tr>
            <tr v-if="!surveys.length">
              <td colspan="6" class="empty-state">暂无探查记录，列表读数为台账资料值</td>
            </tr>
          </tbody>
        </table>
        <template v-if="canRecord">
          <form class="survey-form" @submit.prevent="submitSurvey">
            <label class="filter-item">
              <span>探查日期</span>
              <input v-model="surveyDraft.探查日期" type="date" required />
            </label>
            <label class="filter-item">
              <span>埋设深度（米）</span>
              <input v-model="surveyDraft.埋设深度" type="number" step="0.1" min="0" required />
            </label>
            <label class="filter-item">
              <span>与隧道净距（米）</span>
              <input v-model="surveyDraft.与隧道净距" type="number" step="0.1" min="0" required />
            </label>
            <label class="filter-item">
              <span>结论</span>
              <input v-model="surveyDraft.结论" placeholder="探查结论" />
            </label>
            <button class="btn" type="submit">登记探查记录</button>
          </form>
        </template>
        <p v-else class="hint-text">探查记录由项目部或权属单位登记，当前单位只能查看。</p>
      </section>
    </template>

    <p v-else class="empty-state">没有找到这条地下管线，可能已被清理。</p>

    <footer class="page-foot">
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  MANAGEMENT_ORG,
  getEntry,
  listSurveys,
  recordSurvey,
  submitRelocationPlan,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const columns = ["管线编号", "管线类型", "埋设深度", "管线管径", "与隧道净距", "权属单位", "迁改方案", "探查日期", "探查状态"]

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const row = ref<EntryRow | undefined>(undefined)
const surveys = ref<EntryRow[]>([])
const planText = ref('')
const noticeMessage = ref('')
const errorMessage = ref('')
const surveyDraft = reactive({ 探查日期: '', 埋设深度: '', 与隧道净距: '', 结论: '' })

const pipelineId = computed(() => Number(route.params.id))

const canSubmitPlan = computed(
  () => row.value !== undefined && String(row.value['权属单位']) === store.org,
)
const canRecord = computed(
  () =>
    row.value !== undefined &&
    (store.org === MANAGEMENT_ORG || String(row.value['权属单位']) === store.org),
)

function displayCell(column: string): string {
  const value = row.value?.[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function isLatest(survey: EntryRow): boolean {
  return String(survey['探查日期']) === String(row.value?.['探查日期'] ?? '')
}

function reload() {
  row.value = getEntry('utility', pipelineId.value)
  surveys.value = row.value ? listSurveys(pipelineId.value) : []
  planText.value = String(row.value?.['迁改方案'] ?? '')
}

function goBack() {
  // 列表条件放在 query 里带过来的，原样带回去。
  router.push({ name: 'utility', query: route.query })
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
    reload()
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function submitPlan() {
  showResult(submitRelocationPlan(pipelineId.value, planText.value, store.org))
}

function submitSurvey() {
  showResult(
    recordSurvey(
      pipelineId.value,
      {
        管线id: pipelineId.value,
        管线编号: String(row.value?.['管线编号'] ?? ''),
        探查日期: surveyDraft.探查日期,
        埋设深度: surveyDraft.埋设深度,
        与隧道净距: surveyDraft.与隧道净距,
        结论: surveyDraft.结论,
        记录单位: store.org,
      },
      store.org,
    ),
  )
  surveyDraft.探查日期 = ''
  surveyDraft.埋设深度 = ''
  surveyDraft.与隧道净距 = ''
  surveyDraft.结论 = ''
}

watch(pipelineId, reload, { immediate: true })
</script>
