<template>
  <section class="page" data-module="utility-detail">
    <header class="page-head">
      <div>
        <h2>管线详情 · 迁改方案</h2>
        <p class="page-desc">
          定位到的管线直接进这里看迁改方案；只有该管线的权属单位能提交方案，其它单位只读，跨单位改动一律退回。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="backLink">返回探查列表（条件原样保留）</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state">没有找到这条地下管线，可能已被重置回示例数据。</div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前进度</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">与隧道净距（米）</span>
          <strong class="stat-value">{{ clearanceText }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">净距按哪份算</span>
          <strong class="stat-value source-value">{{ clearanceText ? sourceLabel : '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前值班单位</span>
          <strong class="stat-value source-value">{{ session.org }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="item in baseFields" :key="item.label">
            <th>{{ item.label }}</th>
            <td>{{ item.value || '—' }}</td>
          </tr>
          <tr>
            <th>探查结论</th>
            <td>{{ row.needRelocation ? '需要迁改，已同步进度节点迁改待办' : '无需迁改' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="detail-actions">
        <button
          v-if="canArrange"
          class="btn primary"
          type="button"
          @click="runAction('安排迁改')"
        >
          安排迁改
        </button>
        <button
          v-if="String(row.status) === '迁改中'"
          class="btn primary"
          type="button"
          @click="runAction('确认恢复')"
        >
          确认恢复
        </button>
        <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">
          {{ actionMessage }}
        </span>
      </div>

      <section class="block">
        <h3>探查记录</h3>
        <p class="block-tip">净距以最新一条探查结论的实测值为准；没有实测值时取设计值；都没有时沿用历史台账。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>探查日期</th>
              <th>管线类型</th>
              <th>埋设深度（米）</th>
              <th>管径</th>
              <th>实测净距（米）</th>
              <th>设计净距（米）</th>
              <th>结论</th>
              <th>探查单位</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="survey in surveys" :key="survey.id">
              <td>{{ survey.surveyedAt }}</td>
              <td>{{ survey.pipelineType }}</td>
              <td>{{ survey.depthM }}</td>
              <td>{{ survey.diameter || '—' }}</td>
              <td>{{ survey.measuredClearanceM || '—' }}</td>
              <td>{{ survey.designedClearanceM || '—' }}</td>
              <td>{{ survey.needRelocation ? '需要迁改' : '无需迁改' }}</td>
              <td>{{ survey.submittedBy }}</td>
              <td>{{ survey.remark || '—' }}</td>
            </tr>
            <tr v-if="!surveys.length">
              <td colspan="9" class="empty-state">还没有探查结论，待探查管线先在列表页提交探查。</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h3>迁改方案</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>方案标题</th>
              <th>方案内容</th>
              <th>提交单位</th>
              <th>提交日期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id">
              <td>{{ plan.title }}</td>
              <td>{{ plan.content }}</td>
              <td>{{ plan.submittedBy }}</td>
              <td>{{ plan.submittedAt }}</td>
            </tr>
            <tr v-if="!plans.length">
              <td colspan="4" class="empty-state">
                权属单位尚未提交迁改方案{{ row.needRelocation ? '，这条管线仍挂在进度节点的迁改待办里' : '' }}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="submit-box">
          <template v-if="canSubmitPlan">
            <h4>提交迁改方案（{{ session.org }}）</h4>
            <form @submit.prevent="confirmPlan">
              <label class="modal-field">
                <span>方案标题</span>
                <input v-model="planForm.title" placeholder="如：管井悬吊保护迁改" />
              </label>
              <label class="modal-field">
                <span>方案内容</span>
                <textarea v-model="planForm.content" rows="3" placeholder="写清迁改路由、保护措施与恢复安排"></textarea>
              </label>
              <p v-if="planMessage" class="error-text">{{ planMessage }}</p>
              <button class="btn primary" type="submit">提交方案</button>
              <span class="block-tip">同一份方案重复递不会翻倍；校验不过半条都不落。</span>
            </form>
          </template>
          <p v-else class="block-tip permission-tip">
            当前值班单位「{{ session.org }}」无权提交：只有本管线权属单位「{{ row['权属单位'] }}」能提交迁改方案，其它单位仅可查看，跨单位提交一律退回。
          </p>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  advanceUtility,
  clearanceSource,
  effectiveClearance,
  isPipelineOwner,
  latestPlan,
  plansOf,
  submitRelocationPlan,
  surveysOf,
} from '@/api/utility-service'
import { useSessionStore } from '@/stores/session'
import { listRows } from '@/data/local-store'

const props = defineProps<{ id: string }>()
const route = useRoute()
const session = useSessionStore()

const row = ref(listRows('utility').find((item) => String(item.id) === props.id) ?? null)
const surveys = ref(surveysOf(Number(props.id)))
const plans = ref(plansOf(Number(props.id)))

const planForm = reactive({ title: '', content: '' })
const planMessage = ref('')
const actionMessage = ref('')
const actionOk = ref(false)

const clearanceValue = computed(() => (row.value ? effectiveClearance(row.value) : null))
const clearanceText = computed(() => (clearanceValue.value === null ? '—' : String(clearanceValue.value)))
const sourceLabel = computed(() => (row.value ? clearanceSource(row.value) : '—'))

const canArrange = computed(
  () => row.value !== null && String(row.value.status) === '已探明' && Boolean(row.value.needRelocation),
)
const canSubmitPlan = computed(
  () =>
    row.value !== null &&
    isPipelineOwner(session.org) &&
    session.org === String(row.value['权属单位'] ?? ''),
)

const baseFields = computed(() => {
  if (!row.value) {
    return []
  }
  return [
    { label: '管线编号', value: row.value['管线编号'] },
    { label: '管线类型', value: row.value['管线类型'] },
    { label: '埋设深度（米）', value: row.value['埋设深度'] },
    { label: '管线管径', value: row.value['管线管径'] },
    { label: '权属单位', value: row.value['权属单位'] },
    { label: '探查日期', value: row.value['探查日期'] },
    {
      label: '实测净距 / 设计净距（米）',
      value: `${String(row.value['实测净距'] || '未测')} / ${String(row.value['设计净距'] || '无')}`,
    },
    { label: '台账迁改方案', value: row.value['迁改方案'] },
  ]
})

const backLink = computed(() => ({
  name: 'utility',
  query: { ...route.query },
}))

function refresh() {
  row.value = listRows('utility').find((item) => String(item.id) === props.id) ?? null
  surveys.value = surveysOf(Number(props.id))
  plans.value = plansOf(Number(props.id))
}

function confirmPlan() {
  const result = submitRelocationPlan(Number(props.id), { ...planForm }, session.org)
  planMessage.value = result.message
  if (!result.ok) {
    return
  }
  planForm.title = ''
  planForm.content = ''
  refresh()
}

function runAction(action: '安排迁改' | '确认恢复') {
  const result = advanceUtility(Number(props.id), action)
  actionMessage.value = result.message
  actionOk.value = result.ok
  if (result.ok) {
    refresh()
  }
}

// 最新方案也能在历史表上面看到（已按时间倒序）。
watch(
  () => [row.value?.status, latestPlan(Number(props.id))?.id],
  () => refresh(),
)
</script>

<style scoped>
.source-value {
  font-size: 14px;
}
.detail-table th {
  width: 220px;
  background: #f8fafc;
}
.block {
  margin-top: 18px;
}
.block h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.block-tip {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}
.ok-text {
  color: #027a48;
  font-size: 13px;
}
.submit-box {
  margin-top: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fbfdff;
}
.submit-box h4 {
  margin: 0 0 8px;
  font-size: 14px;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 13px;
  max-width: 520px;
}
.modal-field input,
.modal-field textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
}
.permission-tip {
  margin: 0;
  padding: 6px 8px;
  background: #fef3f2;
  border-radius: 6px;
  color: #b42318;
}
</style>
