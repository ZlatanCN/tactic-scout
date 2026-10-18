import 'dotenv/config';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createRecruitmentPlanner,investigationInstructions,methodologySearchInstructions} from '../../src/recruitment/recruitment-planner.js';
const source=execFileSync('git',['show','12d17fe:src/recruitment/recruitment-planner.ts'],{encoding:'utf8'});
const literal=source.slice(source.indexOf('const agentInstructions = ')+26,source.indexOf('\nexport function conclusionInstructions')).trim().replace(/;$/,'');
const originalCommon=Function('methodologySearchInstructions',`return ${literal}`)(methodologySearchInstructions);
const active=investigationInstructions('understat');
const baseline=originalCommon+'\n'+active.slice(active.indexOf('Understat 只覆盖'));
const originalFetch=globalThis.fetch;
const results=[];
const input={dataMode:'understat' as const,dataSource:'Understat fixture',targetTeam:'巴萨',confirmedPosition:'DEF' as const,history:[
 {role:'user' as const,content:'为巴萨找后卫，重点考察创造机会，按已有xA证据给出后续考察线索，不增加年龄和联赛限制。'},
 {role:'tool' as const,toolName:'search_candidates',content:JSON.stringify({candidates:[{playerId:'fixture-a',name:'A',position:'DEF'},{playerId:'fixture-b',name:'B',position:'DEF'}],nextOffset:null,matchingRecords:2})},
 {role:'tool' as const,toolName:'evaluate_candidates',content:JSON.stringify({evaluations:[{playerId:'fixture-a',name:'A',position:'DEF',metrics:[{key:'understatExpectedAssistsPer90',value:0.25,unit:'xA/90分钟',minutes:1200}]},{playerId:'fixture-b',name:'B',position:'DEF',metrics:[{key:'understatExpectedAssistsPer90',value:0.15,unit:'xA/90分钟',minutes:1200}]}]})},
 {role:'tool' as const,toolName:'search_player_reports',content:JSON.stringify({results:[]})}
]};
try {
 for(let pair=0;pair<3;pair++) for(const arm of pair%2===0?['baseline','active']:['active','baseline']) {
  let usage:unknown;let systemChars=0;
  globalThis.fetch=async(url,init)=>{
   if(init?.body&&typeof init.body==='string') {
    const body=JSON.parse(init.body);
    if(body.messages?.[0]?.role==='system') { if(arm==='baseline') body.messages[0].content=baseline;systemChars=body.messages[0].content.length;init={...init,body:JSON.stringify(body)}; }
   }
   return originalFetch(url,init);
  };
  const started=performance.now();
  try {
   const action=await createRecruitmentPlanner().decide({...input,onTokenUsage:u=>{usage=u;}});
   const valid=action.action==='finish'&&action.reportObservations.length===0&&action.recommendations.length>0&&action.recommendations.every(r=>['fixture-a','fixture-b'].includes(r.playerId)&&r.evidenceKeys.every(k=>k==='understatExpectedAssistsPer90'));
   results.push({pair,arm,systemChars,elapsedMs:Math.round(performance.now()-started),valid,action,usage});
  }catch(error){results.push({pair,arm,systemChars,elapsedMs:Math.round(performance.now()-started),error:String(error),usage});}
  console.log(JSON.stringify(results.at(-1)));await writeFile('.data/evaluations/provider-instructions/results.json',JSON.stringify(results,null,2));
 }
}finally{globalThis.fetch=originalFetch;}
