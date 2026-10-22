import {afterEach,expect,it,vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
afterEach(()=>vi.unstubAllGlobals());
function fixture(config:any={}) {
  const q=new QQWorld({groups:'2',privates:'1,3',sendIntervalMs:0,contentReviewUrl:'',antiLoop:{enabled:false},
    groupSpeak:{enabled:false},quietReply:{enabled:false},routine:{enabled:false},proactive:{enabled:false},...config}) as any;
  const sent:any[]=[];q.log=nullLogger();q.host={isPaused:()=>false,pushEvent:async()=>{}};
  q.driver={connected:true,callApi:async(_action:string,args:any)=>{sent.push(args);return {message_id:sent.length};}};
  return {q,sent};
}
function text(messages:any[]) {return messages.flatMap(m=>m.message).filter(s=>s.type==='text').map(s=>s.data.text).join('');}
it('merges an overlong sentence split without losing text and exposes an editable default',async()=>{
  const {q,sent}=fixture({maxPrivateMessagesPerReply:2});const body='第一句。第二句。第三句。第四句。';
  expect(await q.sendTo('private:1',body)).toContain('已向');expect(sent.length).toBeLessThanOrEqual(2);expect(text(sent)).toBe(body);
  expect(q.routineSegmentText()).toContain('最多 2 条');
});
it('multiple calls share each private recipient budget; a new turn resets it and groups keep their own behavior',async()=>{
  const {q,sent}=fixture({maxPrivateMessagesPerReply:2});
  await q.sendTo('private:1','一句。二句。');expect(sent).toHaveLength(2);
  expect(await q.sendTo('private:1','本轮第三条')).toContain('上限');expect(sent).toHaveLength(2);
  await q.sendTo('private:3','另一个人');expect(sent).toHaveLength(3);
  await q.sendTo('group:2','一。二。三。');expect(sent).toHaveLength(6);
  q.onTurnEnded();await q.sendTo('private:1','下一轮');expect(sent).toHaveLength(7);
});
it('rejects content that cannot fit before sending any part; 0 disables the cap',async()=>{
  const {q,sent}=fixture({maxPrivateMessagesPerReply:1,maxMessageBytes:12});
  expect(await q.sendTo('private:1','abcd!efgh!ijkl!')).toContain('精简');expect(sent).toHaveLength(0);
  q.config.maxPrivateMessagesPerReply=0;await q.sendTo('private:1','abcd!efgh!ijkl!');expect(sent).toHaveLength(3);
});
it('images and voice attachment sends share the boundary and failed sends refund their slot',async()=>{
  const {q,sent}=fixture({maxPrivateMessagesPerReply:1});
  await q.sendTo('private:1','[CQ:image,file=https://example.invalid/p.png]');expect(sent).toHaveLength(1);
  await expect(q.sendMessage('private:1',{message:[{type:'record',data:{file:'voice'}}]})).rejects.toThrow('上限');
  q.onTurnEnded();q.driver.callApi=async()=>{throw Error('offline');};
  await expect(q.sendMessage('private:1',{message:[{type:'text',data:{text:'测试'}}]})).rejects.toThrow('offline');
  q.driver.callApi=async(_a:string,p:any)=>{sent.push(p);return {};};
  await q.sendTo('private:1','失败后重试');expect(sent).toHaveLength(2);
});
it('reserves slots across concurrent sends before the protocol response arrives',async()=>{
  const {q}=fixture({maxPrivateMessagesPerReply:1});let finish:any;
  q.driver.callApi=()=>new Promise(resolve=>{finish=resolve;});
  const pending=q.sendMessage('private:1',{message:[{type:'text',data:{text:'测试'}}]});
  await expect(q.sendMessage('private:1',{message:[{type:'text',data:{text:'测试'}}]})).rejects.toThrow('上限');finish({});await pending;
});
