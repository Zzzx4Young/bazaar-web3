# Changelog

记录 crypto-c2c/ 的结构性变更。文档内容的实质修改请直接进对应 .md 看 git diff / 顶部日期。

## 2026-07-31 — Frontend 最小可启动项目落地（5 路由 + build 通过）

**触发**：用户回答 Q1=B + Q4=shadcn/ui，并授权执行 `npm install` 与"写最小可启动首页"。

**执行**：

1. `npm install` —— 551 包，422 MB，1 分钟完成
2. 创建 7 个源码文件：
   - `src/app/layout.tsx` —— 根布局 + metadata + 顶栏 nav + 底部 footer
   - `src/app/page.tsx` —— 首页（占位 + 4 页面导航卡片 + 下一阶段说明）
   - `src/app/explore/page.tsx` —— 探索占位
   - `src/app/publish/page.tsx` —— 发布占位
   - `src/app/me/page.tsx` —— 我的占位
   - `src/app/globals.css` —— Tailwind 入口 + shadcn 主题变量（light + dark）
   - `src/lib/utils.ts` —— shadcn 标准 `cn()` helper

**Verification（实跑）**：

```
$ npx tsc --noEmit              → exit=0 (0 TS errors)
$ npx next lint                 → exit=0 (✔ No ESLint warnings or errors)
$ npx next build                → exit=0
  ✓ Compiled successfully
  ✓ Generating static pages (7/7)
  Route (app)                  Size     First Load JS
  ┌ ○ /                        150 B    87.4 kB
  ├ ○ /_not-found              873 B    88.1 kB
  ├ ○ /explore                 150 B    87.4 kB
  ├ ○ /me                      150 B    87.4 kB
  └ ○ /publish                 150 B    87.4 kB
```

**Q1 / Q4 决策落档**：

- Q1 = **B**：旧 `mvp-spec.md` / `mvp-tickets.md` / `problem.md` 不动，本路线是"前端原型 demo"
- Q4 = **shadcn/ui**（已通过 Tailwind 主题变量与 `cn()` helper 落地基础设施）

**严格未做**：

- ❌ 没装 shadcn 实际组件（Button / Card / Dialog 等）—— 待下轮
- ❌ 没创建 mock 数据 JSON / TS 类型定义 / Zustand stores
- ❌ 没动 mvp-spec.md / mvp-tickets.md / problem.md / 任何 frozen doc

**目录当前状态**：

```
crypto-c2c/
├── README.md
├── frontend/                              ← ★ 落地 17 个文件
│   ├── README.md
│   ├── package.json / package-lock.json (422M node_modules)
│   ├── tsconfig.json / next.config.mjs / tailwind.config.ts
│   ├── postcss.config.mjs / components.json / .eslintrc.json / .prettierrc / .gitignore
│   └── src/                               ← ★ 新增源码
│       ├── app/
│       │   ├── layout.tsx                 ← ★ 根布局
│       │   ├── page.tsx                   ← ★ 首页
│       │   ├── globals.css                ← ★ Tailwind 入口
│       │   ├── explore/page.tsx           ← ★ 探索占位
│       │   ├── publish/page.tsx           ← ★ 发布占位
│       │   └── me/page.tsx                ← ★ 我的占位
│       └── lib/
│           └── utils.ts                   ← ★ cn() helper
└── docs/
    ├── 00-project-flow.md
    ├── mvp-spec.md                        ← 未动
    ├── mvp-tickets.md                     ← 未动
    ├── problem.md                         ← 未动
    ├── frontend-prototype-roadmap.md      ← 未动
    ├── frontend-stack-recommendation.md   ← 未动
    ├── mock-data-spec.md                  ← 未动
    ├── CHANGELOG.md
    └── 01-10*.md                          ← frozen
```

---

## 2026-07-31 — Frontend 配置文件落地（10 个文件，0 依赖）

**触发**：用户回复"继续"。

**新增**（10 个配置文件，0 依赖、0 源码）：

```
frontend/
├── README.md                (1.7 KB)   ← 已存在，本轮更新
├── package.json             (1.7 KB)   ← ★ 新增：25 项依赖 + 5 个 scripts
├── tsconfig.json            (670 B)    ← ★ 新增：strict + @/* path alias + noUncheckedIndexedAccess
├── next.config.mjs          (328 B)    ← ★ 新增：图片白名单（placehold.co / picsum / dicebear）
├── tailwind.config.ts       (2.1 KB)   ← ★ 新增：shadcn 主题 + container + 动画
├── postcss.config.mjs       (77 B)     ← ★ 新增：tailwind + autoprefixer
├── components.json          (418 B)    ← ★ 新增：shadcn/ui CLI 配置
├── .eslintrc.json           (140 B)    ← ★ 新增：next/core-web-vitals
├── .prettierrc              (153 B)    ← ★ 新增：无分号 + 尾逗号 none
└── .gitignore               (340 B)    ← ★ 新增：标准 Next.js
```

**package.json 关键依赖**（25 项）：

- **运行时**（17 项）：next ^14.2 / react ^18.3 / zustand ^4.5 / react-hook-form ^7.51 / zod ^3.23 / react-markdown ^9 / remark-gfm / embla-carousel-react / dayjs / clsx / tailwind-merge / lucide-react / class-variance-authority / sonner / @radix-ui/react-{slot,dialog,tabs,slider,label,select,avatar,separator,toast}
- **开发**（8 项）：@types/{node,react,react-dom} / typescript ^5.4 / tailwindcss ^3.4 / postcss / autoprefixer / tailwindcss-animate / eslint / eslint-config-next / prettier / prettier-plugin-tailwindcss

**严格未做**：

- ❌ 没装任何依赖（无 `node_modules` / 无 `pnpm-lock.yaml`）
- ❌ 没创建 `src/` 目录
- ❌ 没创建任何 `.ts` / `.tsx` 源码
- ❌ 没执行 `pnpm install` / `pnpm dev`
- ❌ 没动 mvp-spec.md / mvp-tickets.md / problem.md / 任何 frozen doc / 任何 docs/

**验证**：

```
$ ls frontend/  # 10 个文件
$ [ -d frontend/node_modules ] && echo YES || echo NO  # NO ✓
```

**继续推进需要**（不替你拍）：

- 用户二次确认"开始装依赖" → 执行 `pnpm install`
- 或用户先拍 Q1 / Q4 → 再执行

**目录当前状态**：

```
crypto-c2c/
├── README.md
├── frontend/                              ← ★ 新增 10 个配置文件
│   ├── README.md
│   ├── package.json / tsconfig.json / next.config.mjs / tailwind.config.ts
│   ├── postcss.config.mjs / components.json / .eslintrc.json / .prettierrc / .gitignore
└── docs/
    ├── 00-project-flow.md
    ├── mvp-spec.md                        ← 未动
    ├── mvp-tickets.md                     ← 未动
    ├── problem.md                         ← 未动
    ├── frontend-prototype-roadmap.md      ← 未动
    ├── frontend-stack-recommendation.md   ← 未动
    ├── mock-data-spec.md                  ← 未动
    ├── CHANGELOG.md
    └── 01-10*.md                          ← frozen（未动）
```

---

## 2026-07-31 — Standing goal 推进：mock 数据 + 技术选型 + 工程占位

**触发**：用户回复"Q1 Next.js / React · 继续"。

**解读**：

- 用户明确给 Q3 答案：**Next.js / React**
- Q1 字面是策略决策（A/B/C），但消息格式像回答 Q3，"继续"指明要求推进
- Q4 未答，按之前推荐默认采用 **shadcn/ui**
- Q1 未答 → **默认走 B（保留旧 spec，最不可逆 = 最安全）**，等用户回 A/B/C 后可 30 秒调整

**新增**：

1. `docs/mock-data-spec.md`（13.1 KB）—— 25 条商品 + 6 个卖家 + 12 条订单 + 5 个 banner 的完整 TS schema 草案，分布：电子数码 5 物理、数字资产 5 数字、源码 5 数字、游戏 5 数字、服饰 5 物理。媒体用 placehold.co / picsum.photos 公开占位服务，**不接 S3**。
2. `docs/frontend-stack-recommendation.md`（9.5 KB）—— Next.js 14 + Tailwind + shadcn/ui + Zustand + React Hook Form + Zod 完整选型表：15 项依赖 + 版本锁定 + 目录结构 + 配置文件草案 + 响应式断点 + SEO 基础。
3. `frontend/README.md`（1.7 KB）—— 占位目录说明文档，列出启动条件（Q1 + Q4 拍板）+ 启动命令 + 完整目录预览。
4. `frontend/` 子目录占位（**仅 README.md，无源码 / 无配置 / 无依赖**）。

**Q1 默认决策（B = 保留旧 spec）**：

- 旧 `mvp-spec.md` / `mvp-tickets.md` / `problem.md` **不动**
- 旧 spec 是"产品终局参考"，本路线是"前端原型 demo"，并存
- 用户回 A（作废）= 我 `git mv` 3 份到 `docs/archive/`，改 problem.md 状态为 `[!]`
- 用户回 C（并存）= 在 README 加双 spec 导航表

**CHANGELOG / README 更新**：

- `README.md` 活跃表加 2 行（frontend-stack-recommendation / mock-data-spec），新增"🛠️ 工程占位"小节
- `docs/CHANGELOG.md` 加本条目

**严格未做（按纪律）**：

- ❌ 没装任何依赖（无 `node_modules` / 无 `pnpm-lock.yaml`）
- ❌ 没创建 `src/` / `app/` / `components/` 等源码目录
- ❌ 没执行 `npm init` / `pnpm init` / `next create`
- ❌ 没动 mvp-spec.md / mvp-tickets.md / problem.md / 任何 frozen doc
- ❌ 没动 frontend-prototype-roadmap.md（仍是 v0.1 草稿）

**目录当前状态**：

```
crypto-c2c/
├── README.md                              ← 入口
├── frontend/                              ← ★ 新增占位目录（仅 README.md）
│   └── README.md
└── docs/
    ├── 00-project-flow.md
    ├── mvp-spec.md                        ← 不动（Q1 默认 B = 保留）
    ├── mvp-tickets.md                     ← 不动
    ├── problem.md                         ← 不动
    ├── frontend-prototype-roadmap.md      ← v0.1
    ├── frontend-stack-recommendation.md   ← ★ 新增
    ├── mock-data-spec.md                  ← ★ 新增
    ├── CHANGELOG.md
    └── 01-10*.md                          ← frozen（不动）
```

---

## 2026-07-31 — Standing goal 落档（纯前端原型路线）

**触发**：用户发送 standing goal "构建 C2C 交易平台基础展示与交互原型"4 阶段规划，指令"Continue working toward this goal"。

**新增**：

- `docs/frontend-prototype-roadmap.md`（15.2 KB）—— 完整落档用户 standing goal：
  - §0 摘要：0 后端 / 0 合约 / 0 真钱包，纯前端 UI + Mock
  - §1 用户 standing goal 4 阶段原文
  - §2 与 mvp-spec.md 差异表（关键决策点）
  - §3 阶段一：技术栈选型 + Q3/Q4 我的建议
  - §4 阶段二：5 个核心类型 schema 草案（Item / Seller / Order / Categories / User）
  - §5 阶段三：路由表 + shadcn/ui 组件清单
  - §6 阶段四：Mock 数据策略 + Zustand stores + 响应式断点
  - §7 待决策项：Q1（spec 处置）/ Q3（Next.js vs Nuxt.js）/ Q4（shadcn/ui vs Ant Design）
  - §8 与 problem.md 10 条衔接（标记各问题在本路线下"完全失效"/"降级"/"保留"）
- `README.md` 活跃表加一行 `frontend-prototype-roadmap.md`

**关键决策（未拍板，等用户回答）**：

- **Q1**：A 作废旧 spec / B 保留旧 spec / C 并存
- **Q3**：Next.js（推荐）/ Nuxt.js
- **Q4**：shadcn/ui（推荐）/ Ant Design

**未做**（严格按"不破坏现状"原则）：

- ❌ 没动 `mvp-spec.md` / `mvp-tickets.md` / `problem.md`
- ❌ 没创建任何源码目录（`packages/` / `frontend/` / `src/`）
- ❌ 没装任何依赖、没写任何代码
- ❌ 没启动 npm/pnpm init
- ❌ Q1 没拍板前不动 problem.md（§8 的处置待 Q1 后再做）

**目录当前状态**：

```
crypto-c2c/
├── README.md                          ← 入口（活跃）
└── docs/
    ├── 00-project-flow.md                 ← 流程总览
    ├── mvp-spec.md                        ← 缩减版 A spec（活跃 · 待 review）
    ├── mvp-tickets.md                     ← 20 ticket（活跃 · 待 review）
    ├── problem.md                         ← 10 条问题（活跃 · 待决策）
    ├── frontend-prototype-roadmap.md      ← 纯前端原型路线 ★ 新增（待 Q1/Q3/Q4 拍板）
    ├── CHANGELOG.md                       ← 变更日志
    └── 01-10*.md                          ← frozen（10 份）
```

---

## 2026-07-31 — 文档迁移到 docs/ + cross-ref 修复

**触发**：用户在 Windows 端手动将 14 个 .md（除 README）放入 `crypto-c2c/docs/` 子目录。

**改动**：

1. **README.md** —— 14 处相对路径链接全部加上 `docs/` 前缀：
   - 活跃表 4 行（00-project-flow / mvp-spec / mvp-tickets / problem）
   - 冻结表 10 行（01-10）
   - §"当前执行路线"块 2 行（mvp-spec / mvp-tickets）
   - §文档结构 标题下加一行说明"所有项目文档位于 docs/"
2. **docs/problem.md** —— 1 处链接修正：
   - line 6 关联文档 `[README.md](./README.md)` → `[README.md](../README.md)`（从 docs/ 视角，README 在父目录）
   - 其余 12 处 `[mvp-*.md](./mvp-*.md)` **不动**（同目录，相对路径仍有效）

**验证**：

- 全文档 grep `](./0X-`、`](./mvp-`、`](./problem.md`、`](./README.md` —— README 全部已加 `docs/` 前缀；problem.md 唯一 stale README 链接已修；其余合法同目录链接保留
- 全文档相对路径链接全量扫：0 条 broken

**未做**：

- ❌ 没移动 README.md 进 docs/（按用户决策，保持 README 在根目录作为入口）
- ❌ CHANGELOG 不进 README 文档结构表（按用户决策，保持它为审计副产物）
- ❌ 没改任何 .md 的实质内容（problem.md / spec / tickets 一字未动）

**目录当前状态**：

```
crypto-c2c/
├── README.md               ← 入口（活跃）· 所有相对路径已更新到 docs/
└── docs/
    ├── 00-project-flow.md      ← 流程总览（活跃）
    ├── mvp-spec.md             ← 缩减版 A spec（活跃 · 待 review）
    ├── mvp-tickets.md          ← 20 张 ticket（活跃 · 待 review）
    ├── problem.md              ← 待 review 10 条（活跃 · 待决策）
    ├── CHANGELOG.md            ← 变更日志（本文件）
    └── 01-10*.md               ← frozen（10 份）
```

---

## 2026-07-31 — Problem log 新增

**触发**：用户说"这些待 review 的问题先记录到 problem.md 文档"。

**新增**：

- `problem.md`（10.3 KB）—— 10 条 review findings（4 blocker + 6 yellow）落档。
  - §0 Tracker 一张表，10 条按等级升序
  - §1 Blocker：P1（Safe 单点）/ P2（数字超时归谁）/ P4（S3 key 矛盾）—— 每条给"方案 A/B/C"备选 + 改动影响
  - §2 Yellow：P3 / P5 / P6 / P7 / P8 / P9 / P10 —— 每条给具体待决策项
  - §3 已废弃（空）
  - §4 元规则：决策不能只放在 problem.md，必须同步改源文档
- `README.md` 活跃表加 problem.md 一行

**未做**：

- ❌ 没改 spec / tickets 任何实质内容（按用户指令"先记录"）
- ❌ P1/P2/P4 决策未拍板，文档状态全是 `[ ]`

**目录当前状态**：

```
crypto-c2c/
├── README.md               ← 入口（活跃）
├── 00-project-flow.md      ← 流程总览（活跃）
├── mvp-spec.md             ← 缩减版 A spec（活跃 · 待 review）
├── mvp-tickets.md          ← 20 张 ticket（活跃 · 待 review）
├── problem.md              ← 待 review 问题清单（活跃 · 待决策）★ 新增
├── CHANGELOG.md            ← 变更日志
└── 01-10*.md               ← frozen（未移动）
```

---

## 2026-07-31 — 目录结构整理（仅结构，不改内容）

**触发**：用户说"将当前工作目录 crypto-c2c 整理一下"，选 A1（只动结构，不改 spec/tickets 内容）。

**改动**：

1. `README.md` §文档结构 拆成两组：
   - 🚀 **当前活跃**：README + 00-project-flow + mvp-spec + mvp-tickets
   - 🗄️ **已冻结**（标 frozen 理由）：01–10 旧 docs
2. 旧 docs 没有移动 / 重命名 / 删除 —— 文件路径不变，所有外链不破。
3. 没改任何 .md 内容。review findings（4 blocker + 6 yellow）未落入文档 —— 等用户拍板 B1 / B2 后再动 spec。

**未做**（用户没要）：

- ❌ 移动旧 docs 到 `archive/feasibility-2026-07-28/` 子目录（那是 A2）
- ❌ 整合 mvp-spec + mvp-tickets 成单文档（那是 A3）
- ❌ 修复 review 发现的 4 个 blocker（B1 Safe 标红 / B2 数字超时归买家 / B3 边界 case / B4 S3 key 命名）
- ❌ 落档 review findings（10 条 → notes/）

**目录当前状态**：

```
crypto-c2c/
├── README.md               ← 入口（活跃）
├── 00-project-flow.md      ← 流程总览（活跃）
├── mvp-spec.md             ← 缩减版 A spec（活跃 · 待 review）
├── mvp-tickets.md          ← 20 张 ticket（活跃 · 待 review）
├── CHANGELOG.md            ← 本文件
├── 01-product-overview.md  ← frozen（存档）
├── 02-market-analysis.md   ← frozen
├── 03-compliance.md        ← frozen
├── 04-architecture.md      ← frozen（Phase 2/3 子集）
├── 05-payment-flow.md      ← frozen（工厂模式/多签/多币种）
├── 06-tech-stack.md        ← frozen
├── 07-mvp-roadmap.md       ← frozen（旧 Phase 0–3 路线）
├── 08-revenue-model.md     ← frozen
├── 09-risks.md             ← frozen
└── 10-references.md        ← frozen
```

**验证**：

```
$ wc -l *.md
   138 README.md              (+19 行)
   196 00-project-flow.md
   308 mvp-spec.md
   377 mvp-tickets.md
    33 CHANGELOG.md           (新)
   180 01-product-overview.md
   363 02-market-analysis.md
   202 03-compliance.md
   454 04-architecture.md
   578 05-payment-flow.md
   289 06-tech-stack.md
   263 07-mvp-roadmap.md
   270 08-revenue-model.md
   368 09-risks.md
   199 10-references.md
```

文件大小、行数除 README / CHANGELOG 外全部不变。