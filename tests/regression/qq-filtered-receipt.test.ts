import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
let server:Server, url:string;
beforeEach(async()=>{
  server=createServer(async(req,res)=>{
    let data='';for await(const part of req)data+=part;
    const {purpose}=JSON.parse(data);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(purpose==='received'?{allow:false,reason:'test-review',sanitizedText:'（敏感话题）'}:{allow:true,reason:'safe'}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  url=`http://127.0.0.1:${(server.address() as any).port}/review`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.useRealTimers();});

function fixture() {
  const q=new QQWorld({privates:'1',contentReviewUrl:url,sendIntervalMs:0,privateAggregationWindow:3000,
    voice:{enabled:false},call:{enabled:false},affinity:{enabled:false},antiLoop:{enabled:false},
    quietReply:{enabled:false},proactive:{quietFrom:0,quietTo:0}}) as any;
  const events:any[]=[], sent:any[]=[], queued:any[]=[];
  let paused=false;
  q.log=nullLogger();q.connected=true;
  q.driver={connected:true,callApi:async(_action:string,args:any)=>{sent.push(args);return {message_id:sent.length};}};
  q.host={isPaused:()=>paused,store:{range:()=>events},
    pushEvent:async(e:any,opts:any)=>{const saved={...e,cursor:events.length+1,contextDelivery:opts?.deliver===false?'archive-only':'deliver'};events.push(saved);return saved;},
    pushDeferred:(e:any)=>queued.push(e)};
  const flush=()=>{for(const e of queued.splice(0)){const r=e.render();if(r)events.push({...e,cursor:events.length+1,origin:e.origin??'external',source:'qqbot',text:typeof r==='string'?r:r.text,contextDelivery:'deliver'});}};
  const incoming=async(id=42)=>{await q.handleMessage({message_id:id,message_type:'private',time:Date.now()/1000,message:[{type:'text',data:{text:'待审核的测试正文'}}]},
    {address:'private:1',kind:'private',id:1,label:'fixture'},{userId:1,name:'fixture'});flush();};
  const settle=async(count=1)=>{for(let i=0;i<50&&sent.length<count;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  return {q,events,sent,incoming,settle,pause:()=>{paused=true;}};
}

it('sends one filtered receipt even if the model ends silently, bypassing aggregation and voice',async()=>{
  const {q,sent,events,incoming,settle}=fixture();await incoming();
  expect(q.pendingFilteredReplies.has('private:1')).toBe(true);
  expect(events.some(e=>e.meta?.inputRejected)).toBe(true);
  expect(events.some(e=>e.text?.includes('待审核的测试正文'))).toBe(false);
  q.onTurnEnded();await settle();q.onTurnEnded();
  expect(sent).toHaveLength(1);expect(sent[0].message).toEqual([{type:'text',data:{text:'filtered'}}]);
});

it('an explicit model reply is replaced by filtered and does not receive a second fallback',async()=>{
  const {q,sent,incoming,settle}=fixture();await incoming();
  await q.tools().find((t:any)=>t.name==='qq_send').handler({to:'private:1',text:'模型尝试继续回答'},{});
  q.onTurnEnded();await settle();
  expect(sent).toHaveLength(1);expect(sent[0].message).toEqual([{type:'text',data:{text:'filtered'}}]);
});

it('a new rejected input can receive filtered again within six seconds',async()=>{
  const {q,sent,incoming,settle}=fixture();
  await incoming(42);q.onTurnEnded();await settle();
  await incoming(43);q.onTurnEnded();await settle(2);
  expect(sent).toHaveLength(2);
});

it.each(['paused','closed','quiet'])('filtered feedback respects %s rather than bypassing permissions',async(mode)=>{
  const {q,sent,incoming,pause}=fixture();await incoming();
  if(mode==='paused')pause();
  if(mode==='closed')q.config.replyPrivates=false;
  if(mode==='quiet'){
    vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T23:30:00+08:00'));
    q.config.timezone='Asia/Singapore';q.config.quietReply={enabled:true,privates:'',groups:''};
    q.config.routine={enabled:true,sleepStart:'23:00',sleepEnd:'07:00',lazyStart:'12:00',lazyEnd:'13:00'};
  }
  q.onTurnEnded();expect(sent).toHaveLength(0);
});
