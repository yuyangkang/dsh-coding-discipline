/**
 * dsh-coding-discipline — a process-global coding-discipline contribution.
 *
 * Three registrations, all reversible through this plugin's own fiber:
 *
 *   1. a prompt section whose text is a FUNCTION, so the switches and the rule
 *      files are re-read on every assembly and take effect without a restart;
 *   2. a runtime skill holding the full checklist, registered and disposed as
 *      the `registerSkill` switch and the rule files change;
 *   3. the `/coding-rules` and `/coding-checks` commands that edit the switches
 *      and the check commands from the conversation.
 *
 * The plugin publishes no service, so it mounts loose as a bundle row and its
 * contribution reaches every agent and every preset in the profile.
 *
 * @module dsh-coding-discipline
 */
import { existsSync, watch } from 'node:fs'
import {
  configPath,
  ensureSeeded,
  listModules,
  modulesDir,
  readConfig,
  renderSection,
  renderSkill,
  rootDir,
  seedConfig,
  shippedRulesDir,
  writeConfig,
} from './store.js'

export const name = 'coding-discipline'

/** `systemPrompt` and `skills` are hard dependencies: without them there is nothing to contribute. */
export const inject = ['systemPrompt', 'skills', 'commands']

const SECTION_NAME = 'coding-discipline:rules'
/** Sits after the persona prefix (0) and before plan policy (500). */
const SECTION_ORDER = 100
const SKILL_NAME = 'coding-discipline'
const SKILL_DESCRIPTION =
  '编码纪律：先读项目约定、最小变更、写完自检明显 bug、按最窄命令验证后如实报告。'
const SKILL_WHEN_TO_USE = '接到任何写代码、改代码、修 bug、重构或代码审查的任务时'

const USAGE_RULES =
  '命令：/coding-rules on|off | section on|off | skill on|off | module <名> on|off | module <名> section on|off | show [名] | path | reload | reset'
const USAGE_CHECKS =
  '命令：/coding-checks list | add <名称> <命令> | rm <名称> | on <名称> | off <名称>'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Split the composer input, tolerating a leading command name or slash. */
function tokensOf(invocation, commandName) {
  const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput : ''
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0)
  const first = tokens[0]
  if (first === commandName || first === `/${commandName}`) return tokens.slice(1)
  return tokens
}

function onOff(token) {
  if (token === 'on' || token === 'true' || token === '1') return true
  if (token === 'off' || token === 'false' || token === '0') return false
  return undefined
}

/** Resolve a user-typed module token against the module list. */
function resolveModule(config, token) {
  if (token === undefined) return undefined
  const modules = listModules(config)
  return (
    modules.find((module) => module.name === token) ??
    modules.find((module) => module.file === token) ??
    modules.find((module) => module.file === `${token}.md`) ??
    modules.find((module) => module.name.toLowerCase() === token.toLowerCase())
  )
}

function statusText() {
  const { config, error } = readConfig()
  const modules = listModules(config)
  const lines = ['编码纪律 · dsh-coding-discipline', '']
  lines.push(`总开关      ${config.enabled ? '开' : '关'}`)
  const section = config.enabled && config.injectSection ? renderSection() : ''
  lines.push(`常驻段落    ${config.injectSection ? '开' : '关'}${section.length > 0 ? `（${section.length} 字符）` : ''}`)
  const skill = config.enabled && config.registerSkill ? renderSkill(config) : ''
  lines.push(`Skill       ${config.registerSkill ? '开' : '关'}${skill.length > 0 ? `（${skill.length} 字符）` : ''}`)
  if (error !== undefined) lines.push(`⚠ ${error}`)
  lines.push(`目录        ${rootDir()}`)
  lines.push('')
  lines.push(`模块（${modules.length}）`)
  if (modules.length === 0) lines.push('  （modules/ 下没有 .md 文件）')
  for (const module of modules) {
    const flags = `${module.enabled ? '开' : '关'}  ${module.inSection ? '常驻' : '仅skill'}`
    const broken = module.error === undefined ? '' : `  ⚠ ${module.error}`
    lines.push(`  ${flags}  ${module.name.padEnd(18)} ${module.file}${broken}`)
  }
  lines.push('')
  const checks = Object.entries(config.checks)
  lines.push(`自检命令（${checks.length}）`)
  if (checks.length === 0) lines.push('  （未配置）用 /coding-checks add <名称> <命令> 添加')
  for (const [checkName, check] of checks) {
    lines.push(`  ${check.enabled ? '开' : '关'}  ${checkName.padEnd(12)} ${check.command}`)
  }
  lines.push('')
  lines.push(USAGE_RULES)
  return lines.join('\n')
}

function showText(config, token) {
  if (token === undefined) {
    const section = renderSection()
    return section.length === 0
      ? '常驻段落当前为空（可能总开关关闭、段落开关关闭，或没有启用任何「常驻」模块）。'
      : `常驻段落实际内容：\n\n${section}`
  }
  const module = resolveModule(config, token)
  if (module === undefined) return `没有名为 "${token}" 的模块。用 /coding-rules 查看列表。`
  if (module.error !== undefined) return `模块 "${module.name}" 读取失败：${module.error}`
  return `模块 ${module.name}（${module.file}，${module.bytes} 字节，${module.enabled ? '已启用' : '已停用'}，${module.inSection ? '常驻' : '仅 skill'}）：\n\n${module.text.trim()}`
}

function pathText() {
  return [
    '规则与开关所在位置（可直接编辑，保存即生效）：',
    `  目录       ${rootDir()}`,
    `  开关       ${configPath()}`,
    `  规则模块   ${modulesDir()}`,
    `  内置默认   ${shippedRulesDir()}`,
    '',
    '在 modules/ 下新建任意 .md 文件即新增一个规则模块（文件名前缀 10-、20- 只用于排序），',
    '第一次出现的模块默认启用，且默认只进 skill；用 /coding-rules module <名> section on 让它常驻。',
  ].join('\n')
}

/** `/coding-rules` — inspect and edit the switches. */
function rulesCommand(refresh, invocation) {
  const args = tokensOf(invocation, 'coding-rules')
  const action = (args[0] ?? 'status').toLowerCase()
  const { config, error } = readConfig()
  if (error !== undefined) return { kind: 'error', text: `${error}\n\n用 /coding-rules reset 重建默认开关文件。` }

  switch (action) {
    case 'status':
      return { kind: 'success', text: statusText() }

    case 'on':
    case 'off': {
      config.enabled = onOff(action)
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `编码纪律已${config.enabled ? '启用' : '停用'}。` }
    }

    case 'section': {
      const value = onOff(args[1])
      if (value === undefined) return { kind: 'error', text: `用法：/coding-rules section on|off\n${USAGE_RULES}` }
      config.injectSection = value
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `常驻段落已${value ? '开启' : '关闭'}。` }
    }

    case 'skill': {
      const value = onOff(args[1])
      if (value === undefined) return { kind: 'error', text: `用法：/coding-rules skill on|off\n${USAGE_RULES}` }
      config.registerSkill = value
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `coding-discipline skill 已${value ? '注册' : '注销'}。` }
    }

    case 'module': {
      const module = resolveModule(config, args[1])
      if (module === undefined) {
        return { kind: 'error', text: `没有名为 "${args[1] ?? ''}" 的模块。用 /coding-rules 查看列表。` }
      }
      if ((args[2] ?? '').toLowerCase() === 'section') {
        const value = onOff(args[3])
        if (value === undefined) return { kind: 'error', text: `用法：/coding-rules module <名> section on|off\n${USAGE_RULES}` }
        config.modules[module.name] = { enabled: module.enabled, inSection: value }
        writeConfig(config)
        refresh()
        return { kind: 'success', text: `模块 ${module.name} 已${value ? '加入常驻段落' : '移出常驻段落（仍保留在 skill 中）'}。` }
      }
      const value = onOff(args[2])
      if (value === undefined) return { kind: 'error', text: `用法：/coding-rules module <名> on|off\n${USAGE_RULES}` }
      config.modules[module.name] = { enabled: value, inSection: module.inSection }
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `模块 ${module.name} 已${value ? '启用' : '停用'}。` }
    }

    case 'show':
      return { kind: 'success', text: showText(config, args[1]) }

    case 'path':
      return { kind: 'success', text: pathText() }

    case 'reload': {
      const created = ensureSeeded()
      refresh()
      const extra = created.modules.length > 0 ? `，新增模块 ${created.modules.join('、')}` : ''
      return { kind: 'success', text: `已重新读取规则与开关${extra}。` }
    }

    case 'reset': {
      writeConfig(seedConfig())
      refresh()
      return {
        kind: 'success',
        text: `开关已重置为默认（模块文件未被改动）。注意：自定义模块的开关记录已丢失，重新启用即可。\n\n${statusText()}`,
      }
    }

    default:
      return { kind: 'error', text: `未知子命令 "${action}"。\n${USAGE_RULES}` }
  }
}

function checksListText(config) {
  const entries = Object.entries(config.checks)
  if (entries.length === 0) {
    return [
      '尚未配置自检命令。',
      '插件不会替你执行这些命令——登记后，它们会写进常驻段落和 skill，由你用自己的 shell 工具在项目里运行。',
      '',
      '例如：/coding-checks add lint npm run lint',
      `      /coding-checks add test pnpm test`,
    ].join('\n')
  }
  return [
    `自检命令（${entries.length}）：`,
    ...entries.map(([checkName, check]) => `  ${check.enabled ? '开' : '关'}  ${checkName.padEnd(12)} ${check.command}`),
    '',
    USAGE_CHECKS,
  ].join('\n')
}

/** `/coding-checks` — edit the project's check commands. */
function checksCommand(refresh, invocation) {
  const args = tokensOf(invocation, 'coding-checks')
  const action = (args[0] ?? 'list').toLowerCase()
  const { config, error } = readConfig()
  if (error !== undefined) return { kind: 'error', text: `${error}\n\n用 /coding-rules reset 重建默认开关文件。` }

  switch (action) {
    case 'list':
      return { kind: 'success', text: checksListText(config) }

    case 'add': {
      const checkName = args[1]
      const command = args.slice(2).join(' ').trim()
      if (checkName === undefined || command.length === 0) {
        return { kind: 'error', text: `用法：/coding-checks add <名称> <命令>\n${USAGE_CHECKS}` }
      }
      const existed = config.checks[checkName] !== undefined
      config.checks[checkName] = { command, enabled: true }
      writeConfig(config)
      refresh()
      return {
        kind: 'success',
        text: `${existed ? '已更新' : '已添加'}自检命令 ${checkName} = \`${command}\`。\n\n${checksListText(config)}`,
      }
    }

    case 'rm':
    case 'remove': {
      const checkName = args[1]
      if (checkName === undefined || config.checks[checkName] === undefined) {
        return { kind: 'error', text: `没有名为 "${checkName ?? ''}" 的自检命令。\n${USAGE_CHECKS}` }
      }
      delete config.checks[checkName]
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `已删除自检命令 ${checkName}。\n\n${checksListText(config)}` }
    }

    case 'on':
    case 'off': {
      const checkName = args[1]
      const entry = checkName === undefined ? undefined : config.checks[checkName]
      if (entry === undefined) {
        return { kind: 'error', text: `没有名为 "${checkName ?? ''}" 的自检命令。\n${USAGE_CHECKS}` }
      }
      entry.enabled = onOff(action)
      writeConfig(config)
      refresh()
      return { kind: 'success', text: `自检命令 ${checkName} 已${entry.enabled ? '启用' : '停用'}。\n\n${checksListText(config)}` }
    }

    default:
      return { kind: 'error', text: `未知子命令 "${action}"。\n${USAGE_CHECKS}` }
  }
}

/**
 * Register the section, the skill, and the two commands.
 * @param ctx - the plugin context; only `systemPrompt`, `skills`, `commands`,
 *   `logger`, and `effect` are used.
 */
export function apply(ctx) {
  const warn = (detail) => {
    try {
      ctx.logger?.warn?.(`coding-discipline: ${detail}`)
    } catch {
      /* A logger must never break the plugin. */
    }
  }

  try {
    const created = ensureSeeded()
    if (created.dir || created.config || created.modules.length > 0) {
      ctx.logger?.info?.(`coding-discipline: 规则库位于 ${rootDir()}`)
    }
  } catch (error) {
    warn(`规则库初始化失败：${messageOf(error)}`)
  }

  // The skill body is a plain string at registration time, so it is re-registered
  // whenever the switches or the files change; the section below does not need
  // that because its text is a function re-evaluated on every assembly.
  let skillDisposer
  const syncSkill = () => {
    if (skillDisposer !== undefined) {
      try {
        skillDisposer()
      } catch (error) {
        warn(`skill 注销失败：${messageOf(error)}`)
      }
      skillDisposer = undefined
    }
    let spec
    try {
      const { config } = readConfig()
      if (!config.enabled || !config.registerSkill) return
      const content = renderSkill(config)
      if (content.trim().length === 0) return
      spec = {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        whenToUse: SKILL_WHEN_TO_USE,
        content,
      }
    } catch (error) {
      warn(`skill 内容生成失败：${messageOf(error)}`)
      return
    }
    try {
      skillDisposer = ctx.skills.register(spec)
    } catch (error) {
      warn(`skill 注册失败：${messageOf(error)}`)
    }
  }

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => {
      try {
        return renderSection()
      } catch (error) {
        warn(`常驻段落渲染失败：${messageOf(error)}`)
        return ''
      }
    },
  })

  syncSkill()

  ctx.commands.register({
    name: 'coding-rules',
    description: '查看与开关编码纪律（常驻段落、skill、规则模块）',
    input: { hint: '[status|on|off|section on|off|skill on|off|module <名> on|off|show [名]|path|reload|reset]' },
    handler: (invocation) => rulesCommand(syncSkill, invocation),
  })

  ctx.commands.register({
    name: 'coding-checks',
    description: '查看与编辑本项目的编码自检命令（lint / test / typecheck）',
    input: { hint: '[list|add <名称> <命令>|rm <名称>|on <名称>|off <名称>]' },
    handler: (invocation) => checksCommand(syncSkill, invocation),
  })

  // Package-private RPC: the client half's settings page (lib/client.js) reads
  // and writes the switch document through these handlers via `host.call`.
  // `harness` is a host builtin here; without it (e.g. a headless profile with
  // no client) these registrations are skipped and the host still works.
  if (typeof harness !== 'undefined' && typeof harness.handle === 'function') {
    const rpc = {
      getConfig: () => readConfig().config,
      listModules: () => listModules(readConfig().config),
      paths: () => ({ config: configPath(), modules: modulesDir(), root: rootDir() }),
      setConfig: (next) => {
        writeConfig(next)
        syncSkill()
        return true
      },
      reload: () => {
        ensureSeeded()
        syncSkill()
        return true
      },
      reset: () => {
        writeConfig(seedConfig())
        syncSkill()
        return true
      },
    }
    for (const [method, handler] of Object.entries(rpc)) {
      try {
        harness.handle(`coding-discipline:${method}`, handler)
      } catch (error) {
        warn(`客户端 RPC ${method} 注册失败：${messageOf(error)}`)
      }
    }
  }

  let watcher
  try {
    const { config } = readConfig()
    if (config.watch && existsSync(rootDir())) {
      let timer
      watcher = watch(rootDir(), { recursive: true }, () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          syncSkill()
        }, 200)
        timer.unref?.()
      })
      watcher.on('error', (error) => warn(`文件监听出错，改用 /coding-rules reload：${messageOf(error)}`))
    }
  } catch (error) {
    warn(`文件监听不可用，改用 /coding-rules reload：${messageOf(error)}`)
  }

  ctx.effect(function* () {
    yield () => {
      if (skillDisposer !== undefined) {
        try {
          skillDisposer()
        } catch {
          /* Teardown is best effort. */
        }
      }
    }
    yield () => {
      if (watcher !== undefined) {
        try {
          watcher.close()
        } catch {
          /* Teardown is best effort. */
        }
      }
    }
  }, 'coding-discipline cleanup')
}
