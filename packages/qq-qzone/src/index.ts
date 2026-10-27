import type {WorldDefinition} from 'cortico/world.ts';
import type {ConfigGroup, ToolDef, WorldHost} from 'cortico/core/types.ts';
import {OneBotDriver} from '../../../src/driver.ts';
import {resourcePath} from '../../../src/local-resources.ts';
import {resolveEmojiFile} from '../../../src/normalize.ts';
import {reviewContent} from '../../../src/content-review.ts';
import {QZonePoster, parseQzoneEvent} from './qzone.ts';
import {readFileSync, statSync} from 'node:fs';

const defaults = {
  enabled:false, wsUrl:'ws://127.0.0.1:3001', tokenSecret:'QQ_QZONE_ONEBOT_TOKEN',
  allowedUsers:'', localResourcesDir:'', emojiDir:'emoji', contentReviewUrl:'',
  tickSec:3600, chancePerTick:0, dailyQuota:5, permission:1,
  autoReplyComments:false, replyDailyQuota:20, replyCooldownSec:60,
  commentAction:'send_qzone_comment', quietFrom:0, quietTo:0, timezone:'Asia/Shanghai',
};
type Config = typeof defaults;
type Host = WorldHost & {isPaused?():boolean};
const ids = (s:string) => String(s).split(/[\s,]+/).filter(v=>/^[1-9]\d*$/.test(v));
const schema: ConfigGroup = {id:'world:qq-qzone',owner:'world:qq-qzone',schema:{type:'object',title:'QQ 空间',properties:Object.fromEntries(
  Object.entries(defaults).map(([key,value])=>['worlds.qq-qzone.'+key, {
    type:typeof value as 'boolean'|'string'|'number',title:({enabled:'启用空间',wsUrl:'OneBot 正向 WS 地址',tokenSecret:'Token 密钥名',allowedUsers:'允许读取评论的 QQ 号',localResourcesDir:'本地资源允许目录',emojiDir:'表情目录',contentReviewUrl:'可选审核地址',tickSec:'交流机会间隔（秒）',chancePerTick:'每次投递概率',dailyQuota:'每日发布上限（0 不限）',permission:'默认可见权限',autoReplyComments:'评论唤醒主模型',replyDailyQuota:'每日评论回复上限（0 不限）',replyCooldownSec:'评论回复间隔（秒）',commentAction:'回复评论协议 action',quietFrom:'静默开始小时',quietTo:'静默结束小时',timezone:'时区'} as Record<string,string>)[key], 'x-hot':false,
    ...(key==='chancePerTick'?{minimum:0,maximum:1}:{}),
    ...(['quietFrom','quietTo'].includes(key)?{minimum:0,maximum:23}:{}),
    ...(key==='tickSec'?{minimum:10}:{}),
    ...(['dailyQuota','replyDailyQuota','replyCooldownSec'].includes(key)?{minimum:0}:{}),
  }]))}};

export class QQZoneWorld {
  readonly id = 'qq-qzone';
  private host: Host | null = null;
  private driver: OneBotDriver | null = null;
  private poster: QZonePoster | null = null;
  private comments = new Map<string,{user:string;at:number}>();
  constructor(private cfg:Config,private dataDir:string,private secret:(name:string)=>string) {}
  private blocked(): string | null {
    if (!this.cfg.enabled || !this.host || !this.driver?.connected) return 'QQ 空间未启用或未连接。';
    if (this.host.isPaused?.()) return '运行已暂停。';
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:this.cfg.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
    const {quietFrom:from,quietTo:to}=this.cfg;
    if (from!==to && (from<to?hour>=from&&hour<to:hour>=from||hour<to)) return 'QQ 空间处于静默时段。';
    return null;
  }
  async start(host:WorldHost) {
    this.host=host;
    if (!this.cfg.enabled) return;
    if (!/^wss?:\/\//.test(this.cfg.wsUrl)) throw Error('OneBot 地址必须为 WS(S)');
    const token=this.secret(this.cfg.tokenSecret);
    if (!token) throw Error('QQ 空间需要配置独立 OneBot Token 密钥');
    this.poster=new QZonePoster({cfg:{enabled:true,tickSec:this.cfg.tickSec,chancePerTick:this.cfg.chancePerTick,dailyQuota:this.cfg.dailyQuota,
      permission:this.cfg.permission,imageMode:'none',autoReplyComments:{enabled:this.cfg.autoReplyComments,dailyQuota:this.cfg.replyDailyQuota,cooldownSec:this.cfg.replyCooldownSec},commentAction:this.cfg.commentAction},
      log:host.log,dataDir:this.dataDir,callApi:(action,params)=>this.driver!.callApi(action,params),
      blockedReason:()=>this.blocked(),
      emojiDir:resourcePath(this.cfg.localResourcesDir,this.cfg.emojiDir,true)||'',
      resolveImage:value=>this.image(value),
      review:async text=>!this.cfg.contentReviewUrl||(await reviewContent(this.cfg.contentReviewUrl,text,'message')).allow,
      pushEvent:async event=>{
        if (this.blocked()) return;
        const e=event as Parameters<WorldHost['pushEvent']>[0];
        await host.pushEvent(e,{trigger:e.origin==='external'&&!this.cfg.autoReplyComments?'piggyback':'debounce'});
      },identity:()=>null,resolveSecret:name=>name?this.secret(name):undefined});
    this.driver=new OneBotDriver({mode:'forward',wsUrl:this.cfg.wsUrl,wsHost:'127.0.0.1',wsPort:0,wsPath:'/',token,log:host.log,
      onEvent:event=>{
        const ev=event as unknown as Record<string,unknown>;
        const user=ev.operator_id??ev.user_id;
        if (this.blocked()||!ids(this.cfg.allowedUsers).includes(String(user))) return;
        const parsed=parseQzoneEvent(ev);
        if(parsed?.tid&&parsed.commentId){
          this.comments.set(parsed.tid+'#'+parsed.commentId,{user:String(user),at:Date.now()});
          while(this.comments.size>1000)this.comments.delete(this.comments.keys().next().value!);
        }
        void this.poster?.onEvent(ev).catch(error=>host.log.warn('QQ 空间互动处理失败',{error:String(error)}));
      }});
    await this.driver.start();
    this.poster.start();
  }
  async stop(){this.poster?.stop();await this.driver?.stop();this.poster=null;this.driver=null;this.host=null;this.comments.clear();}
  private image(value:string):string {
    if (/^https?:\/\//i.test(value)) return value;
    if (/^base64:\/\/[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length<23*1024*1024) return value;
    const blob=this.host?.blob(value);
    if (blob&&blob.mime.startsWith('image/')&&blob.bytes.length<=16*1024*1024) return 'base64://'+Buffer.from(blob.bytes).toString('base64');
    const dir=resourcePath(this.cfg.localResourcesDir,this.cfg.emojiDir,true);
    const path=dir&&resolveEmojiFile(dir,value);
    if (!path||statSync(path).size>16*1024*1024) throw Error('附图不存在、超过 16 MiB 或超出允许目录。');
    return 'base64://'+readFileSync(path).toString('base64');
  }
  tools():ToolDef[]{
    const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[],run:(args:Record<string,unknown>)=>Promise<unknown>,read=false):ToolDef=>({
      name,description,parameters:{type:'object',properties,required,additionalProperties:false},tags:[read?'read':'speak'],...(read?{}:{barrierAfter:true}),
      handler:async(args,ctx)=>{
        if (ctx.signal?.aborted) return {failed:true,text:'操作已取消。'};
        const blocked=read&&args.view==='status'?(this.cfg.enabled&&this.poster?null:'QQ 空间未启用。'):this.blocked();
        if(blocked)return {failed:true,text:blocked};
        if(required.some(key=>typeof args[key]!=='string'||!String(args[key]).trim()))return {failed:true,text:'缺少必填的非空正文或编号。'};
        try{return {text:JSON.stringify(await run(args))};}catch(error){return {failed:true,text:String(error)};}
      }});
    return [
      tool('qq_qzone_post','发布 QQ 空间动态。content 必填，由当前主模型根据可核实的记忆撰写；不公开私聊隐私，别人的经历不写成自己的。images 仅接受真实网络图片、图片附件句柄或允许目录的表情文件名。返回成功和 tid 才表示发布成功，结果不明时先读列表避免重复。',
        {content:{type:'string'},images:{type:'array',items:{type:'string'},maxItems:9},ats:{type:'array',items:{type:'string'}},permission:{type:'number'}},['content'],async a=>{
          if(a.images!==undefined&&(!Array.isArray(a.images)||a.images.length>9||a.images.some(v=>typeof v!=='string')))throw Error('images 必须是最多 9 个字符串。');
          if(a.ats!==undefined&&(!Array.isArray(a.ats)||a.ats.some(v=>typeof v!=='string')))throw Error('ats 必须是字符串数组。');
          return this.poster!.post({content:String(a.content),images:a.images as string[]|undefined,ats:a.ats as string[]|undefined,permission:typeof a.permission==='number'?a.permission:undefined});
        }),
      tool('qq_qzone_delete','删除已知 tid 的空间动态。',{tid:{type:'string'}},['tid'],a=>this.poster!.delete(String(a.tid))),
      tool('qq_qzone_reply','回复最近 24 小时内允许名单中实际收到的评论。tid 和 comment_id 来自空间评论事件，content 必填。',{tid:{type:'string'},comment_id:{type:'string'},content:{type:'string'}},['tid','comment_id','content'],async a=>{
        const row=this.comments.get(a.tid+'#'+a.comment_id);
        const permitted=()=>!!row&&Date.now()-row.at<86400_000&&ids(this.cfg.allowedUsers).includes(row.user);
        if(!permitted())throw Error('评论未在本连接收到、已过期或不在允许名单。');
        return this.poster!.replyComment(String(a.tid),String(a.comment_id),String(a.content),permitted);
      }),
      tool('qq_qzone_read','查询空间：view=status 返回本地记录和限制，view=feeds 请求协议端实际动态。',{view:{type:'string',enum:['status','feeds']},num:{type:'integer',minimum:1,maximum:20}},['view'],async a=>{
        if(a.view==='status')return this.poster!.status();
        if(a.view!=='feeds'||(a.num!==undefined&&(!Number.isInteger(a.num)||Number(a.num)<1||Number(a.num)>20)))throw Error('view 或 num 无效。');
        return this.poster!.getFeeds(Number(a.num??5));
      },true),
    ];
  }
  webUi(){return {label:'QQ 空间',panels:[],config:[schema]};}
  envPromptVars(){return {};}
}
const definition:WorldDefinition<Config>={id:'qq-qzone',label:'QQ 空间',defaults:()=>({...defaults}),
  create:ctx=>new QQZoneWorld(ctx.cfg,ctx.dataDir,name=>ctx.secret(name)),
  describe:{tools:new QQZoneWorld({...defaults},'',()=> '').tools().map(({name,description,parameters,tags})=>({name,description,parameters,tags})),
    events:[{type:'qq-qzone.proactive',description:{zh:'空间发布机会，由主模型决定是否发布。',en:'An opportunity for the main model to publish a post.'}},
      {type:'qq-qzone.interact',description:{zh:'允许名单中的外部空间评论或互动。',en:'An external QZone interaction from an allowed user.'}}]}};
export default definition;
