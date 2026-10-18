export const abilityLabels: Record<string, string> = {
  crossing: "传中", dribbling: "盘带", finishing: "射门", heading: "头球", long_shots: "远射", marking: "盯人",
  off_the_ball: "无球跑动", passing: "传球", penalty_taking: "点球", tackling: "抢断", vision: "视野",
  handling: "手控球", aerial_reach: "制空范围", command_of_area: "禁区控制", communication: "指挥防线",
  kicking: "大脚开球", throwing: "手抛球", anticipation: "预判", decisions: "决策", one_on_ones: "一对一防守",
  positioning: "防守站位", reflexes: "反应", first_touch: "第一脚触球", technique: "技术", flair: "想象力",
  corners: "角球", teamwork: "团队合作", work_rate: "工作投入", long_throws: "界外球", eccentricity: "意外性",
  rushing_out: "出击", punching: "击球倾向", acceleration: "加速", free_kick_taking: "任意球", strength: "强壮",
  stamina: "耐力", pace: "速度", jumping_reach: "弹跳高度", leadership: "领导力", dirtiness: "小动作倾向",
  balance: "平衡", bravery: "勇敢", consistency: "稳定性", aggression: "侵略性", agility: "灵活",
  important_matches: "重要比赛发挥", injury_proneness: "伤病倾向", versatility: "多面性", natural_fitness: "自然体质",
  determination: "意志力", composure: "镇定", concentration: "集中",
};

export const abilityGroups = [
  { id: "technical", label: "技术", keys: ["crossing", "dribbling", "finishing", "heading", "long_shots", "marking", "passing", "penalty_taking", "tackling", "first_touch", "technique", "corners", "long_throws", "free_kick_taking"] },
  { id: "mental", label: "意识", keys: ["off_the_ball", "vision", "anticipation", "decisions", "positioning", "flair", "teamwork", "work_rate", "leadership", "dirtiness", "bravery", "consistency", "aggression", "important_matches", "injury_proneness", "versatility", "determination", "composure", "concentration"] },
  { id: "physical", label: "身体", keys: ["acceleration", "strength", "stamina", "pace", "jumping_reach", "balance", "agility", "natural_fitness"] },
  { id: "goalkeeping", label: "门将", keys: ["handling", "aerial_reach", "command_of_area", "communication", "kicking", "throwing", "one_on_ones", "reflexes", "eccentricity", "rushing_out", "punching"] },
] as const;

export function friendlyMetricLabel(label: string): string {
  return label.replace(/^(?:Understat|ASA|Premier League|FPL|StatsBomb|Wyscout|SkillCorner)\s*/i, "");
}

export const personalityLabels: Record<string, string> = {
  adaptability: "适应能力", ambition: "进取心", loyalty: "忠诚度", pressure: "抗压",
  professionalism: "职业素养", sportsmanship: "体育精神", temperament: "情绪控制", controversy: "争议倾向",
};

export const traitLabels: Record<string, string> = {
  avoids_using_weaker_foot: "较少使用逆足",
  comes_deep_to_get_ball: "回撤接球",
  crosses_early: "提前传中",
  dictates_tempo: "掌控比赛节奏",
  dives_into_tackles: "倾向倒地铲抢",
  gets_forward_whenever_possible: "积极前插",
  knocks_ball_past_opponent: "人球分过",
  likes_to_try_to_beat_offside_trap: "尝试反越位跑动",
  moves_into_channels: "向肋部空当跑动",
  runs_with_ball_down_left: "沿左路带球推进",
  runs_with_ball_down_right: "沿右路带球推进",
  runs_with_ball_often: "经常带球推进",
  runs_with_ball_through_centre: "从中路带球推进",
  shoots_from_distance: "偏好远射",
  tries_killer_balls_often: "经常尝试直塞",
  tries_long_range_passes: "尝试长距离传球",
};
