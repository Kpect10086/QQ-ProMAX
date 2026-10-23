/** 转发来源推断（纯逻辑，不依赖 cortico 运行时，可独立单测）。 */

/** 转发节点暴露的原始会话线索（由 world.renderForwardNode 填充）。 */
export interface ForwardSourceNode {
  /** 群转发：节点原始所在群号 */
  originGroupId?: number;
  /** 私聊转发：节点原始对方 QQ（已排除自己） */
  originPeerUin?: number;
}

/** 转发来源的结构化描述（同时写入事件 meta，供工具/UI 程序化读取）。 */
export type ForwardSourceMeta =
  | { kind: 'group'; id: number; name?: string }
  | { kind: 'private'; id: number; name?: string }
  | { kind: 'mixed'; groups: number[]; peers: number[] };

/** 推断来源所需的身份视图（由 world 的 this.identity 适配）。 */
export interface ForwardSourceIdentity {
  selfId?: number;
  groups: Map<number, string>;
  friends: Map<number, { remark?: string; nickname?: string }>;
}

/**
 * 由转发节点推断「转发来源群/人」。
 * - 单一群 → 群「<群名>(<id>)」
 * - 单一私聊 → 私聊「<昵称>(<QQ>)」
 * - 跨群/跨人 → 多个来源（…）
 * - 来源恰好等于收到转发的当前会话时返回 null（已在上下文中，避免重复噪声）。
 */
export function forwardSource(
  nodes: ForwardSourceNode[],
  identity: ForwardSourceIdentity,
  recvKind: 'group' | 'private',
  recvId: number,
): { label: string; source: ForwardSourceMeta } | null {
  const groups: number[] = [];
  const peers: number[] = [];
  for (const n of nodes) {
    if (n.originGroupId && !groups.includes(n.originGroupId)) groups.push(n.originGroupId);
    if (n.originPeerUin && !peers.includes(n.originPeerUin)) peers.push(n.originPeerUin);
  }
  // 来源恰好等于当前会话：不重复标注。
  if (groups.length === 1 && peers.length === 0 && recvKind === 'group' && groups[0] === recvId) return null;
  if (groups.length === 0 && peers.length === 1 && recvKind === 'private' && peers[0] === recvId) return null;

  const labelParts: string[] = [];
  for (const g of groups) {
    const name = identity.groups.get(g);
    labelParts.push(name ? `群「${name}(${g})」` : `群${g}`);
  }
  for (const p of peers) {
    const f = identity.friends.get(p);
    const pname = (f?.remark ?? '').trim() || (f?.nickname ?? '').trim() || `QQ用户${p}`;
    labelParts.push(`私聊「${pname}(${p})」`);
  }
  if (!labelParts.length) return null;
  if (labelParts.length === 1) {
    const isGroup = groups.length > 0;
    const id = isGroup ? groups[0] : peers[0];
    const name = isGroup ? identity.groups.get(id) : undefined;
    return { label: labelParts[0], source: { kind: isGroup ? 'group' : 'private', id, name } };
  }
  return { label: `多个来源（${labelParts.join('、')}）`, source: { kind: 'mixed', groups, peers } };
}
