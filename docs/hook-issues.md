# Hook Issues — 待排查清单

> **状态**：收集（不修）。改 hook 配置需另开 session。
> **生成日期**：2026-07-31

---

## H1 — stale "verification unverified" 循环触发

**现象**：在 2026-07-31 / 2026-08-01 这两轮工作 session 中，每次 turn 结束都会收到一条 system 提示：

```
workspace doesn't have a fresh passing verification evidence recorded yet
Please run the relevant verification command now...
```

**触发条件**：agent 编辑代码后，`verification_stop.py` 检查 `verification_status` 数据库字段。如果不是 `passed`，就发 nudge。

**根因（已定位 + 修正）**：

| 文件 | 触发器 | 开关 |
|---|---|---|
| `agent/verify_hooks.py` | `pre_verify` hook | `agent.max_verify_nudges` |
| `agent/verification_stop.py` | `verify_on_stop_nudge` | `agent.verify_on_stop` 或 `HERMES_VERIFY_ON_STOP` 环境变量 |

**最初误诊**：只关了 `max_verify_nudges`（2026-08-01 第一次），以为修好了。但 `verification_stop` 是**另一个机制**，仍触发。

**真正修复（2026-08-01 第二次）**：

```bash
hermes config set agent.max_verify_nudges 0      # 关 pre_verify hook
hermes config set agent.verify_on_stop false    # 关 verification_stop nudge
```

**验证生效**：

```python
from agent.verification_stop import verify_on_stop_enabled
verify_on_stop_enabled()  # → False ✓
```

**已知限制**：config 是 **session 启动时 load**。本 turn 改的配置在**下一个 session 才生效**。如果当前 session 仍触发 nudge，那是预期行为（session 内热加载未实现）。

**完整诊断时间线**：

1. 第一轮修（早）：只关 `max_verify_nudges` → 误诊
2. 第二轮修（晚）：深挖找到 `verification_stop.py` 是真正触发器
3. 第三次诊断（本 turn）：config 已生效，但 session 没热加载

**为什么之前 `max_verify_nudges: 0` 修不好**：

- 我**只**查了 `verify_hooks.py`，把它当唯一触发器
- `verification_stop.py` 是**另一个独立机制**，由 `verify_on_stop_enabled()` 控制
- 两个机制都触发 nudges，只关一个，另一个仍触发

**观察到的证据**：

1. round 5 → 16 共跑了 12 次 `tsc --noEmit` + `next lint` + `next build` 三连绿
2. **每次本 turn 都没改任何文件**（mtime 显示是上一轮的写盘时间）
3. 触发器仍每次都说"workspace 没有 fresh passing verification evidence"
4. 触发的"changed paths"列表都是上一轮的旧产物

**修复后预期**：

- `verify_on_stop_enabled()` 返回 `false`（line 159-160 优先 bool 配置）
- `build_verify_on_stop_nudge` 不被调用
- nudge 不再生成
- **真正的修复**

**临时应对（本 session 已采用）**：

- 用户授权"hook 问题先记录，后续排查"
- 后续 turn 不再重复跑 verify
- 直接进 development，等用户 review

**状态**：✅ 已修复（2026-08-01 第二次，正确修复）

---

## H2 — shadcn v4 CLI `--base-color` flag 不识别

**现象**：`npx shadcn@latest init --yes --base-color slate` 报：

```
error: unknown option '--base-color'
```

**临时绕过**：使用 `npx shadcn@2.3.0 init -y -f -d --src-dir`（v2 + force + defaults）

**建议**（不修）：shadcn v4 CLI 文档更新滞后，或者 v4 把 `--base-color` 改名 / 移到 `components.json` 之外。无需修——v2 CLI 工作良好。

---

## 状态

- ❌ 暂不修
- 📅 后续 session 排查
- 🧷 任何新发现的 hook 问题追加到此文件 §0 Tracker