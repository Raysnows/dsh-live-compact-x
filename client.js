window.__ModuleLoader__.load({
  id: "dsh-live-compact-x",
  factory(require) {
    /** 全走宿主原生接口的设置界面。 */
    const React = require("react");
    const { SettingsFormModel, settingsNumberField, SettingsForm, SettingsValueField } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;

    // 宿主设置命名空间 = Loader 条目 id，也就是 cordis.patch.yml 里的 compaction-spine-x。
    // 老安装（上游 / 早期 fork）可能叫 compaction-spine，两个都试，谁被服务用谁。
    const NS_CANDIDATES = ["compaction-spine-x", "compaction-spine"];
    const NS = NS_CANDIDATES[0];
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
      "spine.savedHint": "替换掉的 token",
      "spine.count": "切刀数",
      "spine.mine": "我方卡片",
      "spine.official": "官方卡片",
      "spine.average": "平均",
      "spine.biggest": "最大一刀",
      "spine.topKnife": "最多刀法",
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
      "spine.cutPoint": "切点",
      "spine.presetDefault": "默认档",
      "spine.presetCustom": "自定义档",
      "spine.presetDefaultOn": "现在是默认档，点开可改",
      "spine.knobsHint": "点开调刀把，改完点保存才生效",
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
      "spine.scopeSession": "本会话",
      "spine.scopeAll": "全部会话",
      "spine.scopeSessionHint": "只看这一条会话切过什么",
      "spine.scopeAllHint": "按决策日志汇总所有会话 · 统计于",
      "spine.scopeHintNow": "本会话累计",
      "spine.scopeHintAll": "全部会话累计",
      "spine.knifeSmall": "小刀",
      "spine.knifeMerge": "中刀",
      "spine.knifeBig": "大刀",
      "spine.knifeOfficial": "官方",
      "spine.knifePlugin": "旧卡片",
      "spine.knifeShortBig": "大刀",
      "spine.knifeShortOfficial": "官方",
      "spine.knifeShortPlugin": "旧卡",
      "spine.knifeBigHint": "本插件请官方摘要接手，算我们的刀",
      "spine.knifeOfficialHint": "插件接管前后的原生压缩",
      "spine.knifeStats": "刀法统计",
      "spine.colKnife": "刀法",
      "spine.colCount": "刀数",
      "spine.colSaved": "切掉",
      "spine.colShare": "占比",
      "spine.colAvg": "平均",
      "spine.knifeNote": "小刀、中刀、大刀都是本插件切的（大刀借用官方摘要）；官方 = 插件接管之前或让位时的原生压缩，旧卡片 = 早期没记刀名的卡。",
      "spine.experimental": "实验性",
      "spine.enableMid": "启用中刀（合并整张卡片，默认关闭）",
      "spine.groupSmallHint": "抢在官方压缩之前先切尾巴，一行内容都不丢。",
      "spine.groupMidHint": "上下文很大时，把连续的老卡片并成一张；不省钱就不动。",
      "spine.groupBigHint": "前两把刀都切不动时，才请官方压缩接手。",
      "spine.docs": "文档与出处",
      "spine.docsHint": "点复制带走路径",
      "spine.docsReadme": "README",
      "spine.docsChangelog": "更新记录",
      "spine.docsRepo": "仓库",
      "spine.docsIssues": "反馈",
      "spine.version": "版本",
      "spine.debug": "调试信息",
      "spine.debugHint": "默认收起",
      "spine.debugSid": "会话 ID",
      "spine.debugCounts": "计数",
      "spine.debugSettings": "生效设置",
      "spine.sessions": "会话数",
      "spine.sessionsHint": "有切刀记录的会话",
      "spine.since": "最早记录",
      "spine.generated": "统计于",
      "spine.attempts": "尝试",
      "spine.skipped": "跳过",
      "spine.failed": "失败",
      "spine.allEmpty": "还没有任何会话切过内容。",
    };
    const en = {
      takeoverPresets: "Take over official presets",
      takeoverHint: "Enter true/false, or a JSON array such as [\"standard\"] to limit takeover. Applies to newly loaded presets after saving; recreate existing sessions.",
      takeoverArrayHint: "JSON array: only the listed preset IDs are taken over; true and false are also accepted.",
      summary: "cuts at 20000, keeps 3 rounds, stops at 650000",
      "tab.spine": "Compaction",
      "spine.saved": "Cut so far",
      "spine.savedHint": "replaced tokens",
      "spine.count": "Cuts",
      "spine.mine": "Our cards",
      "spine.official": "Official cards",
      "spine.average": "avg",
      "spine.biggest": "Largest cut",
      "spine.topKnife": "Top knife",
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
      "spine.cutPoint": "Cut points",
      "spine.presetDefault": "Defaults",
      "spine.presetCustom": "Custom",
      "spine.presetDefaultOn": "On defaults — expand to edit",
      "spine.knobsHint": "Expand to tune, then save",
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
      "spine.scopeSession": "This session",
      "spine.scopeAll": "All sessions",
      "spine.scopeSessionHint": "What this session cut",
      "spine.scopeAllHint": "Aggregated from the decision log · as of",
      "spine.scopeHintNow": "This session",
      "spine.scopeHintAll": "All sessions",
      "spine.knifeSmall": "Small cut",
      "spine.knifeMerge": "Merge cut",
      "spine.knifeBig": "Big cut",
      "spine.knifeOfficial": "Official",
      "spine.knifePlugin": "Legacy card",
      "spine.knifeShortBig": "big",
      "spine.knifeShortOfficial": "official",
      "spine.knifeShortPlugin": "legacy",
      "spine.knifeBigHint": "The plugin asked the official summarizer to take over",
      "spine.knifeOfficialHint": "Native compaction outside the plugin",
      "spine.knifeStats": "Knife stats",
      "spine.colKnife": "knife",
      "spine.colCount": "cuts",
      "spine.colSaved": "cut",
      "spine.colShare": "share",
      "spine.colAvg": "avg",
      "spine.knifeNote": "Small, merge, and big cuts are all ours (big borrows the official summarizer). Official = native compaction before takeover or while standing down; legacy = early cards without a knife label.",
      "spine.experimental": "experimental",
      "spine.enableMid": "Enable the merge cut (joins whole cards, off by default)",
      "spine.groupSmallHint": "Cuts the tail before official compaction, dropping nothing.",
      "spine.groupMidHint": "When the context is huge, joins continuous old cards; skips unless it pays off.",
      "spine.groupBigHint": "Only when the first two knives cannot cut, the official summary takes over.",
      "spine.docs": "Docs",
      "spine.docsHint": "copy any path",
      "spine.docsReadme": "README",
      "spine.docsChangelog": "Changelog",
      "spine.docsRepo": "Repo",
      "spine.docsIssues": "Issues",
      "spine.version": "Version",
      "spine.debug": "Debug info",
      "spine.debugHint": "collapsed by default",
      "spine.debugSid": "Session ID",
      "spine.debugCounts": "Counters",
      "spine.debugSettings": "Effective settings",
      "spine.sessions": "Sessions",
      "spine.sessionsHint": "sessions with cuts",
      "spine.since": "Since",
      "spine.generated": "as of",
      "spine.attempts": "Attempts",
      "spine.skipped": "skipped",
      "spine.failed": "failed",
      "spine.allEmpty": "No session has cut anything yet.",
    };

    const SPINE_KEY = "spine.cuts";
    const SPINE_CSS = [
      ".sp-root{box-sizing:border-box;height:100%;overflow-y:auto;padding:12px 14px 26px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}",
      ".sp-topbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}",
      ".sp-scope{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-docrow>.sp-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}",
      ".sp-scope-btn{font:inherit;font-size:12px;padding:3px 13px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".sp-scope-btn[data-on='1']{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}",
      ".sp-topbar-sub{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".sp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:10px}",
      ".sp-kpi{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;min-width:0}",
      ".sp-kpi-label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sp-kpi-value{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:1px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sp-kpi-hint{font-size:10.5px;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sp-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-bottom:10px}",
      ".sp-card-title{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:8px}",
      ".sp-card-sub{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".sp-bar{display:flex;gap:2px;height:22px;border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-seg{height:100%;min-width:2px}",
      ".sp-seg:hover{opacity:.72}",
      ".sp-legend{display:flex;flex-wrap:wrap;gap:12px 16px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px;font-variant-numeric:tabular-nums}",
      ".sp-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}",
      ".sp-thead,.sp-trow{display:grid;grid-template-columns:1fr 58px 78px 58px 66px;gap:8px;align-items:center;padding:4px 6px}",
      ".sp-thead{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:2px}",
      ".sp-trow{font-size:12.5px;border-radius:6px}",
      ".sp-trow:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sp-trow-off{opacity:.55}",
      ".sp-knife{display:flex;align-items:center;min-width:0}",
      ".sp-head{display:grid;grid-template-columns:16px 74px 88px 56px 1fr 54px 26px;gap:10px;padding:0 6px 4px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}",
      ".sp-row{display:grid;grid-template-columns:16px 74px 88px 56px 1fr 54px 26px;gap:10px;align-items:center;padding:4px 6px;border-radius:6px;font-size:12px}",
      ".sp-head>span,.sp-row>span,.sp-trow>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
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
      ".sp-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(228px,1fr));gap:10px 14px}",
      ".sp-group{margin-bottom:12px}",
      ".sp-group:last-child{margin-bottom:0}",
      ".sp-group-title{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}",
      ".sp-group-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2)}",
      ".sp-switch{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}",
      ".sp-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".sp-field-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".sp-tag{font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".sp-tag-warn{border-color:var(--dsw-alias-state-warning-primary,#C88A2E);color:var(--dsw-alias-state-warning-primary,#C88A2E)}",
      ".sp-field-row{display:flex;align-items:center;gap:6px}",
      ".sp-input{font:inherit;font-size:12px;width:100%;box-sizing:border-box;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
      ".sp-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}",
      ".sp-input:disabled{opacity:.5}",
      ".sp-field-hint{font-size:10.5px;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));overflow-wrap:anywhere}",
      ".sp-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:14px 0;font-size:12px}",
      ".sp-foot{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px;flex-wrap:wrap}",
      ".sp-dot-sep{opacity:.45}",
      ".sp-path{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
      ".sp-docrow{display:grid;grid-template-columns:76px 1fr auto;gap:8px;align-items:center;padding:3px 0;border-bottom:1px dashed var(--dsw-alias-border-l2)}",
      ".sp-docrow:last-child{border-bottom:0}",
      ".sp-doclabel{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".sp-doclink{color:var(--dsw-alias-state-business-primary);text-decoration:none}",
      ".sp-detail-row{display:grid;grid-template-columns:88px 1fr auto;gap:8px;align-items:center;font-size:11.5px}",
      ".sp-preset{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px}",
      ".sp-note{margin-top:8px;padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l2);font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
    ].join("\n");
    // 五类刀法：小刀 / 中刀 / 大刀 都是本插件动的手（大刀借用官方摘要），
    // 官方是插件接管前后的原生压缩，旧卡片是我们早期没记刀名的卡。
    const KNIFE_ORDER = ["small", "merge", "big", "official", "plugin"];
    const KNIFE_COLOR = {
      small: "#6F9FE8", merge: "#9B7BE8", big: "#E0A35E", official: "#8A8F98", plugin: "#6FBFA8",
    };
    const KNIFE_LABEL = {
      small: "spine.knifeSmall", merge: "spine.knifeMerge", big: "spine.knifeBig",
      official: "spine.knifeOfficial", plugin: "spine.knifePlugin",
    };
    /** 时间线徽标只有 70px 宽，用短名；完整名放在悬停提示里。 */
    const KNIFE_SHORT = {
      small: "spine.knifeSmall", merge: "spine.knifeMerge", big: "spine.knifeShortBig",
      official: "spine.knifeShortOfficial", plugin: "spine.knifeShortPlugin",
    };
    /** 自己人：小刀、中刀、大刀、旧卡片；官方不算。 */
    const OURS = ["small", "merge", "big", "plugin"];
    const EMPTY_KINDS = { small: 0, merge: 0, plugin: 0, big: 0, official: 0 };
    const SEP = String.fromCharCode(92);
    /** 打开中刀时写进 deepCutAbove 的默认门槛：上下文超过 12 万 token 才试。 */
    const MID_ON = 120000;
    const KNOB_GROUPS = [
      {
        id: "small",
        title: "spine.knifeSmall",
        hint: "spine.groupSmallHint",
        keys: ["chunkMax", "chunkMin", "burstCuts", "paybackTurns", "spanBandRatio", "minNetGain"],
      },
      {
        id: "big",
        title: "spine.knifeBig",
        hint: "spine.groupBigHint",
        keys: ["officialAbove", "officialCooldownMs", "bigGate", "keepRounds", "keepRoundTokens"],
      },
      // 实验性功能放最后：默认收起也不抢眼，开开关才生效。
      {
        id: "mid",
        title: "spine.knifeMerge",
        hint: "spine.groupMidHint",
        experimental: true,
        enable: "deepCutAbove",
        on: MID_ON,
        keys: ["mergeMaxSpan", "mergeBreakEven", "mergeCooldownMs", "deepCutAbove"],
      },
    ];

    /**
     * 打开面板要停在最上面。会话视图和聊天共用宿主那个滚动容器，聊天通常停在底部，
     * 切过来就继承了那个偏移；自己的根也可能是滚动容器。挂载时把沿路能滚的都归零。
     */
    function resetScroll(node) {
      let el = node;
      let depth = 0;
      while (el && depth < 6) {
        try {
          const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
          const overflowY = style ? String(style.overflowY || "") : "";
          if ((overflowY === "auto" || overflowY === "scroll") && el.scrollTop !== 0) el.scrollTop = 0;
        } catch {}
        el = el.parentElement;
        depth += 1;
      }
    }

    /** 根节点的 ref：每次挂载（也就是每次切到这个页签）都回到顶部。 */
    function rootRef(node) {
      if (node) resetScroll(node);
    }

    function num(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

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

    /** 一刀属于哪把刀。老数据只有 spine / official 两种 kind，spine 当时就是小刀。 */
    function kindOfCut(cut) {
      const kind = String(cut?.kind || "");
      if (KNIFE_ORDER.indexOf(kind) >= 0) return kind;
      if (kind === "spine") return "small";
      if (kind === "official") return "official";
      return "plugin";
    }

    /** 面板的全部统计都在这里算，纯函数，组件只负责画。 */
    function summarizeCuts(cuts) {
      const list = Array.isArray(cuts) ? cuts : [];
      const byKind = {};
      for (const kind of KNIFE_ORDER) byKind[kind] = { cuts: 0, saved: 0 };
      let total = 0;
      let files = 0;
      let biggest = null;
      for (const cut of list) {
        const kind = kindOfCut(cut);
        const tokens = num(cut.tokens);
        byKind[kind].cuts += 1;
        byKind[kind].saved += tokens;
        total += tokens;
        if (Array.isArray(cut.rawNames)) files += cut.rawNames.length;
        if (!biggest || num(biggest.tokens) < tokens) biggest = cut;
      }
      const mine = OURS.reduce((sum, kind) => sum + byKind[kind].cuts, 0);
      const mineSaved = OURS.reduce((sum, kind) => sum + byKind[kind].saved, 0);
      return {
        count: list.length,
        total,
        byKind,
        average: list.length ? Math.round(total / list.length) : 0,
        biggest,
        files,
        first: list.length ? list[0] : null,
        last: list.length ? list[list.length - 1] : null,
        spineCount: mine,
        spineTokens: mineSaved,
        officialCount: byKind.official.cuts,
        officialTokens: byKind.official.saved,
      };
    }

    /** 构成条：每一刀按 token 占比分一段，小刀至少 1.5% 好看见。 */
    function barSegments(cuts) {
      const list = (Array.isArray(cuts) ? cuts : []).filter((cut) => num(cut.tokens) > 0);
      const total = list.reduce((sum, cut) => sum + num(cut.tokens), 0);
      if (!total) return [];
      return list.map((cut) => ({
        cut,
        width: Math.max(1.5, (num(cut.tokens) / total) * 100),
        share: num(cut.tokens) / total,
        color: KNIFE_COLOR[kindOfCut(cut)] || "var(--dsw-alias-label-secondary)",
      }));
    }

    /** 按刀法汇总的构成条：小刀 / 中刀 / 大刀 / 旧卡各一段。 */
    function kindBars(rows) {
      const list = (Array.isArray(rows) ? rows : []).filter((row) => num(row.saved) > 0);
      const total = list.reduce((sum, row) => sum + num(row.saved), 0);
      if (!total) return [];
      return list.map((row) => ({
        row,
        width: Math.max(1.5, (num(row.saved) / total) * 100),
        share: num(row.saved) / total,
        color: row.color || "var(--dsw-alias-label-secondary)",
      }));
    }

    function shareText(part, whole) {
      const total = num(whole);
      if (!total) return "—";
      const ratio = (num(part) / total) * 100;
      if (ratio >= 10) return ratio.toFixed(0) + "%";
      return (ratio >= 1 ? ratio.toFixed(1) : ratio.toFixed(2)) + "%";
    }

    function Kpi(props) {
      const value = String(props.value ?? "");
      // 数字用 19px 好看，纯文字/日期（刀法名、日期）降一档，免得撑出卡片换行。
      const long = value.length > 7;
      const style = {};
      if (props.color) style.color = props.color;
      if (long) style.fontSize = "15px";
      return h("div", { className: "sp-kpi" },
        h("div", { className: "sp-kpi-label" }, props.label),
        h("div", { className: "sp-kpi-value", style }, value),
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

    function KnifeBadge(props) {
      const kind = props.kind;
      const full = props.t(KNIFE_LABEL[kind] || "spine.knifePlugin");
      return h("span", {
        className: "sp-badge",
        style: { color: KNIFE_COLOR[kind] || "inherit", borderColor: KNIFE_COLOR[kind] || "currentColor" },
        title: props.title || full,
      }, props.t(KNIFE_SHORT[kind] || KNIFE_LABEL[kind] || "spine.knifePlugin"));
    }

    function CutRow(props) {
      const { cut, t, dir, index } = props;
      const kind = kindOfCut(cut);
      const files = Array.isArray(cut.rawNames) ? cut.rawNames : [];
      const sep = String(dir || "").includes(SEP) ? SEP : "/";
      const range = cut.start && cut.end ? cut.start + "→" + cut.end : "—";
      return h("details", { className: "sp-details" },
        h("summary", { className: "sp-row" },
          h("span", { className: "sp-dim sp-num" }, String(index)),
          h(KnifeBadge, { kind, t }),
          h("span", { className: "sp-dim sp-mono" }, range),
          h("span", { className: "sp-num sp-mono" }, fmtTokens(cut.tokens)),
          h("span", { className: "sp-dim", title: cut.model || cut.provider || "" }, cut.model || cut.provider || "—"),
          h("span", { className: "sp-dim sp-num" }, fmtClock(cut.time)),
          h("span", { className: "sp-num sp-dim" }, files.length ? String(files.length) : "—")),
        h("div", { className: "sp-detail" },
          cut.preview ? h("p", { className: "sp-preview" }, cut.preview) : null,
          files.length
            ? h("ul", { className: "sp-files" }, files.map((name) => h("li", { key: name },
              h("code", { className: "sp-path", style: { flex: "1 1 auto" } }, name),
              h("button", { className: "sp-btn", onClick: () => copyText(dir ? dir + sep + name : name) }, t("spine.copy")))))
            : h("div", { className: "sp-dim" }, t("spine.noFiles"))));
    }

    function KnifeTable(props) {
      const { t, rows, total } = props;
      return h("div", null,
        h("div", { className: "sp-thead" },
          h("span", null, t("spine.colKnife")),
          h("span", { className: "sp-num" }, t("spine.colCount")),
          h("span", { className: "sp-num" }, t("spine.colSaved")),
          h("span", { className: "sp-num" }, t("spine.colShare")),
          h("span", { className: "sp-num" }, t("spine.colAvg"))),
        rows.map((row) => h("div", {
          key: row.kind,
          className: "sp-trow" + (row.cuts ? "" : " sp-trow-off"),
        },
          h("span", { className: "sp-knife" },
            h("span", { className: "sp-dot", style: { background: row.color } }),
            t(row.labelKey),
            row.experimental ? h("span", { className: "sp-tag sp-tag-warn", style: { marginLeft: "6px" } }, t("spine.experimental")) : null),
          h("span", { className: "sp-num sp-mono" }, String(row.cuts)),
          h("span", { className: "sp-num sp-mono" }, fmtTokens(row.saved)),
          h("span", { className: "sp-num sp-mono" }, shareText(row.saved, total)),
          h("span", { className: "sp-num sp-mono" }, row.cuts ? fmtTokens(Math.round(row.saved / row.cuts)) : "—"))));
    }

    function DocRow(props) {
      const { t, label, value, href } = props;
      if (!value) return null;
      return h("div", { className: "sp-docrow" },
        h("span", { className: "sp-doclabel" }, label),
        href
          ? h("a", { className: "sp-path sp-doclink", href, target: "_blank", rel: "noreferrer", title: value }, value)
          : h("code", { className: "sp-path", title: value }, value),
        h("button", { className: "sp-btn", onClick: () => copyText(value) }, t("spine.copy")));
    }
    function renderPanel(props, state, scope, bump, setScope) {
      const t = props.t;
      const model = props.model;
      const actions = props.actions || {};
      const shell = model && typeof model.shell === "function"
        ? (() => { try { return model.shell() || {}; } catch { return {}; } })()
        : {};
      const all = scope === "all";
      const global = (state && state.global) || {};
      const sessionCuts = Array.isArray(state && state.cuts) ? state.cuts : [];
      const settings = (state && state.settings) || {};
      const docs = (state && state.docs) || {};
      const allKnives = global.knives || {};
      const subtitle = all
        ? t("spine.scopeAllHint") + " " + fmtClock(global.generatedAt)
        : t("spine.scopeSessionHint");
      const topbar = h("div", { className: "sp-topbar" },
        h("div", { className: "sp-scope" },
          h("button", {
            className: "sp-scope-btn",
            "data-on": all ? "0" : "1",
            onClick: () => setScope("session"),
          }, t("spine.scopeSession")),
          h("button", {
            className: "sp-scope-btn",
            "data-on": all ? "1" : "0",
            onClick: () => setScope("all"),
          }, t("spine.scopeAll"))),
        h("span", { className: "sp-topbar-sub" }, subtitle));
      if (!state) {
        return h("div", { className: "sp-root", ref: rootRef }, topbar,
          h("div", { className: "sp-empty" }, t("spine.unavailable")));
      }
      // 计数优先用投影给的累计值（不吃 40 刀上限）；没有就按当前时间线自己算。
      const derived = summarizeCuts(sessionCuts);
      const hasCounters = Boolean(state.kinds || state.savedBy);
      const counterKinds = hasCounters
        ? { ...EMPTY_KINDS, ...(state.kinds || {}) }
        : {
          small: derived.byKind.small.cuts, merge: derived.byKind.merge.cuts,
          big: derived.byKind.big.cuts, plugin: derived.byKind.plugin.cuts, official: derived.byKind.official.cuts,
        };
      const savedBy = hasCounters
        ? { ...EMPTY_KINDS, ...(state.savedBy || {}) }
        : {
          small: derived.byKind.small.saved, merge: derived.byKind.merge.saved,
          big: derived.byKind.big.saved, plugin: derived.byKind.plugin.saved, official: derived.byKind.official.saved,
        };
      const rows = (all ? ["small", "merge", "big"] : KNIFE_ORDER)
        .map((kind) => {
          const stat = all
            ? { cuts: num(allKnives[kind] && allKnives[kind].cuts), saved: num(allKnives[kind] && allKnives[kind].saved) }
            : { cuts: num(counterKinds[kind]), saved: num(savedBy[kind]) };
          return {
            kind,
            color: KNIFE_COLOR[kind],
            labelKey: KNIFE_LABEL[kind],
            experimental: kind === "merge",
            cuts: stat.cuts,
            saved: stat.saved,
          };
        });
      const totalSaved = rows.reduce((sum, row) => sum + row.saved, 0);
      const totalCuts = rows.reduce((sum, row) => sum + row.cuts, 0);
      const bars = kindBars(rows);
      // 本会话看「最大的一刀」，全部会话没有逐刀记录，改看「量最大的一把刀」。
      const topKnife = rows.reduce((best, row) => (row.saved > best.saved ? row : best), { saved: 0, kind: "", cuts: 0 });
      const biggestCut = sessionCuts.reduce(
        (best, cut) => (num(cut.tokens) > num(best && best.tokens) ? cut : best),
        null,
      );
      const lastCut = sessionCuts.length ? sessionCuts[sessionCuts.length - 1] : null;
      const attempts = global.attempts || {};
      const kpis = all
        ? [
          h(Kpi, { key: "saved", label: t("spine.saved"), value: fmtTokens(totalSaved), hint: t("spine.savedHint"), color: "#6F9FE8" }),
          h(Kpi, { key: "count", label: t("spine.count"), value: String(totalCuts), hint: t("spine.average") + " " + fmtTokens(totalCuts ? Math.round(totalSaved / totalCuts) : 0) }),
          h(Kpi, { key: "sessions", label: t("spine.sessions"), value: String(num(global.sessions)), hint: t("spine.sessionsHint") }),
          h(Kpi, { key: "top", label: t("spine.topKnife"), value: topKnife.kind ? t(KNIFE_SHORT[topKnife.kind]) : "—", hint: topKnife.kind ? fmtTokens(topKnife.saved) + " · " + shareText(topKnife.saved, totalSaved) : t("spine.none") }),
          h(Kpi, { key: "attempts", label: t("spine.attempts"), value: String(num(attempts.cut)), hint: t("spine.skipped") + " " + String(num(attempts.cutSkip)) + " · " + t("spine.failed") + " " + String(num(attempts.failed)) }),
          h(Kpi, { key: "since", label: t("spine.since"), value: global.since ? fmtDate(global.since) : "—", hint: t("spine.generated") + " " + fmtClock(global.generatedAt) }),
        ]
        : [
          h(Kpi, { key: "saved", label: t("spine.saved"), value: fmtTokens(totalSaved), hint: t("spine.savedHint"), color: "#6F9FE8" }),
          h(Kpi, { key: "count", label: t("spine.count"), value: String(totalCuts), hint: t("spine.average") + " " + fmtTokens(totalCuts ? Math.round(totalSaved / totalCuts) : 0) }),
          h(Kpi, {
            key: "mine",
            label: t("spine.mine"),
            value: String(OURS.reduce((sum, kind) => sum + num(counterKinds[kind]), 0)),
            hint: t("spine.knifeSmall") + num(counterKinds.small) + " " + t("spine.knifeMerge") + num(counterKinds.merge)
              + " " + t("spine.knifeBig") + num(counterKinds.big),
          }),
          h(Kpi, { key: "official", label: t("spine.official"), value: String(num(counterKinds.official)), hint: fmtTokens(savedBy.official) + " " + t("spine.tokensShort") }),
          h(Kpi, {
            key: "biggest",
            label: t("spine.biggest"),
            value: biggestCut ? fmtTokens(biggestCut.tokens) : "—",
            hint: biggestCut ? t(KNIFE_LABEL[kindOfCut(biggestCut)]) : t("spine.none"),
          }),
          h(Kpi, { key: "last", label: t("spine.last"), value: lastCut ? fmtClock(lastCut.time) : "—", hint: lastCut ? fmtTokens(lastCut.tokens) + " · " + t(KNIFE_LABEL[kindOfCut(lastCut)]) : t("spine.none") }),
        ];
      const composition = h("div", { className: "sp-card" },
        h("div", { className: "sp-card-title" }, t("spine.composition"),
          h("span", { className: "sp-card-sub" }, fmtTokens(totalSaved) + " " + t("spine.tokensShort") + " · " + String(totalCuts) + " " + t("spine.cutsUnit"))),
        bars.length
          ? h("div", { className: "sp-bar" }, bars.map((seg, index) => h("div", {
            key: seg.row.kind + "-" + index,
            className: "sp-seg",
            style: { width: seg.width + "%", background: seg.color },
            title: t(seg.row.labelKey) + " −" + fmtTokens(seg.row.saved) + " (" + shareText(seg.row.saved, totalSaved) + ")",
          })))
          : h("div", { className: "sp-empty" }, all ? t("spine.allEmpty") : t("spine.empty")),
        bars.length
          ? h("div", { className: "sp-legend" }, bars.map((seg) => h("span", { key: "lg-" + seg.row.kind },
            h("span", { className: "sp-dot", style: { background: seg.color } }),
            t(seg.row.labelKey), " ", fmtTokens(seg.row.saved), " ", shareText(seg.row.saved, totalSaved))))
          : null);
      const statsCard = h("div", { className: "sp-card" },
        h("div", { className: "sp-card-title" }, t("spine.knifeStats"),
          h("span", { className: "sp-card-sub" }, all ? t("spine.scopeHintAll") : t("spine.scopeHintNow"))),
        h(KnifeTable, { t, rows, total: totalSaved }),
        all ? null : h("div", { className: "sp-note" }, t("spine.knifeNote")),
        all
          ? h("div", { className: "sp-foot" },
            h("span", null, t("spine.attempts") + " " + String(num(attempts.cut))),
            h("span", { className: "sp-dot-sep" }, "·"),
            h("span", null, t("spine.skipped") + " " + String(num(attempts.cutSkip)) + " / " + String(num(attempts.mergeSkip))),
            h("span", { className: "sp-dot-sep" }, "·"),
            h("span", null, t("spine.official") + " " + String(num(attempts.official))),
            h("span", { className: "sp-dot-sep" }, "·"),
            h("span", null, t("spine.failed") + " " + String(num(attempts.failed))))
          : null);
      // 全部会话没有逐刀记录，这里只画本会话的时间线；切到全部会话时先不显示，免得看错。
      const timelineCard = !all && sessionCuts.length
        ? h("div", { className: "sp-card" },
          h("div", { className: "sp-card-title" }, t("spine.timeline"),
            h("span", { className: "sp-card-sub" }, fmtTokens(totalSaved) + " · " + String(sessionCuts.length) + " " + t("spine.cutsUnit"))),
          h("div", { className: "sp-head" },
            h("span", null, "#"),
            h("span", null, t("spine.colKind")),
            h("span", null, t("spine.colSeq")),
            h("span", { className: "sp-num" }, t("spine.colTokens")),
            h("span", null, t("spine.colModel")),
            h("span", { className: "sp-num" }, t("spine.colTime")),
            h("span", { className: "sp-num" }, t("spine.colFiles"))),
          sessionCuts.map((cut, index) => ({ cut, index: index + 1 }))
            .reverse()
            .slice(0, 60)
            .map((row) => h(CutRow, { key: row.cut.id + "-" + row.index, cut: row.cut, index: row.index, t, dir: state.shadowDir })))
        : null;
      const knob = (name) => {
        const label = LABELS[name] || [name, ""];
        const field = model && typeof model.field === "function"
          ? (() => { try { return model.field(name) || {}; } catch { return {}; } })()
          : {};
        // 表单里的值优先（改到一半的草稿也看得见）；没服务配置时退回投影里的生效值。
        const staged = field && field.value !== undefined && field.value !== null ? String(field.value) : "";
        const resolved = Number(settings[name]);
        const value = staged !== "" ? staged : (Number.isFinite(resolved) ? resolved : "");
        return h(KnobInput, {
          key: name,
          t,
          label: label[0],
          hint: label[1],
          disabled: !shell.writable || shell.saving,
          overridden: Boolean(field.overridden),
          value,
          onEdit: (text) => { actions.edit?.(name, text); bump(); },
          onReset: () => { actions.resetField?.(name); bump(); },
        });
      };
      const knobDefaults = (state && state.defaults) || {};
      const presetDefault = () => {
        for (const group of KNOB_GROUPS) {
          for (const name of group.keys) {
            const value = Number(knobDefaults[name]);
            if (Number.isFinite(value)) actions.edit?.(name, String(value));
          }
        }
        bump();
      };
      const presetCustom = () => {
        // 「自定义」不写任何东西：草稿里现在填的就是自定义档，点它只是回到未保存状态。
        actions.discard?.();
        bump();
      };
      const isDefault = KNOB_GROUPS.every((group) => group.keys.every((name) => {
        const want = Number(knobDefaults[name]);
        return !Number.isFinite(want) || Math.abs(num(settings[name]) - want) < 1e-9;
      }));
      const knobsCard = h("details", { className: "sp-details sp-card" },
        h("summary", { className: "sp-card-title" }, t("spine.cutPoint"),
          h("span", { className: "sp-card-sub" }, isDefault ? t("spine.presetDefaultOn") : t("spine.knobsHint"))),
        h("div", { className: "sp-preset" },
          h("button", {
            className: "sp-btn" + (isDefault ? " sp-btn-primary" : ""),
            disabled: !shell.writable || shell.saving,
            onClick: presetDefault,
          }, t("spine.presetDefault")),
          h("button", {
            className: "sp-btn",
            disabled: !shell.writable || shell.saving,
            onClick: presetCustom,
          }, t("spine.presetCustom")),
          h("span", { className: "sp-card-sub" }, shell.writable ? t("spine.knobsHint") : t("spine.readOnly")),
          h("button", {
            className: "sp-btn sp-btn-primary",
            disabled: !shell.writable || shell.saving,
            onClick: () => { actions.save?.(); bump(); },
          }, shell.saving ? t("saving") : t("save")),
          h("button", {
            className: "sp-btn",
            disabled: !shell.writable || shell.saving,
            onClick: () => { actions.discard?.(); bump(); },
          }, t("discard"))),
        KNOB_GROUPS.map((group) => h("div", { key: group.id, className: "sp-group" },
          h("div", { className: "sp-group-title" },
            t(group.title),
            group.experimental ? h("span", { className: "sp-tag sp-tag-warn" }, t("spine.experimental")) : null),
          group.hint ? h("div", { className: "sp-field-hint", style: { marginBottom: "8px" } }, t(group.hint)) : null,
          group.enable
            ? h("label", { className: "sp-switch" },
              h("input", {
                type: "checkbox",
                checked: num(settings[group.enable]) > 0,
                disabled: !shell.writable || shell.saving,
                onChange: (event) => {
                  actions.edit?.(group.enable, event.target.checked ? String(group.on) : "0");
                  bump();
                },
              }),
              h("span", null, t("spine.enableMid")))
            : null,
          h("div", { className: "sp-fields" }, group.keys.map(knob)))));
      const docsCard = h("div", { className: "sp-card" },
        h("div", { className: "sp-card-title" }, t("spine.docs"),
          h("span", { className: "sp-card-sub" }, t("spine.docsHint"))),
        h("div", null,
          h(DocRow, { t, label: t("spine.docsReadme"), value: docs.readme }),
          h(DocRow, { t, label: t("spine.docsChangelog"), value: docs.changelog }),
          h(DocRow, { t, label: t("spine.docsRepo"), value: docs.repo, href: docs.repo }),
          h(DocRow, { t, label: t("spine.docsIssues"), value: docs.issues, href: docs.issues }),
          h(DocRow, { t, label: t("spine.version"), value: docs.version })));
      const debugCard = h("details", { className: "sp-details sp-card" },
        h("summary", { className: "sp-card-title" }, t("spine.debug"),
          h("span", { className: "sp-card-sub" }, t("spine.debugHint"))),
        h("div", { className: "sp-detail" },
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.dirLabel")),
            h("code", { className: "sp-path" }, state.shadowDir || "—"),
            h("button", { className: "sp-btn", onClick: () => copyText(state.shadowDir || "") }, t("spine.copyDir"))),
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.debugSid")),
            h("code", { className: "sp-path" }, state.sid || "—"),
            h("span", null)),
          h("pre", { className: "sp-path", style: { margin: 0, whiteSpace: "pre-wrap" } },
            t("spine.debugCounts") + " " + JSON.stringify({ kinds: counterKinds, savedBy })),
          h("pre", { className: "sp-path", style: { margin: 0, whiteSpace: "pre-wrap" } },
            t("spine.debugSettings") + " " + JSON.stringify(settings))));
      return h("div", { className: "sp-root", ref: rootRef },
        topbar,
        h("div", { className: "sp-grid" }, kpis),
        composition,
        statsCard,
        timelineCard,
        docsCard,
        knobsCard,
        debugCard);
    }

    function fmtDate(ms) {
      const n = Number(ms) || 0;
      if (!n) return "—";
      const d = new Date(n);
      const two = (v) => String(v).padStart(2, "0");
      return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
    }

    /**
     * 读投影：钩子照常无条件调用一次（顺序稳定），但它一旦抛错，槽位条目会被宿主
     * 打成空白。这里把它兜成一条可见的错误提示。
     */
    function readProjection(props) {
      if (typeof props.useProjection !== "function") return undefined;
      try {
        return props.useProjection(SPINE_KEY);
      } catch (error) {
        return { projectionError: String(error && error.message ? error.message : error) };
      }
    }

    function SpinePanel(props) {
      const t = props.t;
      // 钩子必须在最外层，且每次渲染顺序一致：渲染体抛错也不能少调一个钩子。
      const state = readProjection(props);
      const [tick, setTick] = React.useState(0);
      const [scope, setScope] = React.useState("session");
      try {
        if (state && state.projectionError) throw new Error(state.projectionError);
        return renderPanel(props, state, scope, () => setTick(tick + 1), setScope);
      } catch (error) {
        // 渲染期抛错会把整条槽位条目打成空白：兜底成一条可见提示，别让人看到白屏。
        console.error('spine: panel render failed', error);
        return h("div", { className: "sp-root", ref: rootRef },
          h("div", { className: "sp-card" },
            h("div", { className: "sp-card-title" }, t("spine.knobs")),
            h("div", { className: "sp-empty" }, t("spine.error") + " " + String(error && error.message ? error.message : error))));
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
        const fields = [PRESET_FIELD, ...KEYS.map(settingsNumberField)];
        const forms = new Map(NS_CANDIDATES.map((id) => {
          try { return [id, new SettingsFormModel(ctx.configForms.get(id), fields)]; } catch { return [id, null]; }
        }));
        ctx.effect(() => () => {
          for (const store of stores.values()) { try { store?.dispose?.(); } catch {} }
          for (const form of forms.values()) { try { form?.dispose?.(); } catch {} }
        }, "live-compact: form subscriptions");
        let activeId = NS;
        const activeModel = () => forms.get(activeId) || forms.get(NS) || null;
        // 每个模型的快照订阅只建一次：whileServed 反复进出不能漏订阅。
        const stores = new Map();
        const storeFor = (form) => {
          if (!form) return null;
          if (!stores.has(form)) {
            stores.set(form, form.bind(() => ({
              ...form.shell(),
              takeoverPresets: form.field("takeoverPresets"),
              ...Object.fromEntries(KEYS.map((name) => [name, form.field(name)])),
            })));
          }
          return stores.get(form);
        };
        // 面板可能是先渲染、配置后服务：门面每次转发给当前模型，别把旧模型焊死。
        const model = {
          shell() { try { return activeModel()?.shell() || {}; } catch { return {}; } },
          field(name) { try { return activeModel()?.field(name) || {}; } catch { return {}; } },
          actions() { try { return activeModel()?.actions() || {}; } catch { return {}; } },
          bind(selector) {
            const form = activeModel();
            if (!form) return () => ({ writable: false, saving: false });
            const bound = form.bind(selector);
            return {
              subscribe: (fn) => bound.subscribe(fn),
              getSnapshot: () => {
                const snapshot = bound.getSnapshot();
                return {
                  ...snapshot,
                  takeoverPresets: form.field("takeoverPresets"),
                  ...Object.fromEntries(KEYS.map((name) => [name, form.field(name)])),
                };
              },
            };
          },
          dispose() {},
        };
        ctx.effect(() => ctx.configForms.whileServed(NS_CANDIDATES, (served) => {
          const hit = served && typeof served.has === "function" ? NS_CANDIDATES.find((id) => served.has(id)) : undefined;
          if (hit) activeId = hit;
          const form = activeModel();
          const store = storeFor(form);
          const off = ctx.slots.inject("plugins.row.config", () => ctx.slots.register(
            {
              name: "plugins.row.config",
              key: "dsh-live-compact-x#compaction-spine-x",
              locale: "liveCompact",
              inject: () => ({
                hooks: store ? { liveCompact: store } : { liveCompact: { subscribe: () => () => {}, getSnapshot: () => ({ writable: false, saving: false }) } },
                ...(form ? form.actions() : {}),
              }),
            },
            SettingsPage,
          ));
          return () => { try { off?.(); } catch {} };
        }), "live-compact: settings page");
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
        const panelActions = {
          edit: (name, text) => model.actions().edit?.(name, text),
          resetField: (name) => model.actions().resetField?.(name),
          save: () => model.actions().save?.(),
          discard: () => model.actions().discard?.(),
        };
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
      __test: {
        summarizeCuts, barSegments, kindBars, kindOfCut, shareText, readProjection,
        fmtTokens, fmtClock, renderPanel, SpinePanel, SPINE_CSS,
        KNIFE_COLOR, KNOB_GROUPS, MID_ON,
      },
    };
  },
});