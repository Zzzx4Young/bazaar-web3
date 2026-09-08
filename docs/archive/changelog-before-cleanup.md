> 历史归档（2026-09-08）：仅供追溯，不是当前实施规范。当前入口：[文档索引](../README.md)。原文中的当前状态、待办、估时和建议均为历史记录。

# Changelog

记录 bazaar-web3/ 的结构性变更。文档内容的实质修改请直接进对应 .md 看 git diff / 顶部日期。

## 2026-09-08 — Q1 确认服务端 Alpha

### Q4-10 确认内测暂不提供完成后售后

用户回复“可以先这样”，接受推荐方案 A：完成订单保留只读历史，不提供系统内完成后售后，问题由团队线下记录。同步决策记录，新增 server-alpha-spec.md 整理业务状态、权限、库存、订单快照及验收草案。技术实现细节明确标为草案，未实现服务端、未编制详细接口与工单。

### Q4-9 确认线下协调实物退回

用户选择 A：完成前异常中的实物退回在线下协调，卖家确认退回结果或同意无需退回后，在系统执行全额模拟退款；不建独立退货流程，退款后恢复可售仍按 Q4-8 单独处理。同步 ADR-0002 与决策队列，进入 Q4-10 完成后售后范围确认。本次仅更新文档，未实现服务端。

### Q4-8 确认实物退款后手动恢复可售

用户选择 A：实物全额模拟退款后均保持不可售，由卖家确认货物在手且可再次出售后手动恢复，保留原退款订单记录；未付款取消释放规则不变。同步 ADR-0002、入口与决策队列，进入 Q4-9 实物退回范围确认。本次仅更新文档，未实现服务端。

### Q4-7 确认创建实物订单即占用库存

用户选择 A：创建实物订单即占用单件库存，买家手动取消未付款订单后释放；不自动超时释放。同步 ADR-0002、入口与决策队列，记录服务端一致性、并发防超卖及重复取消保护要求；进入 Q4-8 退款后恢复可售规则确认。本次仅更新文档，未实现服务端。

### Q4-6 确认内测暂不自动超时

用户选择 A：订单取消、交付、确认及异常处理由有权限的测试账户手动操作，不随时间自动取消、完成或模拟退款，无人操作则保留当前状态。同步 ADR-0002、入口与决策队列，进入 Q4-7 实物库存占用与未付款取消规则确认。本次仅更新文档，未实现服务端。

### Q4-5 确认双方处理异常，暂不建设仲裁后台

用户选择 A：完成前买家报告问题，卖家补交或同意全额模拟退款；分歧由团队线下协调，订单保持异常。同步 ADR-0002、入口与决策队列，进入 Q4-6 内测自动超时范围确认。完成后售后、实物退回等尚未确定；本次仅更新文档，未实现服务端。

### Q4-4 确认模拟付款后手动交付、先验收再完成

用户选择 A：数字内容由卖家在模拟付款后手动提交链接及必要提取码，订单买家先查看验收再确认完成。同步 ADR-0002、入口与决策队列，并区分 Alpha 交付决策与尚未解决的历史合约问题。进入 Q4-5 完成前异常处理范围确认；本次仅更新文档，未实现服务端。

### Q4-3 确认外部链接交付数字内容

用户选择 A：卖家通过订单提供外部下载链接及必要提取码，平台不托管文件。同步 ADR-0002、入口与决策队列；标明交付信息不公开、外部链接可能失效或被转发。进入 Q4-4 交付触发与访问时点确认。本次仅更新文档，未实现服务端或交付功能。

### Q4-2 确认卖家自行寄送，平台不提供物流服务

用户选择 A：实物仅寄送，由卖家自行寄出并提供物流单号，买家自行查询并确认收货；平台不提供物流服务，内测使用虚拟数据。同步 ADR-0002、入口与决策队列，进入 Q4-3 数字内容交付载体确认。未接入物流服务或实现服务端；超时与异常规则尚未确认。

### Q4-1 确认实物单件与数字内容重复销售

用户明确选择 A：实物每条发布仅一件，授权数字内容可向多个买家重复销售，不属于独占转让。同步 ADR-0002、入口与决策队列，进入 Q4-2 实物交付方式确认。库存占用、取消恢复和交付规则仍待确认；本次仅更新文档，未实现服务端。

### Q3-2 确认预置账户＋密码

用户明确选择 A，并说明目前为开发内测阶段。采用预置买卖双方测试账户，支持服务端验证的登录与退出；不增加注册、账户管理界面或邮箱登录。同步 ADR-0002、入口与决策队列，进入 Q4-1 库存与重复销售规则确认。仅更新规划文档，未实现认证或服务端。

### Q3-1 确认仅内部测试

用户明确选择“B 仅内部测试”：只面向团队测试账户，不开放注册或外部邀请。同步 ADR-0002、入口与决策队列；继续确认 Q3-2 登录方式。两类商品和模拟结算范围保持不变，未实施服务端。

### Q2 确认同时支持两类商品

用户明确回复“两者同时支持”：实物二手与授权数字内容均纳入 Alpha 目标范围，分别设计库存与交付规则。更新 ADR-0002、文档入口和决策队列。已询问 Q3-1 开放范围；账户方式、重复销售与交付细节尚待确认。结算继续模拟，未启动服务端实现。

用户明确选择 A：真实账户、跨设备数据和服务端权限，结算保持模拟。新增 ADR-0002，同步文档入口、ADR-0001 阶段关系及决策队列。已询问 Q2 首发品类；具体商品、账户和业务规则尚未确认。未实现后端，未启动测试网或真实交易。

## 2026-09-07 — 本地发布流程验收与卖家关联修复

### 蓝图校正与逐步决策启动

用户批准按 review 顺序推进，并要求逐项提供选项确认。新增 review-corrections.md 记录 R01—R12、Q1—Q5 及阶段验收顺序；同步文档入口、ADR 适用范围与历史工单状态。纠正目标人数算术、财务目标冲突、支付示例可用性以及 problem.md 中过时判断。历史正文保留为非执行档案，未实施服务端/合约。

已询问 Q1（服务端 Alpha / 测试网 MVP / 继续用户验证），尚未收到选择；推荐不等于确认。下一步在 Q1 确认后询问首发品类。

### Demo 收尾验收（页面 review 后）

- 个人中心使用关联卖家 ID 及统一商品存储，显示当前卖家的 active 商品，支持发布后刷新恢复；不再使用其他卖家的固定样例切片。
- 个人资料在手机上纵向排列，钱包地址可换行，发布入口保持可见。
- 离开实物类型时清除成色条件，避免隐藏条件继续排除商品。
- 分享按钮明确标记暂未开放并禁用；中英文首页说明、元信息、页脚、发布说明与 Banner 清除已接入钱包、测试网、担保和鉴定服务的表述。
- 验证：typecheck、lint、183 项单元测试、生产构建通过；完整 24 项 Playwright 测试通过，含新增的中英文移动端宽度和隐藏筛选条件回归，以及扩展的个人中心发布商品恢复检查。截图人工复核及分享禁用检查通过。
- 全站英文翻译、完整筛选 URL 同步按本轮约定暂缓；服务端、认证、支付及合约仍未接入。运行生产构建后需重启开发服务器，避免共享 .next 缓存导致旧进程加载失败。

继续验收工作区已有的本地商品聚合、收藏同步、分类筛选、语言路由和模拟购买改动。浏览器回归发现发布表单将用户 ID 写入商品 sellerId，导致对应卖家页缺少新商品；现改为优先使用用户的 linkedSellerId，与个人中心卖出订单的关联规则一致。

发布回归测试覆盖详情刷新、收藏及导航计数、分类探索、首页、卖家页、模拟下单和同语言订单跳转；订单标题断言排除同名图片链接，并检查详情链接地址。

验证：修复后 typecheck、lint、22 个测试文件 / 183 项单元测试、生产构建均通过。首次完整浏览器测试 20 通过、1 失败；修复卖家关联及测试定位后，重跑 publication.spec.ts 的 2 项测试全部通过，其余 19 项 smoke 测试在首次运行中通过。git diff --check 通过。

本次修复作用于新发布商品；此前已存入浏览器的错误 sellerId 未自动迁移。完整业务文案翻译、草稿和图片预览等仍属于路线图后续工作。

## 2026-08-29 — P1 收工（sort i18n + favorites persistence + grid empty + mobile check）

**触发**：8-3 verification gate 后第 1 次集中收日常工作，5 个 commit 落地（P1 路线的全程 4 件 + 1 件 P1 触发未动）。

**5 commits**（`git log` 验证都在 main）：

1. `a6ed062 chore: add deploy + CI + contributing scaffold` — `.github/workflows/ci.yml` + `CONTRIBUTING.md` + `vercel.json` + `package.json` (`screenshot` script)
2. `4621298 feat(frontend): screenshot script with baseline + daily snapshots` — `frontend/scripts/screenshot.mjs` + `docs/screenshots/v0.1/*` + `docs/screenshots/20260829/*`（baseline vs 改造双存档）
3. `3d85b4b feat(frontend): empty-state UX + home trust/trending sections` — 共用 `EmptyState` 组件 + `TrustStrip` + `TrendingCategories` 接入首页 + 4 个空状态迁移 + i18n 双语 key + 11 个新测试
4. `df4fd64 feat(frontend): visual polish (hero gradient + placeholder art + empty halo)` — hero 三层 blob + noise + 5 类目渐变占位卡 + EmptyState halo + Tailwind safelist
5. `7d92af3 test(frontend): sort dropdown i18n + favorites persistence + grid empty` — SortDropdown 改 i18n (zh/en `explore.sort.{newest,price_asc,price_desc,popular}`) + 4 个 favorites persistence 测试 (替代 3 个 cross-renderer fail) + 5 个 ItemGrid 空状态测试 + 3 个 SortDropdown 结构测试

**文件统计**（`git diff --stat 54949a6..HEAD | tail -1`）：42 files / +1221 / -94。

**Verification（commit 7d92af3 后实跑）**：

```
$ npm run typecheck    → exit 0
$ npm run lint         → ✔ No ESLint warnings or errors
$ npm run test         → 22 files / 180 tests passed in 10.99s
$ npm run build        → exit 0, 15 routes prerendered
```

**重要细节 — test count 实跳到 180**：

- 8-3 末态：15 文件 / 149 cases
- 8-29 末态：**22 文件 / 180 cases**
- 本次 P1 净 +12（SortDropdown 3 / ItemGrid 5 / favorites persistence 4,扣 3 个 cross-renderer fail 改为 4 个 rehydrate pass）

**关键回头修正 — favorites store 不是 singleton**：

我原本设计 P1-B 时误以为 `useFavoriteStore` 是单例可跨组件即时同步。实跑发现它是 `useState + useLocalStorage`，每次 `mount` 都是独立 React state。改方案：把 4 个 persistence 测试 (`writes to localStorage` / `rehydrates on mount` / `survives remount` / `toggles reflect in same component`) 落进 `cross-render-consistency` describe 块。**真要跨 renderer 即时一致需要 refactor store 为 zustand**（参照 `use-order-store.ts` 的做法），已和用户确认**这次不做**，留待后续。

**Mobile spot-check（已实跑，未 commit）**：

- 用 `screenshots/mobile-check.mjs`（后续删除）在 390×844 viewport 起 Playwright
- trust strip 自动 2 列（173×173）× 2 行 — **OK**
- trending categories 在 390 下变 2+2+1（grid-cols-2 — 太密）— **微丑但能用**，等 P2 跟进 horizontal scroll-snap 改造
- 留作未来 P2 / P3 改进项，**不**计进 5 commit

**未做 / 已 agreed 推迟**：

- ❌ Push(用户做)
- ❌ Refactor `useFavoriteStore` → zustand（用户拍"暂不动"）
- ❌ Mobile trending 2+2+1 改 horizontal scroll-snap（丑但能用）
- ❌ Lighthouse / a11y score 复查（原 P3 计划）
- ❌ Playwright e2e `smoke.spec.ts` 实际跑过（手册里跑过一次 gate 没 commit）

---

## 2026-08-29 — Verification gate pass (晚)

**触发**：`docs/CHANGELOG.md` + `README.md` 文档收尾后，顺手跑一遍 verification gate 确认 8 月 1–3 日 8 个 commit 之后项目仍可运行。

**执行**（4 步 gate，0 步 Playwright）：

```
$ cd frontend
$ npm run typecheck    → exit 0 (0 TS errors)
$ npm run lint         → exit 0 (✔ No ESLint warnings or errors)
$ npm run test         → 15 files / 149 tests passed in 10.74s
$ npm run build        → exit 0, 8 routes prerendered (zh-CN + en)
```

**关键发现 — 实际 test count = 149,不是 commit message 写的 138**：

- commit `c4b18d5` 标题写 "+ 138 tests" — 8-1 当时是 8 个测试文件 + 138 个 test cases
- 8-2 两个 commit (`60e177b` + `ae195ec`) 加了 5 个新测试文件 + 11 个 test cases
- 现状：**15 test files / 149 test cases**
- CHANGELOG 那条 "138 tests" 记录已经是事后描述,没误导,但**实际数是 149**,未来 git log / 文档引用要用 149

**未做**：

- ❌ Playwright e2e 未跑 — `tests/e2e/smoke.spec.ts` 164 行需要浏览器启动,1–3 分钟,留待单独验证
- ❌ 没 commit 这次的运行结果到仓库 — 验证本身是本地状态,不进版本
- ❌ 没动 mock data / spec / tickets / backend blueprint

**Verification**：

- `git log --oneline -10` 确认 8 个 commit 都在 main
- 4 个 gate 全部实跑，没靠推断

---

## 2026-08-03 — Bug fixes pass（卡片等高 / 优化器 / 根 URL / favorites client）

**触发**：8 月 1–2 日大功能 commit 之后 4 个发现的小问题。

**修复**（4 个 commit，`git log HEAD~4..HEAD`）：

1. **`5ba4e7a` — equalize featured card heights** — `item-card.tsx` + `item-grid.tsx` 共 4 行；首页 featured 网格卡片高度不齐（不同标题行数导致）。
2. **`6ad3d5e` — disable Next.js image optimizer in dev mode** — `next.config.mjs` +5 行；dev 下 placehold.co 走优化器 504，砍掉优化器减少冷启动噪音。
3. **`77475ed` — redirect root URL to default locale** — 旧 `frontend/middleware.ts`(10 行) 删掉，新 `src/middleware.ts`(24 行) 接管；`/` → `/zh-CN` 默认 locale 跳转从"运气好"变"必然"。
4. **`861784c` — add 'use client' to /favorites page** — `favorites/page.tsx` +2 行；store 客户端 hook 在 SSG 阶段炸，加 directive 修。

**Verification**：

- `git log --oneline HEAD~4..HEAD` 4 条干净返回
- working tree clean
- 没有改 spec / 没有改 mock 数据 / 没有改测试

**Verdict**：全部都是表层修复，不动功能边界。

---

## 2026-08-02 — Dark mode polish + notifications page + favorites badge + 15 tests

**触发**：用户授权"暗色模式 + 通知页 + 收藏徽章"三件套，外加测试覆盖。

**Commit**：`60e177b feat: dark-mode polish + notifications + favorites badge + 15 tests`（22 文件 / +560 / -22）

**新增**：

- **通知页** —— `src/app/[locale]/notifications/page.tsx` (92 行) + `src/mock/notifications.ts` (58 行 mock) + `tests/pages/notifications.test.tsx` (100 行)
- **收藏徽章** —— `src/components/layout/favorites-link.tsx` (40 行) + `tests/components/favorites-link.test.tsx` (85 行)，top-nav 现显示收藏数
- **暗色模式打磨** —— `src/components/layout/brand-logo.tsx` (30 行，logo 跟主题切) + `theme-favicon-sync.tsx` (31 行，favicon 跟主题切) + `src/app/[locale]/icon-dark.svg` 暗色专用图标
- **用户类型扩展** —— `src/types/user.ts` +20 行（加 `emailNotifications` / `theme` 字段）
- **3 个测试** —— 上面 3 个组件 / 页面各 1 个

**微调**：`me/page.tsx` 7 行 / `top-nav.tsx` 13 行 / `layout.tsx` 2 行 / `mock/orders.json` 8 行（mock 数据时间戳刷新）。

**测试统计**：本次新增 3 个 `.test.tsx`（约 251 行），与下一次买 modal/mode-toggle 改动不重叠。

**做这个的时候 e2e smoke 文件被更新一行** —— `tests/e2e/smoke.spec.ts` 6 行变化（视口 / 暗色脚本稳定化）。

**未做**：❌ 没动后端 / 没动合约 / 没动 mock data schema / 没改 ADR。

---

## 2026-08-02 — Dark mode + favorites page + Vitest 基础落地

**触发**：用户授权"暗色模式 + 收藏页 + 测试基础设施"。这是 8 月 1 日 i18n 之后的第一个功能日。

**Commit**：`ae195ec feat: dark mode + favorites page + 15 tests`（7 文件 / +383 / -14）

**新增**：

- **Dark mode** —— `src/components/layout/theme-provider.tsx` (82 行) + `mode-toggle.tsx` (24 行，top-nav 切换按钮) + `app/[locale]/layout.tsx` 接 provider
- **Favorites page** —— `src/app/[locale]/favorites/page.tsx` (40 行) + `tests/pages/favorites.test.tsx` (71 行)
- **Theme 测试** —— `tests/components/theme.test.tsx` (144 行)

**i18n 配合**：`top-nav.tsx` 11 行变化（新增主题切换 + 收藏链接的 i18n key）。

**未做**：❌ 没有通知页（下次加）❌ 没有徽章计数（下次加）❌ 没改 mock data。

**决定节奏**：本次刻意保持"小步提交"——暗色 + 收藏页作为一个原子功能，避免大爆炸。

---

## 2026-08-01 — i18n (zh-CN/en) + 138 tests + 5 bug fixes + ADR-0001

**触发**：8 月 1 日 standing goal 转成"前端原型 demo"路线；用户要求 zh-CN 默认 + 英文学术。

**Commit**：

1. `c6c6ab0 docs: rewrite README for bazaar-web3 GitHub repo onboarding`（README 重写为 GitHub 入口文档）
2. `c4b18d5 feat: i18n (zh-CN/en) + 138 tests + 5 bug fixes`（43 文件 / +4282 / -205）

**主要变更**：

- **i18n 全面接入** —— next-intl 落地，所有路由从 `src/app/{explore,page,publish,me,layout,...}` 重构到 `src/app/[locale]/...`；`messages/zh-CN.json` + `messages/en.json` 各 45 行；`src/i18n/{request,routing}.ts` 12 行；`language-switcher.tsx` 30 行
- **测试基础设施** —— `vitest.config.mjs` 26 行 + `tests/setup.ts` 32 行 + `playwright.config.ts` 30 行 + `tests/e2e/smoke.spec.ts` 164 行
- **Stores** —— `use-order-store.ts` 73 行（zustand + persist 中间件）、`use-filter-store.ts` 11 行
- **ADR 落地** —— `docs/adr/0001-frontend-prototype-first.md` 148 行（"前端先行"决策，含触发重审条件 = 2026-11-01）

**关于 commit message 里"+ 138 tests"的实情**：

- commit message 里的 "138" 是当时 `npx vitest run` 实际跑过的 test cases 数（10 个 `.test.*` 文件 × 平均 13-14 cases）
- 但本次 commit **新增的是 10 个测试文件**（1112 行），不是 138 个文件，因此未来 grep 阶段会以"测试文件数"为准
- 不要在 CHANGELOG / 文档里说"新增 138 个测试文件"，那是错的

**5 bug fixes**（具体哪 5 条没在 commit message 列出，但代码 diff 显示主要是 store persist 中间件 hydration、filter URL 同步、order-status 状态机边界 case）—— 已被后续代码吃掉，不在 main 留痕。

**严格未做**：

- ❌ 没动后端 / 合约 / 真实钱包
- ❌ 没改 `mvp-spec.md` / `mvp-tickets.md` / `problem.md`（按 ADR-0001 = 决策档案）
- ❌ 旧 `crypto-c2c` 名字保留在 `docs/CHANGELOG.md` 顶部直至今日（2026-08-03 修）

**Verification**：

- `git diff c4b18d5~1 c4b18d5 --stat` = 43 文件 / +4282 / -205
- `git ls-tree --name-only -r c4b18d5 | grep '\.test\.' | wc -l` = 10 ✓

---

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
   - line 6 关联文档 `[README.md](../README.md)` → `[README.md](../../README.md)`（从 docs/ 视角，README 在父目录）
   - 其余 12 处 `[mvp-*.md](../mvp-*.md)` **不动**（同目录，相对路径仍有效）

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
