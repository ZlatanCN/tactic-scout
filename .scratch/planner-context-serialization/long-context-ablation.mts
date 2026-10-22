import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {createRecruitmentPlanner} from '../../src/recruitment/recruitment-planner.js';
const base=JSON.parse(await readFile('.data/evaluations/conclusion-context/input.json','utf8'));
const previousTimeout=process.env.OPENAI_TIMEOUT_MS;
process.env.OPENAI_TIMEOUT_MS='180000';
const results=[];
for(const arm of ['base','history_trimmed','candidate_context_trimmed'] as const){
  let input=structuredClone(base);
  if(arm==='history_trimmed') input.history=input.history.slice(-3);
  if(arm==='candidate_context_trimmed'){
    input.history=input.history.filter((e:any)=>e.role==='user'||e.role==='assistant');
    if(input.constraints) input.constraints.evaluatedCandidates=input.constraints.evaluatedCandidates.slice(0,8);
  }
  let usage:any;
  const started=performance.now();
  try{
    const action=await createRecruitmentPlanner().decide({...input,onTokenUsage:(u:any)=>usage=u});
    results.push({arm,elapsedMs:Math.round(performance.now()-started),ok:true,action,usage});
  }catch(error){results.push({arm,elapsedMs:Math.round(performance.now()-started),ok:false,error:String(error),usage});}
  await writeFile(`/tmp/long-context-${arm}.json`,JSON.stringify(results.at(-1),null,2));
  console.log(JSON.stringify({arm,elapsedMs:results.at(-1)!.elapsedMs,ok:results.at(-1)!.ok,usage}));
}
if(previousTimeout===undefined)delete process.env.OPENAI_TIMEOUT_MS;else process.env.OPENAI_TIMEOUT_MS=previousTimeout;
