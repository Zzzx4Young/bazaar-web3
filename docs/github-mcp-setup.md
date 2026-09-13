# GitHub MCP 配置与验证

更新：2026-09-13。

当前 GitHub MCP 配置如下：

- 服务：`github`
- 传输：`streamable_http`
- 地址：`https://api.githubcopilot.com/mcp/`
- Token 环境变量：`GH_TOKEN`
- 状态：已启用

Token 已写入 WSL 用户的 `~/.bashrc`，交互式 Bash 可以加载该变量。验证时不输出 Token 内容。
GitHub CLI 与 GitHub MCP 共用这一份变量，不保存第二份 Token。

已确认：

- `.bashrc` 能加载 `GH_TOKEN`
- `codex mcp get github` 显示服务已启用，且认证变量名正确
- GitHub MCP 已完成真实账户及提交查询
- GitHub CLI 2.100.0 已使用同一 Token 完成认证，并读取指定 SHA 的 Actions run 与 jobs

修改 Token 后，在 WSL 中重新加载环境并重启 Codex：

```bash
source ~/.bashrc
codex
```

重启后分别执行 `gh auth status` 和一次 GitHub MCP 只读查询。Token 泄露后应立即在 GitHub
撤销并重新生成。
