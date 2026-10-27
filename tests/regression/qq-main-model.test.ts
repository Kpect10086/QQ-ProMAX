import {afterEach,expect,it,vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
import {QQWorld} from '../../src/world.ts';
import {QQ_DEFAULTS,QQ_SECRETS} from '../../src/config.ts';
import {ProactiveSpeaker} from '../../src/proactive.ts';
import {QZonePoster} from '../../packages/qq-qzone/src/qzone.ts';
import {existsSync} from 'node:fs';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('has no built-in affinity storage, tools, settings or prompt injection even with legacy config',async()=>{
  const q:any=new QQWorld({privates:'1',affinity:{enabled:true},contentReviewUrl:''} as any);
  q.log=nullLogger();q.host={isPaused:()=>false};q.pushIncomingMessage=async()=>{};
  q.reminders={list:()=>[]};q.connected=true;q.driver={connected:true};
  expect(Object.hasOwn(QQ_DEFAULTS,'affinity')).toBe(false);
  expect(q.tools().some((t:any)=>t.name.startsWith('qq_affinity'))).toBe(false);
  expect(JSON.stringify(q.webUi())).not.toContain('qqbot.affinity');
  expect(Object.hasOwn(q.envPromptVars(),'qq.affinity')).toBe(false);
  expect(existsSync(new URL('../../src/affinity.ts',import.meta.url))).toBe(false);
  await q.handleMessage({message_id:2,user_id:1,time:Date.now()/1000,message:[{type:'text',data:{text:'你好'}}]},
    {address:'private:1',kind:'private',id:1,unread:{count:0}},{userId:1,name:'fixture'});
});
it('uses no implicit extra model with legacy feature switches or ambient provider secrets',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const q:any=new QQWorld({privates:'1',emotion:{enabled:true},voice:{enabled:true,semanticJudge:true},contentReviewUrl:'',affinity:{enabled:false}} as any);
  q.host={isPaused:()=>false};q.log=nullLogger();q.pushIncomingMessage=async()=>{};
  q.connected=true;q.driver={connected:true};
  await q.handleMessage({message_id:1,user_id:1,time:Date.now()/1000,message:[{type:'text',data:{text:'用语音说你好'}}]},
    {address:'private:1',kind:'private',id:1,unread:{count:0}},{userId:1,name:'fixture'});
  expect(fetcher).not.toHaveBeenCalled();expect(QQ_DEFAULTS.vision.enabled).toBe(false);
  expect(QQ_SECRETS).not.toContain('DEEPSEEK_API_KEY');expect(QQ_SECRETS).not.toContain('OPENROUTER_API_KEY');
});
it('bounds event requests by pause, quiet, quota, cooldown, unanswered state and the exact requested address',async()=>{
  const cfg={...QQ_DEFAULTS.proactive,enabled:true,privateCooldownSec:60,dailyQuota:1};let paused=false,quiet=false;
  const requests:any[]=[];const target={address:'private:1',kind:'private' as const,label:'untrusted name'};
  const speaker=new ProactiveSpeaker({cfg,log:nullLogger(),dataDir:'',getTargets:()=>[target],
    isPaused:()=>paused,isQuiet:()=>quiet,request:async(t,reason)=>{requests.push({t,reason});return true;}});
  paused=true;await speaker.trigger(target.address);paused=false;quiet=true;await speaker.trigger(target.address);quiet=false;
  expect(requests).toHaveLength(0);
  await speaker.trigger('private:999');expect(requests).toHaveLength(0);
  await speaker.trigger(target.address);await speaker.trigger(target.address);expect(requests).toHaveLength(1);
  expect(speaker.status().dailyCount).toBe(1);
});
it('sends a verified audio attachment with review disabled and still blocks when review denies it',async()=>{
  const q:any=new QQWorld({privates:'1',contentReviewUrl:'',sendIntervalMs:0,quietReply:{enabled:false},antiLoop:{enabled:false}});
  const bytes=Buffer.from('WAV fixture');const {createHash}=await import('node:crypto');
  const calls:any[]=[];q.log=nullLogger();q.driver={connected:true,callApi:async(a:string,p:any)=>{calls.push({a,p});return {message_id:1};}};
  q.host={isPaused:()=>false,blob:()=>({mime:'audio/wav',bytes}),store:{range:()=>[{type:'tts.audio',meta:{audioHash:createHash('sha256').update(bytes).digest('hex'),transcript:'真实合成正文'}}]},pushEvent:async()=>{}};
  const send=q.tools().find((t:any)=>t.name==='qq_send');
  await send.handler({to:'private:1',audio_handle:'mem:audio'},{});
  expect(calls[0].p.message[0].type).toBe('record');
  q.config.contentReviewUrl='http://review.invalid';vi.stubGlobal('fetch',async()=>Response.json({allow:false}));
  await send.handler({to:'private:1',audio_handle:'mem:audio'},{});
  expect(calls.at(-1).p.message[0]).toEqual({type:'text',data:{text:'filtered'}});
});
it('space scheduler requests main-model action and rejects empty content without invoking a model or transport',async()=>{
  const events:any[]=[],calls:any[]=[];
  const poster:any=new QZonePoster({cfg:{enabled:true,tickSec:3600,chancePerTick:1,dailyQuota:2,permission:1,imageMode:'none',autoReplyComments:{enabled:false,dailyQuota:2,cooldownSec:0},commentAction:'send_qzone_comment'},
    dataDir:'',log:nullLogger(),callApi:async(...args:any[])=>{calls.push(args);return{tid:'one'};},pushEvent:async(e:any)=>events.push(e),identity:()=>null,resolveSecret:()=>''});
  await poster.tick();expect(events[0]).toMatchObject({origin:'internal',type:'qq-qzone.proactive'});expect(calls).toHaveLength(0);
  expect(await poster.post({content:''})).toMatchObject({ok:false});expect(calls).toHaveLength(0);
  await poster.post({content:'一'});await poster.post({content:'二'});expect(await poster.post({content:'三'})).toMatchObject({ok:false});expect(calls).toHaveLength(2);
});
