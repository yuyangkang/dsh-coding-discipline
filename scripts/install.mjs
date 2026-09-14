#!/usr/bin/env node
/**
 * Install or uninstall dsh-coding-discipline for one dsh profile.
 *
 * `dsh plugin --profile <p> add <spec>` only forwards its arguments to pnpm
 * inside the profile directory. It does NOT register the bundle, and a package
 * whose patch is absent from `dsh.profile.bundles` contributes nothing at all —
 * which is the step people miss. This script performs both steps and is
 * idempotent.
 *
 *   node scripts/install.mjs --profile web --spec link:/abs/path/to/pkg
 *   node scripts/install.mjs --profile web --spec github:owner/repo
 *   node scripts/install.mjs --profile web --spec dsh-coding-discipline
 *   node scripts/install.mjs --profile web --uninstall
 *   node scripts/install.mjs --profile web --spec link:/abs/path --dry-run
 *
 * Exit codes: 0 ok, 1 usage/environment error, 2 pnpm failed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OWN_PACKAGE = readJson(join(PACKAGE_ROOT, 'package.json'))

function usage(detail, exitCode = 1) {
  if (detail !== undefined) console.error(`错误：${detail}\n`)
  console.error(
    [
      '用法：node scripts/install.mjs [选项]',
      '',
      '  --profile <名>    目标 profile（默认 web）',
      '  --spec <pnpm 规格> 安装源：dsh-coding-discipline / github:owner/repo / link:/abs/path / file:...',
      '  --name <包名>      卸载时指定包名（默认自动识别）',
      '  --dsh-home <路径>  覆盖 $DSH_HOME',
      '  --uninstall        从 profile 中移除',
      '  --dry-run          只打印将要执行的动作',
      '  --yes              跳过确认提示（本脚本无交互提示，保留给自动化）',
    ].join('\n'),
  )
  process.exit(exitCode)
}

/** Read JSON tolerantly: a manifest saved by an editor may carry a UTF-8 BOM. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''))
}

function parseArgs(argv) {
  const options = {
    profile: 'web',
    spec: undefined,
    name: undefined,
    dshHome: process.env.DSH_HOME,
    uninstall: false,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) usage(`${token} 需要一个值`)
      index += 1
      return value
    }
    switch (token) {
      case '--profile': options.profile = next(); break
      case '--spec': options.spec = next(); break
      case '--name': options.name = next(); break
      case '--dsh-home': options.dshHome = next(); break
      case '--uninstall': options.uninstall = true; break
      case '--dry-run': options.dryRun = true; break
      case '--yes': break
      case '--help': case '-h': usage(undefined, 0); break
      default: usage(`未知参数 ${token}`)
    }
  }
  return options
}

/** Quote one argv token for the shell that spawn() will use. */
function quoteArg(value) {
  if (!/[\s"']/u.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

function runPnpm(args, cwd, dryRun) {
  const line = `pnpm ${args.map(quoteArg).join(' ')}`
  console.log(`  $ ${line}`)
  if (dryRun) return
  const result = spawnSync(line, { cwd, stdio: 'inherit', shell: true })
  if (result.error !== undefined) {
    console.error(`\npnpm 启动失败：${result.error.message}\n请确认 pnpm 在 PATH 中。`)
    process.exit(2)
  }
  if (result.status !== 0) {
    console.error(`\npnpm 退出码 ${result.status}`)
    process.exit(2)
  }
}

/** Resolve the package name of a path-like spec by reading its package.json. */
function nameFromPathSpec(spec) {
  const withoutProtocol = spec.replace(/^(?:link|file|portal):/u, '')
  if (!isAbsolute(withoutProtocol) && !withoutProtocol.startsWith('.')) return undefined
  const base = isAbsolute(withoutProtocol) ? withoutProtocol : resolve(PACKAGE_ROOT, withoutProtocol)
  const manifest = join(base, 'package.json')
  if (!existsSync(manifest)) return undefined
  try {
    const parsed = readJson(manifest)
    return typeof parsed.name === 'string' ? parsed.name : undefined
  } catch {
    return undefined
  }
}

/** Best-effort package name from a spec, used when pnpm adds nothing new (already installed). */
function nameFromSpec(spec) {
  const fromPath = nameFromPathSpec(spec)
  if (fromPath !== undefined) return fromPath
  const bare = spec.replace(/^(?:npm|github|git\+[a-z]+):/u, '')
  if (bare.includes('/')) return undefined
  return bare.replace(/@[^@/]*$/u, '')
}

function readProfileManifest(profileDir) {
  const path = join(profileDir, 'package.json')
  if (!existsSync(path)) usage(`找不到 profile 的 package.json：${path}`)
  return { path, manifest: readJson(path) }
}

function writeProfileManifest(path, manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function bundlesOf(manifest) {
  const profile = manifest.dsh?.profile
  if (profile === undefined) {
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [] } }
  } else if (!Array.isArray(manifest.dsh.profile.bundles)) {
    manifest.dsh.profile.bundles = []
  }
  return manifest.dsh.profile.bundles
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  const dshHome = options.dshHome !== undefined && options.dshHome.trim().length > 0
    ? options.dshHome.trim()
    : join(homedir(), '.dsh')
  const profileDir = join(dshHome, 'profiles', options.profile)
  if (!existsSync(profileDir)) {
    usage(`profile 目录不存在：${profileDir}\n先启动一次该 profile 以初始化它。`)
  }

  console.log(`DSH_HOME   ${dshHome}`)
  console.log(`profile    ${options.profile}  (${profileDir})`)
  console.log(`package    ${OWN_PACKAGE.name}@${OWN_PACKAGE.version}`)
  console.log(`模式       ${options.uninstall ? '卸载' : '安装'}${options.dryRun ? '（dry-run）' : ''}\n`)

  if (options.uninstall) {
    const { path, manifest } = readProfileManifest(profileDir)
    const bundles = bundlesOf(manifest)
    const name = options.name ?? bundles.find((entry) => entry === OWN_PACKAGE.name) ?? OWN_PACKAGE.name
    const index = bundles.indexOf(name)
    console.log(index === -1 ? `bundles 中没有 ${name}，跳过。` : `从 bundles 移除 ${name}`)
    if (index !== -1) {
      bundles.splice(index, 1)
      if (!options.dryRun) writeProfileManifest(path, manifest)
    }
    runPnpm(['remove', name], profileDir, options.dryRun)
    console.log(`\n完成。重启 profile 后该插件不再加载。规则文件仍保留在 ${join(dshHome, 'coding-discipline')}。`)
    return
  }

  const spec = options.spec ?? OWN_PACKAGE.name
  const { path, manifest } = readProfileManifest(profileDir)
  const before = { ...(manifest.dependencies ?? {}) }

  console.log('1/3 安装包到 profile')
  runPnpm(['add', spec], profileDir, options.dryRun)

  console.log('\n2/3 注册 bundle（dsh plugin add 不会做这一步）')
  let name = spec
  if (!options.dryRun) {
    const after = readJson(path).dependencies ?? {}
    const added = Object.keys(after).filter((key) => before[key] === undefined)
    name = added[0] ?? nameFromSpec(spec) ?? options.name ?? OWN_PACKAGE.name
    if (added.length > 1) {
      console.log(`  注意：这次新增了多个依赖（${added.join(', ')}），将注册 ${name}；如有遗漏请手工补 bundles。`)
    }
  } else {
    name = nameFromSpec(spec) ?? options.name ?? OWN_PACKAGE.name
  }
  console.log(`  包名：${name}`)

  const { manifest: fresh } = readProfileManifest(profileDir)
  const bundles = bundlesOf(fresh)
  if (bundles.includes(name)) {
    console.log('  bundles 中已存在，无需改动。')
  } else {
    bundles.push(name)
    console.log(`  写入 ${path} 的 dsh.profile.bundles`)
    if (!options.dryRun) writeProfileManifest(path, fresh)
  }

  console.log('\n3/3 完成')
  console.log(`  bundles: ${bundles.join(', ')}`)
  console.log('\n下一步：')
  console.log('  1) 重启该 profile（bundle 行不是热加载的）')
  console.log(`  2) 重启后运行 /coding-rules 查看状态`)
  console.log(`  3) 规则与开关位于 ${join(dshHome, 'coding-discipline')}`)
  console.log('\n回滚：')
  console.log(`  node ${join(PACKAGE_ROOT, 'scripts', 'install.mjs')} --profile ${options.profile} --uninstall`)
}

main()
