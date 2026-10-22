export interface MemoryTime {occurredAt:string|null;timeConfidence:number;timeTextOriginal:string;timezone:string}
export function sourceEventTime(event:{ts:string;meta?:Record<string,unknown>}):number;
export function anchorTime(text:string,referenceAt:number,explicit?:string|null,timezone?:string):MemoryTime;
export function absoluteSummary(text:string,time:{occurredAt:string|null;timezone:string}):string;
export function relativeTime(occurredAt:string|null,now?:number,timezone?:string):string;
