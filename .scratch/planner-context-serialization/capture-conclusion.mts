import 'dotenv/config';
import {writeFile} from 'node:fs/promises';
import {configuredRecruitmentConversation} from '../../src/recruitment/conversation.js';
import {getDataRepository} from '../../src/evaluation/local-agent-environment.js';
import {createRecruitmentPlanner,RecruitmentModelTimeoutError} from '../../src/recruitment/recruitment-planner.js';
const model=createRecruitmentPlanner();
const conversation=configuredRecruitmentConversation({repository:getDataRepository(),plannerFactory:()=>({async decide(input){
 if(input.decisionMode==='expand') throw new RecruitmentModelTimeoutError(60000);
 if(input.decisionMode==='conclude') {
  const {signal,onTokenUsage,...frozen}=input;
  await writeFile('.data/evaluations/conclusion-context/input.json',JSON.stringify(frozen,null,2),{mode:0o600});
  console.log(JSON.stringify({captured:true,mode:input.decisionMode,historyEntries:input.history.length,candidates:input.constraints?.evaluatedCandidates.length}));
  throw new Error('CAPTURE_COMPLETE');
 }
 return model.decide(input);
}})});
try {await conversation.turn({threadId:`capture-${Date.now()}`,message:'我想为巴萨找一个新的后卫，要能参与出球和高位防守'});}catch(error){if(!(error instanceof Error&&error.message.includes('CAPTURE_COMPLETE'))) throw error;}
