const ENDPOINT="https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL="gemini-3.7-flash";
function getKeys(){return(process.env.GEMINI_API_KEYS||process.env.GEMINI_API_KEY||"").split(",").map(x=>x.trim()).filter(Boolean)}
function parse(req){return new Promise((ok,no)=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>{try{ok(JSON.parse(s||"{}"))}catch(e){no(e)}});req.on("error",no)})}
function reply(res,n,b){res.statusCode=n;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(b))}
function input(body){
 let a=[{type:"text",text:body.message||""}];
 for(const f of body.files||[]){if(!f.data)continue;let m=f.type||"application/octet-stream";
  if(m.startsWith("image/"))a.push({type:"image",data:f.data,mime_type:m});
  else if(m==="application/pdf")a.push({type:"document",data:f.data,mime_type:m});
  else {let t="";try{t=Buffer.from(f.data,"base64").toString("utf8")}catch{};a.push({type:"text",text:`\nFILE ${f.name||"attachment"}:\n${t.slice(0,400000)}`})}
 }
 return a.length===1?a[0].text:a
}
module.exports=async function(req,res){
 if(req.method==="GET")return reply(res,200,{ok:true,model:MODEL,time:Date.now()});
 if(req.method!=="POST")return reply(res,405,{error:"Method not allowed"});
 let b;try{b=await parse(req)}catch{return reply(res,400,{error:"Invalid JSON"})}
 let ks=getKeys();if(!ks.length)return reply(res,500,{error:"GEMINI_API_KEYS is not configured."});
 let start=Math.floor(Date.now()/1000)%ks.length,up=null,last="";
 for(let z=0;z<ks.length;z++){let key=ks[(start+z)%ks.length];try{
  let payload={model:b.model||MODEL,input:input(b),stream:true,generation_config:{thinking_level:["low","medium","high"].includes(b.thinking)?b.thinking:"medium"}};
  if(b.webSearch)payload.tools=[{type:"google_search"}];
  let r=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Accept":"text/event-stream","x-goog-api-key":key,"Api-Revision":"2026-05-20"},body:JSON.stringify(payload)});
  if(r.ok){up=r;break}last=await r.text();if(![401,403,408,429,500,502,503,504].includes(r.status))break;
 }catch(e){last=e.message}}
 if(!up){let msg=last||"Gemini request failed";try{msg=JSON.parse(last).error.message||msg}catch{}return reply(res,502,{error:msg})}
 res.statusCode=200;res.setHeader("Content-Type","text/event-stream; charset=utf-8");res.setHeader("Cache-Control","no-cache, no-transform");res.setHeader("Connection","keep-alive");res.setHeader("X-Accel-Buffering","no");if(res.flushHeaders)res.flushHeaders();
 let reader=up.body.getReader(),dec=new TextDecoder(),buf="";const send=x=>res.write("data: "+JSON.stringify(x)+"\n\n");send({type:"status",text:"Thinking…"});
 try{while(true){let q=await reader.read();if(q.done)break;buf+=dec.decode(q.value,{stream:true});let parts=buf.split(/\r?\n\r?\n/);buf=parts.pop()||"";for(const p of parts){let ev="",data="";for(const l of p.split(/\r?\n/)){if(l.startsWith("event:"))ev=l.slice(6).trim();if(l.startsWith("data:"))data+=l.slice(5).trim()}if(!data)continue;let j;try{j=JSON.parse(data)}catch{continue}
  if(ev==="step.start"&&j.step?.type==="thought")send({type:"status",text:"Thinking…"});
  else if(ev==="step.start"&&j.step?.type==="model_output")send({type:"status",text:"Solving…"});
  else if(ev==="step.delta"&&j.delta?.type==="text")send({type:"text",text:j.delta.text});
  else if(ev==="step.delta"&&j.delta?.text)send({type:"text",text:j.delta.text});
 }}send({type:"done"})}catch(e){send({type:"error",error:e.message||"Stream interrupted"})}finally{res.end()}
};
