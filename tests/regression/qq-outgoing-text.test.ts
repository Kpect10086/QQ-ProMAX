import {expect,it} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const textSpec='../../src/outgoing-text.ts';
const worldSpec='../../src/world.ts';
const {outgoingChatText}=await import(textSpec);
const {QQWorld}=await import(worldSpec);
it('unwraps only the current recipient text without executing actions or changing destinations',()=>{
  const text='七点了，你睡好了吗？';
  expect(outgoingChatText(JSON.stringify({qq_send:{to:'私聊1',text}}),'private:1')).toBe(text);
  expect(outgoingChatText('```json\n'+JSON.stringify({qq_send:{to:'group:2',text}})+'\n```','group:2')).toBe(text);
  expect(outgoingChatText('解释 qq_send 的用途。','private:1')).toBe('解释 qq_send 的用途。');
  for(const command of [
    {qq_send:{to:'private:3',text}}, {qq_send:{to:'private:1',text,at:['3']}},
    {qq_poke:{target:'private:1'}}, {qq_send:{to:'private:1',text},qq_poke:{}},
    {qq_send:{to:'private:1',text:JSON.stringify({qq_send:{to:'private:1',text}})}},
  ]) expect(()=>outgoingChatText(JSON.stringify(command),'private:1')).toThrow();
  expect(()=>outgoingChatText('{"qq_send": {','private:1')).toThrow();
});
it('the real send boundary transmits plain text and blocks routing or action envelopes',async()=>{
  const world=new QQWorld({contentReviewUrl:'',sendIntervalMs:0,antiLoop:{enabled:false}}) as any;
  world.host={isPaused:()=>false};world.log=nullLogger();
  const sent:any[]=[];world.driver={callApi:async(action:string,args:any)=>{sent.push({action,args});return {};}};
  await world.sendTo('private:1',JSON.stringify({qq_send:{to:'私聊1',text:'你好。'}}));
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain('你好。');expect(JSON.stringify(sent[0])).not.toContain('qq_send');
  await world.sendTo('private:1',JSON.stringify({qq_send:{to:'private:2',text:'串聊'}}));
  expect(sent).toHaveLength(1);
});
it('proactive opportunities reach the main model without generating a draft or sending a message',async()=>{
  const world=new QQWorld({proactive:{enabled:true},contentReviewUrl:'',sendIntervalMs:0,antiLoop:{enabled:false}}) as any;
  const events:any[]=[];const sent:any[]=[];
  world.host={isPaused:()=>false,pushEvent:async(e:any)=>events.push(e)};world.log=nullLogger();
  world.driver={callApi:async(action:string,args:any)=>{sent.push({action,args});return {};}};
  world.proactiveTargets=()=>[{address:'private:1',kind:'private',label:'fixture'}];
  world.chatCompletion=async(messages:any[])=>{
    expect(messages[0].content).toContain('此接口没有工具');
    return JSON.stringify({qq_send:{to:'私聊1',text:'今天休息得怎么样？'}});
  };
  world.initProactive();
  try {
    await world.proactive.trigger('private:1');
    expect(sent).toHaveLength(0);expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({type:'qq.proactive',origin:'internal',senderKey:'private:1'});
    expect(events[0].text).not.toContain('今天休息得怎么样？');
  }finally{world.proactive.stop();}
});
