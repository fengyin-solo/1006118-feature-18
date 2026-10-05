# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `shield-tunnel-construction:entries` 这一项，或调用 `resetModule(模块)`。

## 管线探查的专项约定

管线探查（`utility`）在通用台账之外有一套领域服务：`frontend/src/api/utility-service.ts`。
管线探查页与进度节点页上的「迁改待办」挂的是同一个组件
（`frontend/src/components/RelocationTodoPanel.vue`）和同一份取数实现，两处读到的
未恢复管线数恒等。

- **查询**：管线类型、权属单位为下拉筛选（权属单位 = 标准目录 + 台账历史单位）；
  埋设深度、与隧道净距支持上下限过滤；条件叠加取交集。筛选条件与页码写在路由 query 里，
  翻页、进详情、浏览器后退都原样保留。零命中时按格列出没对上的条件。
- **净距口径**：以最新一条探查结论的实测净距为准，未测时取同条结论的设计净距，
  都没有时沿用历史台账值（兼容历史探查记录）。
- **进度**：待探查/已探明/迁改中/已恢复一键切换，角标数始终按全量台账统计。
- **权限**：顶栏可切换值班单位。迁改方案只有该管线的权属单位能提交，施工单位
  （中铁盾构项目部）负责探查结论与状态流转，监理只读；跨单位提交一律退回。
- **去重与原子性**：同一管线重复递相同探查结论/相同方案只记一次；先完成全部校验，
  再把行表、探查记录、方案、待办拼成整份库一次写入 localStorage，写不成不落半条。
- **存量迁移**：localStorage 带 schema 版本号（`shield-tunnel-construction:schema-version`），
  v1 老库首次打开按探查日期补录（基准日 2026-09-15），占位样例换成真实台账并补历史探查结论。

业务规则的命令行校验（纯 Node，无需浏览器）：

```bash
cd frontend
node scripts/run-verify.cjs       # 62 项取数/权限/去重/同步/原子性断言
node scripts/verify-migration.cjs # 17 项 v1 -> v2 存量迁移断言
```
