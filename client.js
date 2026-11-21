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
      "spine.timeline": "切点时间线",
      "spine.empty": "还没有切开过任何内容。上下文变大后，小刀会先在这里记一笔。",
      "spine.unavailable": "宿主没有提供压缩统计（插件未接管，或宿主版本较旧）。",
      "spine.kindMine": "小刀",
      "spine.kindOfficial": "官方",
      "spine.files": "备份文件",
      "spine.noFiles": "这一刀没有留备份文件。",
      "spine.copy": "复制",
      "spine.copyDir": "复制目录",
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
      "spine.timeline": "Cut timeline",
      "spine.empty": "Nothing has been cut yet. Once the context grows, the first cut appears here.",
      "spine.unavailable": "The host does not serve compaction stats (plugin not active, or an older host).",
      "spine.kindMine": "knife",
      "spine.kindOfficial": "official",
      "spine.files": "Backup files",
      "spine.noFiles": "This cut kept no backup file.",
      "spine.copy": "Copy",
      "spine.copyDir": "Copy folder",
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
    const CUT_COLORS = { spine: "#7CC0FF", official: "#E7A45C" };
    const SEP = String.fromCharCode(92);
    const S = {
      wrap: { padding: "18px 20px 32px", maxWidth: 900, margin: "0 auto", fontFamily: "inherit" },
      stats: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 },
      stat: { flex: "1 1 0", minWidth: 132, border: "1px solid rgba(127,127,147,0.24)", borderRadius: 10, padding: "10px 12px", background: "rgba(127,127,147,0.06)" },
      statLabel: { fontSize: 11, opacity: 0.6, letterSpacing: "0.01em" },
      statValue: { fontSize: 20, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" },
      statHint: { fontSize: 11, opacity: 0.45, marginTop: 2 },
      sectionTitle: { fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.55, margin: "4px 0 8px" },
      hint: { opacity: 0.62, fontSize: 13, lineHeight: 1.7 },
      cut: { border: "1px solid rgba(127,127,147,0.22)", borderRadius: 10, marginBottom: 8, background: "rgba(127,127,147,0.05)" },
      cutHead: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", listStyle: "none" },
      badge: { fontSize: 11, padding: "1px 7px", borderRadius: 999, border: "1px solid", lineHeight: 1.7, whiteSpace: "nowrap" },
      tokens: { fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
      meta: { fontSize: 12, opacity: 0.55, whiteSpace: "nowrap" },
      cutBody: { padding: "0 12px 12px", display: "grid", gap: 8 },
      preview: { fontSize: 12, opacity: 0.75, lineHeight: 1.65, margin: 0, wordBreak: "break-word" },
      fileRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
      path: { fontSize: 11.5, opacity: 0.8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all" },
      button: { font: "inherit", fontSize: 11.5, padding: "2px 8px", borderRadius: 6, border: "1px solid rgba(127,127,147,0.35)", background: "transparent", color: "inherit", cursor: "pointer" },
      footer: { marginTop: 18, display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", borderTop: "1px solid rgba(127,127,147,0.18)", paddingTop: 12, flexWrap: "wrap" },
    };

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

    function Stat(props) {
      return h("div", { style: S.stat },
        h("div", { style: S.statLabel }, props.label),
        h("div", { style: { ...S.statValue, color: props.color || "inherit" } }, props.value),
        props.hint ? h("div", { style: S.statHint }, props.hint) : null);
    }

    function CutRow(props) {
      const { cut, t, dir } = props;
      const color = CUT_COLORS[cut.kind] || "inherit";
      const files = Array.isArray(cut.rawNames) ? cut.rawNames : [];
      const sep = String(dir || "").includes(SEP) ? SEP : "/";
      const range = cut.start && cut.end ? "seq " + cut.start + " → " + cut.end : t("spine.noRange");
      return h("details", { style: S.cut },
        h("summary", { style: S.cutHead },
          h("span", { style: { ...S.badge, color, borderColor: color } },
            cut.kind === "spine" ? t("spine.kindMine") : t("spine.kindOfficial")),
          h("span", { style: S.tokens }, "−" + fmtTokens(cut.tokens)),
          h("span", { style: S.meta }, range),
          h("span", { style: { ...S.meta, marginLeft: "auto" } }, fmtClock(cut.time))),
        h("div", { style: S.cutBody },
          cut.preview ? h("p", { style: S.preview }, cut.preview) : null,
          cut.provider || cut.model ? h("div", { style: S.meta }, [cut.provider, cut.model].filter(Boolean).join(" / ")) : null,
          files.length
            ? h("div", null,
              h("div", { style: S.meta }, t("spine.files")),
              files.map((name) => h("div", { key: name, style: S.fileRow },
                h("code", { style: S.path }, name),
                h("button", { style: S.button, onClick: () => copyText(dir ? dir + sep + name : name) }, t("spine.copy")))))
            : h("p", { style: { ...S.meta, margin: 0 } }, t("spine.noFiles"))));
    }

    function SpinePanel(props) {
      const t = props.t;
      const state = typeof props.useProjection === "function" ? props.useProjection(SPINE_KEY) : undefined;
      if (!state) return h("div", { style: S.wrap }, h("p", { style: S.hint }, t("spine.unavailable")));
      const cuts = Array.isArray(state.cuts) ? state.cuts : [];
      const rows = cuts.slice().reverse();
      return h("div", { style: S.wrap },
        h("div", { style: S.stats },
          h(Stat, { label: t("spine.saved"), value: fmtTokens(state.saved), hint: t("spine.savedHint"), color: "#7CC0FF" }),
          h(Stat, { label: t("spine.count"), value: String(cuts.length) }),
          h(Stat, { label: t("spine.mine"), value: String(state.spine || 0) }),
          h(Stat, { label: t("spine.official"), value: String(state.official || 0) })),
        h("div", { style: S.sectionTitle }, t("spine.timeline")),
        rows.length
          ? rows.map((cut, index) => h(CutRow, { key: cut.id + "-" + index, cut, t, dir: state.shadowDir }))
          : h("p", { style: S.hint }, t("spine.empty")),
        state.shadowDir
          ? h("div", { style: S.footer },
            h("code", { style: S.path }, state.shadowDir),
            h("button", { style: S.button, onClick: () => copyText(state.shadowDir) }, t("spine.copyDir")))
          : null);
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
        // 会话里的「压缩」页：读宿主投影，实时看切过多少、切在哪、备份文件在哪。
        // 单独一个 effect：面板挂不上（老宿主没有 conversation.view）也不影响设置页。
        ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register(
          {
            name: "conversation.view",
            id: "dsh-live-compact-x#cuts",
            order: 25,
            locale: "liveCompact",
            label: () => t("tab.spine"),
          },
          (props) => h(SpinePanel, { ...props, t }),
        )), "live-compact: cuts panel");
      },
    };
  },
});
