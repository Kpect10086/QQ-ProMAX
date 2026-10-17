import type { WorldDefinition } from 'cortico/world.ts';
import { QQWorld } from './world.ts';
const tools = new QQWorld({}).tools();
import { qqDefaults, qqTimezoneOptions, type QQConfigSection } from './config.ts';

export const definition: WorldDefinition<QQConfigSection> = {
  id: 'qqbot',
  label: 'QQ ProMAX',
  defaults: qqDefaults,
  describe: {
    tools: tools.map(({handler,endsTurn,barrierAfter,...tool}) => tool),
    events: [
      ...['system','qq.message','qqbot.output','qq.send_policy','qq.group-request','qq.recall','qq.member','qq.poke','qq.react','qq.forward','qq.affinity'].map(type => ({type,description:'QQ platform event or current capability status.'})),
    ],
  },
  configOptions(kind) {
    if (kind === 'qq-timezone') return qqTimezoneOptions();
    return [];
  },
  create(ctx) {
    return new QQWorld(ctx.cfg, ctx.packageDir, ctx.dataDir);
  },
};
