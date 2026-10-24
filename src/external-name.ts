/** QQ names are display data; escaping prevents them from creating prompt lines or tags. */
export function externalName(value: unknown): string {
  const name = typeof value === 'string' ? [...value.slice(0, 256)].slice(0, 128).join('') : '';
  return '外部名称=' + JSON.stringify(name).replace(/[<>&\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}
