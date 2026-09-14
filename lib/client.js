/**
 * Client half of dsh-coding-discipline — a sidebar settings page.
 *
 * This file is a hand-written client bundle in the shape the client module
 * graph consumes: `window.__ModuleLoader__.load({ id, factory })`. The factory
 * is lazy CJS: executing the bundle only registers the factory; the body runs
 * at materialization on first import. Nothing external is `require`d — `React`,
 * `host`, `styles`, `console`, and `ctx` (with `ctx.slots`) arrive as closure
 * builtins — so the bundle stays dependency-free on the browser side too.
 *
 * The page is a `settings.section` entry (the sanctioned "whole page in the
 * sidebar settings") that reads and writes the plugin's switch document
 * through the package-private Client→Host RPC: `host.call("coding-discipline:*")`
 * pairs with `harness.handle("coding-discipline:*")` registered by the host
 * half in `lib/index.js`.
 *
 * @module dsh-coding-discipline/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-coding-discipline',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** export helpers matching the graph's CJS contract */
    const __defProp = Object.defineProperty
    const __getOwnPropDesc = Object.getOwnPropertyDescriptor
    const __getOwnPropNames = Object.getOwnPropertyNames
    const __hasOwnProp = Object.prototype.hasOwnProperty
    const __export = (target, all) => {
      for (const name in all) __defProp(target, name, { get: all[name], enumerable: true })
    }
    const __copyProps = (to, from, except, desc) => {
      if ((from && typeof from === 'object') || typeof from === 'function') {
        for (let key of __getOwnPropNames(from)) {
          if (!__hasOwnProp.call(to, key) && key !== except) {
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable })
          }
        }
      }
      return to
    }
    const __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod)

    /**
     * One labeled checkbox row.
     * @param {object} p - row props
     * @param {boolean} p.checked - checkbox state
     * @param {string} p.label - row text
     * @param {(v: boolean) => void} p.onChange - checked change callback
     */
    function Row({ checked, label, onChange }) {
      return React.createElement(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 0',
            cursor: 'pointer',
            userSelect: 'none',
          },
        },
        React.createElement('input', {
          type: 'checkbox',
          checked,
          onChange: (event) => onChange(event.target.checked),
        }),
        React.createElement('span', null, label),
      )
    }

    /** @param {object} p */
    function Fieldset({ title, children }) {
      return React.createElement(
        'fieldset',
        { style: { border: '1px solid var(--dsw-border, #dee2e6)', borderRadius: '6px', padding: '12px', margin: '0 0 16px' } },
        React.createElement('legend', { style: { padding: '0 6px', fontWeight: 600 } }, title),
        children,
      )
    }

    /** Small action button. */
    function ActionButton({ label, onClick, danger, loading }) {
      return React.createElement(
        'button',
        {
          onClick,
          disabled: loading,
          style: {
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-border, #dee2e6)',
            background: danger ? 'transparent' : 'var(--dsw-alias-interactive-bg, #f1f3f5)',
            color: danger ? 'var(--dsw-danger, #dc3545)' : 'inherit',
            cursor: loading ? 'wait' : 'pointer',
            fontWeight: 500,
          },
        },
        loading ? '…' : label,
      )
    }

    /**
     * The settings page body. Config and module list come from the host over the
     * package-private RPC; there is no local store to seed.
     */
    function SettingsPage() {
      const [state, setState] = React.useState({
        loading: true,
        error: null,
        config: null,
        modules: [],
        dirs: null,
      })

      const refresh = React.useCallback(async () => {
        try {
          const [config, modules, dirs] = await Promise.all([
            host.call('coding-discipline:getConfig'),
            host.call('coding-discipline:listModules'),
            host.call('coding-discipline:paths'),
          ])
          setState({ loading: false, error: null, config, modules: modules ?? [], dirs })
        } catch (error) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      const save = async (patch) => {
        setState((previous) => ({ ...previous, loading: true, error: null }))
        try {
          await host.call('coding-discipline:setConfig', patch)
          await refresh()
        } catch (error) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      const toggleConfig = (key) => {
        const config = state.config
        if (!config) return
        void save({ ...config, [key]: !config[key] })
      }

      const toggleModule = (name, key) => {
        const config = state.config
        if (!config) return
        const modules = { ...config.modules }
        const entry = modules[name] ?? { enabled: true, inSection: false }
        modules[name] = { ...entry, [key]: !entry[key] }
        void save({ ...config, modules })
      }

      const reload = async () => {
        setState((previous) => ({ ...previous, loading: true }))
        try {
          await host.call('coding-discipline:reload')
          await refresh()
        } catch (error) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      const reset = async () => {
        setState((previous) => ({ ...previous, loading: true }))
        try {
          await host.call('coding-discipline:reset')
          await refresh()
        } catch (error) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      if (state.loading) {
        return React.createElement('div', { style: { padding: 24, color: 'var(--dsw-text-secondary, #6c757d)' } }, '加载中…')
      }
      if (state.error) {
        return React.createElement(
          'div',
          { style: { padding: 16, color: 'var(--dsw-danger, #dc3545)' } },
          React.createElement('p', null, `加载失败：${state.error}`),
          React.createElement(ActionButton, { label: '重试', onClick: refresh }),
        )
      }
      const config = state.config
      if (!config) {
        return React.createElement('div', { style: { padding: 24 } }, '配置不可用。')
      }

      return React.createElement(
        'div',
        { style: { padding: '16px 20px', maxWidth: 640, overflowY: 'auto' } },
        React.createElement('h3', { style: { margin: '0 0 12px' } }, '编码纪律'),
        React.createElement(
          'p',
          { style: { color: 'var(--dsw-text-secondary, #6c757d)', margin: '0 0 16px', fontSize: 13, lineHeight: 1.5 } },
          '这些开关与 /coding-rules 命令等价，保存后立即生效。规则正文（编辑方式）见下方路径。',
        ),
        React.createElement(
          Fieldset,
          { title: '主要开关' },
          React.createElement(Row, { checked: config.enabled, label: '主开关：启用插件', onChange: () => toggleConfig('enabled') }),
          React.createElement(Row, { checked: config.injectSection, label: '常驻段落：写进 system prompt', onChange: () => toggleConfig('injectSection') }),
          React.createElement(Row, { checked: config.registerSkill, label: '注册 Skill：可用 /skill coding-discipline', onChange: () => toggleConfig('registerSkill') }),
          React.createElement(Row, { checked: config.watch, label: '文件监听：保存规则文件后自动生效', onChange: () => toggleConfig('watch') }),
        ),
        React.createElement(
          Fieldset,
          { title: '规则模块' },
          state.modules.length === 0
            ? React.createElement('p', { style: { color: 'var(--dsw-text-secondary, #6c757d)' } }, 'modules/ 下没有 Markdown 模块。')
            : state.modules.map((module) =>
                React.createElement(
                  'div',
                  {
                    key: module.name,
                    style: {
                      border: '1px solid var(--dsw-border, #dee2e6)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      margin: '0 0 8px',
                    },
                  },
                  React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, module.name),
                  React.createElement('div', { style: { display: 'flex', gap: 20 } },
                    React.createElement(Row, {
                      checked: module.enabled,
                      label: '启用',
                      onChange: () => toggleModule(module.name, 'enabled'),
                    }),
                    React.createElement(Row, {
                      checked: module.inSection,
                      label: '常驻段落',
                      onChange: () => toggleModule(module.name, 'inSection'),
                    }),
                  ),
                  React.createElement(
                    'div',
                    { style: { color: 'var(--dsw-text-secondary, #6c757d)', fontSize: 12, marginTop: 4 } },
                    `${module.file} · ${module.bytes} 字节${module.error ? ` · ${module.error}` : ''}`,
                  ),
                ),
              ),
        ),
        state.dirs
          ? React.createElement(
              Fieldset,
              { title: '位置' },
              React.createElement(
                'div',
                { style: { fontSize: 13, lineHeight: 1.8, color: 'var(--dsw-text-secondary, #6c757d)' } },
                React.createElement('div', null, '开关: ', React.createElement('code', null, state.dirs.config)),
                React.createElement('div', null, '模块: ', React.createElement('code', null, state.dirs.modules)),
              ),
            )
          : null,
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' } },
          React.createElement(ActionButton, { label: '重载规则', onClick: reload, loading: state.loading }),
          React.createElement(ActionButton, { label: '重置为默认', onClick: reset, danger: true, loading: state.loading }),
        ),
      )
    }

    const index_exports = {}
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject,
    })

    /** Hard client-side services (only the slot registry). */
    function inject() {
      return ['slots']
    }

    /**
     * Client half entry: register the sidebar settings page.
     * @param {object} ctx - the client plugin context (`ctx.slots` required).
     */
    function apply(ctx) {
      if (ctx.slots === undefined) return
      try {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'coding-discipline',
              order: 50,
              label: () => '编码纪律',
            },
            SettingsPage,
          ),
        )
      } catch (error) {
        console.error('coding-discipline: 设置页注册失败', error)
      }
    }

    module.exports = __toCommonJS(index_exports)
    return module.exports
  },
})