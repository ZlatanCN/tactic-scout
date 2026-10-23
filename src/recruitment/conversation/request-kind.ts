/**
 * Conservative production routing for questions about indexed sources.
 * Recruitment requests stay on the existing default path when the wording is
 * ambiguous; the classifier only selects knowledge Q&A on clear research
 * signals.
 */
export function isKnowledgeQuestion(message: string): boolean {
  const text = message.normalize("NFKC").trim();
  if (!text) return false;

  const recruitmentActionSignal = /(?:推荐|寻找|找人|引援|替代者|接班人|补强|转会|签约|招聘|检查.{0,8}(?:球队|阵容)|(?:球队|阵容).{0,4}样本|(?:find|look\s+for|search\s+for)\s+(?:(?:me|us)\s+)?(?:(?:a|an|some|one)\s+)?(?:candidate|player|footballer|striker|forward|midfielder|winger|defender|goalkeeper|replacement|successor)\b|recommend\s+(?:(?:me|us)\s+)?(?:(?:a|an|some|one)\s+)?(?:candidate|player|footballer|striker|forward|midfielder|winger|defender|goalkeeper)\b|(?:need|want)\s+(?:a|an|some|one\s+)?(?:replacement|successor|backup)\b|sign\s+(?:(?:a|an|the)\s+)?(?:player|footballer|striker|forward|midfielder|winger|defender|goalkeeper)\b|shortlist\s+(?:players|candidates|strikers|forwards|midfielders|wingers|defenders|goalkeepers)\b|找一[名个位]|寻找一[名个位]|需要一[名个位])/iu.test(text);
  const recruitmentEntitySignal = /(?:候选|球员|candidate|player)/iu.test(text);
  const sourceQuestionSignal = /(?:这份|该|这篇|上述|原文).{0,8}(?:报告|文档|文章|论文|研究|文献|资料).{0,12}(?:讲|说|写|结论|观点|发现|提到|内容|分析|回答|依据|方法|样本|数据|作者|引用)|(?:报告|文档|文章|论文|研究|文献|资料).{0,12}(?:讲了什么|说了什么|写了什么|核心结论|主要结论|结论是什么|主要观点|研究发现|提到什么)|(?:report|paper|study|article|source).{0,16}(?:say|write|conclude|find|mention|discuss|cover|claim|study|analyze|analyse|assess|evaluate|observe|include|examine)/iu.test(text);
  const knowledgeSignal = /(?:论文|研究|文献|原文|作者|摘要|方法|实验|样本|数据集|资料|来源|引用|报告说|提到|回答|解释|是什么|为什么|如何|多少|哪一年|哪一季|paper|study|research|source|citation|abstract|method|experiment|sample|dataset|according to)/iu.test(text);
  const paperIdentifier = /\b(?:doi|arxiv|pubmed|plos|jats)\b|10\.\d{4,9}\//iu.test(text);
  return !recruitmentActionSignal && (paperIdentifier || sourceQuestionSignal || (knowledgeSignal && !recruitmentEntitySignal));
}
