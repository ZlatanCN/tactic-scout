# 保留来源身份的多来源当前球员池

## Status

Accepted

## Context

Understat 已提供欧洲五大联赛当前赛季表现池；ASA 为北美多个赛事提供当前赛季表现池。TactiScout 只使用 ASA 的 MLS、USL Championship 与 USL League One，和 Understat 形成地域互补。各来源的球员 ID、球队 ID、统计定义和位置组各自独立。按姓名合并会把同名球员误作同一身份；把不同联赛的原始数值放在一起排序，也会制造未验证的跨赛事比较。

现有招募对话依赖单一 `PlayerRepository`。若每个问题都要求用户选择 provider，就会暴露实现细节，并让用户错过未指定赛事时本来应能发现的区域候选。

## Decision

新增显式多来源当前赛季表现池，将 Understat 五大联赛和 ASA 当前三项北美赛事（MLS、USL Championship、USL League One）作为互补候选发现来源。适配器保留每条记录的原 provider identity、原字段口径、赛事、赛季和读取时间。

- 不按姓名、数字 ID、球队名或可见标签跨来源合并记录。
- 未指定赛事时按赛事轮转候选分页；明确指定赛事时只查询匹配赛事。
- 比较样本限制在相同 provider、赛事、赛季和位置组；报告不声称跨赛事统一排名。
- ASA 只纳入 MLS、USL Championship 与 USL League One；其它 ASA 赛事不属于产品候选范围。
- Understat 不提供年龄，因此跨来源或未限定赛事的年龄上限条件不能安全执行；必须显式说明并等用户调整条件。只有用户明确限定到 ASA 男足赛事时才使用其年龄字段。
- 一次候选调查要求组合来源均成功读取；任一来源不可用时将查询报告为失败，不把部分结果冒充为完整组合覆盖。
- 此模式须显式启用；既有默认与单来源模式保持不变。

## Implementation note

2026-10-11：ASA 的目录、默认搜索、USL 简称和 mosaic 入口现均限制在 MLS、USL Championship 与 USL League One；其它 ASA 赛事在候选入口处拒绝或过滤。回归边界见 [issue 149](../../.scratch/tactiscout-mvp/issues/149-separate-usl-super-league-from-mens-candidate-pool.md)。

## Consequences

- 用户可以在一次 LangGraph 调查中发现欧洲和北美的当前赛季候选。
- 候选报告会同时暴露各来源的实际赛事范围、统计字段和能力缺口。
- 组合覆盖受最慢来源延迟与任一来源可用性影响；需要保留来源失败状态。
- 年龄约束暂时阻止组合池查询；候选身份分组遵循 [ADR 0009](0009-exact-identity-candidate-groups.md)。当前 release 没有 ASA bridge，因此真实 Understat↔ASA 重叠仍未能去重；全球适配分校准与注册阵容核验也未解决。
- 来源接入或运行成功不代表来源已授予本地保留、AI/RAG 处理或公开展示许可；来源处理边界继续逐项记录。

## Alternatives considered

- 让用户每次先选一个来源：保留了实现细节，并使未指定赛事的检索范围依赖用户了解数据覆盖。
- 合并同名或名称相似的球员：没有精确 cross-provider 标识支持，会产生错误身份关联。
- 把各联赛记录直接拼成统一实力榜：联赛、指标口径、样本和来源覆盖并不天然可比。
- 只返回成功来源的部分结果：除非将本次缺失来源和实际覆盖传进报告，否则会把源故障伪装成完整搜索结果。
