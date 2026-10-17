/** Use an optional host image processor when one is available. */
export async function prepareImageRequest(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const specifier = 'cortico/providers/image-requests.ts';
  let processor;
  try {processor = await import(specifier);}
  catch (error) {if ((error as {code?:string}).code === 'ERR_MODULE_NOT_FOUND') return body; throw error;}
  return processor.prepareImageRequest(body,signal);
}
