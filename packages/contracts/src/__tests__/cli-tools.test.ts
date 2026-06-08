import { describe, it, expect } from 'vitest'
import {
  CliToolDef,
  CliToolInstallMethod,
  CliToolsState,
  CustomCliTool,
  CliToolRuntimeInfo,
  CatalogResp,
  InstalledResp,
  AddCustomCliToolReq,
  CliToolPlatform,
  CliToolMethod,
  CliToolStatus,
} from '../dto'

describe('CliToolPlatform / CliToolMethod / CliToolStatus', () => {
  it('CliToolPlatform 枚举合法值', () => {
    expect(CliToolPlatform.parse('darwin')).toBe('darwin')
    expect(CliToolPlatform.parse('linux')).toBe('linux')
    expect(CliToolPlatform.parse('win32')).toBe('win32')
    expect(() => CliToolPlatform.parse('windows')).toThrow()
  })

  it('CliToolMethod 枚举合法值', () => {
    expect(CliToolMethod.parse('brew')).toBe('brew')
    expect(CliToolMethod.parse('npm')).toBe('npm')
    expect(CliToolMethod.parse('pipx')).toBe('pipx')
    expect(CliToolMethod.parse('pip')).toBe('pip')
    expect(CliToolMethod.parse('cargo')).toBe('cargo')
    expect(CliToolMethod.parse('apt')).toBe('apt')
    expect(() => CliToolMethod.parse('yum')).toThrow()
  })

  it('CliToolStatus 枚举合法值', () => {
    expect(CliToolStatus.parse('installed')).toBe('installed')
    expect(CliToolStatus.parse('not_installed')).toBe('not_installed')
    expect(() => CliToolStatus.parse('unknown')).toThrow()
  })
})

describe('CliToolInstallMethod', () => {
  it('合法 parse', () => {
    const result = CliToolInstallMethod.parse({
      method: 'brew',
      command: 'brew install ffmpeg',
      platforms: ['darwin'],
    })
    expect(result.method).toBe('brew')
    expect(result.platforms).toEqual(['darwin'])
  })

  it('platforms: [] 空数组 → 抛错（nonempty）', () => {
    expect(() =>
      CliToolInstallMethod.parse({
        method: 'brew',
        command: 'brew install ffmpeg',
        platforms: [],
      })
    ).toThrow()
  })

  it('method 非枚举值 → 抛错', () => {
    expect(() =>
      CliToolInstallMethod.parse({
        method: 'yum',
        command: 'yum install ffmpeg',
        platforms: ['linux'],
      })
    ).toThrow()
  })
})

describe('CliToolDef', () => {
  it('最小合法 parse：只需 id/name/binNames，其余填默认值', () => {
    const result = CliToolDef.parse({ id: 'jq', name: 'jq', binNames: ['jq'] })
    expect(result.friendliness).toBe(0)
    expect(result.summary).toBe('')
    expect(result.categories).toEqual([])
    expect(result.custom).toBe(false)
    expect(result.installMethods).toEqual([])
  })

  it('缺 binNames → 抛错', () => {
    expect(() => CliToolDef.parse({ id: 'jq', name: 'jq' })).toThrow()
  })

  it('binNames: [] 空数组 → 抛错（nonempty）', () => {
    expect(() => CliToolDef.parse({ id: 'jq', name: 'jq', binNames: [] })).toThrow()
  })

  it('完整字段 parse 正确', () => {
    const result = CliToolDef.parse({
      id: 'ffmpeg',
      name: 'FFmpeg',
      binNames: ['ffmpeg', 'ffprobe'],
      summary: '音视频处理工具',
      categories: ['video', 'audio'],
      installMethods: [
        { method: 'brew', command: 'brew install ffmpeg', platforms: ['darwin'] },
      ],
      detailIntro: '功能强大的命令行音视频转码工具',
      useCases: ['视频转码', '音频提取'],
      guideSteps: ['安装 FFmpeg', '运行 ffmpeg -i input.mp4 output.mp3'],
      examplePrompts: [{ label: '转 mp3', prompt: '把这个视频转成 mp3' }],
      friendliness: 4,
      home: 'https://ffmpeg.org',
      repoUrl: 'https://github.com/FFmpeg/FFmpeg',
      docsUrl: 'https://ffmpeg.org/documentation.html',
      custom: false,
    })
    expect(result.binNames).toEqual(['ffmpeg', 'ffprobe'])
    expect(result.friendliness).toBe(4)
    expect(result.installMethods).toHaveLength(1)
  })

  it('friendliness 超出范围 → 抛错', () => {
    expect(() =>
      CliToolDef.parse({ id: 'x', name: 'x', binNames: ['x'], friendliness: 6 })
    ).toThrow()
    expect(() =>
      CliToolDef.parse({ id: 'x', name: 'x', binNames: ['x'], friendliness: -1 })
    ).toThrow()
  })
})

describe('CliToolsState', () => {
  it('parse({ custom: [] }) 通过', () => {
    const result = CliToolsState.parse({ custom: [] })
    expect(result.custom).toEqual([])
  })

  it('parse({ added: [{}] }) → custom 深等于 []（旧结构兼容，strip 未知键）', () => {
    const result = CliToolsState.parse({ added: [{}] })
    expect(result.custom).toEqual([])
  })

  it('parse({}) → custom 深等于 []（default）', () => {
    const result = CliToolsState.parse({})
    expect(result.custom).toEqual([])
  })
})

describe('CustomCliTool', () => {
  it('最小合法 parse，version 默认 null', () => {
    const result = CustomCliTool.parse({
      id: 'x',
      name: 'x',
      binName: 'x',
      binPath: '/usr/bin/x',
      createdAt: 1,
    })
    expect(result.version).toBeNull()
  })

  it('完整字段 parse', () => {
    const result = CustomCliTool.parse({
      id: 'my-tool',
      name: 'My Tool',
      binName: 'mytool',
      binPath: '/usr/local/bin/mytool',
      version: '1.2.3',
      installMethod: 'brew',
      installPackage: 'my-tool',
      description: '自定义工具',
      createdAt: 1700000000000,
    })
    expect(result.version).toBe('1.2.3')
    expect(result.installMethod).toBe('brew')
  })

  it('缺 createdAt → 抛错', () => {
    expect(() =>
      CustomCliTool.parse({ id: 'x', name: 'x', binName: 'x', binPath: '/usr/bin/x' })
    ).toThrow()
  })
})

describe('CliToolRuntimeInfo', () => {
  it('installed 状态合法 parse', () => {
    const result = CliToolRuntimeInfo.parse({
      id: 'jq',
      status: 'installed',
      version: '1.7',
      binPath: '/opt/homebrew/bin/jq',
    })
    expect(result.status).toBe('installed')
    expect(result.version).toBe('1.7')
  })

  it('not_installed 状态 version/binPath 可为 null', () => {
    const result = CliToolRuntimeInfo.parse({
      id: 'jq',
      status: 'not_installed',
      version: null,
      binPath: null,
    })
    expect(result.version).toBeNull()
    expect(result.binPath).toBeNull()
  })
})

describe('CatalogResp', () => {
  it('合法 parse，tools 为数组', () => {
    const result = CatalogResp.parse({
      tools: [{ id: 'jq', name: 'jq', binNames: ['jq'] }],
    })
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].id).toBe('jq')
  })

  it('tools 空数组 parse 通过', () => {
    const result = CatalogResp.parse({ tools: [] })
    expect(result.tools).toEqual([])
  })
})

describe('InstalledResp', () => {
  it('合法 parse', () => {
    const result = InstalledResp.parse({
      detected: [{ id: 'jq', status: 'installed', version: '1.7', binPath: '/opt/homebrew/bin/jq' }],
      custom: [],
      platform: 'darwin',
    })
    expect(result.platform).toBe('darwin')
    expect(result.detected).toHaveLength(1)
    expect(result.custom).toEqual([])
  })

  it('非法 platform → 抛错', () => {
    expect(() =>
      InstalledResp.parse({
        detected: [],
        custom: [],
        platform: 'freebsd',
      })
    ).toThrow()
  })
})

describe('AddCustomCliToolReq', () => {
  it('只传 binPath → 合法 parse', () => {
    const result = AddCustomCliToolReq.parse({ binPath: '/usr/bin/x' })
    expect(result.binPath).toBe('/usr/bin/x')
  })

  it('完整字段 parse', () => {
    const result = AddCustomCliToolReq.parse({
      binPath: '/usr/local/bin/mytool',
      name: 'My Tool',
      description: '自定义工具说明',
    })
    expect(result.name).toBe('My Tool')
    expect(result.description).toBe('自定义工具说明')
  })

  it('缺 binPath → 抛错', () => {
    expect(() => AddCustomCliToolReq.parse({})).toThrow()
    expect(() => AddCustomCliToolReq.parse({ name: 'tool' })).toThrow()
  })
})
