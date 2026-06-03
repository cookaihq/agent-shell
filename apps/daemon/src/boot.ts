import { serveDaemonUrl, type SidecarHandle } from '@agent-shell/sidecar'
import { startDaemon, type DaemonServer, type StartDaemonOptions } from './server'

export interface BootHandle {
  daemon: DaemonServer
  sidecar: SidecarHandle
  stop: () => Promise<void>
}

export interface BootOptions extends StartDaemonOptions {
  namespace?: string
}

/** 集成入口：起 HTTP，再把真实 URL 通过 sidecar socket 发布出去。 */
export async function boot(opts: BootOptions = {}): Promise<BootHandle> {
  const { namespace, ...daemonOpts } = opts
  const daemon = await startDaemon(daemonOpts)
  let sidecar: SidecarHandle
  try {
    sidecar = await serveDaemonUrl(daemon.url, namespace)   // serveDaemonUrl 自带 'default' 默认（去掉重复默认值）
  } catch (err) {
    await daemon.close()   // I1：发布失败不泄漏已绑定的端口
    throw err
  }
  let stopped = false
  return {
    daemon,
    sidecar,
    stop: async () => {
      if (stopped) return            // M1：幂等，重复 stop 安全
      stopped = true
      try {
        await sidecar.close()
      } finally {
        await daemon.close()         // I2：sidecar 关闭失败也要拆掉 daemon
      }
    },
  }
}
