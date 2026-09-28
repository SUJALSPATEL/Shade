import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:'))) {
    const asTs = specifier.replace(/\.js$/, '.ts');
    try {
      const resolved = await nextResolve(asTs, context);
      if (existsSync(fileURLToPath(resolved.url))) return resolved;
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}
