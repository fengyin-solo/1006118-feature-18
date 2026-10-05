<template>
  <section class="todo-panel">
    <header class="todo-head">
      <h3>迁改待办（探查结论同步）</h3>
      <span class="todo-count">
        {{ hasFilter ? '当前条件命中未恢复管线' : '未恢复管线' }} <strong>{{ total }}</strong> 条
      </span>
    </header>

    <form class="filter-bar todo-filters" @submit.prevent="emitSearch">
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="localOwner">
          <option value="">全部单位</option>
          <option v-for="owner in owners" :key="owner" :value="owner">{{ owner }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>管线类型</span>
        <select v-model="localType">
          <option value="">全部类型</option>
          <option v-for="type in PIPELINE_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>进度</span>
        <select v-model="localStatus">
          <option value="">全部未恢复</option>
          <option value="已探明">已探明</option>
          <option value="迁改中">迁改中</option>
        </select>
      </label>
      <label class="filter-item">
        <span>编号/管径</span>
        <input v-model="localKeyword" placeholder="按管线编号或管径检索" />
      </label>
      <button class="btn" type="submit">查询待办</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>管线编号</th>
          <th>管线类型</th>
          <th>权属单位</th>
          <th>当前进度</th>
          <th>与隧道净距（米）</th>
          <th>迁改方案</th>
          <th>探查日期</th>
          <th>明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todos" :key="todo.key">
          <td>{{ todo.pipelineNo }}</td>
          <td>{{ todo.pipelineType }}</td>
          <td>{{ todo.owner }}</td>
          <td>{{ todo.status }}</td>
          <td>{{ todo.clearanceM ?? '—' }}</td>
          <td>{{ todo.planTitle || '方案未提交' }}</td>
          <td>{{ todo.updatedAt || '—' }}</td>
          <td>
            <RouterLink class="link" :to="{ name: 'utility-detail', params: { id: todo.utilityId } }">
              查看迁改方案明细
            </RouterLink>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="8" class="empty-state">当前条件下没有未恢复的迁改待办</td>
        </tr>
      </tbody>
    </table>
    <p v-if="compact" class="todo-tip">
      这里与「管线探查」页共用同一份取数，两处的未恢复管线数始终一致：当前 {{ total }} 条。
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * 迁改待办面板：管线探查页与进度节点页挂的是同一个组件、同一份取数实现
 * （queryRelocationTodos -> queryUtilities），明细和未恢复管线数天然对齐。
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue'

import {
  PIPELINE_TYPES,
  ownerOptions,
  queryRelocationTodos,
} from '@/api/utility-service'
import type { RelocationTodo } from '@/data/types'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
void props

const todos = ref<RelocationTodo[]>([])
const total = ref(0)
const owners = ownerOptions()
const localOwner = ref('')
const localType = ref('')
const localStatus = ref('')
const localKeyword = ref('')

function load() {
  const payload = queryRelocationTodos({
    owner: localOwner.value,
    pipelineType: localType.value,
    status: localStatus.value,
    keyword: localKeyword.value,
  })
  todos.value = payload.items
  total.value = payload.total
}

const hasFilter = computed(
  () =>
    Boolean(localOwner.value) ||
    Boolean(localType.value) ||
    Boolean(localStatus.value) ||
    Boolean(localKeyword.value.trim()),
)

function emitSearch() {
  load()
}

// 下拉/页签变化即时重取；关键词保留在「查询待办」按钮触发。
watch([localOwner, localType, localStatus], load)
onMounted(load)
// 从详情页或其它模块切回来时按最新台账重取，两处读数始终对齐。
onActivated(load)

defineExpose({ reload: load })
</script>

<style scoped>
.todo-panel {
  margin-top: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.todo-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.todo-head h3 {
  margin: 0;
  font-size: 15px;
}
.todo-count {
  font-size: 12px;
  color: var(--muted);
}
.todo-count strong {
  color: #b42318;
  font-size: 15px;
}
.todo-filters {
  margin-bottom: 10px;
}
.todo-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
