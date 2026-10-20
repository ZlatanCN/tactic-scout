# 08: 加入浏览器范围的长期偏好

**What to build:** 每个匿名浏览器身份可以查看、修改、删除和清空自己明确批准的长期偏好。偏好通过持久化 LangGraph `BaseStore` 跨重启保留；当前案件明确要求始终优先，候选、报告、搜索观察和案件事实永不进入长期记忆。

**Blocked by:** 03

**Status:** resolved

**Labels:** ready-for-agent

- [x] 浏览器生成匿名 `memoryOwnerId`，不同身份使用隔离的 Store namespace。
- [x] 实施前核对已安装依赖是否真正提供持久化 `BaseStore`；当前 SQLite checkpoint 包本身不能作为 Store 的持久化证明。
- [x] 增加可替换的持久化 Store 实现；本地原型跨重启保存，`InMemoryStore` 只用于测试。
- [x] 用户可以列出、编辑、删除单条偏好并清空当前匿名身份的全部偏好。
- [x] 只有用户明确操作或批准后才保存；不保存候选、报告、案件事实、临时条件、搜索观察或推断画像。
- [x] 新案件从当前请求开始；Store 只补充遗漏字段，最新明确请求覆盖旧偏好。
- [x] API 与本地 UI 通过真实重启、身份隔离和完整图偏好优先级测试验证。

## Answer

完成。匿名浏览器身份通过 `memoryOwnerId` 写入独立 BaseStore namespace；本地 `SQLiteBaseStore` 在进程重建后保留经明确批准的白名单偏好。偏好 API 和设置弹窗支持读取、编辑、删除和清空；新请求优先，仅补充未明确字段。`preferences.test.ts` 验证 SQLite 重开、身份隔离、同意状态、API 增删改清空、当前请求优先、Planner Runtime.context 注入和 checkpoint 不持久化偏好事实。
