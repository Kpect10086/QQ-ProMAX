import {expect,it} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
function fixture(){const q=new QQWorld({groups:'2',privates:'1,3',quietReply:{enabled:false},proactive:{quietFrom:0,quietTo:0}}) as any;
  const sent:any[]=[];q.log=nullLogger();q.host={isPaused:()=>false,store:{range:()=>[]},pushEvent:async()=>{}};
  q.driver={connected:true,callApi:async(_a:string,p:any)=>{sent.push(p);return {message_id:1};}};
  q.config.sendIntervalMs=0;q.config.antiLoop.enabled=false;q.connected=true;
  q.aliases.set('联系甲',1);q.aliases.set('联系乙',3);return {q,sent};}
it('an empty private history reports open access and the exact address, then allows a new outbound message',async()=>{
  const {q,sent}=fixture();const recent=q.tools().find((t:any)=>t.name==='qq_history');
  const receipt=await recent.handler({mode:'recent',peer:3,minutes:60},{});
  expect(receipt).toContain('读取已开放');expect(receipt).toContain('当前发送限制：允许发送');
  expect(receipt).toContain('to="private:3"');expect(receipt).toContain('不代表会话关闭');
  await q.sendTo('private:3','新消息');expect(sent).toHaveLength(1);
  const policy=q.routineSegmentText();expect(policy).toContain('联系甲');expect(policy).toContain('联系乙');
  expect(policy).toContain('to=private:3');expect(q.nameVariantsFor(3)).toContain('联系乙');
});
it('a current send restriction is explicit without confusing it with closed read access',async()=>{
  const {q}=fixture();q.streamGate={blocked:()=>true};const recent=q.tools().find((t:any)=>t.name==='qq_history');
  expect(await recent.handler({mode:'recent',peer:1},{})).toContain('直播期间 QQ 消息暂存');
  q.config.replyPrivates=false;expect(await recent.handler({mode:'recent',peer:1},{})).toContain('未开放读取');
  q.config.replyPrivates=true;expect(await recent.handler({mode:'recent',peer:99},{})).toContain('未开放读取');
});
