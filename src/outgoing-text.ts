/** Plain-chat generators can imitate a tool call; never execute its routing or actions. */
export function outgoingChatText(text: string, address: string): string {
  const body = text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const command = /^[{[]/u.test(body) && /["'](?:qq_\w+|tool_calls?|function_call)["']\s*:|["'](?:name|tool)["']\s*:\s*["']qq_\w+/u.test(body);
  if (!command) {
    if (/^qq_\w+\s*\(/u.test(body)) throw Error('生成了工具指令，请改用消息正文。');
    return text;
  }
  let value: any;
  try { value = JSON.parse(body); } catch { throw Error('生成了不完整的工具指令，消息未发送。'); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !value.qq_send) throw Error('聊天正文含工具指令，消息未发送。');
  const args = value.qq_send;
  if (!args || typeof args !== 'object' || Object.keys(args).some(key => !['to', 'text'].includes(key))
      || typeof args.to !== 'string' || typeof args.text !== 'string' || !args.text.trim()) throw Error('聊天指令格式无效，消息未发送。');
  const to = args.to.trim().replace(/^私聊\s*:?[\s]*/u, 'private:').replace(/^群聊\s*:?[\s]*/u, 'group:');
  if (to !== address) throw Error('聊天指令的目标与当前会话不一致，消息未发送。');
  const plain = outgoingChatText(args.text, address);
  if (plain !== args.text) throw Error('聊天正文嵌套了工具指令，消息未发送。');
  return plain;
}
