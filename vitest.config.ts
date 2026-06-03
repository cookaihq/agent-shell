import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/daemon/src/**/*.test.ts',
      // desktop 仅收纯逻辑测试（如 updater-policy）——耦合 electron 的代码在 RUN_AS_NODE 下拿不到 API，不在此跑。
      'apps/desktop/src/**/*.test.ts',
    ],
    environment: 'node',
  },
})
