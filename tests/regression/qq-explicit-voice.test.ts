import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
  const q=new QQWorld({privates:'1',sendIntervalMs:0,contentReviewUrl:'',maxPrivateMessagesPerReply:1,
    voice:{enabled:true,tts:true,provider:'local',voiceBaseUrl:'http://speech.invalid/v1'},
    quietReply:{enabled:false},antiLoop:{enabled:false},routine:{enabled:false},proactive:{quietFrom:0,quietTo:0}}) as any;
  const sent:any[]=[],events:any[]=[],requests:any[]=[];let paused=false;
  q.log=nullLogger();q.host={isPaused:()=>paused,store:{range:()=>[{cursor:1,type:'qq.message',origin:'external',senderKey:'private:1'}]},pushEvent:async(e:any)=>{events.push(e);return e;}};
  q.driver={connected:true,callApi:async(_a:string,p:any)=>{sent.push(p);return{message_id:sent.length};}};
  vi.stubGlobal('fetch',async(url:any,opts:any)=>{requests.push({url,body:JSON.parse(opts.body)});return new Response('RIFF-test',{headers:{'content-type':'audio/wav'}});});
  const send=(args:any)=>q.tools().find((t:any)=>t.name==='qq_send').handler({to:'private:1',text:'我在这里。',...args},{});
  return{q,sent,events,requests,send,pause:()=>{paused=true;}};
}
it('sends synthesized QQ audio when the main agent explicitly selects voice without a side judge',async()=>{
  const {q,sent,events,requests,send}=fixture();
  expect(await send({voice:true})).toContain('发送语音 1 段');
  expect(requests[0].url).toBe('http://speech.invalid/v1/audio/speech');expect(requests[0].body.input).toBe('我在这里。');
  expect(sent[0].message).toEqual([{type:'record',data:{file:expect.stringMatching(/^base64:\/\//)}}]);
  expect(events.find(e=>e.type==='qq.sent').meta.delivery).toBe('confirmed');
  expect(q.recentSends[0].text).toBe('我在这里。');
  q.onTurnEnded();expect(await send({voice:true,text:'第二条'})).toContain('上限');expect(sent).toHaveLength(1);
});
it('explicit text selection avoids synthesis without calling TTS',async()=>{
  const {q,sent,requests,send}=fixture();
  expect(await send({voice:false})).toContain('已发送');expect(requests).toHaveLength(0);expect(sent[0].message[0].type).toBe('text');
});
it.each(['paused','closed','disabled'])('an explicit voice request respects %s',async mode=>{
  const {q,sent,requests,send,pause}=fixture();
  if(mode==='paused')pause();if(mode==='closed')q.config.replyPrivates=false;if(mode==='disabled')q.config.voice.tts=false;
  await send({voice:true}).catch(()=>{});expect(sent).toHaveLength(0);expect(requests).toHaveLength(0);
});
it('review rejection still sends only filtered and never synthesizes the rejected text',async()=>{
  const {q,sent,send}=fixture();q.config.contentReviewUrl='http://review.invalid';
  const urls:string[]=[];vi.stubGlobal('fetch',async(url:any)=>{urls.push(url);return Response.json({allow:false,reason:'test-policy'});});
  expect(await send({voice:true})).toContain('filtered');expect(urls).toEqual(['http://review.invalid']);
  expect(sent[0].message).toEqual([{type:'text',data:{text:'filtered'}}]);
});
it('rejects invalid voice options and mixed image requests before sending',async()=>{
  const {sent,requests,send}=fixture();
  expect(await send({voice:'true'})).toContain('voice');expect(await send({voice:true,images:['https://image.invalid/x.png']})).toContain('图片');
  expect(sent).toHaveLength(0);expect(requests).toHaveLength(0);
});
it('reports a synthesis failure as an actual text fallback rather than claiming audio was sent',async()=>{
  const {sent,send}=fixture();vi.stubGlobal('fetch',async()=>new Response('offline',{status:503}));
  const result=await send({voice:true});expect(result).toContain('回退文字');expect(result).not.toContain('发送语音');expect(sent[0].message[0].type).toBe('text');
});
it('declares explicit voice selection and the confirmed-send event in the installed package metadata',()=>{
  const {q}=fixture(),send=q.tools().find((t:any)=>t.name==='qq_send');
  expect(send.parameters.properties.voice.type).toBe('boolean');
  const describe=JSON.parse(readFileSync(new URL('../../describe.json',import.meta.url),'utf8'));
  expect(describe.events.some((e:any)=>e.type==='qq.sent')).toBe(true);
  expect(describe.tools.find((t:any)=>t.name==='qq_send').parameters.properties.voice.type).toBe('boolean');
});
