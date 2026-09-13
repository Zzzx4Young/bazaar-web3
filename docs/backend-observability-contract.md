# Alpha 请求关联与安全日志契约

更新：2026-09-13。适用于 I7 受控内测，不改变业务路由、请求 body、权限、状态机或
幂等规则。

## 请求 ID

- 客户端可以发送 `X-Request-Id`。只接受 1—64 个 ASCII 字符，首字符为字母或数字，
  后续字符限字母、数字、点、下划线、冒号和连字符；其他值被忽略并由服务端生成 UUID。
- 服务端为每个请求确定一个 ID，在所有成功和失败响应的 `X-Request-Id` header 返回。
  错误 JSON 仍使用稳定 `code` 和 `retryable`，并增加相同的 `requestId`。
- 前端为请求生成 UUID，并在 `BackendError` 暴露服务端返回的 `requestId` 与 `retryable`。
  请求 ID 只用于诊断，不作为身份、授权、幂等或业务资源 ID。

## 最小请求日志

每个完成请求记录一行 JSON，仅包含：

- `event=http_request`、UTC 时间、request ID；
- HTTP 方法、服务端路由模板、状态码、毫秒耗时；
- 失败时的稳定应用错误码。

普通日志不得记录原始 URL/query、请求或响应 body、headers、Cookie、CSRF、密码、
收件信息、物流单号、数字链接、提取码、数据库连接串、SQL 或驱动错误。未匹配路由
统一记录 `unmatched`，避免把 URL 中的任意值写入日志。日志 sink 失败只能产生不含
请求内容的降级事件，不能改变 HTTP 结果或业务事务。

## 验收

测试覆盖调用方 ID 透传、非法 ID 替换、成功/错误响应一致、稳定错误码关联、未匹配
路径脱敏和日志 sink 失败。OpenAPI、CORS、前端客户端和内测问题模板同步使用本契约。
