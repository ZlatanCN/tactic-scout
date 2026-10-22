import 'dotenv/config';
import { createRecruitmentPlanner } from '/Users/zhujiayou/Documents/Codex/2026-09-29/referenced-chatgpt-conversation-this-is-an/src/recruitment/recruitment-planner.ts';
import { RecruitmentBriefSchema } from '/Users/zhujiayou/Documents/Codex/2026-09-29/referenced-chatgpt-conversation-this-is-an/src/domain/recruitment-brief.ts';
const brief=RecruitmentBriefSchema.parse({task:'reinforcement',targetTeam:{value:'巴萨',quote:'巴萨',basis:'explicit'},referencePlayer:null,referenceClues:[],referenceRecheck:null,positions:['DEF'],priorities:[],constraints:[],filters:{maxAge:null,minimumMinutes:0,competition:null,season:null},unresolved:[]});
const history=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'tool' as any,toolName:i%2?undefined:'investigation_policy',content:'这是一段用于上下文压力测试的真实中文调查记录，包含候选、指标、限制与证据说明。'.repeat(35)}));
const started=performance.now();
let usage;
try {
 const action=await createRecruitmentPlanner().decide({brief,history:history as any,dataMode:'demo',dataSource:'Demo',targetTeam:'巴萨',decisionMode:'investigate',confirmedPosition:null,confirmedPositions:[],positionBroadeningApproved:false,onTokenUsage:u=>usage=u});
 console.log(JSON.stringify({ok:true,elapsedMs:Math.round(performance.now()-started),action,usage}));
} catch(e) { console.log(JSON.stringify({ok:false,elapsedMs:Math.round(performance.now()-started),error:String(e),usage})); }
