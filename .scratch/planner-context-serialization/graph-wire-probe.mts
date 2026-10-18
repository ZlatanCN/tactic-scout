import 'dotenv/config';
import {StateGraph,Annotation,START,END} from '@langchain/langgraph';
import {createChatModel} from '../../src/recruitment/chat-model.js';
const original=globalThis.fetch;
globalThis.fetch=async (_url,init)=>{
 const body=JSON.parse(String(init?.body));
 console.log(JSON.stringify({stream:body.stream,reasoningEffort:body.reasoning_effort,maxTokens:body.max_tokens,temperature:body.temperature}));
 throw new Error('WIRE_CAPTURED');
};
try{
 const state=Annotation.Root({text:Annotation<string>});
 const graph=new StateGraph(state).addNode('model',async()=>{await createChatModel('fixture',process.env.OPENAI_MODEL!).invoke('仅回答OK');return{text:'done'};}).addEdge(START,'model').addEdge('model',END).compile();
 const run=await graph.streamEvents({text:''},{version:'v3',streamMode:['custom']});
 await run.output;
}catch(error){console.log('probe stopped after intercepted request');}finally{globalThis.fetch=original;}
