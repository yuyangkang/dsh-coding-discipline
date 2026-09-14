# dsh-coding-discipline

给 DeepSeek Harness 的**编码纪律**插件：让 agent 在写代码时先读项目约定、保持最小变更、写完自检明显 bug、按最窄命令验证后如实报告。

它同时做四件事：

| 贡献 | 生效方式 | 载体 |
| --- | --- | --- |
| **常驻段落** | 每个会话、每次请求都在 system prompt 里 | `ctx.systemPrompt.section()`，位置紧跟 persona（order 100） |
| **按需 skill** | 只在 skill 目录里列一行，需要时由模型加载 | `ctx.skills.register()`，名字 `coding-discipline` |
| **两条斜杠命令** | 在对话里查看与改开关 | `/coding-rules`、`/coding-checks` |
| **侧边栏操作页** | Web 侧边栏 → 设置 → 编码纪律，图形化开关/重载/重置 | 客户端 `settings.section` + 包私有 RPC（`host.call` ↔ `harness.handle`） |

规则正文**不在代码里**。它是一组可随手编辑的 Markdown 文件，改完保存即生效（下一次请求就带上），不需要重新打包或重启。

---

## 安装

```sh
# 从 GitHub（公开仓库，无需鉴权）
dsh plugin --profile web add github:<owner>/dsh-coding-discipline
# 或从 npm
dsh plugin --profile web add dsh-coding-discipline
# 或本地目录（软链，改代码即生效）
dsh plugin --profile web add link:/abs/path/to/dsh-coding-discipline
```

然后**必须把包名加进 profile 的 bundles**，否则它的 `cordis.patch.yml` 不会被组合：

```jsonc
// $DSH_HOME/profiles/web/package.json
"dsh": { "profile": { "bundles": [ "...", "dsh-coding-discipline" ] } }
```

`scripts/install.mjs` 把上面两步合成一条命令：

```sh
node scripts/install.mjs --profile web --spec link:/abs/path/to/dsh-coding-discipline
node scripts/install.mjs --profile web --spec github:owner/dsh-coding-discipline
node scripts/install.mjs --profile web --uninstall
```

> `dsh plugin add` 只是把参数转发给 profile 目录里的 pnpm，它**不会**替你把包名写进 `bundles`。这是最容易踩空的一步。

**重启 profile 后生效**（bundle 行不是热加载的）。

---

## 卸载与回滚

```sh
node scripts/install.mjs --profile web --uninstall
# 等价于手工：
#   1. 从 $DSH_HOME/profiles/web/package.json 的 dsh.profile.bundles 删掉 dsh-coding-discipline
#   2. dsh plugin --profile web remove dsh-coding-discipline
```

规则与开关文件不会被删除，重装后沿用。

---

## 命令

### `/coding-rules`

```
/coding-rules                      查看状态：总开关、段落、skill、模块、自检命令、目录
/coding-rules on | off             总开关
/coding-rules section on | off     是否注入常驻段落
/coding-rules skill on | off       是否注册 coding-discipline skill
/coding-rules module <名> on | off             启用/停用某个规则模块
/coding-rules module <名> section on | off     该模块是否进常驻段落（关掉后仍留在 skill 里）
/coding-rules show [模块名]        打印常驻段落实际内容，或某个模块的正文
/coding-rules path                 打印规则与开关文件的位置
/coding-rules reload               重新读取磁盘（新增模块后不用重启）
/coding-rules reset                开关恢复默认（不动模块文件）
```

### `/coding-checks`

登记**本项目**的自检命令。插件不会替你执行它们——登记后它们会写进常驻段落和 skill，由 agent 用它自己的 shell 工具在项目里跑（这样仍然受 sandbox 约束）。

```
/coding-checks                      列出
/coding-checks add lint npm run lint
/coding-checks add test pnpm test
/coding-checks rm test
/coding-checks on lint
/coding-checks off lint
```

## 侧边栏操作页

Web 界面里，侧边栏底部齿轮 → **设置** → **编码纪律** 就是图形化操作页（`settings.section`，order 50）。它和 `/coding-rules` 读写同一份开关：

- 四个主开关（总开关 / 常驻段落 / 注册 skill / 文件监听）
- 每个规则模块的「启用」与「常驻段落」两个开关
- 重载规则、重置为默认两个按钮
- 显示开关与模块文件的真实路径

它通过 HTTP bridge 读写：客户端 `fetch("/api/coding-discipline/getConfig" | "setConfig" | "listModules" | "paths" | "reload" | "reset")` 对应对端 `webServer` 上的同名 JSON 端点（`lib/index.js` 的 `makeBridgeRoutes`），因此**与命令行开关完全一致、立即落盘**。`lib/client.js` 是手写的客户端 bundle（`window.__ModuleLoader__.load({id, factory})`），只 `require` 浏览器平台的 seed 模块（`react`、`react/jsx-runtime`），通过 `ctx.slots` 注册 `settings.section` 页面，不需要也不使用 `host`/`harness` 动态包内置。

---

## 规则与开关文件

```
$DSH_HOME/coding-discipline/
  config.json          开关
  modules/             规则正文，一个文件一个模块
    10-core.md            -> 模块 core
    20-minimal-change.md  -> 模块 minimal-change
    30-verification.md    -> 模块 verification
    40-self-review.md     -> 模块 self-review
```

- **首次运行从插件包内复制默认值**；之后永不覆盖，升级只会补上缺失的模块文件。
- **新增规则 = 新建一个 `.md` 文件**。文件名前缀 `10-`、`20-` 只用于排序；`moduleName` 会去掉它。新模块默认「启用 + 只进 skill」，用 `/coding-rules module <名> section on` 让它常驻。
- 只有「启用 + 常驻」的模块进 system prompt；「启用 + 仅 skill」的模块只在你加载 skill 时出现。`40-self-review.md` 默认属于后者——那份自检清单很长，不该每轮都付 token。
- `config.json` 写坏了也不会静默失效：解析失败时回退到默认规则继续生效，`/coding-rules` 会显示具体错误。

### 段落开关与「空段落」约定

`renderSection()` 在总开关或段落开关关闭时返回**空字符串**。prompt 组装器会丢弃空段落，所以开关是真正实时的——不需要重新注册、不需要重启。

skill 正文在注册时是字符串，所以改文件后的热更新靠 `fs.watch` 触发重新注册，并由 `/coding-rules reload` 兜底。

---

## 设计说明

- **规则不进代码。** 插件只做三件事：注入、注册、提供命令。规则迭代是改 Markdown 一行字，不是发版。
- **项目约定优先。** 规则第一条就是"先读项目自己的 AGENTS.md / CONTRIBUTING / lint 配置，冲突时以项目为准"。全局规则只补项目没写的那部分。
- **插件不执行命令。** 自检命令只写进提示词，由 agent 用自己的 sandbox 化 shell 工具运行；插件不绕过 sandbox 起进程。
- **零依赖。** `lib/` 只用 Node 内置模块，不引 `@deepseek-ai/*` 包，因此不会和部署版本耦合。

## 作用域

这一行是 profile 级 bundle 行，注册在**全局层**，因此对该 profile 下**所有会话、所有 preset** 生效（包括 `minimal`、`ptc`）。如果你只想让编码类会话生效，那就不是插件该做的事——把同一段 prompt section 放进自建 preset 的 `agent.cordis.yml`。

## 兼容性

- DSH `0.1.5-rc.1` 上验证通过：`systemPrompt.section` / `skills.register` / `commands.register` 与 `webServer` HTTP bridge 四类契约为实际运行时实测；客户端使用浏览器的 9 个 seed 模块（`react` 等），不依赖 `host`/`harness` 动态包内置。
- Node >= 20（`fs.watch` 的 `recursive` 选项）。

## 测试

```sh
node test/run.mjs
```

25 项离线用例：播种不覆盖用户编辑、段落/skill 渲染、各类开关、新模块发现、损坏配置的回退、`apply()` 对服务的注册契约、命令子命令与错误分支、桥接路由、客户端 bundle 的形状（seed 模块 require + `settings.section` 注册）、teardown。
