import 'dotenv/config';
const url = `${process.env.OPENAI_BASE_URL}/chat/completions`;
const messages = [{role:'system',content:'Return a JSON object with action finish. No prose.'},{role:'user',content:'Return {"action":"finish"}'}];
for (const options of [
  {},
  {reasoning_effort:'none'},
  {thinking:{type:'disabled'}},
  {chat_template_kwargs:{enable_thinking:false}},
  {reasoning_effort:'none',thinking:{type:'disabled'}},
]) {
  const started=performance.now();
  try {
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL,messages,max_tokens:128,temperature:0,...options})});
    const body=await response.text();
    console.log(JSON.stringify({options,status:response.status,elapsedMs:Math.round(performance.now()-started),body:body.slice(0,500)}));
  } catch (error) {
    console.log(JSON.stringify({options,elapsedMs:Math.round(performance.now()-started),error:String(error)}));
  }
}
