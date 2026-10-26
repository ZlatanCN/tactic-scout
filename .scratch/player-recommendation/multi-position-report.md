# 全位置 FM 属性相似公式与消融实验报告

Status: resolved
Labels: ready-for-agent

运行时间：2026-10-25T12:58:55.330591+00:00。协议：`fm-all-positions-v1`。

结论状态：**provisional**。全局公式：`rmse`；开发候选：`rmse`。该结果只代表本快照、冻结的位置属性映射和预注册工程稳健性协议，不是现实足球相关性标签。

## 数据和覆盖

FM manifest：`431eecb0a892bf7be8e056832a6fd9e553f461d1b629fdd080ea31e847bd85eb`；快照日期 `2025-11-23`；有效 FM IDs 102,706。Feature-map SHA256：`37f9719a4ef2ab2242da622e716bfa0f36d1be6d8cb2468db477005b15f54e20`。

| 位置 | 候选评分≥15 | feature数 | 拟合 | 开发 query | 测试 query |
| --- | ---: | ---: | ---: | ---: | ---: |
| amc | 17243 | 16 | 12058 | 120 | 120 |
| aml | 17881 | 19 | 12423 | 120 | 120 |
| amr | 17985 | 19 | 12562 | 120 | 120 |
| dc | 21276 | 20 | 14841 | 120 | 120 |
| dl | 11363 | 21 | 7898 | 120 | 120 |
| dm | 17195 | 18 | 12031 | 120 | 120 |
| dr | 11956 | 21 | 8386 | 120 | 120 |
| gk | 10319 | 27 | 7283 | 120 | 120 |
| mc | 24583 | 19 | 17199 | 120 | 120 |
| ml | 8786 | 17 | 6086 | 120 | 120 |
| mr | 9713 | 17 | 6819 | 120 | 120 |
| stc | 21119 | 18 | 14731 | 120 | 120 |
| wbl | 6790 | 22 | 4758 | 120 | 120 |
| wbr | 6675 | 22 | 4670 | 120 | 120 |

`SW` 没有 rating≥15 候选，未纳入覆盖和宏平均。每个位置查询集合在 14 个位置间身份不重叠；不同集合的 FM IDs 也完全隔离。

## 全局公式对比

全局宏平均对所有具体位置等权。J5±2 是参考画像在固定 ±2 raw 属性扰动后的 Top5 Jaccard 稳定性；它是工程诊断，不是真实推荐质量。

| 公式 | 开发 J5±2 | 测试 J5±2 | 开发相对 MAE Δ（95% CI） | 测试相对 MAE Δ（95% CI） | 测试最差位置 Δ | p95 ms | 可晋级 |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| mae | 0.547 | 0.544 | 基线 | 基线 | — | 1.46 | 基线 |
| rmse | 0.631 | 0.617 | 0.084 [0.074, 0.093] | 0.073 [0.064, 0.083] | 0.050 | 1.75 | 是 |
| cosine | 0.587 | 0.575 | — | — | — | 1.82 | 否（对照/不参选） |
| correlation | 0.544 | 0.541 | — | — | — | 2.38 | 否（对照/不参选） |
| zrmse | 0.619 | 0.608 | 0.072 [0.062, 0.081] | 0.064 [0.054, 0.073] | 0.019 | 1.85 | 是 |
| mahalanobis | 0.538 | 0.540 | -0.009 [-0.020, 0.001] | -0.004 [-0.015, 0.006] | -0.026 | 2.01 | 否 |
| weighted_mae | 0.544 | 0.536 | -0.003 [-0.010, 0.003] | -0.008 [-0.015, -0.001] | -0.037 | 1.66 | 否 |
| ca_only | 1.000 | 1.000 | — | — | — | 1.00 | 否（对照/不参选） |
| random | 1.000 | 1.000 | — | — | — | 1.69 | 否（对照/不参选） |

MAE 是基线，随机排序与 CA-only 是稳定性负对照；它们不参与“水平敏感”公式晋级。高扰动稳定性本身不能证明推荐质量。

公式算分与稳定 TopK 排序的 p95 为内存基准，不含 SQLite 读取或模型调用。全实验约 343 秒，峰值 RSS 约 1.1 GiB；这描述的是离线 Python 实验进程，不是 TypeScript 在线请求的资源目标。

| 场景 | 最小池 | 空池 query | 少于5人 query |
| --- | ---: | ---: | ---: |
| amc/open | 17240 | 0 | 0 |
| amc/u23 | 9339 | 0 | 0 |
| amc/u23_ca160 | 13 | 0 | 0 |
| amc/u23_pa160 | 102 | 0 | 0 |
| aml/open | 17878 | 0 | 0 |
| aml/u23 | 9249 | 0 | 0 |
| aml/u23_ca160 | 11 | 0 | 0 |
| aml/u23_pa160 | 76 | 0 | 0 |
| amr/open | 17982 | 0 | 0 |
| amr/u23 | 9345 | 0 | 0 |
| amr/u23_ca160 | 12 | 0 | 0 |
| amr/u23_pa160 | 90 | 0 | 0 |
| dc/open | 21273 | 0 | 0 |
| dc/u23 | 11623 | 0 | 0 |
| dc/u23_ca160 | 2 | 0 | 120 |
| dc/u23_pa160 | 45 | 0 | 0 |
| dl/open | 11360 | 0 | 0 |
| dl/u23 | 6132 | 0 | 0 |
| dl/u23_ca160 | 3 | 0 | 120 |
| dl/u23_pa160 | 32 | 0 | 0 |
| dm/open | 17192 | 0 | 0 |
| dm/u23 | 8862 | 0 | 0 |
| dm/u23_ca160 | 6 | 0 | 0 |
| dm/u23_pa160 | 57 | 0 | 0 |
| dr/open | 11953 | 0 | 0 |
| dr/u23 | 6451 | 0 | 0 |
| dr/u23_ca160 | 0 | 120 | 120 |
| dr/u23_pa160 | 28 | 0 | 0 |
| gk/open | 10316 | 0 | 0 |
| gk/u23 | 6153 | 0 | 0 |
| gk/u23_ca160 | 0 | 120 | 120 |
| gk/u23_pa160 | 10 | 0 | 0 |
| mc/open | 24580 | 0 | 0 |
| mc/u23 | 13550 | 0 | 0 |
| mc/u23_ca160 | 12 | 0 | 0 |
| mc/u23_pa160 | 95 | 0 | 0 |
| ml/open | 8783 | 0 | 0 |
| ml/u23 | 4299 | 0 | 0 |
| ml/u23_ca160 | 3 | 0 | 120 |
| ml/u23_pa160 | 25 | 0 | 0 |
| mr/open | 9710 | 0 | 0 |
| mr/u23 | 5031 | 0 | 0 |
| mr/u23_ca160 | 4 | 0 | 120 |
| mr/u23_pa160 | 37 | 0 | 0 |
| stc/open | 21116 | 0 | 0 |
| stc/u23 | 11576 | 0 | 0 |
| stc/u23_ca160 | 6 | 0 | 0 |
| stc/u23_pa160 | 54 | 0 | 0 |
| wbl/open | 6787 | 0 | 0 |
| wbl/u23 | 3247 | 0 | 0 |
| wbl/u23_ca160 | 2 | 0 | 120 |
| wbl/u23_pa160 | 20 | 0 | 0 |
| wbr/open | 6672 | 0 | 0 |
| wbr/u23 | 3102 | 0 | 0 |
| wbr/u23_ca160 | 0 | 120 | 120 |
| wbr/u23_pa160 | 17 | 0 | 0 |

## 属性组消融

对 MAE 与开发阶段选出的全局公式，分别去掉每个位置属性组；候选资格不变。Jaccard=1 表示去组前后 Top5 相同。结果解释属性组对该冻结排序的影响，不作为因果或足球实战标签。

| 位置/公式/移除组 | Top5 与完整模型平均 Jaccard | 平均 CA gap 变化 |
| --- | ---: | ---: |
| amc/mae/creation | 0.093 | 1.95 |
| amc/mae/progression | 0.167 | 2.13 |
| amc/mae/threat | 0.238 | 1.77 |
| amc/rmse/creation | 0.067 | 2.00 |
| amc/rmse/progression | 0.139 | 1.92 |
| amc/rmse/threat | 0.208 | 1.95 |
| aml/mae/creation | 0.141 | 1.04 |
| aml/mae/support | 0.224 | 1.03 |
| aml/mae/threat | 0.115 | 3.48 |
| aml/rmse/creation | 0.117 | 1.02 |
| aml/rmse/support | 0.167 | 1.19 |
| aml/rmse/threat | 0.106 | 2.86 |
| amr/mae/creation | 0.130 | 0.66 |
| amr/mae/support | 0.215 | 1.82 |
| amr/mae/threat | 0.115 | 3.69 |
| amr/rmse/creation | 0.122 | 0.87 |
| amr/rmse/support | 0.183 | 1.88 |
| amr/rmse/threat | 0.101 | 3.81 |
| dc/mae/aerial_physical | 0.129 | 3.09 |
| dc/mae/defending | 0.126 | 2.46 |
| dc/mae/distribution | 0.223 | 0.76 |
| dc/rmse/aerial_physical | 0.123 | 3.22 |
| dc/rmse/defending | 0.095 | 3.09 |
| dc/rmse/distribution | 0.210 | 0.77 |
| dl/mae/defending | 0.206 | 3.19 |
| dl/mae/engine | 0.190 | 2.13 |
| dl/mae/wide_attack | 0.154 | 1.15 |
| dl/rmse/defending | 0.167 | 3.22 |
| dl/rmse/engine | 0.145 | 2.68 |
| dl/rmse/wide_attack | 0.159 | 0.82 |
| dm/mae/circulation | 0.254 | 1.48 |
| dm/mae/screening | 0.098 | 3.10 |
| dm/mae/work | 0.139 | 1.29 |
| dm/rmse/circulation | 0.248 | 1.13 |
| dm/rmse/screening | 0.079 | 3.05 |
| dm/rmse/work | 0.092 | 1.49 |
| dr/mae/defending | 0.164 | 2.52 |
| dr/mae/engine | 0.180 | 1.75 |
| dr/mae/wide_attack | 0.156 | 0.94 |
| dr/rmse/defending | 0.137 | 2.65 |
| dr/rmse/engine | 0.137 | 1.96 |
| dr/rmse/wide_attack | 0.160 | 1.10 |
| gk/mae/distribution | 0.388 | -0.16 |
| gk/mae/goalkeeping | 0.143 | 1.76 |
| gk/mae/judgment | 0.250 | 1.84 |
| gk/mae/mobility | 0.249 | 1.00 |
| gk/rmse/distribution | 0.352 | 0.14 |
| gk/rmse/goalkeeping | 0.132 | 1.68 |
| gk/rmse/judgment | 0.247 | 2.08 |
| gk/rmse/mobility | 0.213 | 1.24 |
| mc/mae/circulation | 0.175 | 2.77 |
| mc/mae/movement | 0.144 | 2.66 |
| mc/mae/two_way | 0.115 | 0.31 |
| mc/rmse/circulation | 0.156 | 2.36 |
| mc/rmse/movement | 0.124 | 3.16 |
| mc/rmse/two_way | 0.082 | 0.55 |
| ml/mae/carrying | 0.145 | 2.37 |
| ml/mae/contribution | 0.161 | 1.73 |
| ml/mae/wide_delivery | 0.242 | 0.23 |
| ml/rmse/carrying | 0.130 | 2.60 |
| ml/rmse/contribution | 0.116 | 1.92 |
| ml/rmse/wide_delivery | 0.227 | 0.27 |
| mr/mae/carrying | 0.146 | 2.98 |
| mr/mae/contribution | 0.151 | 1.91 |
| mr/mae/wide_delivery | 0.243 | 0.69 |
| mr/rmse/carrying | 0.127 | 2.59 |
| mr/rmse/contribution | 0.128 | 1.85 |
| mr/rmse/wide_delivery | 0.239 | 0.63 |
| stc/mae/finishing_movement | 0.205 | 1.29 |
| stc/mae/link | 0.094 | 2.92 |
| stc/mae/physical | 0.151 | 3.23 |
| stc/rmse/finishing_movement | 0.151 | 1.74 |
| stc/rmse/link | 0.073 | 3.23 |
| stc/rmse/physical | 0.116 | 2.75 |
| wbl/mae/defending | 0.213 | 1.15 |
| wbl/mae/engine | 0.204 | 2.49 |
| wbl/mae/wide_attack | 0.162 | 1.58 |
| wbl/rmse/defending | 0.192 | 1.55 |
| wbl/rmse/engine | 0.173 | 2.92 |
| wbl/rmse/wide_attack | 0.124 | 2.23 |
| wbr/mae/defending | 0.195 | 1.79 |
| wbr/mae/engine | 0.199 | 2.65 |
| wbr/mae/wide_attack | 0.179 | 1.90 |
| wbr/rmse/defending | 0.176 | 1.55 |
| wbr/rmse/engine | 0.167 | 2.75 |
| wbr/rmse/wide_attack | 0.178 | 2.12 |

## 高潜名单

高潜名单通过确定性 PA 排序检查：先 PA 降序，再当前属性距离升序，最后稳定 FM ID。PA 不与当前属性距离合成。

| 位置 | 场景 | query数 | 空池 | TopK 中 CA<160 的累计数 |
| --- | --- | ---: | ---: | ---: |
| amc | open | 240 | 0 | 480 |
| amc | u23 | 240 | 0 | 960 |
| amc | u23_pa160 | 240 | 0 | 960 |
| aml | open | 240 | 0 | 480 |
| aml | u23 | 240 | 0 | 1675 |
| aml | u23_pa160 | 240 | 0 | 1675 |
| amr | open | 240 | 0 | 480 |
| amr | u23 | 240 | 0 | 1200 |
| amr | u23_pa160 | 240 | 0 | 1200 |
| dc | open | 240 | 0 | 720 |
| dc | u23 | 240 | 0 | 1920 |
| dc | u23_pa160 | 240 | 0 | 1920 |
| dl | open | 240 | 0 | 1440 |
| dl | u23 | 240 | 0 | 1680 |
| dl | u23_pa160 | 240 | 0 | 1680 |
| dm | open | 240 | 0 | 645 |
| dm | u23 | 240 | 0 | 1440 |
| dm | u23_pa160 | 240 | 0 | 1440 |
| dr | open | 240 | 0 | 1200 |
| dr | u23 | 240 | 0 | 2400 |
| dr | u23_pa160 | 240 | 0 | 2400 |
| gk | open | 240 | 0 | 1440 |
| gk | u23 | 240 | 0 | 2400 |
| gk | u23_pa160 | 240 | 0 | 2400 |
| mc | open | 240 | 0 | 240 |
| mc | u23 | 240 | 0 | 960 |
| mc | u23_pa160 | 240 | 0 | 960 |
| ml | open | 240 | 0 | 1920 |
| ml | u23 | 240 | 0 | 1680 |
| ml | u23_pa160 | 240 | 0 | 1680 |
| mr | open | 240 | 0 | 1440 |
| mr | u23 | 240 | 0 | 1440 |
| mr | u23_pa160 | 240 | 0 | 1440 |
| stc | open | 240 | 0 | 1200 |
| stc | u23 | 240 | 0 | 1919 |
| stc | u23_pa160 | 240 | 0 | 1919 |
| wbl | open | 240 | 0 | 1680 |
| wbl | u23 | 240 | 0 | 1920 |
| wbl | u23_pa160 | 240 | 0 | 1920 |
| wbr | open | 240 | 0 | 1201 |
| wbr | u23 | 240 | 0 | 2400 |
| wbr | u23_pa160 | 240 | 0 | 2400 |

这些 CA/PA 数字和属性相似度都来自 FM 快照；潜力名单不预测实际发展，不代表候选会达到 PA。

## 结论限制

- 公式赢家只对这批 FM 快照、位置特征映射、查询采样和属性噪声协议成立。
- 没有独立球探相关性标签，因此不报告 NDCG/Recall，也不称为真实替代质量最优。
- STC-only 的 `rmse18` 作为历史对照保留；全局结果由本次 14 位置宏平均实验决定。
- 实验不调用网关、LLM、Understat 或其他外部服务。

原始排名、split、拟合参数、噪声结果和逐项验证保存在 `.data/recommendation-experiments/20261025-multiposition-v2`。
