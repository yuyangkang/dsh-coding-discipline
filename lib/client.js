/**
 * Client half of dsh-coding-discipline — a sidebar settings page.
 *
 * This file is a hand-written client bundle in the shape the client module
 * graph consumes: `window.__ModuleLoader__.load({ id, factory })`. The factory
 * is lazy CJS: executing the bundle only registers the factory; the body runs
 * at materialization on first import. Nothing external is `require`d except
 * the browser platform seed modules (`react`, `react/jsx-runtime`) — exactly
 * the set the shell's seed table provides. There is no global `React` and no
 * `host` RPC in this DSH version; the page therefore talks to the host over
 * the webServer HTTP bridge (`/api/coding-discipline`) just like the shipped
 * profile bundles do.
 *
 * The page is a `settings.section` entry (the sanctioned "whole page in the
 * sidebar settings"): `ctx.slots.inject("settings.section", ...)` pairs with
 * `ctx.slots.register(...)`.
 *
 * @module dsh-coding-discipline/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-coding-discipline',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** Platform seed modules — the only external requires this bundle may make. */
    const React = require('react')
    const { jsx } = require('react/jsx-runtime')

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

    const BRIDGE_PREFIX = '/api/coding-discipline'

    /** Read a bridge `{ ok, ... }` response or throw on transport / `ok:false`. */
    async function bridgeCall(path, body) {
      const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`设置桥接返回 ${response.status}`)
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error ?? '设置桥接调用失败')
      return payload
    }

    function Row(props) {
      return jsx(
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
        jsx('input', {
          type: 'checkbox',
          checked: props.checked,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        jsx('span', null, props.label),
      )
    }

    function Fieldset(props) {
      return jsx(
        'fieldset',
        { style: { border: '1px solid var(--dsw-border, #dee2e6)', borderRadius: '6px', padding: '12px', margin: '0 0 16px' } },
        jsx('legend', { style: { padding: '0 6px', fontWeight: 600 } }, props.title),
        props.children,
      )
    }

    function ActionButton(props) {
      return jsx(
        'button',
        {
          onClick: props.onClick,
          disabled: props.loading,
          style: {
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-border, #dee2e6)',
            background: props.danger ? 'transparent' : 'var(--dsw-alias-interactive-bg, #f1f3f5)',
            color: props.danger ? 'var(--dsw-danger, #dc3545)' : 'inherit',
            cursor: props.loading ? 'wait' : 'pointer',
            fontWeight: 500,
          },
        },
        props.loading ? '…' : props.label,
      )
    }

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
            bridgeCall('getConfig'),
            bridgeCall('listModules'),
            bridgeCall('paths'),
          ])
          setState({ loading: false, error: null, config: config.config, modules: modules.modules ?? [], dirs })
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
          await bridgeCall('setConfig', patch)
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
          await bridgeCall('reload')
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
          await bridgeCall('reset')
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
        return jsx('div', { style: { padding: 24, color: 'var(--dsw-text-secondary, #6c757d)' } }, '加载中…')
      }
      if (state.error) {
        return jsx(
          'div',
          { style: { padding: 16, color: 'var(--dsw-danger, #dc3545)' } },
          jsx('p', null, `加载失败：${state.error}`),
          jsx(ActionButton, { label: '重试', onClick: refresh }),
        )
      }
      const config = state.config
      if (!config) {
        return jsx('div', { style: { padding: 24 } }, '配置不可用。')
      }

      return jsx(
        'div',
        { style: { padding: '16px 20px', maxWidth: 640, overflowY: 'auto' } },
        jsx('h3', { style: { margin: '0 0 12px' } }, '编码纪律'),
        jsx(
          'p',
          { style: { color: 'var(--dsw-text-secondary, #6c757d)', margin: '0 0 16px', fontSize: 13, lineHeight: 1.5 } },
          '这些开关与 /coding-rules 命令等价，保存后立即生效。规则正文（编辑方式）见下方路径。',
        ),
        jsx(
          Fieldset,
          { title: '主要开关' },
          jsx(Row, { checked: config.enabled, label: '主开关：启用插件', onChange: () => toggleConfig('enabled') }),
          jsx(Row, { checked: config.injectSection, label: '常驻段落：写进 system prompt', onChange: () => toggleConfig('injectSection') }),
          jsx(Row, { checked: config.registerSkill, label: '注册 Skill：可用 /skill coding-discipline', onChange: () => toggleConfig('registerSkill') }),
          jsx(Row, { checked: config.watch, label: '文件监听：保存规则文件后自动生效', onChange: () => toggleConfig('watch') }),
        ),
        jsx(
          Fieldset,
          { title: '规则模块' },
          state.modules.length === 0
            ? jsx('p', { style: { color: 'var(--dsw-text-secondary, #6c757d)' } }, 'modules/ 下没有 Markdown 模块。')
            : state.modules.map((module) =>
                jsx(
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
                  jsx('div', { style: { fontWeight: 600, marginBottom: 4 } }, module.name),
                  jsx('div', { style: { display: 'flex', gap: 20 } },
                    jsx(Row, {
                      checked: module.enabled,
                      label: '启用',
                      onChange: () => toggleModule(module.name, 'enabled'),
                    }),
                    jsx(Row, {
                      checked: module.inSection,
                      label: '常驻段落',
                      onChange: () => toggleModule(module.name, 'inSection'),
                    }),
                  ),
                  jsx(
                    'div',
                    { style: { color: 'var(--dsw-text-secondary, #6c757d)', fontSize: 12, marginTop: 4 } },
                    `${module.file} · ${module.bytes} 字节${module.error ? ` · ${module.error}` : ''}`,
                  ),
                ),
              ),
        ),
        state.dirs
          ? jsx(
              Fieldset,
              { title: '位置' },
              jsx(
                'div',
                { style: { fontSize: 13, lineHeight: 1.8, color: 'var(--dsw-text-secondary, #6c757d)' } },
                jsx('div', null, '开关: ', jsx('code', null, state.dirs.config)),
                jsx('div', null, '模块: ', jsx('code', null, state.dirs.modules)),
              ),
            )
          : null,
        jsx(
          'div',
          { style: { display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' } },
          jsx(ActionButton, { label: '重载规则', onClick: reload, loading: state.loading }),
          jsx(ActionButton, { label: '重置为默认', onClick: reset, danger: true, loading: state.loading }),
        ),
      )
    }

    const index_exports = {}
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject,
    })

    /** Hard client-side services (the slot registry). Kept as an array, matching
     * how the shipped client bundles declare their `inject` exports. */
    var inject = ['slots']

    /**
     * Client half entry: register the sidebar settings page.
     * Read the slot registry through `ctx.get` (defensive) even though it is
     * declared in `inject`, so a host running without a client never throws.
     * @param {object} ctx - the client plugin context.
     */
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      try {
        slots.inject('settings.section', () =>
          slots.register(
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