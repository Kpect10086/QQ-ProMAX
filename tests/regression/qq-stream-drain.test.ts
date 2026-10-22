import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
const spec='../../src/stream-gate.ts';
const {QQStreamGate}=await import(spec);
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0)){
  expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));expect(dir.includes('qq-drain-')).toBe(true);
  rmSync(dir,{recursive:true,force:true});
}});
const message=(id:number)=>({post_type:'message' as const,message_type:'private' as const,message_id:id,user_id:1,message:`fixture${id}`});
function files(){const dir=mkdtempSync(join(tmpdir(),'qq-drain-'));dirs.push(dir);const status=join(dir,'status.json'),queue=join(dir,'queue.json');
  writeFileSync(status,JSON.stringify({live:true}));return {status,queue,live:(value:boolean)=>writeFileSync(status,JSON.stringify({live:value}))};}

it('an ordered burst releases 32 cheap backlog entries per drain without a half-second delay per message',async()=>{
  const f=files(),delivered:number[]=[];
  const gate=new QQStreamGate(()=>f.status,f.queue,()=>false,async (e:{message_id?:number})=>{delivered.push(e.message_id!);},()=>{throw Error('Unexpected failure');});
  try {
    gate.start();for(let id=1;id<=70;id++)gate.defer(message(id));
    f.live(false);await gate.drain();expect(delivered).toEqual(Array.from({length:32},(_,i)=>i+1));expect(gate.pending).toBe(38);
    await gate.drain();await gate.drain();expect(delivered).toEqual(Array.from({length:70},(_,i)=>i+1));
    expect(gate.pending).toBe(0);expect(JSON.parse(readFileSync(f.queue,'utf8'))).toEqual([]);
  }finally{await gate.stop();}
});

it('a failed entry stays at the head across restart and subsequent entries are not lost or sent out of order',async()=>{
  const f=files(),delivered:number[]=[],errors:unknown[]=[];let fail=true;
  const create=()=>new QQStreamGate(()=>f.status,f.queue,()=>false,async (e:{message_id?:number})=>{
    if(e.message_id===3&&fail)throw Error('Consumer busy');delivered.push(e.message_id!);
  },(e:unknown)=>errors.push(e));
  let gate=create();
  try {
    gate.start();for(let id=1;id<=5;id++)gate.defer(message(id));f.live(false);await gate.drain();
    expect(delivered).toEqual([1,2]);expect(errors).toHaveLength(1);expect(gate.pending).toBe(3);
    await gate.stop();gate=create();gate.start();fail=false;await gate.drain();
    expect(delivered).toEqual([1,2,3,4,5]);expect(gate.pending).toBe(0);
  }finally{await gate.stop();}
});

it('each entry rechecks pause and live mode, and concurrent drain calls never duplicate delivery',async()=>{
  const f=files(),delivered:number[]=[];let paused=false,active=0,maxActive=0;
  const gate=new QQStreamGate(()=>f.status,f.queue,()=>paused,async (e:{message_id?:number})=>{
    active++;maxActive=Math.max(maxActive,active);await Promise.resolve();delivered.push(e.message_id!);
    if(e.message_id===1)paused=true;if(e.message_id===2)f.live(true);active--;
  },()=>{throw Error('Unexpected failure');});
  try {
    gate.start();for(let id=1;id<=4;id++)gate.defer(message(id));f.live(false);
    await Promise.all([gate.drain(),gate.drain()]);expect(delivered).toEqual([1]);expect(gate.pending).toBe(3);
    paused=false;await gate.drain();expect(delivered).toEqual([1,2]);expect(gate.pending).toBe(2);
    f.live(false);await gate.drain();expect(delivered).toEqual([1,2,3,4]);expect(maxActive).toBe(1);
  }finally{await gate.stop();}
});
