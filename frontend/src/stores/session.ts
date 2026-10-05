import { defineStore } from 'pinia'

import {
  CONSTRUCTION_ORG,
  PIPELINE_OWNERS,
  SUPERVISION_ORG,
} from '@/api/utility-service'

// 可切换的值班身份：施工单位组织探查与迁改，权属单位只对自家管线递方案，监理只读。
export const ORG_OPTIONS = [CONSTRUCTION_ORG, ...PIPELINE_OWNERS, SUPERVISION_ORG]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    org: CONSTRUCTION_ORG,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOrg(org: string) {
      this.org = org
      // 切到权属单位值班时，值班人跟着换个称呼，便于台账留痕看得懂。
      if (org === CONSTRUCTION_ORG) {
        this.operator = '值班管理员'
      } else if (org === SUPERVISION_ORG) {
        this.operator = '现场监理'
      } else {
        this.operator = `${org}联络员`
      }
    },
  },
})
