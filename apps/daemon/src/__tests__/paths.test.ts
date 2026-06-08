import { describe, it, expect, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { channelDataDir, defaultSkillsDir, configPath, defaultProjectsDir, defaultAutomationsDir } from '../paths'

describe('channelDataDir / 渠道路径隔离', () => {
  afterEach(() => { delete process.env.AGENT_SHELL_DATA_DIR; delete process.env.AGENT_SHELL_PROJECTS_DIR })

  it('未设 env → 缺省 .agent-shell；skills/config 挂其下', () => {
    delete process.env.AGENT_SHELL_DATA_DIR
    expect(channelDataDir()).toBe(path.join(os.homedir(), '.agent-shell'))
    expect(defaultSkillsDir()).toBe(path.join(os.homedir(), '.agent-shell', 'skills'))
    expect(configPath()).toBe(path.join(os.homedir(), '.agent-shell', 'config.json'))
  })

  it('设 AGENT_SHELL_DATA_DIR=.agent-shell-dev → skills/config 随之切到 dev 目录', () => {
    process.env.AGENT_SHELL_DATA_DIR = '.agent-shell-dev'
    expect(defaultSkillsDir()).toBe(path.join(os.homedir(), '.agent-shell-dev', 'skills'))
    expect(configPath()).toBe(path.join(os.homedir(), '.agent-shell-dev', 'config.json'))
  })

  it('未设 env → projects 缺省 ~/AgentShell/projects', () => {
    delete process.env.AGENT_SHELL_PROJECTS_DIR
    expect(defaultProjectsDir()).toBe(path.join(os.homedir(), 'AgentShell', 'projects'))
  })

  it('设 AGENT_SHELL_PROJECTS_DIR=AgentShell-dev → dev 渠道项目目录随之隔离', () => {
    process.env.AGENT_SHELL_PROJECTS_DIR = 'AgentShell-dev'
    expect(defaultProjectsDir()).toBe(path.join(os.homedir(), 'AgentShell-dev', 'projects'))
  })
})

describe('defaultAutomationsDir', () => {
  it('= 渠道数据目录下的 automations 子目录', () => {
    expect(defaultAutomationsDir()).toBe(path.join(channelDataDir(), 'automations'))
  })
  it('默认在 home 的 .agent-shell 下', () => {
    delete process.env.AGENT_SHELL_DATA_DIR
    expect(defaultAutomationsDir()).toBe(path.join(os.homedir(), '.agent-shell', 'automations'))
  })
})
