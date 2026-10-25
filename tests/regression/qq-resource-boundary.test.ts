import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,parse} from 'node:path';
import {resourcePath} from '../../src/local-resources.ts';
import {StickerStore} from '../../src/sticker.ts';
import {nullLogger} from 'cortico/core/util.ts';
import {QQWorld} from '../../src/world.ts';
const dirs:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function temp(){const d=mkdtempSync(join(tmpdir(),'qq-scope-'));dirs.push(d);return d;}
it('allows only designated resources and refuses traversal, sibling prefixes, disk roots and files used as roots',()=>{
 const root=temp(),outside=temp();writeFileSync(join(root,'state.json'),'{}');
 expect(resourcePath(root,'state.json')).toBe(join(root,'state.json'));
 expect(resourcePath(root,'emoji',true)).toBe(join(root,'emoji'));
 for(const name of ['../private.txt',outside,join(outside,'secret.txt')])expect(resourcePath(root,name,true)).toBeNull();
 expect(resourcePath(parse(root).root,root,true)).toBeNull();expect(resourcePath(join(root,'state.json'),'x',true)).toBeNull();
});
it('refuses junction and symlink escapes, including a nonexistent destination inside an external link',()=>{
 const root=temp(),outside=temp();writeFileSync(join(outside,'secret.png'),'secret');
 symlinkSync(outside,join(root,'link'),'junction');
 expect(resourcePath(root,'link/secret.png')).toBeNull();expect(resourcePath(root,'link/new-dir',true)).toBeNull();
 symlinkSync(join(outside,'missing'),join(root,'broken'),'junction');
 expect(resourcePath(root,'broken/new',true)).toBeNull();
});
it('rejects poisoned sticker metadata before favorite upload or writing outside its directory',async()=>{
 const root=temp(),outside=temp(),hash='a'.repeat(64);writeFileSync(join(outside,'secret.png'),'secret');
 writeFileSync(join(root,'sticker-index.json'),JSON.stringify({[hash]:{hash,file:join(outside,'secret.png'),ext:'.png'}}));
 const upload=vi.fn();const store=new StickerStore(root,{enabled:false} as any,nullLogger(),root,()=>'',undefined,upload);
 expect(store.size).toBe(0);await store.favoriteSync();expect(upload).not.toHaveBeenCalled();
});
it('does not read configured files or image roots outside the designated directory, even with legacy voice settings',()=>{
 const root=temp(),outside=temp();mkdirSync(join(root,'emoji'));
 const q:any=new QQWorld({localResourcesDir:root,emojiDir:outside,sticker:{dir:outside},asr:{mode:'local'},call:{enabled:true,mode:'system'}} as any,'',root);
 expect(q.emojiDirAbs).toBe('');expect(q.stickerDirAbs).toBe('');expect(q.tools().some((t:any)=>t.name==='qq_voicecall')).toBe(false);
 expect(q.startSystemCallLoop).toBeUndefined();expect(q.resolveAsrSidecar).toBeUndefined();
 expect(q.webUi('zh').config.flatMap((g:any)=>Object.keys(g.schema.properties??{})).some((k:string)=>/\.asr\.|\.call\.|voxcpmSidecar/.test(k))).toBe(false);
});
it('ignores incoming audio bytes and old ASR settings while retaining a message-id placeholder',async()=>{
 const q:any=new QQWorld({privates:'1',contentReviewUrl:'',voice:{enabled:true,asr:true,audioFallback:true,semanticJudge:false},call:{enabled:true,mode:'system'},asr:{mode:'local'},affinity:{enabled:false}} as any);
 const events:any[]=[];const api=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 q.driver={connected:true,callApi:api};q.log=nullLogger();
 q.host={isPaused:()=>false,store:{range:()=>[]},pushEvent:async(e:any)=>e,pushDeferred:(e:any)=>events.push(e)};
 await q.handleMessage({message_id:123,time:Date.now()/1000,message:[{type:'record',data:{file:'C:/private.wav',url:'http://audio.invalid/secret.wav'}}]},
  {address:'private:1',kind:'private',label:'fixture'},{userId:1,name:'fixture'});
 expect(api).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 const event=events.find(e=>e.type==='qq.message');expect(event.render().text).toContain('123');expect(event.blobs??[]).toEqual([]);
});
