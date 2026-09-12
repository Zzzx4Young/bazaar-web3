# GitHub MCP 配置与验证

更新：2026-09-12。

当前 GitHub MCP 配置如下：

- 服务：`github`
- 传输：`streamable_http`
- 地址：`https://api.githubcopilot.com/mcp/`
- Token 环境变量：`GITHUB_PAT_TOKEN`
- 状态：已启用

Token 已写入 WSL 用户的 `~/.bashrc`，交互式 Bash 可以加载该变量。验证时不输出 Token 内容。

已确认：

- `.bashrc` 能加载 `GITHUB_PAT_TOKEN`
- `codex mcp get github` 显示服务已启用，且认证变量名正确

尚未确认：

- 当前已运行的 Codex 进程是否继承更新后的变量
- GitHub MCP 是否能完成真实账户查询

当前 Codex 进程早于 `.bashrc` 配置启动，因此需要在 WSL 中重启：

```bash
source ~/.bashrc
codex
```

重启后使用 GitHub MCP 发起一次只读查询。此前一次 GitHub API 检查因网络连接失败返回 HTTP `000`，不能据此判断 Token 有效性。Token 泄露后应立即在 GitHub 撤销并重新生成。
