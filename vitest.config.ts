import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({test:{include:['tests/regression/*.test.ts'],setupFiles:['tests/setup.ts'],testTimeout:15000},resolve:{alias:{cortico:fileURLToPath(new URL('./node_modules/cortico/src',import.meta.url))}}});
