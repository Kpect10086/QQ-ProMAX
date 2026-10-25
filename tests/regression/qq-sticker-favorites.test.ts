import {afterEach, expect, it, vi} from 'vitest';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nullLogger} from 'cortico/core/util.ts';
const STICKER_SPEC='../../src/sticker.ts';
const WORLD_SPEC='../../src/world.ts';
const NORMALIZE_SPEC='../../src/normalize.ts';
const {StickerStore}=await import(STICKER_SPEC);
const {QQWorld}=await import(WORLD_SPEC);
const {buildOutgoing}=await import(NORMALIZE_SPEC);
const dirs:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true});});

it('favorite import deduplicates concurrent images, annotates using deployment secrets, and survives reload',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qq-favorites-'));dirs.push(dir);
  const requests:Array<Record<string,any>>=[];
  const png=Buffer.from('89504e470d0a1a0a','hex');
  vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
    if(url.includes('/chat/completions')){
      requests.push({headers:options?.headers,body:JSON.parse(String(options?.body))});
      return Response.json({choices:[{message:{content:'{"emotion":"开心","usage":"回应夸奖","tag":"猫猫笑"}'}}]});
    }
    if(url.includes('failed')) return new Response('',{status:404});
    return new Response(png);
  });
  const cfg={enabled:true,endpoint:'https://vision.invalid/v1',apiKeySecret:'TEST_STICKER_SECRET',model:'vision-test',maxBytes:1024,timeoutMs:1000};
  const store=new StickerStore(dir,cfg,nullLogger(),dir,()=> 'deployment-test-key');
  const result=await store.importFavorites([{url:'https://image.invalid/1',summary:''},{url:'https://image.invalid/2',summary:''},{url:'https://image.invalid/failed',summary:''}]);
  expect(result).toEqual({added:1,existing:1,failed:1});
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.authorization).toBe('Bearer deployment-test-key');
  const match=store.stats(10,'夸奖').recent;
  expect(match).toHaveLength(1);expect(match[0].emotion).toBe('开心');expect(match[0].count).toBe(2);
  expect(store.stats(10,'愤怒').recent).toEqual([]);
  expect(existsSync(join(dir,match[0].file))).toBe(true);
  expect(buildOutgoing(`[表情包:${match[0].file}]`,dir)).toEqual([{type:'image',data:{file:join(dir,match[0].file),sub_type:1}}]);
  expect(new StickerStore(dir,cfg,nullLogger(),dir).stats(10,'开心').recent[0].file).toBe(match[0].file);
  const world=new QQWorld({emojiDir:dir,localResourcesDir:dir,sendIntervalMs:0,voice:{enabled:false},proactive:{},routine:{}});
  world.stickers=store;world.host={isPaused:()=>false};world.log=nullLogger();
  const sent:unknown[]=[];
  world.driver={callApi:async(_action:string,params:unknown)=>{sent.push(params);return {};}};
  const stats=world.tools().find((t:{name:string})=>t.name==='qq_sticker_stats');
  const selection=await stats.handler({query:'夸奖'},{});
  expect(selection).toContain(`[表情包:${match[0].file}]`);
  expect(selection).toContain('来源:QQ收藏');
  await world.sendTo('private:123',`[表情包:${match[0].file}]`);
  expect(sent).toEqual([{message_type:'private',user_id:123,message:[{type:'image',data:{file:join(dir,match[0].file),sub_type:1}}]}]);
});

it('favorite sync coalesces concurrent requests, accepts descriptions, and does not send QQ messages',async()=>{
  const world=new QQWorld({proactive:{},routine:{}});
  world.connected=true;world.log=nullLogger();
  const actions:string[]=[];let imported:unknown;
  world.driver={callApi:async(action:string)=>{actions.push(action);return [{url:'https://image.invalid/cat.gif',desc:'撒娇'}];}};
  world.stickers={size:3,importFavorites:async(f:unknown)=>{imported=f;return {added:1,existing:0,failed:0};}};
  const sync=world.tools().find((t:{name:string})=>t.name==='qq_sticker_sync');
  const results=await Promise.all([sync.handler({},{}),sync.handler({},{})]);
  expect(results[0]).toContain('新增 1 张');expect(results[1]).toBe(results[0]);
  expect(actions).toEqual(['fetch_custom_face_detail']);
  expect(imported).toEqual([{url:'https://image.invalid/cat.gif',summary:'撒娇'}]);
  world.driver={callApi:async(action:string)=>{actions.push(action);if(action==='fetch_custom_face_detail')throw Error('unsupported');return ['https://image.invalid/fallback'];}};
  await sync.handler({},{});expect(imported).toEqual([{url:'https://image.invalid/fallback',summary:''}]);
  world.driver={callApi:async()=>[{url:'file:///private.txt'}]};
  expect(await sync.handler({},{})).toContain('缺少图片 URL');
  world.connected=false;expect(await sync.handler({},{})).toContain('未连接');
});

it('sync retries unknown annotations after restart without duplicating the image',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qq-sticker-retry-'));dirs.push(dir);
  let ready=false;
  vi.stubGlobal('fetch',async(url:string)=>url.includes('/chat/completions')
    ? ready ? Response.json({choices:[{message:{content:'{"emotion":"困倦","usage":"晚安问候","tag":"睡觉"}'}}]}) : new Response('',{status:503})
    : new Response(Buffer.from('89504e470d0a1a0a','hex')));
  const cfg={enabled:true,endpoint:'https://vision.invalid',apiKeySecret:'TEST_SECRET',model:'test',maxBytes:1024,timeoutMs:1000};
  const favorites=[{url:'https://image.invalid/1',summary:''}];
  const first=new StickerStore(dir,cfg,nullLogger(),dir,()=> 'test-key');
  await first.importFavorites(favorites);expect(first.stats().recent[0].emotion).toBe('未知');
  ready=true;
  const next=new StickerStore(dir,cfg,nullLogger(),dir,()=> 'test-key');
  expect(await next.importFavorites(favorites)).toEqual({added:0,existing:1,failed:0});
  expect(next.stats(10,'晚安').recent[0].emotion).toBe('困倦');expect(next.size).toBe(1);
});
