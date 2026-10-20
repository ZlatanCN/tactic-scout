# 01: 注入运行时上下文

**What to build:** 同一张招募案件 `StateGraph` 可以在每次运行时注入 repository、Planner、知识库、观察器和实验配置等服务；缺失必需依赖时，在读取案件、访问数据源或调用模型之前给出明确配置失败。运行时依赖不进入 checkpoint，现有用户行为保持不变。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Labels:** ready-for-agent

- [x] 生产组合边界构造运行时上下文，已编译图从 `Runtime.context` 取得依赖。
- [x] 测试可以使用不同上下文运行同一张已编译图，不需要修改或重置全局状态。
- [x] 缺少必需依赖时，在 repository、Planner、工具或供应商请求前失败。
- [x] 函数、客户端、观察器、原始异常和供应商响应不写入 checkpoint 状态。
- [x] 先对照安装版本核对 `StateGraph` 的 `contextSchema` 构造签名；按真实声明实现，不照抄可能过时的示例。
- [x] 完整对话测试证明注入前后用户可见行为等价。

## Answer

完成。招募图使用已安装 LangGraph 版本支持的 `StateGraph` context schema 构造签名；运行时服务由 `Runtime.context` 读取，状态与 checkpoint 只保留案件事实。`tests/recruitment/runtime-context.test.ts` 覆盖同一编译图使用不同运行时依赖以及必需依赖缺失的早期失败；完整对话既有回归与构建通过。
