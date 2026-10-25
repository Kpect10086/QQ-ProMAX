import {registerHooks, stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'cortico' || specifier.startsWith('cortico/')) {
    throw new Error(`Packaged host does not provide source modules: ${specifier}`);
  }
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    return {format:'module', shortCircuit:true,
      source:stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {mode:'transform', sourceUrl:url})};
  }
  return nextLoad(url, context);
}});
