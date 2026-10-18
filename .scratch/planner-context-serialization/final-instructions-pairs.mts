import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {createRecruitmentPlanner,conclusionInstructions,type RecruitmentPlanner} from '../../src/recruitment/recruitment-planner.js';
const input=JSON.parse(await readFile('.data/evaluations/conclusion-context/input.json','utf8')) as Parameters<RecruitmentPlanner['decide']>[0];
const baseline=await readFile('.scratch/planner-context-serialization/baseline-final-instructions.txt','utf8');
const active=conclusionInstructions('understat');
const allowed=new Map(input.constraints?.evaluatedCandidates.map(c=>[c.playerId,new Set(c.evidenceKeys)]));
const originalFetch=globalThis.fetch;const results=[];
try {
 for(let pair=0;pair<3;pair++)for(const arm of pair%2===0?['baseline','phase']:['phase','baseline']) {
  let usage:unknown;let cachedTokens:unknown;let bodyCapture=Promise.resolve();
  globalThis.fetch=async(url,init)=>{
   if(arm==='baseline'&&typeof init?.body==='string') {
    const body=JSON.parse(init.body);if(body.messages?.[0]?.role==='system') {body.messages[0].content=body.messages[0].content.replace(active,baseline);init={...init,body:JSON.stringify(body)};}
   }
   const response=await originalFetch(url,init);
   bodyCapture=response.clone().json().then(body=>{cachedTokens=body.usage?.prompt_tokens_details?.cached_tokens;}).catch(()=>{});
   return response;
  };
  const started=performance.now();
  try {
   const action=await createRecruitmentPlanner().decide({...input,onTokenUsage:u=>{usage=u;}});
   const elapsedMs=Math.round(performance.now()-started);await bodyCapture;
   const valid=action.action==='finish'&&action.recommendations.length>0&&new Set(action.recommendations.map(r=>r.playerId)).size===action.recommendations.length&&action.recommendations.every(r=>allowed.has(r.playerId)&&r.evidenceKeys.every(k=>allowed.get(r.playerId)!.has(k)))&&action.reportObservations.length===0;
   results.push({pair,arm,elapsedMs,valid,usage,cachedTokens,action});
  }catch(error){await bodyCapture;results.push({pair,arm,elapsedMs:Math.round(performance.now()-started),error:String(error),usage,cachedTokens});}
  const row=results.at(-1)!;console.log(JSON.stringify({pair,arm,elapsedMs:row.elapsedMs,valid:'valid'in row?row.valid:false,usage,cachedTokens}));
  await writeFile('.data/evaluations/conclusion-context/final-instructions-results.json',JSON.stringify(results,null,2),{mode:0o600});
 }
}finally{globalThis.fetch=originalFetch;}
