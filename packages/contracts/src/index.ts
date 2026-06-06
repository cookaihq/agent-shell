export const CONTRACTS_VERSION = '0.0.0'
// 让 renderer 等下游不必各自直依赖 zod：contracts 是 zod 的唯一拥有者，下游统一从这里取 z / ZodTypeAny。
export { z } from 'zod'
export type { ZodTypeAny } from 'zod'
export * from './events'
export * from './dto'
export * from './desktop'
export * from './transcript'
