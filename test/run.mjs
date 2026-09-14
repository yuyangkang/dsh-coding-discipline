/**
 * Offline acceptance test for dsh-coding-discipline.
 *
 * Runs the store and the plugin's `apply()` against a throwaway DSH_HOME and a
 * fake Cordis context, so the whole package can be validated without booting a
 * profile. The fake context asserts the exact contracts the real services
 * enforce (kebab-case skill name, non-empty description, finite section order,
 * boolean command flags, function handler).
 *
 *   node test/run.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-coding-discipline-'))
process.env.DSH_HOME = home

const store = await import('../lib/store.js')
const plugin = await import('../lib/index.js')

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition, detail) {
  if (!condition) throw new Error(detail ?? 'assertion failed')
}

function assertIncludes(haystack, needle, detail) {
  if (!String(haystack).includes(needle)) {
    throw new Error(detail ?? `expected output to include ${JSON.stringify(needle)}`)
  }
}

// ── seeds cleanly ───────────────────────────────────────────────────────────

check('ensureSeeded creates dir, config, and modules', () => {
  const created = store.ensureSeeded()
  assert(created.dir, 'root dir not reported as created')
  assert(created.config, 'config not reported as created')
  assert(created.modules.length === 4, `expected 4 seeded modules, got ${created.modules.length}`)
  assert(store.configPath() === join(home, 'coding-discipline', 'config.json'), 'unexpected config path')
})

check('seeded config carries the shipped default placement', () => {
  const { config, error } = store.readConfig()
  assert(error === undefined, `unexpected parse error: ${error}`)
  assert(config.enabled === true, 'master switch should default on')
  assert(config.modules['core'].inSection === true, 'core should be in the section')
  assert(config.modules['minimal-change'].inSection === true, 'minimal-change should be in the section')
  assert(config.modules['verification'].inSection === true, 'verification should be in the section')
  assert(config.modules['self-review'].inSection === false, 'self-review should be skill-only')
  assert(config.modules['self-review'].enabled === true, 'self-review should be enabled')
})

check('module names drop the ordering prefix', () => {
  const names = store.listModules().map((module) => module.name).sort()
  assert(JSON.stringify(names) === JSON.stringify(['core', 'minimal-change', 'self-review', 'verification']), `unexpected names: ${names}`)
})

check('ensureSeeded never overwrites an edited module', () => {
  const target = join(store.modulesDir(), '10-core.md')
  const edited = '# 我自己改过的 core\n'
  writeFileSync(target, edited, 'utf8')
  store.ensureSeeded()
  assert(readFileSync(target, 'utf8') === edited, 'seeding clobbered a user edit')
  writeFileSync(target, readFileSync(join(store.shippedRulesDir(), '10-core.md'), 'utf8'), 'utf8')
})

// ── rendering ───────────────────────────────────────────────────────────────

check('section includes section modules and excludes skill-only ones', () => {
  const section = store.renderSection()
  assertIncludes(section, '## 编码纪律（常驻）')
  assertIncludes(section, '先侦察，后动手')
  assertIncludes(section, '最小变更')
  assertIncludes(section, '验证')
  assertIncludes(section, 'coding-discipline')
  assert(!section.includes('写完后的自检清单'), 'skill-only module leaked into the section')
})

check('skill includes every enabled module and the closing contract', () => {
  const skill = store.renderSkill()
  assertIncludes(skill, '# 编码纪律（coding-discipline）')
  assertIncludes(skill, '先侦察，后动手')
  assertIncludes(skill, '最小变更')
  assertIncludes(skill, '验证')
  assertIncludes(skill, '写完后的自检清单')
  assertIncludes(skill, '已改动的')
})

check('section collapses to empty when the master switch is off', () => {
  const { config } = store.readConfig()
  store.writeConfig({ ...config, enabled: false })
  assert(store.renderSection() === '', 'disabled plugin still rendered a section')
  store.writeConfig({ ...config, enabled: true })
  assert(store.renderSection().length > 0, 're-enabling did not restore the section')
})

check('section collapses to empty when the section switch is off', () => {
  const { config } = store.readConfig()
  store.writeConfig({ ...config, injectSection: false })
  assert(store.renderSection() === '', 'section switch off still rendered')
  assert(store.renderSkill().length > 0, 'skill should survive the section switch')
  store.writeConfig({ ...config, injectSection: true })
})

check('per-module switches are honored', () => {
  const { config } = store.readConfig()
  store.writeConfig({ ...config, modules: { ...config.modules, core: { enabled: false, inSection: true } } })
  assert(!store.renderSection().includes('先侦察，后动手'), 'disabled module still in the section')
  assert(!store.renderSkill().includes('先侦察，后动手'), 'disabled module still in the skill')
  store.writeConfig(config)
})

check('a new module file is picked up with skill-only defaults', () => {
  const extra = join(store.modulesDir(), '50-extra.md')
  writeFileSync(extra, '## 我的额外规则\n\n- 这是一条本地新增的规则。\n', 'utf8')
  const modules = store.listModules()
  const found = modules.find((module) => module.name === 'extra')
  assert(found !== undefined, 'new module not discovered')
  assert(found.enabled === true && found.inSection === false, 'new module defaults should be enabled + skill-only')
  assertIncludes(store.renderSkill(), '这是一条本地新增的规则')
  assert(!store.renderSection().includes('这是一条本地新增的规则'), 'skill-only module leaked into the section')
  rmSync(extra)
})

check('a malformed config falls back to defaults instead of silencing the rules', () => {
  writeFileSync(store.configPath(), '{ this is not json', 'utf8')
  const { error } = store.readConfig()
  assert(error !== undefined, 'parse error was not reported')
  assert(store.renderSection().length > 0, 'malformed config silenced the rules')
  store.writeConfig(store.seedConfig())
  assert(store.readConfig().error === undefined, 'reset did not repair the file')
})

// ── check commands ──────────────────────────────────────────────────────────

check('check commands feed the section and can be switched off', () => {
  const { config } = store.readConfig()
  store.writeConfig({ ...config, checks: { lint: { command: 'npm run lint', enabled: true } } })
  assertIncludes(store.renderSection(), 'lint=`npm run lint`')
  assertIncludes(store.renderSkill(), '本项目自检命令')
  const off = store.readConfig().config
  store.writeConfig({ ...off, checks: { lint: { command: 'npm run lint', enabled: false } } })
  assert(!store.renderSection().includes('npm run lint'), 'disabled check still rendered')
  assertIncludes(store.renderSkill(), '尚未配置')
  store.writeConfig(store.seedConfig())
})

check('a string check entry is accepted and blank commands are dropped', () => {
  const { config } = store.readConfig()
  store.writeConfig({ ...config, checks: { lint: 'pnpm lint', broken: '   ' } })
  const read = store.readConfig().config
  assert(read.checks.lint.command === 'pnpm lint' && read.checks.lint.enabled === true, 'string check entry not normalized')
  assert(read.checks.broken === undefined, 'blank command should be dropped')
  store.writeConfig(store.seedConfig())
})

// ── apply() contract against a fake context ─────────────────────────────────

function fakeCtx() {
  const record = { sections: [], skills: [], commands: [], effects: [], disposers: [], warnings: [] }
  const ctx = {
    logger: { warn: (line) => record.warnings.push(line), info: () => {} },
    systemPrompt: {
      section: (section) => {
        assert(typeof section.name === 'string' && section.name.length > 0, 'section name must be a string')
        assert(Number.isFinite(section.order), 'section order must be finite')
        assert(typeof section.text === 'function' || typeof section.text === 'string', 'section text must be a string or function')
        record.sections.push(section)
        return () => {}
      },
    },
    skills: {
      register: (skill) => {
        assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name), `skill name must be kebab-case, got ${skill.name}`)
        assert(typeof skill.description === 'string' && skill.description.length > 0, 'skill needs a description')
        assert(typeof skill.content === 'string' && skill.content.length > 0, 'skill needs content')
        if (skill.whenToUse !== undefined) assert(typeof skill.whenToUse === 'string', 'whenToUse must be a string')
        record.skills.push(skill)
        return () => {
          record.disposers.push('skill')
        }
      },
    },
    commands: {
      register: (command) => {
        assert(/^[a-z0-9-]+$/.test(command.name), `command name "${command.name}" is not accepted`)
        assert(typeof command.description === 'string' && command.description.trim().length > 0, 'command needs a description')
        assert(typeof command.handler === 'function', 'command needs a handler')
        if (command.input !== undefined) assert(typeof command.input.hint === 'string' && command.input.hint.length > 0, 'input hint must be non-empty')
        record.commands.push(command)
        return () => {}
      },
    },
    effect: (generator, label) => {
      assert(typeof generator === 'function', 'effect expects a generator function')
      record.effects.push(label)
      const iterator = generator()
      let step = iterator.next()
      while (!step.done) {
        record.disposers.push(step.value)
        step = iterator.next()
      }
    },
  }
  return { ctx, record }
}

const { ctx, record } = fakeCtx()
let applyError
try {
  plugin.apply(ctx)
} catch (error) {
  applyError = error
}

check('apply() runs without throwing', () => {
  assert(applyError === undefined, `apply threw: ${applyError?.stack ?? applyError}`)
  assert(record.warnings.length === 0, `unexpected warnings: ${record.warnings.join(' | ')}`)
})

check('apply() registers exactly one section at the intended slot', () => {
  assert(record.sections.length === 1, `expected 1 section, got ${record.sections.length}`)
  assert(record.sections[0].name === 'coding-discipline:rules', 'unexpected section name')
  assert(record.sections[0].order === 100, 'unexpected section order')
  assertIncludes(record.sections[0].text(), '## 编码纪律（常驻）')
})

check('apply() registers exactly one runtime skill', () => {
  assert(record.skills.length === 1, `expected 1 skill, got ${record.skills.length}`)
  assert(record.skills[0].name === 'coding-discipline', 'unexpected skill name')
  assertIncludes(record.skills[0].content, '写完后的自检清单')
})

check('apply() registers both commands and they answer', () => {
  assert(record.commands.length === 2, `expected 2 commands, got ${record.commands.length}`)
  const rules = record.commands.find((command) => command.name === 'coding-rules')
  const checks = record.commands.find((command) => command.name === 'coding-checks')
  assert(rules !== undefined && checks !== undefined, 'missing a command')

  const status = rules.handler({ rawInput: '' })
  assert(status.kind === 'success', `status failed: ${JSON.stringify(status)}`)
  assertIncludes(status.text, '总开关')
  assertIncludes(status.text, 'self-review')

  const added = checks.handler({ rawInput: 'add lint npm run lint' })
  assert(added.kind === 'success', `add failed: ${JSON.stringify(added)}`)
  assertIncludes(added.text, 'npm run lint')
  assertIncludes(store.renderSection(), 'npm run lint')

  const toggled = checks.handler({ rawInput: 'off lint' })
  assert(toggled.kind === 'success', `off failed: ${JSON.stringify(toggled)}`)
  assert(!store.renderSection().includes('npm run lint'), 'switched-off check still rendered')

  const badName = checks.handler({ rawInput: 'rm nope' })
  assert(badName.kind === 'error', 'removing an unknown check should error')

  const unknown = rules.handler({ rawInput: 'frobnicate' })
  assert(unknown.kind === 'error', 'unknown subcommand should error')

  const moduleOff = rules.handler({ rawInput: 'module core off' })
  assert(moduleOff.kind === 'success', `module toggle failed: ${JSON.stringify(moduleOff)}`)
  assert(!store.renderSection().includes('先侦察，后动手'), 'module switch did not reach the section')
  rules.handler({ rawInput: 'module core on' })

  const restore = checks.handler({ rawInput: 'rm lint' })
  assert(restore.kind === 'success', 'cleanup failed')
})

check('toggling the skill switch disposes and restores the registration', () => {
  const before = record.skills.length
  const rules = record.commands.find((command) => command.name === 'coding-rules')
  rules.handler({ rawInput: 'skill off' })
  assert(record.disposers.includes('skill'), 'turning the skill off did not dispose it')
  rules.handler({ rawInput: 'skill on' })
  assert(record.skills.length === before + 1, 'turning the skill back on did not re-register it')
})

// ── package-private RPC (host side of the settings page) ────────────────────

check('harness.handle registers the config RPC surface', () => {
  const rpc = {}
  const previous = globalThis.harness
  globalThis.harness = { handle: (name, fn) => { rpc[name] = fn } }
  try {
    plugin.apply(fakeCtx().ctx)
  } finally {
    if (previous === undefined) delete globalThis.harness
    else globalThis.harness = previous
  }
  const methods = Object.keys(rpc).sort()
  assert(
    JSON.stringify(methods) === JSON.stringify(['coding-discipline:getConfig', 'coding-discipline:listModules', 'coding-discipline:paths', 'coding-discipline:reload', 'coding-discipline:reset', 'coding-discipline:setConfig']),
    `unexpected RPC methods: ${methods.join(', ')}`,
  )

  const config = rpc['coding-discipline:getConfig']()
  assert(config.enabled === true, 'getConfig did not return the switch document')
  const modules = rpc['coding-discipline:listModules']()
  assert(modules.length === 4, `listModules returned ${modules.length} modules`)
  const paths = rpc['coding-discipline:paths']()
  assert(typeof paths.config === 'string' && typeof paths.modules === 'string', 'paths did not return strings')

  assert(rpc['coding-discipline:setConfig']({ ...config, enabled: false }) === true, 'setConfig did not return true')
  assert(store.readConfig().config.enabled === false, 'setConfig did not persist')
  rpc['coding-discipline:setConfig']({ ...config, enabled: true })
  assert(store.readConfig().config.enabled === true, 'setConfig did not restore')

  assert(rpc['coding-discipline:reset']() === true, 'reset did not return true')
  assert(rpc['coding-discipline:reload']() === true, 'reload did not return true')
})

check('apply() without harness still works', () => {
  const sandbox = fakeCtx()
  if ('harness' in globalThis) throw new Error('harness present in previous test context')
  plugin.apply(sandbox.ctx)
  assert(sandbox.record.sections.length === 1, 'section missing without harness')
})

// ── client bundle (sidebar settings page) ───────────────────────────────────

function loadClientBundle() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  const ReactStub = {
    createElement: (...args) => ({ __type: 'react-element', args }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const sandbox = {
    window,
    React: ReactStub,
    console,
  }
  const fn = new Function('window', 'React', 'console', source)
  fn(sandbox.window, sandbox.React, sandbox.console)
  return { source, registrations, ReactStub }
}

check('client bundle registers one factory and exports apply/inject', () => {
  const { registrations } = loadClientBundle()
  assert(registrations.length === 1, `expected 1 factory registration, got ${registrations.length}`)
  const registration = registrations[0]
  assert(registration.id === 'dsh-coding-discipline', `unexpected factory id: ${registration.id}`)
  assert(typeof registration.factory === 'function', 'factory must be a function')
  const materialized = registration.factory((spec) => { throw new Error(`no external requires allowed, got ${spec}`) })
  assert(typeof materialized.apply === 'function', 'factory exports apply')
  assert(Array.isArray(materialized.inject), 'factory exports inject as an array')
  assert(materialized.inject.includes('slots'), 'inject should list the slots service')
})

check('client apply() registers the settings.section page', () => {
  const { registrations } = loadClientBundle()
  const recordSlots = []
  const slots = {
    inject: (key, callback) => { recordSlots.push({ key, callback }); return () => {} },
    register: (registration, component) => { recordSlots[0].registration = registration; recordSlots[0].component = component; return () => {} },
  }
  const ctx = {
    get: (name) => (name === 'slots' ? slots : undefined),
  }
  registrations[0].factory((spec) => { throw new Error(`no external module ${spec}`) }).apply(ctx)
  assert(recordSlots.length === 1, 'client apply did not inject a slot')
  assert(recordSlots[0].key === 'settings.section', `unexpected slot key: ${recordSlots[0].key}`)
  // The inject callback runs the register call; the registration object is captured by the stub.
  recordSlots[0].callback()
  const registration = recordSlots[0].registration
  assert(registration.name === 'settings.section', 'unexpected slot name')
  assert(registration.id === 'coding-discipline', 'unexpected slot id')
  assert(registration.order === 50, `unexpected order: ${registration.order}`)
  assert(registration.label() === '编码纪律', 'unexpected label')
  assert(typeof recordSlots[0].component === 'function', 'settings page component must be a function')
})

check('client apply() is a no-op when slots is unavailable', () => {
  const { registrations } = loadClientBundle()
  const ctx = { get: (name) => undefined }
  let threw = false
  try {
    registrations[0].factory((spec) => { throw new Error(`no external module ${spec}`) }).apply(ctx)
  } catch (error) {
    threw = true
  }
  assert(!threw, 'apply should not throw when slots is missing')
})

// ── apply() yields teardown disposers through ctx.effect ────────────────────

check('apply() yields teardown disposers through ctx.effect', () => {
  assert(record.effects.length === 1, `expected 1 effect, got ${record.effects.length}`)
  assert(record.disposers.filter((entry) => typeof entry === 'function').length >= 1, 'no teardown disposer yielded')
  for (const disposer of record.disposers) if (typeof disposer === 'function') disposer()
})

check('the section text function never throws on a broken store', () => {
  writeFileSync(store.configPath(), 'not json at all', 'utf8')
  assert(typeof record.sections[0].text() === 'string', 'section text threw or returned non-string')
  store.writeConfig(store.seedConfig())
})

// ── report ──────────────────────────────────────────────────────────────────

rmSync(home, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
for (const failure of failures) console.log(`  ✗ ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
