import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
const dirs:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'qq-missing-sticker-'));dirs.push(dir);
  const q=new QQWorld({privates:'1',emojiDir:dir,sendIntervalMs:0,contentReviewUrl:'',voice:{enabled:false},
    maxPrivateMessagesPerReply:2,antiLoop:{enabled:false},quietReply:{enabled:false},routine:{enabled:false},proactive:{quietFrom:0,quietTo:0}}) as any;
  const sent:any[]=[],events:any[]=[];q.log=nullLogger();
  q.host={isPaused:()=>false,pushEvent:async(e:any)=>{events.push(e);return e;},store:{range:()=>[{cursor:1,type:'qq.message',origin:'external',senderKey:'private:1'}]}};
  q.driver={connected:true,callApi:async(_a:string,p:any)=>{sent.push(p);return{message_id:sent.length};}};
  return{q,dir,sent,events};
}
it('keeps ordinary text when a model invents a sticker name, recording only the delivered text',async()=>{
  const {q,sent,events}=fixture();
  const send=q.tools().find((t:any)=>t.name==='qq_send');
  const result=await send.handler({to:'private:1',text:'在呢！\n[表情包:抱抱.jpg]'},{});
  expect(result).toContain('已发送');expect(result).toContain('未附上 1 个无效表情包');expect(result).toContain('不要重发正文');
  expect(sent).toHaveLength(1);expect(sent[0].message.every((s:any)=>s.type==='text')).toBe(true);
  expect(sent[0].message.map((s:any)=>s.data.text).join('').trim()).toBe('在呢！');
  expect(events.find(e=>e.type==='qq.sent').meta.text.trim()).toBe('在呢！');
  expect(q.recentSends[0].text).not.toContain('表情包');
});
it('deduplicates delivered text despite a changed invalid sticker name, across model turns',async()=>{
  const {q,sent}=fixture();await q.sendTo('private:1','在呢[表情包:抱抱.jpg]');q.onTurnEnded();
  expect(await q.sendTo('private:1','在呢[表情包:安慰.jpg]')).toContain('去重');expect(sent).toHaveLength(1);
});
it('does not send an empty message or consume budget when only missing stickers were requested',async()=>{
  const {q,sent}=fixture();q.config.maxPrivateMessagesPerReply=1;
  expect(await q.sendTo('private:1','［表情包：missing.gif］')).toContain('没有有效正文');expect(sent).toHaveLength(0);
  expect(await q.sendTo('private:1','正常回复')).toContain('已向');expect(sent).toHaveLength(1);
});
it('retains valid stickers and text while skipping only invalid ones',async()=>{
  const {q,dir,sent}=fixture();writeFileSync(join(dir,'real.gif'),'GIF89a');
  const result=await q.sendTo('private:1','你好[表情包:missing.gif][表情包:real.gif]');
  expect(result).toContain('未附上 1 个无效表情包');
  expect(sent.flatMap(m=>m.message).filter(s=>s.type==='image')).toEqual([{type:'image',data:{file:join(dir,'real.gif'),sub_type:1}}]);
  expect(sent.length).toBeLessThanOrEqual(q.config.maxPrivateMessagesPerReply);
});
it('never reads or sends an escaping sticker path, and explicit image errors still reject the request',async()=>{
  const {q,sent}=fixture();await q.sendTo('private:1','文字[表情包:../secret.png]');
  expect(sent[0].message).toEqual([{type:'text',data:{text:'文字'}}]);
  expect(await q.sendTo('private:1','图片',undefined,undefined,q.replyCounts('private:1'),['file:///C:/secret.png'])).toContain('不允许任意本机文件');
  expect(sent).toHaveLength(1);
});
it('still applies content review before falling back to text',async()=>{
  const {q,sent}=fixture();q.config.contentReviewUrl='http://review.invalid';
  vi.stubGlobal('fetch',async()=>Response.json({allow:false,reason:'test-policy'}));
  await q.sendTo('private:1','应被拒绝的正文[表情包:missing.gif]');
  expect(sent[0].message).toEqual([{type:'text',data:{text:'filtered'}}]);
});
