import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/regression/*.test.ts'],setupFiles:['tests/setup.ts'],testTimeout:15000},resolve:{alias:{cortico:new URL('./node_modules/cortico/src',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/,'$1')}}});
