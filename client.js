window.__ModuleLoader__.load({
  id: 'dsh-turn-fold',
  factory(require) {
    const React = require('react');
    const { useSyncExternalStore, useState, useEffect, useMemo, useCallback, useRef } = React;
    const h = React.createElement;

    const NS = 'turn-fold';
    const STRINGS = {
      zh: {
        process: '思考过程', reply: '回复',
        expandAll: '展开全部', collapseAll: '收起全部',
        thinking: '思考', expandReply: '展开回复', collapseReply: '收起回复',
        expandProcess: '展开思考过程', collapseProcess: '收起思考过程',
        empty: '这一轮没有可显示的过程',
        'kind.commands': '运行命令', 'kind.read': '读取文件', 'kind.readImage': '读取图片', 'kind.search': '搜索',
        'kind.write': '写入文件', 'kind.edit': '编辑文件', 'kind.code': '运行代码', 'kind.webSearch': '搜索网页',
        'kind.webFetch': '访问网页', 'kind.subagents': '子智能体', 'kind.plan': '更新计划', 'kind.questions': '提问',
        'kind.tools': '工具调用',
        'other.command': '命令', 'other.context': '上下文变更', 'other.workflow-run': '工作流',
        'other.model-retry': '模型重试', 'other.question-reply': '已回答问题', 'other.unknown': '其他',
      },
      en: {
        process: 'Process', reply: 'Reply',
        expandAll: 'Expand all', collapseAll: 'Collapse all',
        thinking: 'Thinking', expandReply: 'Expand reply', collapseReply: 'Collapse reply',
        expandProcess: 'Expand process', collapseProcess: 'Collapse process',
        empty: 'Nothing to show for this turn',
        'kind.commands': 'Ran command', 'kind.read': 'Read file', 'kind.readImage': 'Read image', 'kind.search': 'Search',
        'kind.write': 'Wrote file', 'kind.edit': 'Edited file', 'kind.code': 'Ran code', 'kind.webSearch': 'Web search',
        'kind.webFetch': 'Fetched page', 'kind.subagents': 'Subagent', 'kind.plan': 'Updated plan', 'kind.questions': 'Question',
        'kind.tools': 'Tool call',
        'other.command': 'Command', 'other.context': 'Context change', 'other.workflow-run': 'Workflow',
        'other.model-retry': 'Model retry', 'other.question-reply': 'Answered question', 'other.unknown': 'Other',
      },
    };

    // ---------------------------------------------------------------- data helpers

    /** Same tool categories the shipped Chat grouping uses. */
    function activity(name) {
      if (name === 'read') return 'read';
      if (name === 'read_image') return 'readImage';
      if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search';
      if (name === 'write') return 'write';
      if (name === 'edit' || name === 'apply_patch') return 'edit';
      if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands';
      if (name === 'run_code') return 'code';
      if (name === 'web_search') return 'webSearch';
      if (name === 'web_fetch') return 'webFetch';
      if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents';
      if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan';
      if (name === 'ask_user_question' || name === 'request_user_input') return 'questions';
      return 'tools';
    }

    const ARG_KEYS = ['description', 'title', 'objective', 'task', 'command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'queries', 'url', 'prompt', 'message', 'name', 'action', 'method', 'provider', 'questions'];

    function argsOf(root) {
      const raw = root.call?.argsRaw ?? root.argsRaw;
      if (typeof raw === 'string' && raw !== '') {
        try {
          const value = JSON.parse(raw);
          if (value !== null && typeof value === 'object') return value;
        } catch (_) { /* fall through to the lazy view */ }
      }
      const view = root.args;
      const out = {};
      if (view && typeof view.value === 'function') {
        for (const key of ARG_KEYS) {
          try { if (typeof view.has !== 'function' || view.has(key)) { const v = view.value(key); if (v !== undefined) out[key] = v; } } catch (_) { /* partial */ }
        }
      }
      return out;
    }

    const oneLine = (value) => String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
    const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? String(p);

    function toolDetail(name, kind, args) {
      const str = (k) => (typeof args[k] === 'string' && args[k].trim() !== '' ? args[k] : undefined);
      if (kind === 'tools') {
        const sub = str('action') ?? str('method') ?? (str('provider') && str('method') ? `${args.provider}.${args.method}` : undefined);
        return sub ? `${name} · ${oneLine(sub)}` : name;
      }
      if (kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'readImage') {
        const p = str('file_path') ?? str('path');
        if (p) return baseName(p);
      }
      if (kind === 'questions' && Array.isArray(args.questions)) {
        const q = args.questions.find((item) => item && typeof item.question === 'string');
        if (q) return oneLine(q.question);
      }
      for (const key of ['description', 'title', 'objective', 'task', 'pattern', 'query', 'url', 'command', 'cmd', 'prompt', 'message', 'file_path', 'path']) {
        const v = str(key);
        if (v) return oneLine(v);
      }
      if (Array.isArray(args.queries)) return oneLine(args.queries.join(', '));
      return name;
    }

    function cleanReasoning(text) {
      if (typeof text !== 'string') return '';
      if (!text.startsWith('<signature>')) return text;
      const end = text.indexOf('</signature>');
      return end === -1 ? '' : text.slice(end + 12).replace(/^\s+/, '');
    }

    function hasReply(blocks) {
      return Array.isArray(blocks) && blocks.some((b) => {
        if (b.kind === 'reasoning' || b.kind === 'tool-call') return false;
        if (b.kind === 'text') return typeof b.text === 'string' && b.text.trim() !== '';
        return true;
      });
    }

    /** Rows the shipped Chat shows inside a Turn's process (everything except inputs and Turn chrome). */
    const PROCESS_KINDS = new Set(['assistant-step', 'tool-call', 'context', 'command', 'workflow-run', 'model-retry', 'system-prompt', 'question-reply', 'unknown']);

    function visibleNode(n) {
      if (n.visibility !== undefined && n.visibility !== 'visible') return false;
      if (n.kind === 'system-prompt') return false;
      if (n.kind === 'context') return Array.isArray(n.data?.content) && n.data.content.some((b) => b.type === 'tool-addition' || b.type === 'tool-removal');
      if (n.kind === 'command' && n.data?.name === 'permission') return false;
      return true;
    }

    /** Ordered window entries: reasoning, intermediate replies, tools and other process rows. */
    function buildEntries(nodes, answerKey) {
      const out = [];
      for (const n of nodes) {
        if (!n || !PROCESS_KINDS.has(n.kind) || !visibleNode(n)) continue;
        if (n.kind === 'assistant-step') {
          const blocks = Array.isArray(n.data?.blocks) ? n.data.blocks : [];
          blocks.forEach((b, i) => {
            if (b.kind === 'reasoning') {
              const text = cleanReasoning(b.text);
              if (text.trim() !== '') out.push({ type: 'reasoning', id: `${n.key}:r${i}`, text });
            } else if (b.kind === 'text' && n.key !== answerKey && typeof b.text === 'string' && b.text.trim() !== '') {
              out.push({ type: 'text', id: `${n.key}:t${i}`, text: b.text });
            }
          });
        } else if (n.kind === 'tool-call') {
          const root = n.data?.root;
          if (!root) continue;
          const name = String(root.name || root.call?.name || 'tool');
          const kind = activity(name);
          out.push({
            type: 'tool', id: n.key, kind, name,
            detail: toolDetail(name, kind, argsOf(root)),
            callId: root.callId,
            error: root.kind === 'tool-result' && root.isError === true,
            running: root.kind !== 'tool-result',
          });
        } else {
          const label = n.kind === 'command' && n.data?.name ? '/' + n.data.name : null;
          out.push({ type: 'other', id: n.key, kind: n.kind, label });
        }
      }
      return out;
    }

    /** Text entries stay on their own; every run of reasoning/tools between them becomes one step group. */
    function segment(entries) {
      const segments = [];
      let steps = null;
      for (const e of entries) {
        if (e.type === 'text') {
          steps = null;
          segments.push(e);
        } else {
          if (steps === null) {
            steps = { type: 'steps', id: 'g:' + e.id, items: [] };
            segments.push(steps);
          }
          steps.items.push(e);
        }
      }
      return segments;
    }

    function formatDuration(ms, t) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor(total / 60) % 60;
      const seconds = total % 60;
      let out = '';
      if (hours > 0) out += hours + t('duration.hourUnit');
      if (total >= 60) out += minutes + t('duration.minuteUnit');
      return out + seconds + t('duration.secondUnit');
    }

    const sameArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // ---------------------------------------------------------------- fold state

    /** Per Session/Turn: process window open, reply shown, window details expanded. */
    const DEFAULT_VIEW = Object.freeze({ process: false, reply: true, detail: false });
    const views = new Map();
    const viewListeners = new Set();
    const viewKey = (sid, turn) => `${sid}\u0000${turn}`;
    const getView = (key) => views.get(key) ?? DEFAULT_VIEW;
    function notifyViews() {
      for (const fn of [...viewListeners]) fn();
    }
    function setView(key, patch) {
      views.set(key, { ...getView(key), ...patch });
      notifyViews();
    }
    const subscribeViews = (fn) => { viewListeners.add(fn); return () => viewListeners.delete(fn); };
    function useView(key) {
      return useSyncExternalStore(subscribeViews, () => getView(key));
    }

    // ---------------------------------------------------------------- icons

    const svg = (children, size = 14) => h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'aria-hidden': true }, children);
    const Chevron = ({ open }) => svg(h('path', { d: open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }), 12);
    const ICONS = {
      commands: () => svg([h('rect', { key: 1, x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 2, stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { key: 2, d: 'M4.5 6.5 6.5 8l-2 1.5M8 10h3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' })]),
      file: () => svg([h('path', { key: 1, d: 'M4 1.75h5l3 3v9.5H4z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h('path', { key: 2, d: 'M9 1.75v3h3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' })]),
      search: () => svg([h('circle', { key: 1, cx: 7, cy: 7, r: 4.25, stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { key: 2, d: 'm10.25 10.25 3.5 3.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })]),
      web: () => svg([h('circle', { key: 1, cx: 8, cy: 8, r: 6.25, stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { key: 2, d: 'M1.75 8h12.5M8 1.75c2 2 2 10.5 0 12.5M8 1.75c-2 2-2 10.5 0 12.5', stroke: 'currentColor', strokeWidth: 1.2 })]),
      think: () => svg([h('path', { key: 1, d: 'M8 2.25a4 4 0 0 0-2.5 7.1V11h5V9.35A4 4 0 0 0 8 2.25Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h('path', { key: 2, d: 'M6 13.25h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })]),
      tool: () => svg(h('path', { d: 'M8 1.75 9.4 6.6l4.85 1.4-4.85 1.4L8 14.25 6.6 9.4 1.75 8 6.6 6.6Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' })),
    };
    function iconFor(kind) {
      if (kind === 'commands' || kind === 'code') return ICONS.commands;
      if (kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'readImage') return ICONS.file;
      if (kind === 'search') return ICONS.search;
      if (kind === 'webSearch' || kind === 'webFetch') return ICONS.web;
      return ICONS.tool;
    }

    // ---------------------------------------------------------------- window

    function Markdown({ text, renderFactorySlot, className }) {
      const body = typeof renderFactorySlot === 'function'
        ? renderFactorySlot('conversation.chat.reasoning.content', { text, running: false }, { fallback: h('div', { className: 'tf-pre' }, text) })
        : h('div', { className: 'tf-pre' }, text);
      return h('div', { className }, body);
    }

    function StepItem({ item, tr, inspectCall, renderFactorySlot }) {
      if (item.type === 'reasoning') {
        return h('div', { className: 'tf-reason' },
          h('div', { className: 'tf-line tf-muted' }, h('span', { className: 'tf-icon' }, ICONS.think()), h('span', null, tr('thinking'))),
          h(Markdown, { text: item.text, renderFactorySlot, className: 'tf-reason-body' }));
      }
      if (item.type === 'tool') {
        const clickable = typeof inspectCall === 'function' && item.callId !== undefined;
        const Icon = iconFor(item.kind);
        return h(clickable ? 'button' : 'div', {
          type: clickable ? 'button' : undefined,
          className: 'tf-line tf-tool' + (clickable ? ' tf-clickable' : '') + (item.error ? ' tf-error' : ''),
          title: item.detail,
          onClick: clickable ? () => inspectCall(item.callId) : undefined,
        },
        h('span', { className: 'tf-icon' }, Icon()),
        h('span', { className: 'tf-kind' }, tr('kind.' + item.kind)),
        h('span', { className: 'tf-dot', 'aria-hidden': true }),
        h('span', { className: 'tf-detail' }, item.detail));
      }
      return h('div', { className: 'tf-line tf-muted' },
        h('span', { className: 'tf-icon' }, ICONS.tool()),
        h('span', null, item.label ?? tr('other.' + item.kind) ?? item.kind));
    }

    function stepsSummary(items, tr) {
      const counts = new Map();
      let thinking = 0;
      for (const it of items) {
        if (it.type === 'reasoning') thinking++;
        else {
          const label = it.type === 'tool' ? tr('kind.' + it.kind) : (it.label ?? tr('other.' + it.kind));
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
      }
      const parts = [];
      if (thinking > 0) parts.push(tr('thinking') + (thinking > 1 ? ' ' + thinking : ''));
      for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) parts.push(n > 1 ? `${label} ${n}` : label);
      return parts.join(' · ');
    }

    function StepGroup({ group, open, onToggle, tr, inspectCall, renderFactorySlot }) {
      return h('div', { className: 'tf-steps' },
        h('button', { type: 'button', className: 'tf-line tf-summary', 'aria-expanded': open, onClick: onToggle },
          h('span', { className: 'tf-icon' }, h(Chevron, { open })),
          h('span', { className: 'tf-detail' }, stepsSummary(group.items, tr))),
        open ? h('div', { className: 'tf-steps-body' }, group.items.map((item) => h(StepItem, { key: item.id, item, tr, inspectCall, renderFactorySlot }))) : null);
    }

    function ProcessWindow({ segments, detail, setDetail, tr, inspectCall, renderFactorySlot }) {
      // Per-group overrides of the window-wide choice; cleared whenever the window-wide choice changes.
      const [overrides, setOverrides] = useState(() => new Map());
      useEffect(() => { setOverrides(new Map()); }, [detail]);
      const groups = segments.filter((s) => s.type === 'steps').length;
      return h('div', { className: 'tf-window' },
        groups > 0 ? h('div', { className: 'tf-toolbar' },
          h('button', { type: 'button', className: 'tf-pill', onClick: () => setDetail(!detail) },
            h(Chevron, { open: detail }), h('span', null, tr(detail ? 'collapseAll' : 'expandAll')))) : null,
        segments.length === 0
          ? h('div', { className: 'tf-line tf-muted' }, tr('empty'))
          : segments.map((s) => {
            if (s.type === 'text') return h(Markdown, { key: s.id, text: s.text, renderFactorySlot, className: 'tf-text' });
            const open = overrides.has(s.id) ? overrides.get(s.id) : detail;
            return h(StepGroup, {
              key: s.id, group: s, open, tr, inspectCall, renderFactorySlot,
              onToggle: () => setOverrides((prev) => new Map(prev).set(s.id, !open)),
            });
          }));
    }

    // ---------------------------------------------------------------- hiding the shipped rows

    /** Session → Turn → keys whose shipped rows this plugin replaces. */
    const managed = new Map();
    let styleEl = null;
    let scheduled = false;
    const q = (value) => '"' + CSS.escape(String(value)) + '"';

    function renderCss() {
      scheduled = false;
      if (styleEl === null) return;
      let css = '';
      for (const [sid, turns] of managed) {
        const sel = [];
        for (const [turn, info] of turns) {
          for (const key of info.processKeys) sel.push(`[data-chat-node-key=${q(key)}]`);
          sel.push(`[data-chat-group-key][data-chat-turn=${q(turn)}]`);
          if (info.answerKey !== null) {
            sel.push(`[data-chat-node-key=${q(info.answerKey)}] [data-variant="think"]`);
            if (!getView(viewKey(sid, turn)).reply) sel.push(`[data-chat-node-key=${q(info.answerKey)}]`);
          }
        }
        if (sel.length > 0) css += `[data-chat-flow]:has([data-tf-sid=${q(sid)}]) :is(${sel.join(',')}){display:none!important}\n`;
      }
      styleEl.textContent = css;
    }
    function scheduleCss() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(renderCss);
    }
    function manage(sid, turn, info) {
      let turns = managed.get(sid);
      if (turns === undefined) { turns = new Map(); managed.set(sid, turns); }
      turns.set(turn, info);
      notifyViews();
      return () => {
        const current = managed.get(sid);
        if (current?.get(turn) === info) {
          current.delete(turn);
          if (current.size === 0) managed.delete(sid);
          notifyViews();
        }
      };
    }

    // ---------------------------------------------------------------- Turn header

    function makeHeader(tr) {
      return function TurnFoldHeader({ node, useChat, sessionId, inspectCall, renderFactorySlot, t }) {
        const turn = node.location?.kind === 'turn' || node.location?.kind === 'step' ? node.location.turn : undefined;
        const turnNo = node.data?.turn ?? turn?.turn;
        const closed = turn?.status === 'closed';
        const nodes = useChat((s) => (turnNo === undefined ? [] : s.locations.getTurn(turnNo).map((k) => s.nodes.get(k))), sameArray);
        const key = viewKey(sessionId, turnNo);
        const view = useView(key);

        const answerKey = useMemo(() => {
          if (node.data?.answerAnchorSeq === null || node.data?.answerStep === null || node.data?.answerStep === undefined) return null;
          const answer = nodes.filter((n) => n?.kind === 'assistant-step' && n.data?.step === node.data.answerStep && hasReply(n.data.blocks)).pop();
          return answer?.key ?? null;
        }, [nodes, node.data]);
        const processKeys = useMemo(() => nodes.filter((n) => n && PROCESS_KINDS.has(n.kind) && n.key !== answerKey).map((n) => n.key), [nodes, answerKey]);
        const segments = useMemo(() => segment(buildEntries(nodes, answerKey)), [nodes, answerKey]);
        const keysSig = processKeys.join('\u0001');

        useEffect(() => {
          if (!closed || turnNo === undefined) return undefined;
          return manage(sessionId, String(turnNo), { processKeys, answerKey });
          // keysSig stands for processKeys' contents.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [closed, sessionId, turnNo, keysSig, answerKey]);

        const setDetail = useCallback((detail) => setView(key, { detail }), [key]);
        if (!closed) return null;

        const reason = turn.end?.data?.reason?.kind;
        const stopped = reason === 'aborted' || reason === 'interrupted';
        const failed = reason === 'error';
        const elapsed = turn.start && turn.end ? Math.max(1000, turn.end.time - turn.start.time) : undefined;
        const label = stopped ? t('message.stopped')
          : failed ? t('message.turnProcess.failed')
            : elapsed === undefined ? t('message.turnProcess.worked')
              : t('message.turnProcess.took') + formatDuration(elapsed, t);
        const hasProcess = segments.length > 0;
        const toggleProcess = () => setView(key, { process: !view.process });

        return h('div', { className: 'tf-root' },
          h('div', { className: 'tf-head', 'data-tf-header': '', 'data-tf-sid': sessionId },
            h('button', {
              type: 'button', className: 'tf-title', disabled: !hasProcess,
              'aria-expanded': hasProcess ? view.process : undefined,
              title: hasProcess ? tr(view.process ? 'collapseProcess' : 'expandProcess') : undefined,
              onClick: toggleProcess,
            }, h('span', { className: 'tf-label' }, label), hasProcess ? h(Chevron, { open: view.process }) : null),
            h('span', { className: 'tf-spacer' }),
            hasProcess ? h('button', { type: 'button', className: 'tf-pill', 'aria-pressed': view.process, onClick: toggleProcess },
              h('span', null, tr('process')), h(Chevron, { open: view.process })) : null,
            answerKey !== null ? h('button', { type: 'button', className: 'tf-pill', 'aria-pressed': view.reply, onClick: () => setView(key, { reply: !view.reply }) },
              h('span', null, tr('reply')), h(Chevron, { open: view.reply })) : null),
          view.process && hasProcess ? h(ProcessWindow, { segments, detail: view.detail, setDetail, tr, inspectCall, renderFactorySlot }) : null);
      };
    }

    // ---------------------------------------------------------------- reply action button

    function makeReplyAction(tr) {
      return function TurnFoldReplyAction({ messageId, useChat, sessionId }) {
        const turnNo = useChat((s) => {
          for (const [k, entry] of s.timeline.turns) {
            const tail = entry?.data?.get?.('turn-tail');
            if (tail?.closing?.finalNode?.messageId === messageId) return entry.turn ?? k;
          }
          return undefined;
        });
        const key = viewKey(sessionId, turnNo);
        const view = useView(key);
        const isManaged = useSyncExternalStore(subscribeViews, () => turnNo !== undefined && managed.get(sessionId)?.get(String(turnNo))?.answerKey != null);
        if (turnNo === undefined || !isManaged) return null;
        const text = tr(view.reply ? 'collapseReply' : 'expandReply');
        return h('button', {
          type: 'button', className: 'tf-action', 'aria-label': text, title: text, 'aria-pressed': !view.reply,
          onClick: () => setView(key, { reply: !view.reply }),
        }, svg(view.reply
          ? h('path', { d: 'M3.5 6.5 8 2.5l4.5 4M3.5 13.5 8 9.5l4.5 4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })
          : h('path', { d: 'M3.5 2.5 8 6.5l4.5-4M3.5 9.5 8 13.5l4.5-4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }), 15));
      };
    }

    // ---------------------------------------------------------------- styles

    const CSS_TEXT = `
[data-chat-flow-kind="turn-process"]:has([data-tf-header])[hidden]{display:block!important;content-visibility:visible!important}
.tf-root{display:flex;flex-direction:column;min-width:0}
.tf-head{box-sizing:border-box;display:flex;align-items:center;gap:6px;min-width:0;height:calc(33px + var(--dsh-content-font-delta,0px));padding:0 0 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size,14px)}
.tf-title{display:inline-flex;align-items:center;gap:4px;min-width:0;padding:0;border:none;background:0 0;color:inherit;font:inherit;cursor:pointer;transition:color .1s}
.tf-title:disabled{cursor:default}
.tf-label{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.tf-spacer{flex:auto}
.tf-pill{display:inline-flex;align-items:center;gap:4px;flex:none;height:24px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer;transition:color .1s,background-color .1s}
.tf-pill[aria-pressed=true]{color:var(--dsw-alias-label-secondary)}
@media (hover:hover){.tf-title:not(:disabled):hover,.tf-pill:hover{color:var(--dsw-alias-label-secondary)}.tf-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.tf-title:focus-visible,.tf-pill:focus-visible,.tf-line:focus-visible,.tf-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.tf-window{position:relative;margin:8px 0 4px;max-height:min(440px,60vh);overflow:auto;overscroll-behavior:contain;padding:0 12px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);display:flex;flex-direction:column;gap:2px}
.tf-toolbar{position:sticky;top:0;z-index:1;display:flex;justify-content:flex-end;padding:8px 0 4px;background:var(--dsw-alias-bg-base)}
.tf-line{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:2px 0;border:none;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));text-align:left}
.tf-muted{color:var(--dsw-alias-label-tertiary)}
.tf-summary,.tf-clickable{cursor:pointer;border-radius:var(--dsw-radius-sm)}
.tf-summary{color:var(--dsw-alias-label-tertiary)}
@media (hover:hover){.tf-summary:hover,.tf-clickable:hover{color:var(--dsw-alias-label-primary)}}
.tf-icon{display:inline-flex;flex:none;width:16px;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.tf-kind{flex:none;white-space:nowrap}
.tf-dot{flex:none;width:2px;height:2px;border-radius:1px;background:var(--dsw-alias-label-tertiary);margin:0 4px}
.tf-detail{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tf-error,.tf-error .tf-icon{color:var(--dsw-alias-state-error-primary)}
.tf-steps-body{display:flex;flex-direction:column;gap:2px;padding-left:22px}
.tf-reason-body{padding:0 0 4px 22px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}
.tf-text{padding:6px 0;color:var(--dsw-alias-label-primary)}
.tf-pre{white-space:pre-wrap;overflow-wrap:anywhere}
.tf-action{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
@media (hover:hover){.tf-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
`;

    // ---------------------------------------------------------------- plugin

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [lang, dict] of Object.entries(STRINGS)) {
          ctx.effect(() => ctx.locale.register(NS, lang, dict), 'turn-fold: locale ' + lang);
        }
        const bound = ctx.locale.bind(NS);
        const tr = (k) => {
          let v;
          try { v = bound(k); } catch (_) { v = undefined; }
          if (v === undefined || v === '' || v === k) v = STRINGS.en[k] ?? k;
          return v;
        };

        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-turn-fold';
          style.textContent = CSS_TEXT;
          const hide = document.createElement('style');
          hide.dataset.plugin = 'dsh-turn-fold';
          hide.dataset.role = 'hidden-rows';
          document.head.append(style, hide);
          styleEl = hide;
          const stop = subscribeViews(scheduleCss);
          renderCss();
          return () => {
            stop();
            styleEl = null;
            style.remove();
            hide.remove();
          };
        }, 'turn-fold: styles');

        const Header = makeHeader(tr);
        ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'turn-process',
          locale: 'chat',
        }, Header));

        const ReplyAction = makeReplyAction(tr);
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'turn-fold-reply',
          order: 5,
          label: () => tr('collapseReply'),
        }, ReplyAction));
      },
    };
  },
});
