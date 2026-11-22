window.__ModuleLoader__.load({
  id: "dsh-live-compact-x",
  factory(require) {
    /** 全走宿主原生接口的设置界面。 */
    const React = require("react");
    const { SettingsFormModel, settingsNumberField, SettingsForm, SettingsValueField } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;

    const NS = "compaction-spine";
    const GROUPS = [
      { id: "basic", keys: ["minTokens", "pointerTokens", "keepRounds"] },
      {
        id: "advanced",
        keys: [
          "chunkMin", "chunkMax", "keepRoundTokens", "bigGate", "cooldownMs",
          "thresholdRatio", "headroomTokens", "retainTokens", "compactionRetries",
        ],
      },
    ];
    const KEYS = GROUPS.flatMap((group) => group.keys);
    const PRESET_FIELD = {
      field: "takeoverPresets",
      format: (value) => Array.isArray(value) ? JSON.stringify(value) : String(value),
      parse: (text) => {
        const raw = String(text ?? "").trim();
        if (raw === "true" || raw === "false") return { kind: "set", value: raw === "true" };
        if (raw.startsWith("[")) {
          try {
            const value = JSON.parse(raw);
            if (Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0)) {
              return { kind: "set", value };
            }
          } catch {}
        }
        return { kind: "set", value: raw };
      },
    };
    const LABELS = {
      minTokens: ["起切 token 数", "默认 20000"],
      pointerTokens: ["大结果只留指针", "0 = 跟随一刀上限"],
      keepRounds: ["保留原文轮数", "至少 1 轮，默认 3"],
      chunkMin: ["一刀最小 token", "默认 1000"],
      chunkMax: ["一刀最大 token", "默认 32000"],
      keepRoundTokens: ["收尾停止线", "默认 32000"],
      bigGate: ["绝对停切线", "默认 650000"],
      cooldownMs: ["官方压缩后冷却 ms", "0 = 只跳过一次"],
      thresholdRatio: ["官方大压缩触发比例", "默认 0.8"],
      headroomTokens: ["官方大压缩预留", "默认 65536"],
      retainTokens: ["官方大压缩保留", "默认 8192"],
      compactionRetries: ["官方大压缩重试", "默认 0"],
      minNetGain: ["净收益门槛", "切掉−卡片 不到这个数就不切"],
      burstCuts: ["一次连切", "收尾时最多连切几刀"],
      deepCutAbove: ["中刀启用线", "上下文超过它才试中刀；0 = 关闭"],
      mergeMaxSpan: ["中刀窗口", "chunkMax × 它；默认 4 = 128k"],
      mergeBreakEven: ["中刀回本倍数", "一次性重算 / 净赚 超过它就不切"],
      mergeCooldownMs: ["中刀冷却 ms", "两刀中刀之间的最小间隔"],
      officialAbove: ["大刀启用线", "超过它且没有可切段时请官方压缩；0 = 关"],
      officialCooldownMs: ["大刀冷却 ms", "两次大压缩的最小间隔"],
      paybackTurns: ["小刀回本轮数", "重算超过 净赚×它 就不切；0 = 关"],
      spanBandRatio: ["动态刀长比例", "单刀上限 = 上下文 × 它；0 = 关"],
      keepRounds: ["保留原文轮数", "最近几轮留原文"],
      keepRoundTokens: ["收尾停止线", "降到这个 token 就不切"],
      bigGate: ["绝对停切线", "超过即不再小切"],
      chunkMax: ["一刀上限", "小刀一次最多切多少"],
      chunkMin: ["一刀下限", "不够就不切"],
    };

    const zh = {
      takeoverPresets: "接管官方预设",
      takeoverHint: "填 true/false，或填 JSON 数组（例如 [\"standard\"]）限制接管的预设。保存后仅影响新加载的预设；已有会话需重建。",
      takeoverArrayHint: "JSON 数组：只接管列出的 preset ID；也可填 true 或 false。",
      summary: "20000 起切、3 轮留原文、650000 停",
      "tab.spine": "压缩",
      "spine.saved": "累计切掉",
      "spine.savedHint": "被卡片替换掉的 token",
      "spine.count": "切刀数",
      "spine.mine": "我方卡片",
      "spine.official": "官方卡片",
      "spine.average": "平均",
      "spine.biggest": "最大一刀",
      "spine.last": "最近一刀",
      "spine.none": "还没有",
      "spine.tokensShort": "tokens",
      "spine.cutsUnit": "刀",
      "spine.composition": "压缩构成",
      "spine.timeline": "切点时间线",
      "spine.empty": "还没有切开过任何内容。上下文变大后，小刀会先在这里记一笔。",
      "spine.unavailable": "宿主没有提供压缩统计（插件未接管，或宿主版本较旧）。",
      "spine.error": "面板渲染出错：",
      "spine.kindMine": "小刀",
      "spine.kindOfficial": "官方",
      "spine.files": "备份文件",
      "spine.filesShort": "文件",
      "spine.noFiles": "这一刀没有留备份文件。",
      "spine.copy": "复制",
      "spine.copyDir": "复制目录",
      "spine.knobs": "刀把",
      "spine.knobsHint": "改完点保存，立即生效",
      "spine.readOnly": "当前配置只读",
      "spine.dirLabel": "备份目录",
      "spine.colKind": "类型",
      "spine.colTokens": "切掉",
      "spine.colSeq": "事件号",
      "spine.colModel": "模型",
      "spine.colTime": "时间",
      "spine.colFiles": "文件",
      discard: "放弃修改",
      basic: "常用",
      advanced: "高级设置",
      save: "保存",
      saving: "保存中…",
      invalid: "请填有效数字；留空清除覆盖，使用环境变量或默认值。",
      unavailable: "当前配置不可写",
      saveFailed: "保存失败，修改已保留，请检查后重试。",
      overridden: "已覆盖",
      reset: "恢复默认",
      unavailableHost: "宿主没有提供这一项配置",
    };
    const en = {
      takeoverPresets: "Take over official presets",
      takeoverHint: "Enter true/false, or a JSON array such as [\"standard\"] to limit takeover. Applies to newly loaded presets after saving; recreate existing sessions.",
      takeoverArrayHint: "JSON array: only the listed preset IDs are taken over; true and false are also accepted.",
      summary: "cuts at 20000, keeps 3 rounds, stops at 650000",
      "tab.spine": "Compaction",
      "spine.saved": "Cut so far",
      "spine.savedHint": "tokens replaced by cards",
      "spine.count": "Cuts",
      "spine.mine": "Our cards",
      "spine.official": "Official cards",
      "spine.average": "avg",
      "spine.biggest": "Largest cut",
      "spine.last": "Last cut",
      "spine.none": "none yet",
      "spine.tokensShort": "tokens",
      "spine.cutsUnit": "cuts",
      "spine.composition": "Composition",
      "spine.timeline": "Cut timeline",
      "spine.empty": "Nothing has been cut yet. Once the context grows, the first cut appears here.",
      "spine.unavailable": "The host does not serve compaction stats (plugin not active, or an older host).",
      "spine.error": "Panel render failed: ",
      "spine.kindMine": "knife",
      "spine.kindOfficial": "official",
      "spine.files": "Backup files",
      "spine.filesShort": "files",
      "spine.noFiles": "This cut kept no backup file.",
      "spine.copy": "Copy",
      "spine.copyDir": "Copy folder",
      "spine.knobs": "Knobs",
      "spine.knobsHint": "Save to apply immediately",
      "spine.readOnly": "Configuration is read-only",
      "spine.dirLabel": "Backup folder",
      "spine.colKind": "kind",
      "spine.colTokens": "cut",
      "spine.colSeq": "seq",
      "spine.colModel": "model",
      "spine.colTime": "time",
      "spine.colFiles": "files",
      discard: "Discard",
      basic: "Common",
      advanced: "Advanced",
      save: "Save",
      saving: "Saving…",
      invalid: "Enter a valid number; leave blank to use the environment or default.",
      unavailable: "Configuration is not writable",
      saveFailed: "Save failed; your edits have been kept.",
      overridden: "Overridden",
      reset: "Reset to default",
      unavailableHost: "The host does not serve this namespace",
    };

    const SPINE_KEY = "spine.cuts";
    const SPINE_CSS = [
      ".sp-root{box-sizing:border-box;height:100%;overflow-y:auto;padding:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}",
      ".sp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(116px,1fr));gap:8px;margin-bottom:10px}",
      ".sp-kpi{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;min-width:0}",
      ".sp-kpi-label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sp-kpi-value{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:1px}",
      ".sp-kpi-hint{font-size:10.5px;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sp-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-bottom:10px}",
      ".sp-card-title{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:8px}",
      ".sp-card-sub{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".sp-bar{display:flex;gap:2px;height:20px;border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-seg{height:100%;min-width:2px}",
      ".sp-seg:hover{opacity:.72}",
      ".sp-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px}",
      ".sp-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}",
      ".sp-head{display:grid;grid-template-columns:20px 58px 1fr 74px 1fr 66px 46px;gap:8px;padding:0 6px 4px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}",
      ".sp-row{display:grid;grid-template-columns:20px 58px 1fr 74px 1fr 66px 46px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;font-size:12px}",
      ".sp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sp-badge{font-size:10.5px;line-height:17px;padding:0 6px;border-radius:999px;border:1px solid;text-align:center;white-space:nowrap}",
      ".sp-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}",
      ".sp-num{text-align:right;font-variant-numeric:tabular-nums}",
      ".sp-dim{color:var(--dsw-alias-label-secondary)}",
      ".sp-details summary{list-style:none;cursor:pointer}",
      ".sp-details summary::-webkit-details-marker{display:none}",
      ".sp-detail{display:grid;gap:6px;padding:6px 8px 8px;border-top:1px dashed var(--dsw-alias-border-l2)}",
      ".sp-preview{margin:0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-height:104px;overflow:hidden}",
      ".sp-files{margin:0;padding:0;list-style:none;display:grid;gap:3px;max-height:132px;overflow:auto}",
      ".sp-files li{display:flex;align-items:center;gap:8px}",
      ".sp-btn{font:inherit;font-size:11px;padding:2px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}",
      ".sp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sp-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}",
      ".sp-btn:disabled{opacity:.45;cursor:not-allowed}",
      ".sp-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px 14px}",
      ".sp-group{margin-bottom:12px}",
      ".sp-group:last-child{margin-bottom:0}",
      ".sp-group-title{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}",
      ".sp-group-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2)}",
      ".sp-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".sp-field-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".sp-tag{font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".sp-field-row{display:flex;align-items:center;gap:6px}",
      ".sp-input{font:inherit;font-size:12px;width:100%;box-sizing:border-box;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
      ".sp-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}",
      ".sp-input:disabled{opacity:.5}",
      ".sp-field-hint{font-size:10.5px;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));overflow-wrap:anywhere}",
      ".sp-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:16px 0;font-size:12px}",
      ".sp-foot{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;flex-wrap:wrap}",
      ".sp-path{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
    ].join("\n");
    const CUT_COLOR = { spine: "#6F9FE8", official: "#E0A35E" };
    const SEP = String.fromCharCode(92);
    const KNOB_GROUPS = [
      { id: "small", title: "小刀", keys: ["chunkMax", "chunkMin", "burstCuts", "paybackTurns", "spanBandRatio", "minNetGain"] },
      { id: "mid", title: "中刀", keys: ["deepCutAbove", "mergeMaxSpan", "mergeBreakEven", "mergeCooldownMs"] },
      { id: "big", title: "大刀", keys: ["officialAbove", "officialCooldownMs", "bigGate", "keepRounds", "keepRoundTokens"] },
    ];

    function fmtTokens(value) {
      const n = Number(value) || 0;
      if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
      if (n >= 1000) return (n >= 100000 ? String(Math.round(n / 1000)) : (n / 1000).toFixed(1)) + "k";
      return String(Math.round(n));
    }

    function fmtClock(ms) {
      const n = Number(ms) || 0;
      if (!n) return "—";
      const d = new Date(n);
      const two = (v) => String(v).padStart(2, "0");
      return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
    }

    function copyText(text) {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
      } catch {}
    }

    /** 面板的全部统计都在这里算，纯函数，组件只负责画。 */
    function summarizeCuts(cuts) {
      const list = Array.isArray(cuts) ? cuts : [];
      const sum = (arr) => arr.reduce((total, cut) => total + (Number(cut.tokens) || 0), 0);
      const spine = list.filter((cut) => cut.kind === "spine");
      const official = list.filter((cut) => cut.kind === "official");
      const total = sum(list);
      const biggest = list.reduce((best, cut) => ((Number(cut.tokens) || 0) > (Number(best && best.tokens) || 0) ? cut : best), null);
      const files = list.reduce((count, cut) => count + (Array.isArray(cut.rawNames) ? cut.rawNames.length : 0), 0);
      return {
        count: list.length,
        total,
        spineCount: spine.length,
        spineTokens: sum(spine),
        officialCount: official.length,
        officialTokens: sum(official),
        average: list.length ? Math.round(total / list.length) : 0,
        biggest,
        files,
        first: list.length ? list[0] : null,
        last: list.length ? list[list.length - 1] : null,
      };
    }

    /** 构成条：每一刀按 token 占比分一段，小刀至少 1.5% 好看见。 */
    function barSegments(cuts) {
      const list = (Array.isArray(cuts) ? cuts : []).filter((cut) => (Number(cut.tokens) || 0) > 0);
      const total = list.reduce((sum, cut) => sum + (Number(cut.tokens) || 0), 0);
      if (!total) return [];
      return list.map((cut) => ({
        cut,
        width: Math.max(1.5, ((Number(cut.tokens) || 0) / total) * 100),
        share: (Number(cut.tokens) || 0) / total,
        color: CUT_COLOR[cut.kind] || "var(--dsw-alias-label-secondary)",
      }));
    }

    function Kpi(props) {
      return h("div", { className: "sp-kpi" },
        h("div", { className: "sp-kpi-label" }, props.label),
        h("div", { className: "sp-kpi-value", style: props.color ? { color: props.color } : undefined }, props.value),
        props.hint ? h("div", { className: "sp-kpi-hint" }, props.hint) : null);
    }

    /**
     * 自己的旋钮输入。文档明确：不要把宿主原语组件（SettingsValueField 之类）
     * 放进自己的槽位里——它一旦抛错，整个槽位条目就变成空白。这里只借配置表单模型
     * 的读写面，控件自己画。
     */
    function KnobInput(props) {
      const { t, label, hint, disabled, overridden, value, onEdit, onReset } = props;
      const [text, setText] = React.useState(String(value ?? ""));
      return h("label", { className: "sp-field" },
        h("div", { className: "sp-field-head" },
          h("span", null, label),
          overridden ? h("span", { className: "sp-tag" }, t("overridden")) : null),
        h("div", { className: "sp-field-row" },
          h("input", {
            className: "sp-input",
            type: "number",
            value: text,
            disabled,
            onChange: (event) => {
              setText(event.target.value);
              onEdit(event.target.value);
            },
          }),
          overridden ? h("button", { className: "sp-btn", disabled, onClick: onReset }, t("reset")) : null),
        hint ? h("div", { className: "sp-field-hint" }, hint) : null);
    }

    function CutRow(props) {
      const { cut, t, dir, index } = props;
      const color = CUT_COLOR[cut.kind] || "inherit";
      const files = Array.isArray(cut.rawNames) ? cut.rawNames : [];
      const sep = String(dir || "").includes(SEP) ? SEP : "/";
      const range = cut.start && cut.end ? cut.start + "→" + cut.end : "—";
      return h("details", { className: "sp-details" },
        h("summary", { className: "sp-row" },
          h("span", { className: "sp-dim sp-num" }, String(index)),
          h("span", { className: "sp-badge", style: { color, borderColor: color } },
            cut.kind === "spine" ? t("spine.kindMine") : t("spine.kindOfficial")),
          h("span", { className: "sp-mono sp-num", style: { textAlign: "left" } }, "−" + fmtTokens(cut.tokens)),
          h("span", { className: "sp-dim sp-mono", style: { textAlign: "left" } }, range),
          h("span", { className: "sp-dim", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cut.model || cut.provider || "—"),
          h("span", { className: "sp-dim sp-mono" }, fmtClock(cut.time)),
          h("span", { className: "sp-dim sp-num" }, files.length ? String(files.length) : "·")),
        h("div", { className: "sp-detail" },
          cut.preview ? h("p", { className: "sp-preview" }, cut.preview) : null,
          files.length
            ? h("ul", { className: "sp-files" }, files.map((name) => h("li", { key: name },
              h("code", { className: "sp-path", style: { flex: "1 1 auto" } }, name),
              h("button", { className: "sp-btn", onClick: () => copyText(dir ? dir + sep + name : name) }, t("spine.copy")))))
            : h("div", { className: "sp-dim" }, t("spine.noFiles"))));
    }

    function SpinePanel(props) {
      const t = props.t;
      const build = () => {
        const t = props.t;
        const state = typeof props.useProjection === "function" ? props.useProjection(SPINE_KEY) : undefined;
        const [, setTick] = React.useState(0);
        const bump = () => setTick((value) => value + 1);
        const model = props.model;
        const actions = props.actions || {};
        if (!state) return h("div", { className: "sp-root" }, h("div", { className: "sp-empty" }, t("spine.unavailable")));
        const cuts = Array.isArray(state.cuts) ? state.cuts : [];
        const stats = summarizeCuts(cuts);
        const segments = barSegments(cuts);
        const rows = cuts.map((cut, index) => ({ cut, index: index + 1 })).reverse();
        const shell = model && typeof model.shell === "function" ? model.shell() : {};
        const knob = (name) => {
          const label = LABELS[name] || [name, ""];
          const field = model && typeof model.field === "function" ? (() => { try { return model.field(name) || {}; } catch { return {}; } })() : {};
          return h(KnobInput, {
            key: name,
            t,
            label: label[0],
            hint: label[1],
            disabled: !shell.writable || shell.saving,
            overridden: Boolean(field.overridden),
            value: field.value,
            onEdit: (text) => { actions.edit?.(name, text); bump(); },
            onReset: () => { actions.resetField?.(name); bump(); },
          });
        };
        return h("div", { className: "sp-root" },
          h("div", { className: "sp-grid" },
            h(Kpi, { label: t("spine.saved"), value: fmtTokens(stats.total), hint: t("spine.savedHint"), color: "#6F9FE8" }),
            h(Kpi, { label: t("spine.count"), value: String(stats.count), hint: t("spine.average") + " " + fmtTokens(stats.average) }),
            h(Kpi, { label: t("spine.mine"), value: String(stats.spineCount), hint: fmtTokens(stats.spineTokens) + " " + t("spine.tokensShort") }),
            h(Kpi, { label: t("spine.official"), value: String(stats.officialCount), hint: fmtTokens(stats.officialTokens) + " " + t("spine.tokensShort") }),
            h(Kpi, { label: t("spine.biggest"), value: stats.biggest ? fmtTokens(stats.biggest.tokens) : "—", hint: stats.biggest ? "seq " + stats.biggest.start + "→" + stats.biggest.end : t("spine.none") }),
            h(Kpi, { label: t("spine.last"), value: stats.last ? fmtClock(stats.last.time) : "—", hint: stats.last ? fmtTokens(stats.last.tokens) : t("spine.none") })),
          h("div", { className: "sp-card" },
            h("div", { className: "sp-card-title" }, t("spine.composition"),
              h("span", { className: "sp-card-sub" }, t("spine.files") + " " + String(stats.files))),
            segments.length
              ? h("div", { className: "sp-bar" }, segments.map((segment, index) => h("div", {
                key: segment.cut.id + "-" + index,
                className: "sp-seg",
                style: { width: segment.width + "%", background: segment.color },
                title: (segment.cut.kind === "spine" ? t("spine.kindMine") : t("spine.kindOfficial")) + " −" + fmtTokens(segment.cut.tokens) + " (seq " + segment.cut.start + "→" + segment.cut.end + ")",
              })))
              : h("div", { className: "sp-empty" }, t("spine.empty")),
            segments.length
              ? h("div", { className: "sp-legend" },
                h("span", null, h("span", { className: "sp-dot", style: { background: CUT_COLOR.spine } }), t("spine.kindMine"), " ", fmtTokens(stats.spineTokens)),
                h("span", null, h("span", { className: "sp-dot", style: { background: CUT_COLOR.official } }), t("spine.kindOfficial"), " ", fmtTokens(stats.officialTokens)))
              : null),
          h("div", { className: "sp-card" },
            h("div", { className: "sp-card-title" }, t("spine.timeline"),
              h("span", { className: "sp-card-sub" }, fmtTokens(stats.total) + " · " + String(stats.count) + " " + t("spine.cutsUnit"))),
            rows.length
              ? h("div", null,
                h("div", { className: "sp-head" },
                  h("span", { className: "sp-num" }, "#"),
                  h("span", null, t("spine.colKind")),
                  h("span", null, t("spine.colTokens")),
                  h("span", null, t("spine.colSeq")),
                  h("span", null, t("spine.colModel")),
                  h("span", null, t("spine.colTime")),
                  h("span", { className: "sp-num" }, t("spine.colFiles"))),
                rows.slice(0, 60).map((row) => h(CutRow, { key: row.cut.id + "-" + row.index, cut: row.cut, index: row.index, t, dir: state.shadowDir })))
              : h("div", { className: "sp-empty" }, t("spine.empty"))),
          h("div", { className: "sp-card" },
            h("div", { className: "sp-card-title" }, t("spine.knobs"),
              h("span", { className: "sp-card-sub" }, shell.writable ? t("spine.knobsHint") : t("spine.readOnly")),
              h("button", { className: "sp-btn sp-btn-primary", disabled: !shell.writable || shell.saving, onClick: () => { actions.save?.(); bump(); } }, shell.saving ? t("saving") : t("save")),
              h("button", { className: "sp-btn", disabled: !shell.writable || shell.saving, onClick: () => { actions.discard?.(); bump(); } }, t("discard"))),
            KNOB_GROUPS.map((group) => h("div", { key: group.id, className: "sp-group" },
              h("div", { className: "sp-group-title" }, group.title),
              h("div", { className: "sp-fields" }, group.keys.map(knob))))),
          state.shadowDir
            ? h("div", { className: "sp-foot" },
              h("span", null, t("spine.dirLabel")),
              h("code", { className: "sp-path" }, state.shadowDir),
              h("button", { className: "sp-btn", onClick: () => copyText(state.shadowDir) }, t("spine.copyDir")))
            : null);
      };
      try {
        return build();
      } catch (error) {
        // 渲染期抛错会把整条槽位条目打成空白：兜底成一条可见提示，别让人看到白屏。
        console.error('spine: panel render failed', error);
        return h('div', { className: 'sp-root' },
          h('div', { className: 'sp-card' },
            h('div', { className: 'sp-card-title' }, t('spine.knobs')),
            h('div', { className: 'sp-empty' }, t('spine.error') + ' ' + String(error && error.message ? error.message : error))));
      }
    }


    function SettingsPage(props) {
      const { t } = props;
      const state = props.useLiveCompact((snapshot) => snapshot);
      if (props.view === "summary") return t("summary");
      const section = (group) => group.keys.map((name) => {
        const [label, hint] = LABELS[name];
        return h(SettingsValueField, {
          key: name,
          id: `live-compact-${name}`,
          label,
          hint,
          numeric: true,
          disabled: !state.writable || state.saving,
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          invalidLabel: t("invalid"),
          ...state[name],
          onEdit: (text) => props.edit(name, text),
          onReset: () => props.resetField(name),
        });
      });
      return h(SettingsForm, {
        state,
        labels: {
          unavailable: t("unavailableHost"),
          readOnly: t("unavailable"),
          saveFailed: t("saveFailed"),
          save: t("save"),
          saving: t("saving"),
        },
        onSave: props.save,
        onDiscard: props.discard,
      },
      h("h4", null, t("basic")),
      h(SettingsValueField, {
        id: "live-compact-takeoverPresets",
        label: t("takeoverPresets"),
        hint: t("takeoverArrayHint"),
        numeric: false,
        disabled: !state.writable || state.saving,
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        invalidLabel: t("invalid"),
        ...state.takeoverPresets,
        onEdit: (text) => props.edit("takeoverPresets", text),
        onReset: () => props.resetField("takeoverPresets"),
      }),
      h("p", null, t("takeoverHint")),
      section(GROUPS[0]),
      h("details", null,
        h("summary", null, t("advanced")),
        section(GROUPS[1])));
    }

    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const t = ctx.locale.bind("liveCompact");
        ctx.effect(() => ctx.locale.register("liveCompact", { zh, en }), "live-compact: settings dictionary");
        const model = new SettingsFormModel(ctx.configForms.get(NS), [PRESET_FIELD, ...KEYS.map(settingsNumberField)]);
        const store = model.bind(() => ({
          ...model.shell(),
          takeoverPresets: model.field("takeoverPresets"),
          ...Object.fromEntries(KEYS.map((name) => [name, model.field(name)])),
        }));
        ctx.effect(() => () => model.dispose(), "live-compact: form subscription");
        ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.row.config", () => ctx.slots.register(
          {
            name: "plugins.row.config",
            key: "dsh-live-compact-x#compaction-spine-x",
            locale: "liveCompact",
            inject: () => ({ hooks: { liveCompact: store }, ...model.actions() }),
          },
          SettingsPage,
        ))), "live-compact: settings page");
        // 会话里的「压缩」页：读宿主投影出统计，配置沿用设置页那份表单模型（同一份 ledger，
        // 在这里改就是改真配置）。单独一个 effect：面板挂不上不影响设置页。
        if (typeof styles !== "undefined" && styles?.insert) styles.insert(SPINE_CSS);
        else if (typeof document !== "undefined") {
          const marker = "dsh-live-compact-x#spine-panel";
          if (!document.querySelector("style[data-plugin-css=" + JSON.stringify(marker) + "]")) {
            const styleEl = document.createElement("style");
            styleEl.dataset.plugin = "dsh-live-compact-x";
            styleEl.dataset.pluginCss = marker;
            styleEl.textContent = SPINE_CSS;
            document.head.appendChild(styleEl);
          }
        }
        const panelActions = model.actions();
        // 面板注册也包一层：面板挂不上绝不连累设置页。
        ctx.effect(() => {
          try {
            ctx.slots.inject("conversation.view", () => ctx.slots.register(
              {
                name: "conversation.view",
                id: "dsh-live-compact-x#cuts",
                order: 25,
                locale: "liveCompact",
                label: () => t("tab.spine"),
              },
              (props) => h(SpinePanel, { ...props, t, model, actions: panelActions }),
            ));
          } catch (error) {
            ctx.logger?.debug?.("spine: cuts panel registration skipped: " + String(error?.message ?? error));
          }
        }, "live-compact: cuts panel");
      },
      // 只是给本地测试用的出口；加载器只认 inject / apply。
      __test: { summarizeCuts, barSegments, fmtTokens, fmtClock, SpinePanel, SPINE_CSS },
    };
  },
});