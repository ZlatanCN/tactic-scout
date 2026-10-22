import 'dotenv/config';
const url=`${process.env.OPENAI_BASE_URL}/chat/completions`;
for(const model of ['tactiscout-qwen3.5:9b','qwen3.5:9b']){
 const started=performance.now();
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:'Return JSON {"action":"finish"}'},{role:'user',content:'go'}],max_tokens:64,temperature:0,reasoning_effort:'none',response_format:{type:'json_schema',json_schema:{name:'x',strict:true,schema:{type:'object',properties:{action:{type:'string',const:'finish'}},required:['action'],additionalProperties:false}}}})});
 console.log(JSON.stringify({model,status:r.status,elapsedMs:Math.round(performance.now()-started),body:(await r.text()).slice(0,500)}));
}
