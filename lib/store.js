/**
 * dsh-coding-discipline — rule store.
 *
 * The plugin ships its default rules inside the package (`rules/*.md`), but the
 * live copy is the user-editable store under `$DSH_HOME/coding-discipline/`:
 *
 *   config.json    switches (master, section, per-module, per-check)
 *   modules/*.md   the rule text: one module per file, editable by hand
 *
 * `10-core.md` is the module named `core` — a leading `NN-` prefix only exists
 * to give the files a readable order. Nothing is ever overwritten once seeded,
 * so upgrading the package adds new modules without clobbering edits.
 *
 * This module imports Node builtins only, so the package installs on any
 * deployment without pulling peer dependencies.
 *
 * @module dsh-coding-discipline/store
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Shipped default modules, resolved relative to this file rather than cwd. */
const SHIPPED_RULES_DIR = fileURLToPath(new URL('../rules/', import.meta.url))

/** Module names that belong in the always-on section by default; the rest are skill-only. */
const SECTION_BY_DEFAULT = new Set(['core', 'minimal-change', 'verification'])

const MODULE_FILE = /\.md$/i
const ORDER_PREFIX = /^\d+[-_]/
const CONFIG_FILE = 'config.json'

/** Shape of a freshly seeded configuration; `modules` and `checks` start empty. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  injectSection: true,
  registerSkill: true,
  watch: true,
  modules: Object.freeze({}),
  checks: Object.freeze({}),
})

/** Resolve the harness home exactly as the deployment does. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** Root of the editable store. */
export function rootDir() {
  return join(dshHome(), 'coding-discipline')
}

/** Path of the switch document. */
export function configPath() {
  return join(rootDir(), CONFIG_FILE)
}

/** Directory holding one Markdown file per rule module. */
export function modulesDir() {
  return join(rootDir(), 'modules')
}

/** Directory of the modules shipped inside the package. */
export function shippedRulesDir() {
  return SHIPPED_RULES_DIR
}

/** Derive the switch name of one module file: `10-core.md` -> `core`. */
export function moduleName(fileName) {
  return basename(fileName).replace(MODULE_FILE, '').replace(ORDER_PREFIX, '')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shippedModuleFiles() {
  try {
    return readdirSync(SHIPPED_RULES_DIR).filter((file) => MODULE_FILE.test(file)).sort()
  } catch {
    return []
  }
}

/** A configuration whose module entries mirror the shipped module set. */
export function seedConfig() {
  const modules = {}
  for (const file of shippedModuleFiles()) {
    const name = moduleName(file)
    modules[name] = { enabled: true, inSection: SECTION_BY_DEFAULT.has(name) }
  }
  return { ...DEFAULT_CONFIG, modules, checks: {} }
}

/** Coerce a parsed document into the exact configuration shape this plugin reads. */
function normalizeConfig(parsed) {
  const modules = {}
  for (const [name, value] of Object.entries(isPlainObject(parsed.modules) ? parsed.modules : {})) {
    const entry = isPlainObject(value) ? value : {}
    modules[name] = { enabled: entry.enabled !== false, inSection: entry.inSection === true }
  }
  const checks = {}
  for (const [name, value] of Object.entries(isPlainObject(parsed.checks) ? parsed.checks : {})) {
    if (typeof value === 'string') {
      if (value.trim().length > 0) checks[name] = { command: value, enabled: true }
      continue
    }
    const entry = isPlainObject(value) ? value : {}
    if (typeof entry.command !== 'string' || entry.command.trim().length === 0) continue
    checks[name] = { command: entry.command, enabled: entry.enabled !== false }
  }
  return {
    enabled: parsed.enabled !== false,
    injectSection: parsed.injectSection !== false,
    registerSkill: parsed.registerSkill !== false,
    watch: parsed.watch !== false,
    modules,
    checks,
  }
}

/**
 * Read the switch document.
 * @returns the normalized configuration, a readable `error` when the file is
 *   malformed (the caller keeps serving defaults rather than breaking the
 *   prompt), and whether the file exists.
 */
export function readConfig() {
  const path = configPath()
  if (!existsSync(path)) return { config: seedConfig(), error: undefined, exists: false }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!isPlainObject(parsed)) throw new TypeError('config root must be a JSON object')
    return { config: normalizeConfig(parsed), error: undefined, exists: true }
  } catch (error) {
    return {
      config: seedConfig(),
      error: `${path} 解析失败，使用默认配置：${error instanceof Error ? error.message : String(error)}`,
      exists: true,
    }
  }
}

/** Write the switch document atomically. */
export function writeConfig(config) {
  mkdirSync(rootDir(), { recursive: true })
  const path = configPath()
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

/**
 * Create the store on first use and register modules that appeared since.
 * Existing files and existing switch values are never rewritten.
 * @returns what this call created, for logging.
 */
export function ensureSeeded() {
  const created = { dir: false, config: false, modules: [] }
  if (!existsSync(rootDir())) {
    mkdirSync(rootDir(), { recursive: true })
    created.dir = true
  }
  if (!existsSync(modulesDir())) mkdirSync(modulesDir(), { recursive: true })
  for (const file of shippedModuleFiles()) {
    const target = join(modulesDir(), file)
    if (existsSync(target)) continue
    try {
      copyFileSync(join(SHIPPED_RULES_DIR, file), target)
      created.modules.push(file)
    } catch {
      /* A read-only or racing store must not stop the plugin from serving. */
    }
  }
  if (!existsSync(configPath())) {
    writeConfig(seedConfig())
    created.config = true
    return created
  }
  const { config, error } = readConfig()
  if (error !== undefined) return created
  let changed = false
  for (const file of shippedModuleFiles()) {
    const name = moduleName(file)
    if (config.modules[name] !== undefined) continue
    config.modules[name] = { enabled: true, inSection: SECTION_BY_DEFAULT.has(name) }
    changed = true
  }
  if (changed) writeConfig(config)
  return created
}

/**
 * Resolve every module currently on disk against the switch document.
 * A module with no switch entry is enabled with the shipped default placement,
 * so dropping a new `.md` file into `modules/` is enough to add a rule.
 */
export function listModules(config) {
  const resolved = config ?? readConfig().config
  const dir = modulesDir()
  let files
  try {
    files = readdirSync(dir).filter((file) => MODULE_FILE.test(file)).sort()
  } catch {
    files = []
  }
  const modules = []
  for (const file of files) {
    const name = moduleName(file)
    const path = join(dir, file)
    const entry = resolved.modules[name] ?? { enabled: true, inSection: SECTION_BY_DEFAULT.has(name) }
    let text = ''
    let error
    try {
      text = readFileSync(path, 'utf8')
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    modules.push({
      name,
      file,
      path,
      enabled: entry.enabled !== false,
      inSection: entry.inSection === true,
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      error,
    })
  }
  return modules
}

/** Enabled check commands, in configuration order. */
export function enabledChecks(config) {
  return Object.entries(config.checks)
    .filter(([, check]) => check.enabled && check.command.trim().length > 0)
    .map(([name, check]) => ({ name, command: check.command.trim() }))
}

/** One line naming the project's own check commands, or `''` when none are configured. */
export function renderCheckLine(config) {
  const checks = enabledChecks(config)
  if (checks.length === 0) return ''
  const list = checks.map((check) => `${check.name}=\`${check.command}\``).join('；')
  return `本项目自检命令：${list}。改动后必须运行最相关的一条；未运行不得声称已验证。`
}

const SKILL_TRIGGER = '完整细则与「明显 bug」自检清单：开始写或改代码前，先用 `skill` 工具加载 `coding-discipline`。'

/**
 * Render the always-on prompt section.
 * @returns the section text, or `''` when the section is switched off or empty —
 *   an empty section is dropped by the prompt assembler, which is what makes the
 *   switches live without re-registering anything.
 */
export function renderSection() {
  // A malformed switch document falls back to the seeded defaults rather than
  // silencing the rules: the failure direction should be "rules still apply",
  // and `/coding-rules` is where the parse error is surfaced.
  const { config } = readConfig()
  if (!config.enabled || !config.injectSection) return ''
  const modules = listModules(config).filter(
    (module) => module.enabled && module.inSection && module.text.trim().length > 0,
  )
  const checkLine = renderCheckLine(config)
  if (modules.length === 0 && checkLine === '') return ''
  const parts = ['## 编码纪律（常驻）']
  for (const module of modules) parts.push(module.text.trim())
  if (checkLine !== '') parts.push(checkLine)
  parts.push(SKILL_TRIGGER)
  return parts.join('\n\n')
}

/** Render the on-demand skill body: every enabled module plus the check commands. */
export function renderSkill(config) {
  const resolved = config ?? readConfig().config
  const modules = listModules(resolved).filter(
    (module) => module.enabled && module.text.trim().length > 0,
  )
  const parts = [
    '# 编码纪律（coding-discipline）',
    '这是本机生效的完整编码纪律。常驻段落只含摘要，这里含全部启用的模块。**项目自身的约定优先于本规则**：先读项目的 AGENTS.md / CONTRIBUTING / lint 配置，冲突时以项目为准。',
  ]
  if (modules.length === 0) {
    parts.push('当前没有启用任何规则模块。用 `/coding-rules` 查看并开启。')
  }
  for (const module of modules) parts.push(module.text.trim())
  const checks = enabledChecks(resolved)
  if (checks.length > 0) {
    parts.push(
      [
        '## 本项目自检命令',
        ...checks.map((check) => `- \`${check.name}\`：\`${check.command}\``),
        '改动后至少运行最相关的一条。未运行不得声称已验证。',
      ].join('\n'),
    )
  } else {
    parts.push(
      [
        '## 本项目自检命令',
        '尚未配置。先从项目里找出真实存在的命令，再用 `/coding-checks add <名称> <命令>` 登记；不要凭空假设命令存在。',
      ].join('\n'),
    )
  }
  parts.push(
    [
      '## 收尾',
      '报告时分开写：**已改动的** / **已验证的**（附真实命令与结果）/ **未验证的**（附原因）。任何"应该没问题"都不算验证。',
    ].join('\n'),
  )
  return parts.join('\n\n')
}
