import { type DatasetMode, type DatasetScope, type DatasetSnapshotStatus } from "./datasets.js";
import { type PlayerProfile } from "./players.js";

const wyscoutMetricLimitations = [
  "来源事件映射进球（射门事件 + 标签 101）、助攻（标签 301）、传球（传球事件 + 成功标签 1801）和关键传球（旧版标签 302）；关键传球不等于射门助攻，射门助攻保持不可用。",
  "渐进传球次数和成功率由 TactiScout 根据起终点 x 坐标、105 米标准场地长度假设及 Wyscout 渐进传球阈值推算；这不是来源原生字段，缺少坐标或成功/失败标签时不提供。",
  "地面进攻对抗按独立子事件及 701/702/703 结果标签统计；明确胜出占比以 703 为分子、701/702/703 为完整分母并包含中性 702，不等于过人或盘带成功率。",
  "地面防守对抗按独立子事件统计，明确胜出占比以 703 为分子、701/702/703 为完整分母并包含中性 702；这类简化标签不等于抢断成功或标准对抗胜率。",
  "分钟按首发阵容与换人分钟估算为 90 分钟制，不含补时，也未校正红牌等特殊情况；每 90 分钟结果是近似值。",
  "施压、渐进带球、身体能力等未映射指标保持不可用。数据源为 Pappalardo 等人 2019 年数据集（CC BY 4.0）。",
] as const;

const datasetScopes: Record<DatasetMode, DatasetScope> = {
  demo: {
    kind: "fictional_demo",
    title: "虚构演示数据",
    summary: "这份数据只用于体验工作流和界面，不对应真实职业球员。",
    limitations: ["虚构演示数据只用于体验工作流和界面，不能据此判断真实球员能力、现役效力或转会适配；推荐结果只用于体验流程。"],
  },
  statsbomb: {
    kind: "historical_sample",
    title: "StatsBomb 历史比赛样本",
    summary: "来自本机已提供的 StatsBomb Open Data 赛事与赛季。",
    limitations: [
      "只覆盖本机文件中的历史比赛和赛季；历史赛事阵容样本不能证明球队当前完整阵容或代表当前球员市场。",
      "评估只使用文件实际记录且当前适配器支持的事件指标；事件数据不覆盖身体属性、潜力或合同信息。",
    ],
  },
  sportmonks: {
    kind: "current_limited",
    title: "Sportmonks 配置赛季球员池",
    summary: "根据服务器配置的赛季和 Sportmonks 账户权限读取球队名单与赛季统计。",
    limitations: [
      "仅使用服务器配置且账户套餐实际开通的赛事与赛季；不代表全球完整球员市场。",
      "只有账户确认覆盖的统计字段才参与评估；本版不提供市场估值、GPS/追踪数据或外部球探报告，也不以合同字段支持结论。",
    ],
  },
  skillcorner: {
    kind: "historical_sample",
    title: "SkillCorner 历史聚合样本",
    summary: "当前适配的是 2024/25 澳大利亚 A-League 球员聚合样例。",
    limitations: [
      "只覆盖 SkillCorner Open Data 的 2024/25 澳大利亚 A-League 样例，不是现役阵容或完整引援市场。",
      "来源位置组较宽（如 Full Back），不能据此识别左/右脚或左右边后卫。跑动和传球指标保留来源定义、单位与样本范围，不代表完整球员能力；未验证的派生能力不计分。",
    ],
  },
  wyscout: {
    kind: "historical_sample",
    title: "Wyscout 2017/18 历史比赛样本",
    summary: "基于本机提供的 Wyscout 历史赛事文件和所选赛事过滤条件。",
    limitations: [
      "当前 Wyscout 数据只覆盖 2017/18 历史顶级联赛样本，不是现役球员池；球队与年龄均按历史赛季解释，不能用于当前效力、年龄或转会可行性判断。",
      ...wyscoutMetricLimitations,
    ],
  },
  curated: {
    kind: "historical_sample",
    title: "TactiScout 自建球探数据集 · 历史样本",
    summary: "由带来源指纹的 Wyscout 2017/18 比赛事件，通过版本化规则生成球员赛季指标。",
    limitations: [
      "当前 TactiScout 自建快照基于 Wyscout 2017/18 历史顶级联赛样本，不是现役球员池，也不代表当前俱乐部或转会市场；球队与年龄均按历史赛季解释，不能用于当前效力、年龄或转会可行性判断。",
      "派生指标沿用 TactiScout 公开的字段定义和计算假设；缺失数据保持不可用。",
      ...wyscoutMetricLimitations,
    ],
  },
  fbref: {
    kind: "current_limited",
    title: "FBref 五大联赛当前赛季表现记录",
    summary: "从 FBref 当前五大联赛球员统计页读取有出场记录的球员；这是赛季表现池，不是完整注册名单。",
    limitations: [
      "只覆盖英超、西甲、德甲、意甲和法甲页面中有表现记录的球员，不是全球完整转会市场或球队完整注册阵容；年龄根据出生日期和抓取日期计算，来源的球队、赛季与统计可能滞后或不完整。",
      "只使用当前页面实际提供的基础、传球、防守和持球字段；缺失指标不按零值处理。位置未知或没有单一球队归属的记录不会进入候选筛选。",
      "不包含可靠的身价、合同、预算、伤病史或转会可行性信息；当前高级足球统计覆盖有限。项目低频读取公开统计页，页面访问受限或结构变更时需等待或调整数据源。",
    ],
  },
  fpl: {
    kind: "current_limited",
    title: "Fantasy Premier League 当前赛季球员池",
    summary: "读取 FPL 当前赛季游戏目录中归属英超俱乐部的球员及已观测到的赛季统计；目录不等于完整注册阵容。",
    limitations: [
      "候选池仅覆盖 Fantasy Premier League 返回且关联到英超俱乐部的游戏球员，不是英超完整注册阵容或全球转会市场。",
      "来源只提供宽泛的门将、后卫、中场、前锋分类；不会据此识别中卫、边后卫、边锋等战术位置。",
      "只能评估来源实际返回的赛季进球、助攻、xG、xA、xGI、抢断、球权恢复及合并解围/封堵/拦截字段；缺失属性不以相邻指标补足。",
      "不提供可靠的身价、合同、转会意愿、预算、伤病、压迫、带球推进或渐进传球信息。",
      "赛季统计随来源更新；来源未提供记录级更新时间 SLA，报告按本机实际读取时间标注。",
    ],
  },
  premier_league: {
    kind: "current_limited",
    title: "Premier League 当前赛季表现池",
    summary: "读取 Premier League 当前赛季球员目录并合并赛季统计榜；年龄只按同源当前赛季球队名单中的出生日期和球员 ID 补充。",
    limitations: [
      "候选池来自 Premier League 单一赛事当前球员目录和统计榜，不代表完整注册阵容、全球转会市场或球员可签约名单；无统计记录的球员分钟为 0，能力属性保持缺失。",
      "来源位置仅映射为门将、后卫、中场、前锋宽组，不能据此确认中卫、边后卫、后腰或边锋等细角色。",
      "只使用适配器实测到的进球、关键传球、成功盘带、抢断、拦截、恢复球权、向前传球和空中对抗字段；未映射字段保持不可用。",
      "来源未提供可用于此适配器的预期进球、渐进传球、带球推进距离、压迫、身价、预算、合同或伤病字段。向前传球不等同于渐进传球。",
      "年龄只在同一来源赛季球队名单中按精确球员 ID 匹配出生日期时可用；匹配失败时年龄未知，且不满足年龄上限筛选。",
      "接口没有公开稳定的开发者 schema、配额或更新时间 SLA；读取时间是本机抓取时间，不构成数据更新保证。",
    ],
  },
  asa: {
    kind: "current_limited",
    title: "American Soccer Analysis 北美三项男足当前赛季表现池",
    summary: "通过 ASA 公开统计接口读取 MLS、USL Championship 与 USL League One 当前赛季的 xGoals、xPass 与 Goals Added 记录；身份按赛事、球员、球队和赛季 ID 精确对应。",
    limitations: [
      "只覆盖 ASA 接口当前返回的 MLS、USL Championship 与 USL League One 当前赛季表现记录，不是完整注册阵容、全球转会市场或球员可签约名单；MLS Next Pro 因 2026 xGoals 返回行数超过本项目完整性上限而未纳入。",
      "跨赛事检索结果必须保留赛事分组；百分位只在同赛事、同赛季和同位置组内比较，不应把不同赛事的原始指标直接当作同水平球员比较。",
      "球队名称仅在 ASA 球队 ID 可解析时显示；球员位置只使用 ASA 的宽组或通用位置，不能推断左右侧职责。",
      "xG、xA、xPass 和 Goals Added 保留 ASA 原始口径；g+ 是场上动作价值指标，不是球队适配分，平均纵向传球距离也不等于渐进传球。",
      "来源未在这些记录中提供最后一次更新的比赛时间；报告显示的是本机读取时间，不能解释为实时更新保证。",
      "来源没有提供可靠的合同、身价、转会可行性、预算或伤病数据；不足以单独判断引援能否达成。",
    ],
  },
  understat: {
    kind: "current_limited",
    title: "Understat 五大联赛当前赛季表现池",
    summary: "串行读取 Understat 当前赛季英超、西甲、德甲、意甲与法甲球员表现页；每条记录保留赛事、赛季、原始球员 ID 与本机抓取时间。",
    limitations: [
      "只覆盖五大联赛当前赛季页面中已有表现记录的球员，不是完整注册阵容、全球转会市场或球员可签约名单。",
      "底层 JSON 路由由网页使用但没有公开稳定的开发者 schema；页面/接口可能变化、限流或不可访问，本机抓取时间也不是来源更新保证。",
      "来源未提供本适配器可用的出生日期、球员年龄、俱乐部 ID、身价、合同、预算、伤病或转会可行性数据；年龄筛选不能执行。",
      "只使用来源实测的进球、助攻、关键传球、xG、npxG、xA、射门、xGChain 与 xGBuildup；缺失值不补零。",
      "xG/npxG 表示来源模型估计的机会数量与质量，不代表终结能力或未来进球；xA、xGChain 与 xGBuildup 保留来源定义，不代替完整创造力或渐进传球。",
      "位置按来源角色字符串归到门将、后卫、中场、前锋宽组；不推断具体位置。跨联赛百分位按同赛事、赛季与位置组分别计算。",
      "来源处理权限尚未核实：公开可读不等于允许自动采集、本地留存、模型/RAG 处理、公开展示或再分发。适配器只在服务进程内缓存，不把原始响应写入仓库；技术限制不代表已获许可，抓取时间也不等于来源更新 SLA。",
    ],
  },
  mosaic: {
    kind: "current_limited",
    title: "多来源当前赛季表现池",
    summary: "组合 Understat 五大联赛与 ASA 当前三项北美男足赛事；每条记录保留原 provider、赛事、赛季和位置组，不做跨来源身份猜测或统一指标排名。",
    limitations: [
      "候选范围只包含 Understat 当前五大联赛与 ASA 当前 MLS、USL Championship、USL League One 中有表现记录的来源记录；不代表完整注册阵容、全球转会市场或球员可签约名单。候选计数是来源记录数，不等于已去重自然人数。",
      "任一来源失败时，多来源候选匹配状态未知；不能把来源失败报告为零匹配或完整的部分结果。",
      "不同来源的球员 ID、赛事标识、位置组和统计口径保持分开；百分位仅在相同 provider、赛事、赛季与位置组内比较，不生成跨来源统一实力排名。",
      "当前没有经验证的 Understat 与 ASA 跨来源身份映射；来源身份只有经过验证的精确 ID bridge 才能关联。同名、球队名或数字 ID 均不构成身份凭据，未关联记录各自保留，组内也不合并表现证据、指标或评分。",
      "Understat 没有出生日期或年龄；跨来源检索不能执行年龄上限筛选，只有明确限定到支持的 ASA 赛事时才使用 ASA 年龄数据。",
      "只使用各来源本次实际提供的字段；位置仅为宽组。压迫、推进及未观测能力，以及身价、合同、预算、伤病和转会可行性信息均保持为数据缺口。",
      "来源适配器与查询成功不证明来源授予本地持久化、AI/RAG 处理或公开展示许可；各来源仍需分别核实处理边界。",
    ],
  },
};

export function describeDatasetScope(
  mode: DatasetMode,
  players?: readonly Pick<PlayerProfile, "competition" | "season" | "datasetId" | "datasetBuiltAt">[],
  datasetSnapshot?: DatasetSnapshotStatus | null,
): DatasetScope {
  const scope = datasetScopes[mode];
  const recordDataset = players?.find((player) => player.datasetId);
  const datasetId = datasetSnapshot?.datasetId ?? recordDataset?.datasetId;
  const datasetBuiltAt = datasetSnapshot?.builtAt ?? recordDataset?.datasetBuiltAt;
  const observedCoverage = players ? {
    playerRecordCount: players.length,
    competitions: [...new Set(players.map((player) => player.competition).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    seasons: [...new Set(players.map((player) => player.season).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
  } : undefined;
  return {
    ...scope,
    limitations: [...scope.limitations],
    ...(datasetId ? { datasetId } : {}),
    ...(datasetBuiltAt ? { datasetBuiltAt } : {}),
    ...(observedCoverage ? { observedCoverage } : {}),
  };
}
