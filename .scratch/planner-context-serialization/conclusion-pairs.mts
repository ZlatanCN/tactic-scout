import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {createRecruitmentPlanner,type RecruitmentPlanner} from '../../src/recruitment/recruitment-planner.js';
const input=JSON.parse(await readFile('.data/evaluations/conclusion-context/input.json','utf8')) as Parameters<RecruitmentPlanner['decide']>[0];
const results=[];
const allowed=new Map(input.constraints?.evaluatedCandidates.map(c=>[c.playerId,new Set(c.evidenceKeys)]));
for(let pair=0;pair<3;pair++)for(const arm of (pair%2===0?['full','selection']:['selection','full']) as Array<'full'|'selection'>){
 let usage:unknown;
 const started=performance.now();
 try{
  const action=await createRecruitmentPlanner({conclusionOutput:arm}).decide({...input,onTokenUsage:u=>{usage=u;}});
  const valid=action.action==='finish'&&action.recommendations.length>0&&new Set(action.recommendations.map(r=>r.playerId)).size===action.recommendations.length&&action.recommendations.every(r=>allowed.has(r.playerId)&&r.evidenceKeys.every(k=>allowed.get(r.playerId)!.has(k)))&&action.reportObservations.length===0;
  results.push({pair,arm,elapsedMs:Math.round(performance.now()-started),valid,usage,action});
 }catch(error){results.push({pair,arm,elapsedMs:Math.round(performance.now()-started),error:String(error),usage});}
 await writeFile('.data/evaluations/conclusion-context/results.json',JSON.stringify(results,null,2),{mode:0o600});
 const row=results.at(-1)!;console.log(JSON.stringify({pair,arm,elapsedMs:row.elapsedMs,valid:'valid' in row?row.valid:false,usage}));
}
