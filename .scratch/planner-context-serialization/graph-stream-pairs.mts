import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {StateGraph,Annotation,START,END} from '@langchain/langgraph';
import {ChatOpenAI} from '@langchain/openai';
import {createRecruitmentPlanner,normalizeModelTokenUsage,type RecruitmentPlanner} from '../../src/recruitment/recruitment-planner.js';
import {structuredModelText} from '../../src/recruitment/model-output.js';
import {createConstrainedConclusionSchema} from '../../src/recruitment/conclusion-policy.js';
const input=JSON.parse(await readFile('.data/evaluations/conclusion-context/input.json','utf8')) as Parameters<RecruitmentPlanner['decide']>[0];
const originalFetch=globalThis.fetch;let wire:any;
globalThis.fetch=async(_url,init)=>{wire=JSON.parse(String(init?.body));throw new Error('CAPTURE_ONLY');};
try{await createRecruitmentPlanner().decide(input);}catch{}finally{globalThis.fetch=originalFetch;}
if(!wire?.messages)throw new Error('Wire capture missing');
const schema=createConstrainedConclusionSchema(input.constraints!);
const allowed=new Map(input.constraints?.evaluatedCandidates.map(c=>[c.playerId,new Set(c.evidenceKeys)]));
const results=[];
for(let pair=0;pair<3;pair++)for(const arm of pair%2===0?['auto','off']:['off','auto']) {
 let sentStream:unknown;let usage:unknown;
 globalThis.fetch=async(url,init)=>{sentStream=JSON.parse(String(init?.body)).stream;return originalFetch(url,init);};
 const started=performance.now();
 try{
  const model=new ChatOpenAI({apiKey:process.env.OPENAI_API_KEY!,model:process.env.OPENAI_MODEL!,temperature:0,presencePenalty:0,frequencyPenalty:0,maxTokens:wire.max_tokens,timeout:180000,maxRetries:0,modelKwargs:{reasoning_effort:'none'},configuration:{baseURL:process.env.OPENAI_BASE_URL,fetchOptions:{redirect:'manual'}},...(arm==='off'?{streaming:false}:{})});
  const structured=model.withStructuredOutput(schema,{name:'recruitment_action',method:'jsonSchema',includeRaw:true});
  const state=Annotation.Root({action:Annotation<unknown>});
  const graph=new StateGraph(state).addNode('planner',async()=>{const response=await structured.invoke(wire.messages);usage=normalizeModelTokenUsage(response);return{action:response.parsed ?? schema.parse(JSON.parse(structuredModelText(response.raw?.content)))};}).addEdge(START,'planner').addEdge('planner',END).compile();
  const run=await graph.streamEvents({action:null},{version:'v3',streamMode:['custom']});
  const action=(await run.output).action as any;
  const valid=action?.action==='finish'&&action.recommendations.length>0&&new Set(action.recommendations.map((r:any)=>r.playerId)).size===action.recommendations.length&&action.recommendations.every((r:any)=>allowed.has(r.playerId)&&r.evidenceKeys.every((k:any)=>allowed.get(r.playerId)!.has(k)))&&action.reportObservations.length===0;
  results.push({pair,arm,sentStream,elapsedMs:Math.round(performance.now()-started),valid,usage,action});
 }catch(error){results.push({pair,arm,sentStream,elapsedMs:Math.round(performance.now()-started),error:String(error),usage});}
 finally{globalThis.fetch=originalFetch;}
 await writeFile('.data/evaluations/conclusion-context/graph-stream-results-v2.json',JSON.stringify(results,null,2),{mode:0o600});
 const row=results.at(-1)!;console.log(JSON.stringify({pair,arm,sentStream,elapsedMs:row.elapsedMs,valid:'valid'in row?row.valid:false,usage}));
}
