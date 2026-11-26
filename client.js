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
      pointerTokens: ["大结果只留指针", "超大的工具结果只留一行指针"],
      keepRounds: ["保留原文轮数", "至少 1 轮，默认 3"],
      chunkMin: ["一刀最小 token", "默认 1000"],
      chunkMax: ["一刀最大 token", "默认 32000"],
      keepRoundTokens: ["收尾停止线", "默认 32000"],
      bigGate: ["绝对停切线", "默认 650000"],
      cooldownMs: ["官方压缩后冷却（毫秒）", "0 = 只跳过一次"],
      thresholdRatio: ["官方大压缩触发比例", "默认 0.8"],
      headroomTokens: ["官方大压缩预留", "默认 65536"],
      retainTokens: ["官方大压缩保留", "默认 8192"],
      compactionRetries: ["官方大压缩重试", "默认 0"],
      minNetGain: ["净收益门槛", "切掉−卡片 不到这个数就不切"],
      burstCuts: ["一次连切", "收尾时最多连切几刀"],
      deepCutAbove: ["中刀启用线", "上下文超过它才试中刀（实验性，开启前请确认风险）"],
      mergeMaxSpan: ["中刀窗口", "chunkMax × 它；默认 4 = 128k"],
      mergeBreakEven: ["中刀回本倍数", "一次性重算 / 净赚 超过它就不切"],
      mergeCooldownMs: ["中刀冷却（毫秒）", "两刀中刀之间的最小间隔"],
      officialAbove: ["大刀启用线", "超过它且没有可切段时让大刀接手（模型或脚本）"],
      officialCooldownMs: ["大刀冷却（毫秒）", "两次大压缩的最小间隔"],
      officialScript: ["大刀归纳器", "0 = 当前模型摘要，1 = 本地脚本卡片"],
  scriptEngine: ["本地脚本版本", "1 = 新版（价值密度选行 + 去重），0 = 稳定版（按原文顺序）"],
      paybackTurns: ["小刀回本轮数", "重算超过 净赚×它 就不切"],
      spanBandRatio: ["动态刀长比例", "单刀上限 = 上下文 × 它"],
      keepRounds: ["保留原文轮数", "最近几轮留原文"],
      keepRoundTokens: ["收尾停止线", "降到这个 token 就不切；不得低于小刀一刀上限"],
      bigGate: ["绝对停切线", "超过即不再小切"],
      chunkMax: ["一刀上限", "小刀一次最多切多少"],
      chunkMin: ["一刀下限", "不够就不切"],
    };

    /**
     * 每个旋钮的参考范围。面板直接把「范围 / 常用」印在输入框下面，
     * 不让人对着一格空数字猜。off 表示这个旋钮有「关」这个状态：
     * 滑块不再从 0 开始，而是给一个能用的下限，启用/关闭放到旁边的小勾选框里。
     */
    const KNOB_META = {
      // min/max 是能拖到的上下限（也是滑块的物理边界），step 是拖动一格的大小。
      // 上下限按本机能遇到的范围定：比如本机上下文最多几十万，大刀启用线给到 1M 没有意义，
      // 冷却时间也不允许调到 0（会变成每轮都压一次）。
      minTokens: { min: 5000, max: 200000, usual: [20000, 60000], step: 1000 },
      pointerTokens: { min: 0, max: 64000, usual: [16000, 32000], step: 1000, zero: "spine.zeroPointer" },
      keepRounds: { min: 1, max: 10, usual: [2, 5], step: 1 },
      chunkMin: { min: 1000, max: 20000, usual: [1000, 4000], step: 100 },
      chunkMax: { min: 8000, max: 128000, usual: [16000, 48000], step: 1000 },
      // 收尾停止线 = 「切到这么小就停」。它必须站在小刀一刀上限（chunkMax）之上：
      // 比一刀还低，等于把同一刀拆成两刀，所谓大刀只是重复小刀。下限因此跟 chunkMax 的默认值齐平。
      keepRoundTokens: { min: 32000, max: 200000, usual: [48000, 96000], step: 1000 },
      bigGate: { min: 100000, max: 1000000, usual: [400000, 650000], step: 50000 },
      cooldownMs: { min: 0, max: 600000, usual: [0, 600000], step: 10000 },
      minNetGain: { min: 500, max: 50000, usual: [2000, 8000], step: 500, off: true, onValue: 3000 },
      burstCuts: { min: 1, max: 10, usual: [1, 4], step: 1 },
      deepCutAbove: { min: 100000, max: 650000, usual: [120000, 250000], step: 10000, off: true, onValue: 120000, noToggle: true },
      mergeMaxSpan: { min: 1, max: 16, usual: [3, 6], step: 1 },
      mergeBreakEven: { min: 1, max: 10, usual: [2, 4], step: 1 },
      mergeCooldownMs: { min: 60000, max: 3600000, usual: [300000, 1200000], step: 60000 },
      officialAbove: { min: 200000, max: 650000, usual: [200000, 450000], step: 10000, off: true, onValue: 300000 },
      officialCooldownMs: { min: 60000, max: 7200000, usual: [600000, 3600000], step: 60000 },
      paybackTurns: { min: 1, max: 30, usual: [2, 10], step: 1, off: true, onValue: 8 },
      spanBandRatio: { min: 0.01, max: 0.5, usual: [0.02, 0.12], step: 0.01, off: true, onValue: 0.06 },
    };

    /**
     * 预设档：只改刀法策略这几项，中刀那几项一律不碰（它还没验收，默认关着）。
     * 点预设只是填草稿，还要点保存才生效——误点一下不会把配置改坏。
     */
    const PRESETS = [
      // 推荐档：出厂值里那四把刀全是关的，日常别用出厂档。这里给一套能跑的：
      // 小刀常开、回本 8 轮、刀长按上下文 6% 缩、45 万请官方收；中刀仍不碰。
      {
        id: "recommended",
        label: "spine.presetRecommended",
        hint: "spine.presetRecommendedHint",
        values: {
          minTokens: 20000, keepRounds: 3, keepRoundTokens: 48000, chunkMin: 1000, chunkMax: 32000,
          burstCuts: 3, minNetGain: 3000, paybackTurns: 8, spanBandRatio: 0.06,
          officialAbove: 450000, bigGate: 650000,
        },
      },
      {
        id: "smallFirst",
        label: "spine.presetSmallFirst",
        hint: "spine.presetSmallFirstHint",
        values: {
          minTokens: 20000, keepRounds: 3, keepRoundTokens: 48000, chunkMin: 1000, chunkMax: 32000,
          burstCuts: 4, minNetGain: 2000, paybackTurns: 4, spanBandRatio: 0,
          officialAbove: 600000, bigGate: 650000,
        },
      },
      {
        id: "bigFirst",
        label: "spine.presetBigFirst",
        hint: "spine.presetBigFirstHint",
        values: {
          minTokens: 30000, keepRounds: 3, keepRoundTokens: 48000, chunkMin: 2000, chunkMax: 32000,
          burstCuts: 1, minNetGain: 4000, paybackTurns: 10, spanBandRatio: 0.04,
          officialAbove: 200000, bigGate: 650000,
        },
      },
    ];

    // ---- 面板设置通道 ----
    // 走宿主 configForms 的话，这个命名空间一旦没被登记成可编辑表单，勾选框和保存
    // 按钮点下去只会安静地失败（save 被吞掉，界面也不动）。这条桥写的是引擎每回合
    // 真正读的 ~/.dsh/spine-settings.json，成了给时间戳，败了把原因原样贴出来。
    const SETTINGS_BRIDGE = "api/dsh-live-compact-x-settings";
    // 路由注册的是这个前缀本身（不在后面拼 /describe）：宿主的路由表是精确匹配，
    // 多一段就落到 /api 的兜底上，浏览器拿到的是 SPA 的 404 页面。
    const bridgeUrl = () => {
      try { return new URL(SETTINGS_BRIDGE, document.baseURI).toString(); }
      catch { return "/" + SETTINGS_BRIDGE; }
    };
    const postBridge = async (op, body) => {
      const response = await fetch(bridgeUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, ...(body || {}) }),
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        throw new Error("宿主返回了无法解析的响应（HTTP " + response.status + "）");
      }
      return payload;
    };

    /**
     * 面板自己的配置草稿：值来自桥，草稿留在本地，保存整批写文件。
     * 组件通过 useSyncExternalStore 订阅，所以每改一格滑块都会立刻重画，不用 bump。
     */
    function createSettingsStore() {
      let snapshot = {
        status: "idle", error: "", effective: {}, defaults: {}, overrides: {}, fixed: {}, file: "",
        draft: {}, saving: false, savedAt: 0, saveError: "",
        doc: null, docLoading: false, docError: "",
        sw: null, swSaving: false, swSavedAt: 0, swError: "", sid: "",
        presets: null, presetSaving: false, presetError: "",
        // 脱敏诊断：贴 issue 用。text 进剪贴板，url 直接打开新建 issue。
        diagLoading: false, diagText: "", diagUrl: "", diagError: "",
        // 本版更新：升级后第一眼看改了什么；「知道了」按版本号记在本机。
        news: null, newsLoading: false, newsError: "",
        // 上一次手工改出来的那套值：切回「自定义档」时用它恢复，而不是把草稿清掉。
        custom: null,
      };
      const listeners = new Set();
      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        for (const fn of [...listeners]) { try { fn(); } catch {} }
      };
      const store = {
        getSnapshot: () => snapshot,
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        dirty(name) { return Object.prototype.hasOwnProperty.call(snapshot.draft, name); },
        async load(sid) {
          const key = typeof sid === "string" ? sid : "";
          if (snapshot.status === "loading") return;
          if (snapshot.status === "ready" && snapshot.sid === key) return;
          publish({ status: "loading", error: "", sid: key, draft: {}, custom: null });
          try {
            const payload = await postBridge("describe", { op: "describe", sid: key });
            if (!payload.ok) throw new Error(payload.message || payload.code || "配置通道不可用");
            const { switch: sw, ...rest } = payload.value || {};
            publish({ status: "ready", error: "", ...rest, sw: sw || null, sid: key });
          } catch (error) {
            publish({ status: "unavailable", error: String(error && error.message ? error.message : error) });
          }
        },
        edit(name, text) {
          const draft = { ...snapshot.draft, [name]: String(text) };
          publish({ draft, custom: { ...(snapshot.custom || {}), ...draft }, saveError: "" });
        },
        reset(name) {
          const fallback = snapshot.defaults[name];
          if (fallback === undefined) return;
          const draft = { ...snapshot.draft, [name]: String(fallback) };
          publish({ draft, custom: { ...(snapshot.custom || {}), ...draft }, saveError: "" });
        },
        setMany(values) {
          const next = { ...snapshot.draft };
          for (const [name, value] of Object.entries(values || {})) next[name] = String(value);
          publish({ draft: next, saveError: "" });
        },
        discard() { publish({ draft: {}, saveError: "" }); },
        // 「自定义档」不是清空：把手动调过的那套值填回草稿，没有就退回生效值。
        applyCustom() {
          const custom = snapshot.custom;
          if (!custom || !Object.keys(custom).length) return false;
          publish({ draft: { ...custom }, saveError: "" });
          return true;
        },
        async persist(patch) {
          if (snapshot.saving) return false;
          const keys = Object.keys(patch || {});
          if (!keys.length) return false;
          publish({ saving: true, saveError: "" });
          try {
            const payload = await postBridge("save", { op: "save", patch });
            if (!payload.ok) throw new Error(payload.message || payload.code || "保存失败");
            const { switch: sw, ...rest } = payload.value || {};
            publish({ status: "ready", saving: false, error: "", savedAt: rest.savedAt || Date.now(), ...rest, sw: sw || snapshot.sw, draft: {}, custom: null });
            return true;
          } catch (error) {
            publish({ saving: false, saveError: String(error && error.message ? error.message : error) });
            return false;
          }
        },
        async save() {
          const patch = {};
          for (const [name, value] of Object.entries(snapshot.draft)) patch[name] = value === null ? null : value;
          return store.persist(patch);
        },
        async saveNow(values) { return store.persist({ ...values }); },
        // 总开关：本会话 / 全部会话。关掉后引擎下一回合就停手，文件里也记着，重启还在。
        async setSwitch(scope, enabled, sid) {
          if (snapshot.swSaving) return false;
          publish({ swSaving: true, swError: "" });
          try {
            const payload = await postBridge("switch", { op: "switch", scope, enabled, sid });
            if (!payload.ok) throw new Error(payload.message || payload.code || "切换失败");
            publish({ swSaving: false, sw: payload.value.switch || snapshot.sw, swSavedAt: payload.value.savedAt || Date.now(), swError: "" });
            return true;
          } catch (error) {
            publish({ swSaving: false, swError: String(error && error.message ? error.message : error) });
            return false;
          }
        },
        /**
         * 自定义档：存/套用/删都走一条通道，服务端会回一份新的 describe，
         * 所以旋钮显示会跟着「生效中的档」一起更新，草稿清空。
         */
        async preset(op, body) {
          if (snapshot.presetSaving) return false;
          publish({ presetSaving: true, presetError: "" });
          try {
            const payload = await postBridge(op, { op, ...body, sid: snapshot.sid });
            if (!payload.ok) throw new Error(payload.message || payload.code || "档位操作失败");
            const { switch: sw, ...rest } = payload.value || {};
            publish({ status: "ready", presetSaving: false, error: "", ...rest, sw: sw || snapshot.sw, draft: {} });
            return true;
          } catch (error) {
            publish({ presetSaving: false, presetError: String(error && error.message ? error.message : error) });
            return false;
          }
        },
        savePreset(scope, name) {
          const draft = snapshot.draft;
          const values = Object.keys(draft).length ? draft : snapshot.effective;
          return store.preset("preset-save", { scope, name, values });
        },
        applyPreset(scope, id) { return store.preset("preset-apply", { scope, id: id || "" }); },
        deletePreset(scope, id) { return store.preset("preset-delete", { scope, id }); },
        /**
         * 取脱敏诊断：服务端只读、已抹掉家目录 / 用户名 / 会话 id / token / 绝对路径。
         * 成功就顺手复制，附一个新建 issue 的链接（对方点开即可粘贴提交）。
         */
        async diag(sid) {
          if (snapshot.diagLoading) return false;
          publish({ diagLoading: true, diagError: "" });
          try {
            const payload = await postBridge("diag", { op: "diag", sid: sid || snapshot.sid });
            if (!payload.ok) throw new Error(payload.message || payload.code || "诊断不可用");
            const value = payload.value || {};
            publish({ diagLoading: false, diagText: value.text || "", diagUrl: value.url || "", diagError: "" });
            copyText(value.text || "");
            return true;
          } catch (error) {
            publish({ diagLoading: false, diagError: String(error && error.message ? error.message : error) });
            return false;
          }
        },
        /**
         * 本版更新：只读 CHANGELOG.md 头几段，跨几个版本升级也能一次看完。
         * 读不到就安静不画，不拿一个空卡占地方。
         */
        async loadNews() {
          if (snapshot.newsLoading || snapshot.news) return;
          publish({ newsLoading: true, newsError: "" });
          try {
            const payload = await postBridge("whatsnew", { op: "whatsnew" });
            if (!payload.ok) throw new Error(payload.message || payload.code || "读不到更新日志");
            publish({ newsLoading: false, news: payload.value || { entries: [] } });
          } catch (error) {
            publish({ newsLoading: false, newsError: String(error && error.message ? error.message : error) });
          }
        },
        async openDoc(which) {
          if (snapshot.doc && snapshot.doc.which === which) { publish({ doc: null, docError: "" }); return; }
          publish({ docLoading: true, docError: "" });
          try {
            const payload = await postBridge("doc", { op: "doc", which });
            if (!payload.ok) throw new Error(payload.message || payload.code || "读不到文档");
            publish({ docLoading: false, doc: { which, ...payload.value } });
          } catch (error) {
            publish({ docLoading: false, docError: String(error && error.message ? error.message : error) });
          }
        },
      };
      return store;
    }

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
      "spine.open": "打开",
      "spine.reveal": "所在位置",
      "spine.openOk": "已打开",
      "spine.openFail": "打不开，路径已复制",
      "spine.preview": "预览",
      "spine.previewLoading": "正在读…",
      "spine.previewTruncated": "只显示前 4 万字，完整内容看文件。",
      "spine.previewFailed": "读不到：",
      "spine.copyPath": "复制路径",
      "spine.cfgLoading": "正在连配置通道…",
      "spine.cfgDown": "配置通道不通：",
      "spine.cfgReady": "配置通道就绪",
      "spine.savedAt": "已保存",
      "spine.saveFailed": "保存失败：",
      "spine.draftPending": "草稿还没保存",
      "spine.cfgFixed": "这一项被 profile 配置固定，改文件不生效",
      "spine.fixedTag": "固定",
      "spine.cfgFallback": "现在走宿主设置表单；重启 DSH 后切换成文件直写",
      "spine.hostRefused": "宿主没有受理这次写入",
      "spine.settingsFile": "设置文件",
      "spine.cfgChannel": "配置通道",
      "spine.channelFile": "文件直写",
      "spine.channelDown": "不通",
      "spine.reloadPage": "刷新",
      "spine.switchSession": "本会话压缩",
      "spine.switchAll": "全部会话压缩",
      "spine.switchHint": "关掉后这个范围里不再用小刀 / 中刀 / 大刀，也不再主动请官方压缩；下一回合生效，重启也记得",
      "spine.switchFailed": "切换失败：",
      "spine.on": "开",
      "spine.offShort": "关",
      "spine.reloadHint": "重新加载这个页面（桌面端 Ctrl+R 没绑，F12 开发者工具里也能刷）",

      "spine.previewEnglish": "官方摘要原文是英文，面板不转述；正文看聊天里那张卡。",
      "spine.missing": "文件不在",
      "spine.knobs": "刀把",
      "spine.cutPoint": "切点",
      "spine.presetRecommended": "推荐档",
      "spine.presetRecommendedHint": "小刀常开、回本 8 轮、刀长按上下文 6%、45 万请官方收；中刀仍关（实验性，要开请单独确认）",
      "spine.presetCustom": "自定义档",
      "spine.presetAdd": "＋",
      "spine.presetAddHint": "把现在这套值存成一个自定义档，可以只给本会话、本工作区或全部会话用",
      "spine.presetFormTitle": "存成自定义档",
      "spine.presetNamePlaceholder": "档名，例如：夜间省流",
      "spine.presetScopeSession": "本会话",
      "spine.presetScopeWorkspace": "本工作区",
      "spine.presetScopeAll": "全部会话",
      "spine.presetScopeSessionHint": "只在这一条会话里用这套值，别的会话不受影响",
      "spine.presetScopeWorkspaceHint": "这个工作区里的所有会话都用这套值",
      "spine.presetScopeAllHint": "所有会话都用这套值（换工作区也带着）",
      "spine.presetWorkspaceUnknown": "当前工作区没认出来：工作区档暂时存不了，先选本会话或全部会话",
      "spine.presetSave": "存成新档",
      "spine.presetCancel": "取消",
      "spine.presetDelete": "删除这个档",
      "spine.presetDeleteAgain": "再点一次删除",
      "spine.presetClear": "取消套用",
      "spine.presetLayer": "当前生效",
      "spine.presetSaveTarget": "保存写回",
      "spine.presetFailed": "档位操作失败：",
      "spine.presetChipHint": "点一下套用，再点一下取消；",
      "spine.presetTagSession": "会话",
      "spine.presetTagWorkspace": "工作区",
      "spine.presetTagAll": "全部",
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
      "spine.knifeBigHint": "本插件让大刀接手（当前模型或本地脚本），算我们的刀",
      "spine.knifeOfficialHint": "插件接管前后的原生压缩",
      "spine.knifeStats": "刀法统计",
      "spine.colKnife": "刀法",
      "spine.colCount": "刀数",
      "spine.colSaved": "切掉",
      "spine.colShare": "占比",
      "spine.colAvg": "平均",
      "spine.knifeNote": "小刀、中刀、大刀都是本插件切的（大刀默认让当前模型归纳，也可切成本地脚本）；官方 = 插件接管之前或让位时的原生压缩，旧卡片 = 早期没记刀名的卡。",
      "spine.experimental": "实验性",
      "spine.lineClashHint": "中刀永远轮不到：中刀启用线必须低于大刀启用线，把中刀调低或大刀调高。当前",
      "spine.enableMid": "启用中刀（合并整张卡片，默认关闭）",
      "spine.groupSmallHint": "抢在官方压缩之前先切尾巴，一行内容都不丢。",
      "spine.groupMidHint": "上下文很大时，把连续的老卡片并成一张；不省钱就不动。",
      "spine.groupBigHint": "前两把刀都切不动时，才让大刀接手：默认用当前模型归纳，也可切成零模型调用的本地脚本。",
      "spine.scriptChoiceTitle": "大刀怎么归纳",
      "spine.groupScript": "本地脚本",
      "spine.groupScriptHint": "小刀、中刀、大刀的本地卡片都按这个版本生成。新版不是改刀法，是改「预算里留哪几行」。",
      "spine.engineTitle": "本地脚本版本",
      "spine.engineStable": "稳定版",
      "spine.engineStableHint": "按原文顺序先到先得（1.3.32 的行为）：结果可预期，但预算一满就丢后段的行。",
      "spine.engineExplore": "新版（探索）",
      "spine.engineExploreHint": "按价值密度选行 + 去重：同样预算下失败的报错、最后一条约束更不容易被裁掉。实测缺的事实从 7 条降到 3 条。",
      "spine.scriptModel": "当前模型",
      "spine.scriptLocal": "本地脚本",
      "spine.scriptModelHint": "用你当前正在用的模型把整段归纳成摘要（不是 DeepSeek 官方账号的模型）：更连贯、更会取舍，但会多发一次模型请求，有 LLM 成本。",
      "spine.diagTitle": "提交问题日志",
      "spine.diagCopy": "复制脱敏诊断",
      "spine.diagIssue": "去 GitHub 提 issue",
      "spine.diagHint": "诊断只读本机日志，附上全部切割参数、刀法统计与本地脚本卡片指标；已自动抹掉家目录、用户名、会话 id、token 与绝对路径，只有数字，不含聊天正文。复制后可自行删改再贴。",
      "spine.diagLoading": "收集中…",
      "spine.scriptLocalHint": "用本地脚本按规则摘录同一段：零模型调用、可按 seq 回读核对；归纳能力弱于模型，卡片不完整时会拒绝，不会偷偷改用模型。",
      "spine.scriptActive": "当前",
      "spine.scriptDraft": "改了要保存才生效",
      "spine.docs": "文档与出处",
      "spine.docsHint": "点开看文档，或复制路径",
      "spine.docsReadme": "README",
      "spine.docsChangelog": "更新记录",
      "spine.newsEntry": "更新日志",
      "spine.newsTitle": "本版更新",
      // 这句是写给自己看的解释，用户不需要；保留空值以免别处读到 undefined。
      "spine.newsHint": "",
      "spine.newsDismiss": "知道了",
      "spine.newsToggle": "点开看本版更新",
      "spine.newsOpen": "收起本版更新",
      "spine.newsUnavailable": "更新日志读不到，显示的是包内自带要点",
      "spine.newsCross": "这次是跨版本升级，下面几版都算新内容",
      "spine.newsHistory": "历史版本",
      "spine.newsHistoryHide": "收起历史版本",
      "spine.docsRepo": "仓库",
      "spine.docsIssues": "反馈",
      "spine.version": "版本",
      "spine.debug": "调试信息",
      "spine.debugHint": "默认收起",
      "spine.debugSid": "会话 ID",
      "spine.debugCounts": "计数",
      "spine.debugSettings": "生效设置",
      "spine.copyJson": "复制 JSON",
      "spine.copyCounts": "复制计数 JSON",
      "spine.copySettings": "复制设置 JSON",
      "spine.sessions": "会话数",
      "spine.sessionsHint": "有切刀记录的会话",
      "spine.since": "最早记录",
      "spine.generated": "统计于",
      "spine.attempts": "尝试",
      "spine.skipped": "跳过",
      "spine.failed": "失败",
      "spine.allEmpty": "还没有任何会话切过内容。",
      "spine.rangeLabel": "范围",
      "spine.usualLabel": "常用",
      "spine.zeroOff": "0 = 关",
      "spine.zeroPointer": "0 = 跟随一刀上限",
      "spine.presetSmallFirst": "小刀优先",
      "spine.presetSmallFirstHint": "小刀多切、大刀推迟到 60 万：细节更连续，上下文会更大",
      "spine.presetBigFirst": "大刀优先",
      "spine.presetBigFirstHint": "小刀少切、20 万就让大刀收：上下文压得低，细节靠摘要",
      "spine.presetDraftHint": "预设只填草稿，点保存才生效",
      "spine.expandRest": "展开其余",
      "spine.onlyRecent": "只看最近",
      "spine.enable": "启用",
      "spine.offState": "关",
      "spine.toggleHint": "勾上才生效；取消勾选 = 关",
      "spine.midWarnTitle": "中刀还没验收",
      "spine.midWarnBody": "它会把连续的老卡片并成一张，一次性重算几十 k 上下文。实测在真实会话里 16 次尝试全被拦下，一次都没落地；开了可能变慢，也可能切出更大的卡片。不建议日常开。",
      "spine.midWarnAck": "我明白风险，仍然要开启",
      "spine.midConfirm": "确认开启",
      "spine.midCancel": "先不改",
      "spine.valueOut": "当前值超出滑块范围，拖动会落回范围内",
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
      "spine.open": "Open",
      "spine.reveal": "Reveal",
      "spine.openOk": "Opened",
      "spine.openFail": "Cannot open; path copied",
      "spine.preview": "Preview",
      "spine.previewLoading": "Reading…",
      "spine.previewTruncated": "Showing the first 40k characters; open the file for the rest.",
      "spine.previewFailed": "Cannot read: ",
      "spine.copyPath": "Copy path",
      "spine.cfgLoading": "Connecting to the settings channel…",
      "spine.cfgDown": "Settings channel unavailable: ",
      "spine.cfgReady": "Settings channel ready",
      "spine.savedAt": "Saved",
      "spine.saveFailed": "Save failed: ",
      "spine.draftPending": "Draft not saved yet",
      "spine.cfgFixed": "This field is pinned by the profile config; editing the file has no effect",
      "spine.fixedTag": "pinned",
      "spine.cfgFallback": "using the host settings form; restart DSH to switch to direct file writes",
      "spine.hostRefused": "the host rejected this write",
      "spine.settingsFile": "Settings file",
      "spine.cfgChannel": "Settings channel",
      "spine.channelFile": "direct file write",
      "spine.channelDown": "down",
      "spine.reloadPage": "Reload",
      "spine.switchSession": "This session",
      "spine.switchAll": "All sessions",
      "spine.switchHint": "Turned off, this scope stops using the small/merge/big cuts and stops asking for official compaction; applies next turn and survives restarts",
      "spine.switchFailed": "Switch failed: ",
      "spine.on": "on",
      "spine.offShort": "off",
      "spine.reloadHint": "Reload this page (Desktop does not bind Ctrl+R)",

      "spine.previewEnglish": "Official summaries are English; read the card in the chat.",
      "spine.missing": "Missing",
      "spine.knobs": "Knobs",
      "spine.cutPoint": "Cut points",
      "spine.presetRecommended": "Recommended",
      "spine.presetRecommendedHint": "Small cuts on, payback 8 turns, span at 6% of context, official handover at 450k; the merge cut stays off",
      "spine.presetCustom": "Custom",
      "spine.presetAdd": "＋",
      "spine.presetAddHint": "Save the current values as a custom preset for this session, this workspace, or all sessions",
      "spine.presetFormTitle": "Save as custom preset",
      "spine.presetNamePlaceholder": "Name, e.g. night mode",
      "spine.presetScopeSession": "This session",
      "spine.presetScopeWorkspace": "This workspace",
      "spine.presetScopeAll": "All sessions",
      "spine.presetScopeSessionHint": "Only this session uses these values; other sessions stay untouched",
      "spine.presetScopeWorkspaceHint": "Every session in this workspace uses these values",
      "spine.presetScopeAllHint": "Every session uses these values",
      "spine.presetWorkspaceUnknown": "Workspace not recognised, so workspace presets are unavailable; pick this session or all sessions",
      "spine.presetSave": "Save preset",
      "spine.presetCancel": "Cancel",
      "spine.presetDelete": "Delete this preset",
      "spine.presetDeleteAgain": "Click again to delete",
      "spine.presetClear": "Clear",
      "spine.presetLayer": "Active",
      "spine.presetSaveTarget": "Save writes to",
      "spine.presetFailed": "Preset failed: ",
      "spine.presetChipHint": "Click to apply, click again to clear;",
      "spine.presetTagSession": "session",
      "spine.presetTagWorkspace": "workspace",
      "spine.presetTagAll": "all",
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
      "spine.knifeBigHint": "This plugin hands the span to the big cut (your current model or a local script)",
      "spine.scriptChoiceTitle": "How the big cut summarizes",
      "spine.groupScript": "Local script",
      "spine.groupScriptHint": "Every local card (small, merge, big cut) follows this version. It changes which lines survive the budget, not the knives.",
      "spine.engineTitle": "Local script version",
      "spine.engineStable": "Stable",
      "spine.engineStableHint": "First come, first kept (1.3.32 behavior): predictable, but later lines get dropped once the budget fills.",
      "spine.engineExplore": "New (experimental)",
      "spine.engineExploreHint": "Value-density selection with de-duplication: same budget keeps more failures and the last constraint. Measured: missing facts 7 → 3.",
      "spine.scriptModel": "Current model",
      "spine.scriptLocal": "Local script",
      "spine.scriptModelHint": "The model you are currently using writes the summary — not a DeepSeek official-account model. It is more coherent and selective, but makes one extra LLM request.",
      "spine.diagTitle": "Report a problem",
      "spine.diagCopy": "Copy sanitized diagnostics",
      "spine.diagIssue": "Open a GitHub issue",
      "spine.diagHint": "Diagnostics include every cutting parameter, per-knife stats and local-script card metrics, all sanitized: home directory, user name, session ids, tokens and absolute paths are stripped. Edit before posting.",
      "spine.diagLoading": "Collecting…",
      "spine.scriptLocalHint": "A local script extracts the same span with zero model calls and seq-based recall. It is less semantic; an incomplete card is refused and never falls back to the model silently.",
      "spine.scriptActive": "Active",
      "spine.scriptDraft": "Saved only after you save",
      "spine.knifeOfficialHint": "Native compaction outside the plugin",
      "spine.knifeStats": "Knife stats",
      "spine.colKnife": "knife",
      "spine.colCount": "cuts",
      "spine.colSaved": "cut",
      "spine.colShare": "share",
      "spine.colAvg": "avg",
      "spine.knifeNote": "Small, merge, and big cuts are all ours (big summarises with your current model by default, or a local script). Official = native compaction before takeover or while standing down; legacy = early cards without a knife label.",
      "spine.experimental": "experimental",
      "spine.lineClashHint": "The merge cut never gets a turn: it must start below the big-knife line — lower it or raise the big-knife line. Current",
      "spine.enableMid": "Enable the merge cut (joins whole cards, off by default)",
      "spine.groupSmallHint": "Cuts the tail before official compaction, dropping nothing.",
      "spine.groupMidHint": "When the context is huge, joins continuous old cards; skips unless it pays off.",
      "spine.groupBigHint": "Only when the first two knives cannot cut does the big cut take over: your current model by default, or a zero-LLM local script.",
      "spine.docs": "Docs",
      "spine.docsHint": "open or copy a path",
      "spine.docsReadme": "README",
      "spine.docsChangelog": "Changelog",
      "spine.newsEntry": "Changelog",
      "spine.newsTitle": "What's new",
      "spine.newsHint": "",
      "spine.newsDismiss": "Got it",
      "spine.newsToggle": "open what's new",
      "spine.newsOpen": "hide what's new",
      "spine.newsUnavailable": "changelog unreadable; showing the digest bundled in the client",
      "spine.newsCross": "Several versions behind: every entry below is new",
      "spine.newsHistory": "Older versions",
      "spine.newsHistoryHide": "Hide older versions",
      "spine.docsRepo": "Repo",
      "spine.docsIssues": "Issues",
      "spine.version": "Version",
      "spine.debug": "Debug info",
      "spine.debugHint": "collapsed by default",
      "spine.debugSid": "Session ID",
      "spine.debugCounts": "Counters",
      "spine.debugSettings": "Effective settings",
      "spine.copyJson": "Copy JSON",
      "spine.copyCounts": "Copy counter JSON",
      "spine.copySettings": "Copy settings JSON",
      "spine.sessions": "Sessions",
      "spine.sessionsHint": "sessions with cuts",
      "spine.since": "Since",
      "spine.generated": "as of",
      "spine.attempts": "Attempts",
      "spine.skipped": "skipped",
      "spine.failed": "failed",
      "spine.allEmpty": "No session has cut anything yet.",
      "spine.rangeLabel": "range",
      "spine.usualLabel": "typical",
      "spine.zeroOff": "0 = off",
      "spine.zeroPointer": "0 = follow the knife cap",
      "spine.presetSmallFirst": "Small first",
      "spine.presetSmallFirstHint": "More small cuts, big cut delayed to 600k: more continuity, bigger context",
      "spine.presetBigFirst": "Big first",
      "spine.presetBigFirstHint": "Fewer small cuts, official big cut at 200k: lower context, details via summary",
      "spine.presetDraftHint": "Presets only fill the draft; save to apply",
      "spine.expandRest": "Show the other",
      "spine.onlyRecent": "Only the newest",
      "spine.enable": "on",
      "spine.offState": "off",
      "spine.toggleHint": "Check to use it; uncheck to turn it off",
      "spine.midWarnTitle": "The merge cut is unproven",
      "spine.midWarnBody": "It joins consecutive old cards into one and recomputes tens of thousands of tokens at once. In real sessions all 16 attempts were blocked and it never fired; it can slow turns down or produce a bigger card. Not recommended for daily use.",
      "spine.midWarnAck": "I understand the risk and still want it on",
      "spine.midConfirm": "Turn on",
      "spine.midCancel": "Not now",
      "spine.valueOut": "The current value is outside the slider range; dragging clamps it",
    };

    const SPINE_KEY = "spine.cuts";
    const SPINE_CSS = [
      ".sp-root{box-sizing:border-box;height:100%;min-height:0;flex:1 1 auto;overflow-y:auto;padding:12px 14px 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}",
      // 这个页签整页铺开：宿主看到 data-conversation-composer-overlay 会把 viewArea 撑满、
      // 把输入条改成绝对定位，同时收掉正文两侧的宽度拖拽条。再按我们自己的标记把输入条藏掉，
      // 只影响压缩页——轨迹页也用了同一个属性，不能按它一刀切。
      "[data-conversation-scroll]:has([data-spine-cover])>[data-composer-seat]{display:none!important}",
      ".sp-topbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}",
      ".sp-scope{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-docrow>.sp-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}",
      ".sp-scope-btn{font:inherit;font-size:12px;padding:3px 13px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".sp-scope-btn[data-on='1']{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}",
      ".sp-topbar-sub{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".sp-topbar-reload{margin-left:8px;flex:none;font-size:11px;padding:2px 9px}",
      ".sp-version{flex:none;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;cursor:pointer;font-family:inherit;padding:1px 8px;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-master{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px 10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;user-select:none}",
      ".sp-master-on{color:var(--dsw-alias-label-primary)}",
      ".sp-master:not(.sp-master-on){border-color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-border-l1))}",
      ".sp-master-state{font-weight:600;font-variant-numeric:tabular-nums}",
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
      ".sp-bar-cut{gap:0}",
      ".sp-bar-cut .sp-seg{flex-shrink:1;box-shadow:inset -1px 0 0 rgba(0,0,0,.45)}",
      ".sp-bar-cut .sp-seg:last-child{box-shadow:none}",
      ".sp-bar-cut .sp-seg-first{margin-left:2px}",
      ".sp-seg:hover{opacity:.72}",
      ".sp-legend{display:flex;flex-wrap:wrap;gap:12px 16px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px;font-variant-numeric:tabular-nums}",
      ".sp-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}",
      ".sp-thead,.sp-trow{display:grid;grid-template-columns:1fr 58px 78px 58px 66px;gap:8px;align-items:center;padding:4px 6px}",
      ".sp-thead{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:2px}",
      ".sp-trow{font-size:12.5px;border-radius:6px}",
      ".sp-trow:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sp-trow-off{opacity:.55}",
      ".sp-knife{display:flex;align-items:center;min-width:0}",
      // 时间列 92px：改短格式后是 "11-25 00:15:33"（14 字符），54px 装不下会截成 "2026-11…"。
      ".sp-head{display:grid;grid-template-columns:16px 74px 88px 56px 1fr 92px 26px 12px;gap:10px;padding:0 6px 4px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}",
      ".sp-row{display:grid;grid-template-columns:16px 74px 88px 56px 1fr 92px 26px 12px;gap:10px;align-items:center;padding:1px 6px;border-radius:6px;font-size:11.5px;line-height:1.6}",
      ".sp-cell-time{white-space:nowrap;font-variant-numeric:tabular-nums}",
      ".sp-scroll-tall{max-height:420px;overflow-y:auto;overscroll-behavior:contain}",
      ".sp-tl-more{display:flex;justify-content:center;margin-top:6px}",
      ".sp-head>span,.sp-row>span,.sp-trow>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".sp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sp-badge{font-size:10.5px;line-height:17px;padding:0 6px;border-radius:999px;border:1px solid;text-align:center;white-space:nowrap}",
      ".sp-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}",
      ".sp-num{text-align:right;font-variant-numeric:tabular-nums}",
      ".sp-dim{color:var(--dsw-alias-label-secondary)}",
      ".sp-details summary{list-style:none;cursor:pointer}",
      ".sp-chev{display:inline-block;width:12px;flex:0 0 auto;text-align:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary);transition:transform .12s ease}",
      ".sp-details[open]>summary .sp-chev{transform:rotate(90deg)}",
      ".sp-details summary:hover .sp-chev{color:var(--dsw-alias-label-primary)}",
      ".sp-dbg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-top:6px}",
      ".sp-dbg-line{font-size:11.5px;margin:2px 0 0}",
      ".sp-dbg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:2px 14px;font-size:11px}",
      ".sp-dbg-row{display:flex;justify-content:space-between;gap:8px;padding:1px 0;border-bottom:1px dashed var(--dsw-alias-border-l2)}",
      ".sp-dbg-row>span:first-child{color:var(--dsw-alias-label-secondary)}",
      ".sp-dbg-row>span:last-child{font-variant-numeric:tabular-nums}",
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
      ".sp-docrow{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 0;border-bottom:1px dashed var(--dsw-alias-border-l2)}",
      ".sp-docrow:last-child{border-bottom:0}",
      ".sp-docactions{display:inline-flex;align-items:center;gap:6px;justify-self:end}",
      ".sp-docnote{grid-column:1/-1;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}",
      ".sp-docmiss{border-color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}",
      ".sp-doclabel{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".sp-docpre{grid-column:1/-1;max-height:260px;overflow:auto;margin:4px 0 6px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2)}",
      ".sp-docpre>pre{margin:0;font:inherit;font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}",
      ".sp-channel{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:2px 0 10px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
      ".sp-channel-label{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none}",
      ".sp-channel-text{overflow-wrap:anywhere}",
      ".sp-channel-bad{color:var(--dsw-alias-state-warning-primary,#C88A2E)}",
      ".sp-val{font-size:11px;color:var(--dsw-alias-label-primary)}",
      ".sp-doclink{color:var(--dsw-alias-state-business-primary);text-decoration:none}",
      ".sp-detail-row{display:grid;grid-template-columns:88px 1fr auto;gap:8px;align-items:center;font-size:11.5px}",
      ".sp-preset{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px}",
      ".sp-field-head>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".sp-value{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".sp-value-out{color:var(--dsw-alias-state-warning-primary,#C88A2E)}",
      ".sp-value-off{color:var(--dsw-alias-label-secondary);font-weight:400}",
      ".sp-mini{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none;flex:0 0 auto}",
      ".sp-mini input{margin:0}",
      ".sp-mini-on{color:var(--dsw-alias-label-primary)}",
      ".sp-range{flex:1 1 auto;width:100%;height:14px;margin:0;padding:0;background:transparent;cursor:pointer;accent-color:var(--dsw-alias-state-business-primary,#6F9FE8)}",
      ".sp-range:disabled{opacity:.45;cursor:not-allowed}",
      ".sp-range-ends{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-top:-2px}",
      ".sp-preset-row{gap:5px}",
      ".sp-preset-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-right:auto}",
      ".sp-btn-plus{font-weight:700;min-width:26px;justify-content:center;padding:2px 6px}",
      ".sp-btn-mini{font-size:10px;padding:1px 6px}",
      ".sp-preset-custom{margin-top:-4px}",
      ".sp-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}",
      ".sp-chip-on{border-color:transparent;background:var(--dsw-alias-button-primary-fill)}",
      ".sp-chip-on .sp-chip-btn,.sp-chip-on .sp-chip-tag{color:var(--dsw-alias-label-primary-foreground);opacity:1}",
      ".sp-chip-on .sp-chip-x{color:var(--dsw-alias-label-primary-foreground);opacity:.75}",
      ".sp-chip-ask{border-color:var(--dsw-alias-state-warning-primary,#C88A2E)}",
      ".sp-chip-btn{font:inherit;font-size:11px;display:inline-flex;align-items:center;gap:5px;padding:2px 4px 2px 9px;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}",
      ".sp-chip-btn:disabled{opacity:.45;cursor:not-allowed}",
      ".sp-chip-name{max-width:120px;overflow:hidden;text-overflow:ellipsis}",
      ".sp-chip-tag{font-size:10px;opacity:.7}",
      ".sp-chip-x{font:inherit;font-size:12px;line-height:1;padding:1px 6px 3px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".sp-chip-x:hover{color:var(--dsw-alias-state-warning-primary,#C88A2E)}",
      ".sp-preset-active{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:10px;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-preset-active>span{margin-right:auto}",
      ".sp-preset-form{display:flex;flex-direction:column;gap:8px;padding:10px;margin-bottom:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}",
      ".sp-form-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".sp-scope-row{display:flex;gap:6px;flex-wrap:wrap}",
      ".sp-preset-form .sp-preset{margin-bottom:0}",
      ".sp-field-range{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}",
      ".sp-choice{margin-bottom:10px}",
      ".sp-choice-row{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 2px}",
      ".sp-choice-on{border-color:var(--dsw-alias-brand-primary,#4C8DF6);color:var(--dsw-alias-brand-primary,#4C8DF6);font-weight:600}",
      // sp-field-hint 是 10.5px + dimmed，在深色底上几乎融进背景（用户实测看不清）。
      // 这两行是「选哪个」的唯一说明，必须能读：抬字号、用 secondary、给一块底。
      ".sp-choice-hint{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);padding:6px 8px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;margin-top:4px}",
      ".sp-choice-now{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}",
      ".sp-choice-now b{color:var(--dsw-alias-label-primary);font-weight:600}",
      ".sp-warn{margin:6px 0 10px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-state-warning-primary,#C88A2E);background:rgba(200,138,46,.08)}",
      ".sp-warn-title{font-size:12px;font-weight:600;color:var(--dsw-alias-state-warning-primary,#C88A2E);margin-bottom:4px}",
      ".sp-warn-body{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);margin-bottom:6px}",
      ".sp-warn-actions{display:flex;align-items:center;gap:6px}",
      ".sp-note{margin-top:8px;padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l2);font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
      // 本版更新：浮层，不占文档流——点开时压在面板上方，关掉就消失，下面的卡片不会跳动。
      // 遮罩只负责「点外面收起来」，不压暗也不吃滚动，看着还是原来的面板。
      ".sp-news-scrim{position:fixed;inset:0;z-index:59;background:transparent}",
      ".sp-news-layer{position:fixed;top:64px;right:24px;z-index:60;width:min(780px,calc(100vw - 48px));pointer-events:none}",
      ".sp-news{border-color:var(--dsw-alias-state-info-primary,#4C8DF6);padding:14px 16px;margin:0;pointer-events:auto;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.32)}",
      ".sp-news-top{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap}",
      ".sp-news-title-main{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".sp-news-ok{flex:none;font-size:11px;padding:2px 9px;margin-left:auto}",
      // 入口只给最新版：历史版本藏在下面这个按钮里，点开才列旧版本。
      ".sp-news-history{margin-top:10px;font-size:11px;padding:3px 10px;color:var(--dsw-alias-label-secondary)}",
      // 内容高到读不完时自己滚：限高 + 细滚动条，滚轮hover在这块上就不会带动整页。
      ".sp-news-body{max-height:min(66vh,640px);overflow-y:auto;overscroll-behavior:contain;padding-right:6px;scrollbar-width:thin}",
      ".sp-news-body::-webkit-scrollbar{width:8px}",
      ".sp-news-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:4px}",
      ".sp-news-body::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-secondary)}",
      ".sp-news-item{padding:10px 0 2px;border-top:1px dashed var(--dsw-alias-border-l2)}",
      ".sp-news-item.sp-news-first{border-top:0;padding-top:0}",
      ".sp-news-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
      ".sp-news-ver{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
      ".sp-news-date{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".sp-news-title{margin-top:2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".sp-news-list{margin:5px 0 0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}",
      ".sp-news-list li{margin-bottom:4px}",
      ".sp-news-entry{flex:none;font-size:11px;padding:2px 10px}",
      ".sp-news-entry-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-info-primary,#4C8DF6)}",
      // grid-column:1/-1 是关键：.sp-docrow 是三列网格（标签 / 路径 / 按钮），
      // 少了这行预览会被塞进 76px 的标签列，文字挤成一条竖线。
      ".sp-doc-trunc{grid-column:1/-1;font-size:10.5px;color:var(--dsw-alias-label-secondary);padding:2px 0 4px}",
      ".sp-doc-body{grid-column:1/-1;margin-top:6px;max-height:46vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}",
      ".sp-doc-h1{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:14px 0 6px}",
      ".sp-doc-h1:first-child{margin-top:0}",
      ".sp-doc-h2{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);margin:10px 0 4px}",
      ".sp-doc-p{margin:0 0 6px;font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}",
      ".sp-doc-ul{margin:0 0 8px;padding-left:18px;font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}",
      ".sp-doc-ul li{margin-bottom:3px}",
    ].join("\n");
    // 五类刀法：小刀 / 中刀 / 大刀 都是本插件动的手（大刀借用官方摘要），
    // 官方是插件接管前后的原生压缩，旧卡片是我们早期没记刀名的卡。
    const KNIFE_ORDER = ["small", "merge", "big", "official", "plugin"];
    const CJK_TEXT = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

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
    /** 时间线默认只画最近几刀；几十刀全铺开会把面板撑成一条长龙。 */
    const TL_PREVIEW = 10;
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
        // 大刀怎么归纳：当前模型摘要 / 本地脚本卡片。两选一，写进 officialScript。
        // 不是滑块：它不是连续量，也没法「拖一半」。
        choice: "officialScript",
        keys: ["officialAbove", "officialCooldownMs", "bigGate", "keepRounds", "keepRoundTokens"],
      },
      {
        id: "script",
        title: "spine.groupScript",
        hint: "spine.groupScriptHint",
        // 本地脚本版本：小刀、中刀、大刀的卡片都吃这个开关。
        choice: "scriptEngine",
        keys: [],
      },
      // 实验性功能放最后：默认收起也不抢眼，开开关才生效。
      {
        id: "mid",
        title: "spine.knifeMerge",
        hint: "spine.groupMidHint",
        experimental: true,
        // 实验性：默认收起，点标题再展开——不占地方，也不会让人误开。
        collapsible: true,
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

    /** 旋钮值的显示单位：毫秒转时间、比例转百分比，其余按 token 格式。 */
    function fmtKnobValue(name, value) {
      const n = Number(value) || 0;
      if (String(name).endsWith("Ms")) {
        if (!n) return "0";
        if (n < 60000) return Math.round(n / 1000) + "s";
        if (n < 3600000) return Math.round(n / 60000) + "min";
        return (n / 3600000).toFixed(n % 3600000 ? 1 : 0) + "h";
      }
      if (name === "spanBandRatio") return n ? (n * 100).toFixed(n < 0.1 ? 1 : 0) + "%" : "0";
      return fmtTokens(n);
    }

    /** 一行「范围 … · 常用 …」，0 有特殊含义的旋钮再补一句。 */
    function knobRange(t, name, metaOverride) {
      const meta = metaOverride || KNOB_META[name];
      if (!meta) return "";
      const span = (from, to) => fmtKnobValue(name, from) + "–" + fmtKnobValue(name, to);
      let text = t("spine.rangeLabel") + " " + span(meta.min, meta.max)
        + " · " + t("spine.usualLabel") + " " + span(meta.usual[0], meta.usual[1]);
      if (meta.zero) text += " · " + t(meta.zero);
      return text;
    }

    function fmtClock(ms) {
      const n = Number(ms) || 0;
      if (!n) return "—";
      const d = new Date(n);
      const two = (v) => String(v).padStart(2, "0");
      // 面板上并排看几刀时，只有时分秒看不出是哪天（跨天的会话全糊在一起）。
      return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate())
        + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
    }

    /**
     * 时间线表格专用的短时间：MM-DD HH:mm:ss。
     *
     * 表格里一格只有 92px，塞不下 19 字符的完整年份（实测被截成 "2026-11…"）。
     * 所以这里省掉年份，但完整时间挂在单元格 title 上；面板别处（KPI、最近一刀、
     * 保存时间、卡片截断时间）仍用 fmtClock 的完整 YYYY-MM-DD HH:mm:ss。
     */
    function fmtRowTime(ms) {
      const n = Number(ms) || 0;
      if (!n) return "—";
      const d = new Date(n);
      const two = (v) => String(v).padStart(2, "0");
      return two(d.getMonth() + 1) + "-" + two(d.getDate())
        + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
    }

    function copyText(text) {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
      } catch {}
    }

    // 路径是「这台机器上的东西」：面板只露尾巴，完整路径留在 title 与复制里。
    function shortPath(value) {
      const text = String(value || "");
      if (!text) return "";
      const sep = text.indexOf("\\") >= 0 ? "\\" : "/";
      const parts = text.split(sep).filter(Boolean);
      if (parts.length <= 4) return text;
      return "…" + sep + parts.slice(-3).join(sep);
    }

    /**
     * 打开本机文件：走宿主自己的 remote（和「在文件夹中显示」同一套），不自己起进程。
     * 纯 Web 宿主 / 旧宿主拿不到服务，就当打不开，调用方退回复制路径——不会白点。
     */
    let bridgeCtx = null;

    function setBridgeCtx(ctx) {
      bridgeCtx = ctx || null;
    }

    function openHostPath(path, action) {
      return Promise.resolve().then(() => {
        const target = String(path || "");
        if (!target) return { ok: false, reason: "empty" };
        let remote = null;
        try {
          remote = bridgeCtx && typeof bridgeCtx.get === "function" ? bridgeCtx.get("remote") : null;
        } catch {
          remote = null;
        }
        const session = remote && remote.session;
        if (!session || typeof session.openWorkspacePath !== "function") return { ok: false, reason: "no-remote" };
        const request = action === "reveal" ? { path: target, action: "reveal" } : { path: target };
        return Promise.resolve(session.openWorkspacePath(request)).then(
          (result) => {
            const ok = !!(result && (result.ok === true || result.opened === true));
            return ok ? { ok: true, reason: "" } : { ok: false, reason: "refused" };
          },
          () => ({ ok: false, reason: "rejected" }),
        );
      }).catch(() => ({ ok: false, reason: "threw" }));
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

    /**
     * 构成条按「一刀一段」画：同一种刀聚在一起，刀与刀之间留分割线，
     * 免得几刀同色糊成一条看不出切了几下。
     */
    function cutBars(cuts) {
      const list = (Array.isArray(cuts) ? cuts : []).filter((cut) => num(cut.tokens) > 0);
      if (!list.length) return [];
      const out = [];
      for (const kind of KNIFE_ORDER) {
        const mine = list.filter((cut) => kindOfCut(cut) === kind);
        mine.forEach((cut, index) => out.push({
          cut,
          kind,
          grow: num(cut.tokens),
          color: KNIFE_COLOR[kind] || "var(--dsw-alias-label-secondary)",
          first: index === 0 && out.length > 0,
        }));
      }
      return out;
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
     * 自己的旋钮：用滑块而不是数字框。
     *
     * 数字框的问题是「填不了也不知道该填多少」：键盘输一半就重算、不合法就悄悄吞掉，
     * 用户只能猜。滑块的上下限直接来自 KNOB_META，拖到哪就是哪，拖不动的地方就是
     * 不允许的值（冷却最低 1 分钟、大刀启用线最高 65 万），一眼看得出边界在哪。
     *
     * 位置放在组件自己的 state 里：拖动时立刻跟手，不用等配置模型回写；
     * 外部值只作为初始位置（重开面板拿最新值）。
     */
    function KnobInput(props) {
      const { t, name, label, hint, range, meta, disabled, overridden, fixed, value, onEdit, onReset, onToggle } = props;
      const lo = Number(meta && meta.min);
      const hi = Number(meta && meta.max);
      const gapped = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
      const step = meta && Number(meta.step) > 0 ? Number(meta.step) : 1;
      const raw = Number(value);
      // 「关」= 这个旋钮的 off 状态（值 0）。既然 0 不再出现在滑块上，关掉就交给旁边的小勾。
      const isOff = Boolean(meta && meta.off) && !(Number.isFinite(raw) && raw > 0);
      const showToggle = Boolean(meta && meta.off && !meta.noToggle);
      const outside = !isOff && Number.isFinite(raw) && gapped && (raw < lo || raw > hi);
      const start = gapped ? Math.min(hi, Math.max(lo, Number.isFinite(raw) ? raw : lo)) : (Number.isFinite(raw) ? raw : 0);
      const [pos, setPos] = React.useState(start);
      // 外部改了值（点预设、按复位、桥加载完）要让滑块跟过去；拖动时值也是自己写回去的，
      // 这条同步只会在「值真的变了」时触发一次。
      const lastExternal = React.useRef(start);
      React.useEffect(() => {
        if (start === lastExternal.current) return;
        lastExternal.current = start;
        setPos(start);
      }, [start]);
      const shown = Number.isFinite(pos) ? pos : start;
      return h("div", { className: "sp-field" },
        h("div", { className: "sp-field-head" },
          h("span", { className: "sp-field-title", title: label }, label),
          showToggle
            ? h("label", { className: "sp-mini" + (isOff ? "" : " sp-mini-on"), title: t("spine.toggleHint") },
              h("input", {
                type: "checkbox",
                "data-knob": name,
                "aria-label": label,
                checked: !isOff,
                disabled,
                onChange: (event) => onToggle?.(Boolean(event.target.checked)),
              }),
              h("span", null, t("spine.enable")))
            : null,
          overridden ? h("span", { className: "sp-tag" }, t("overridden")) : null,
          fixed ? h("span", { className: "sp-tag sp-tag-warn", title: t("spine.cfgFixed") }, t("spine.fixedTag")) : null,
          h("span", {
            className: "sp-value" + (outside ? " sp-value-out" : "") + (isOff ? " sp-value-off" : ""),
            title: outside ? t("spine.valueOut") : "",
          }, isOff ? t("spine.offState") : fmtKnobValue(name, outside ? raw : shown))),
        h("div", { className: "sp-field-row" },
          h("input", {
            className: "sp-range",
            type: "range",
            "data-knob": name,
            min: String(gapped ? lo : 0),
            max: String(gapped ? hi : 100),
            step: String(step),
            value: String(isOff ? (gapped ? lo : 0) : shown),
            disabled: Boolean(disabled) || isOff,
            onChange: (event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              setPos(next);
              onEdit(String(next));
            },
          }),
          overridden ? h("button", { className: "sp-btn", disabled, onClick: onReset }, t("reset")) : null),
        h("div", { className: "sp-range-ends" },
          h("span", null, gapped ? fmtKnobValue(name, lo) : ""),
          h("span", null, gapped ? fmtKnobValue(name, hi) : "")),
        hint ? h("div", { className: "sp-field-hint" }, hint) : null,
        range ? h("div", { className: "sp-field-range" }, range) : null);
    }

    /**
     * 中刀开关：打开时先弹一段风险说明，勾了「我明白」才能点确认，二次确认后才写配置。
     * 关掉是一键的——关永远不该被拦。确认状态放在面板层，展开/收起不会把它弄丢。
     */
    function MidSwitch(props) {
      const { t, on, disabled, ask, ack, onOpen, onClose, onAck, onOff, onEnable } = props;
      return h("div", null,
        h("label", { className: "sp-switch" },
          h("input", {
            type: "checkbox",
            checked: Boolean(on),
            disabled,
            onChange: (event) => { if (event.target.checked) onOpen?.(); else onOff?.(); },
          }),
          h("span", null, t("spine.enableMid")),
          h("span", { className: "sp-tag sp-tag-warn" }, t("spine.experimental"))),
        ask
          ? h("div", { className: "sp-warn" },
            h("div", { className: "sp-warn-title" }, t("spine.midWarnTitle")),
            h("div", { className: "sp-warn-body" }, t("spine.midWarnBody")),
            h("label", { className: "sp-switch" },
              h("input", {
                type: "checkbox",
                checked: Boolean(ack),
                disabled,
                onChange: (event) => onAck?.(Boolean(event.target.checked)),
              }),
              h("span", null, t("spine.midWarnAck"))),
            h("div", { className: "sp-warn-actions" },
              h("button", {
                className: "sp-btn sp-btn-primary",
                disabled: disabled || !ack,
                onClick: () => onEnable?.(),
              }, t("spine.midConfirm")),
              h("button", { className: "sp-btn", disabled, onClick: () => onClose?.() }, t("spine.midCancel"))))
          : null);
    }

    /** 展开指示：收起点是 ▸，展开后由 CSS 转 90°。宿主不画 details 的默认三角，得自己给。 */
    function Chevron(props) {
      return h("span", {
        className: "sp-chev" + (props.className ? " " + props.className : ""),
        "aria-hidden": "true",
      }, "▸");
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
      // 官方摘要正文是英文：面板不糊英文，给一句中文说明。
      const preview = String(cut.preview || "");
      const previewText = CJK_TEXT.test(preview) ? preview : "";
      const englishOnly = !previewText && (kind === "official" || kind === "big");
      const sep = String(dir || "").includes(SEP) ? SEP : "/";
      const range = cut.start && cut.end ? cut.start + "→" + cut.end : "—";
      return h("details", { className: "sp-details" },
        h("summary", { className: "sp-row" },
          h("span", { className: "sp-dim sp-num" }, String(index)),
          h(KnifeBadge, { kind, t }),
          h("span", { className: "sp-dim sp-mono" }, range),
          h("span", { className: "sp-num sp-mono" }, fmtTokens(cut.tokens)),
          h("span", { className: "sp-dim", title: cut.model || cut.provider || "" }, cut.model || cut.provider || "—"),
          // 表格里放短格式（放得下），完整时间进 title（悬停能看到年份）。
          h("span", {
            className: "sp-dim sp-num sp-cell-time",
            title: fmtClock(cut.time),
          }, fmtRowTime(cut.time)),
          h("span", { className: "sp-num sp-dim" }, files.length ? String(files.length) : "—"),
          h(Chevron, { className: "sp-chev-row" })),
        h("div", { className: "sp-detail" },
          previewText
            ? h("p", { className: "sp-preview" }, previewText)
            : englishOnly ? h("p", { className: "sp-preview sp-dim" }, t("spine.previewEnglish")) : null,
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

    /**
     * 文档一行：文件行给「预览 / 复制路径」，地址行给「复制」（链接自己就能点开）。
     * 不再放「打开」：宿主只肯打开工作区里的路径，插件目录在 profiles 下，按钮注定失败。
     * 预览走同一条设置桥把正文读回来，直接铺在行下面——看得见，才是真能看。
     */
    /**
     * 文档预览：把 Markdown 粗读成「小标题 / 要点 / 段落」。
     * 这里的目标是能读，不是忠实还原：先把 ** 与反引号去掉，再按行分层，
     * 长段落仍是段落，要点攒成一个列表——不再把原文一股脑塞进 <pre>。
     */
    function renderDocBody(text) {
      const lines = String(text || "").split(/\r?\n/);
      const out = [];
      let list = null;
      let key = 0;
      const flush = () => { if (list) { out.push(h("ul", { className: "sp-doc-ul", key: "ul" + (key++) }, list)); list = null; } };
      for (const raw of lines) {
        const line = String(raw).replace(/\*\*/g, "").replace(/`/g, "").trimEnd();
        const trimmed = line.trim();
        if (!trimmed) { flush(); continue; }
        const head = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (head) {
          flush();
          out.push(h("div", {
            className: head[1].length <= 1 ? "sp-doc-h1" : "sp-doc-h2",
            key: "h" + (key++),
          }, head[2]));
          continue;
        }
        const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
        if (bullet) {
          if (!list) list = [];
          list.push(h("li", { key: "li" + (key++) }, bullet[1]));
          continue;
        }
        flush();
        out.push(h("p", { className: "sp-doc-p", key: "p" + (key++) }, trimmed));
      }
      flush();
      return out.length ? out : [h("p", { className: "sp-doc-p", key: "empty" }, "")];
    }

    function DocRow(props) {
      const { t, label, value, href, exists, which, preview, onPreview, loading } = props;
      if (!value) return null;
      const missing = which ? exists === false : false;
      const shown = which ? shortPath(value) : value;
      const body = href
        ? h("a", { className: "sp-path sp-doclink", href, target: "_blank", rel: "noreferrer", title: value }, shown)
        : h("code", { className: "sp-path", title: value }, shown);
      const buttons = [];
      if (which) {
        buttons.push(h("button", {
          key: "preview",
          className: "sp-btn",
          disabled: missing || loading,
          onClick: () => onPreview && onPreview(which),
        }, loading ? t("spine.previewLoading") : t("spine.preview")));
        buttons.push(h("button", { key: "copy", className: "sp-btn", onClick: () => copyText(value) }, t("spine.copyPath")));
      } else if (href) {
        buttons.push(h("button", { key: "copy", className: "sp-btn", onClick: () => copyText(value) }, t("spine.copy")));
      }
      const open = preview && preview.which === which ? preview : null;
      return h("div", { className: "sp-docrow" },
        h("span", { className: "sp-doclabel" }, label),
        body,
        h("span", { className: "sp-docactions" }, buttons),
        missing ? h("span", { className: "sp-docnote sp-docmiss" }, t("spine.missing")) : null,
        // 预览必须自己是网格的直接子元素：套一层 div 会让 grid-column 作用在错误的元素上，
        // 预览被塞回 76px 的标签列，文字挤成一条竖线。
        open && open.text
          ? h("div", { className: "sp-doc-body", "data-doc-body": which || "", key: "body" }, renderDocBody(open.text))
          : null,
        open && open.truncated
          ? h("div", { className: "sp-docnote sp-doc-trunc", key: "trunc" }, t("spine.previewTruncated"))
          : null);
    }
    /** 「上次读到哪个版本」：只记版本号，别的不存，跨升级一次能看完几版。 */
    const NEWS_SEEN_KEY = "spine.news-seen";
    /**
     * 内嵌的最近几版要点。宿主那条 op=whatsnew 读不到（包内 CHANGELOG 不在、桥被拦、
     * 或宿主还是旧版）时用它兜底：更新日志不能因为一处没读到就整块消失。
     * 写法要求：一句一件、说人话、不带 markdown 标记——这里是给人看的，不是给人翻的。
     */
    const CLIENT_NEWS = [
      {
        version: "1.4.0",
        date: "2026-11-26",
        title: "本地脚本可选版本，中刀归队，反馈能带参数",
        bullets: [
          "本地脚本分「新版」和「稳定版」两个版本，默认用新版；小刀、中刀、大刀共用这一个开关。",
          "新版优先保住报错、路径、命令和你最后说的约束，同一段报错只留一条。",
          "同样预算实测：丢掉的关键事实从 7 条降到 3 条，保住的有用行从 47 条升到 52 条。",
          "稳定版就是以前的按顺序留行，想要「每次同一张卡」就切回去。",
          "中刀组默认收起了；中刀和大刀的启用线互相咬住，存反了会直接提醒「中刀永远轮不到」。",
          "「官方模型」改叫「当前模型」，避免误会成 DeepSeek 官方账号的模型。",
          "反馈按钮能带全部切割参数和刀法统计，仍然只有数字，不带一句聊天正文。",
        ],
      },
      {
        version: "1.3.32",
        date: "2026-11-26",
        title: "更新日志：右上角一点就开，浮在面板上方",
        bullets: [
          "顶栏右上角新增「更新日志」按钮，就在版本号左边；点开浮在面板上层，下面的统计不动，点浮层外面即收起。",
          "内容按「版本号 → 一句话标题 → 几条要点」排，从新到旧可上下滚，一屏能读完一整版。",
          "以前按钮点了像没反应、或者读不到记录就整块消失的毛病，一并修好了；现在面板自带要点，最少也看得到改了什么。",
        ],
      },
      {
        version: "1.3.27",
        date: "2026-11-26",
        title: "更新日志挪到右上角，排版改成给人读的",
        bullets: [
          "顶栏右上角、版本号左边多了一个「更新日志」按钮，点开随时能看，再点收起。",
          "每一版按「版本号 → 一句话标题 → 几条要点」排，不再是挤成一团的原文。",
        ],
      },
      {
        version: "1.3.26",
        date: "2026-11-26",
        title: "更新日志不会再整块消失",
        bullets: [
          "以前读不到更新记录时，这块内容会凭空不见；现在面板自带一份要点，最少也能看到改了什么。",
        ],
      },
      {
        version: "1.3.25",
        date: "2026-11-26",
        title: "安装提示改成正确的装法",
        bullets: [
          "以前给出的安装地址现在打开是网页，照它装会报错；现在直接给 npm 包名。",
        ],
      },
      {
        version: "1.3.24",
        date: "2026-11-26",
        title: "收尾停止线下限抬高，不再和小刀撞车",
        bullets: [
          "「收尾停止线」最低从 8k 抬到 32k，必须比一刀切掉的量更大，否则等于把一刀拆成两刀。",
          "常用区间改为 48k–96k；推荐档、小刀优先、大刀优先三个预设都同步改好。",
          "实现文件重新分组到 src/ 下，根目录只留宿主直接找的文件。",
        ],
      },
      {
        version: "1.3.23",
        date: "2026-11-25",
        title: "面板里可以直接报问题",
        bullets: [
          "调试卡新增「复制脱敏诊断」与「去 GitHub 提 issue」，诊断会自动抹掉家目录、会话 id 和密钥。",
          "大刀的说明文字改对了：它既可以用当前模型，也可以切成本地脚本。",
        ],
      },
      {
        version: "1.3.22",
        date: "2026-11-25",
        title: "修好了「插件起不来、压缩全停」",
        bullets: [
          "新版 Cordis（4.0.0-rc.12）下插件会直接报错退出，而官方压缩已被关掉，等于整条会话没有压缩。已修复。",
          "许可证文件改成标准 MIT，仓库页不再显示「无法识别」。",
        ],
      },
      {
        version: "1.3.20",
        date: "2026-11-24",
        title: "大刀可选当前模型或本地脚本",
        bullets: [
          "大刀默认用当前模型归纳，也可以在面板里切成零模型调用的本地脚本，不花钱。",
          "卡片和面板的时间都改成年月日完整显示，跨天不再只剩时分秒。",
          "顶栏右上角开始显示版本号。",
        ],
      },
      {
        version: "1.3.19",
        date: "2026-11-24",
        title: "真·零副本：不再为每一刀留一份全文备份",
        bullets: [
          "以前每切一刀都在磁盘留一份原文副本，现在默认不写，只记事件号，需要时从会话日志按号回读。",
          "卡片上会写明原文在会话日志的哪个事件号，不再含糊。",
        ],
      },
    ];
    /** 版本号比较：'1.3.9' < '1.3.31' 这种要按数字比，不能按字符串比。 */
    function versionRank(version) {
      return String(version || "").split(".").map((part) => Number(part) || 0);
    }
    function compareVersion(a, b) {
      const left = versionRank(a);
      const right = versionRank(b);
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const diff = (right[i] || 0) - (left[i] || 0); // 降序：新的在前
        if (diff) return diff;
      }
      return 0;
    }
    /**
     * 宿主读回的条目与内嵌要点合并：同一版本以手写的短句为准（内嵌那份是精选过的）。
     * 合并后**按版本号降序**排，不能靠拼接顺序——宿主读回的是 CHANGELOG 头几版，
     * 直接拼在前面会出现「1.3.28 排在 1.3.31 上面」这种乱序。
     */
    function mergeNews(hostEntries, digest) {
      const known = new Set(digest.map((entry) => entry.version));
      const fresh = (Array.isArray(hostEntries) ? hostEntries : [])
        .filter((entry) => entry && entry.version && !known.has(entry.version));
      const merged = [...fresh, ...digest].filter((entry) => entry && entry.version);
      return merged.sort((a, b) => compareVersion(a.version, b.version));
    }

    function readSeenVersion() {
      try { return String(globalThis.localStorage?.getItem(NEWS_SEEN_KEY) || ""); } catch { return ""; }
    }
    function writeSeenVersion(version) {
      try { globalThis.localStorage?.setItem(NEWS_SEEN_KEY, String(version || "")); } catch {}
    }

    /**
     * 本版更新卡：升级后第一眼就该知道改了什么。
     * 按版本号从新到旧最多列 12 条；点「知道了」按版本号记在本机，之后不再自动弹。
     */
    /** 升级后第一次自动展开；展开与否由面板状态管，顶栏版本号随时能再点开。 */
    function newsShouldAuto(version) {
      const current = String(version || "").trim();
      if (!current) return false;
      return readSeenVersion() !== current;
    }

    function NewsCard(props) {
      const { t, news, version, open, onClose, source, historyOpen, onToggleHistory } = props;
      const entries = news && Array.isArray(news.entries) ? news.entries : [];
      if (!open || !entries.length) return null;
      // 手动点开时不做「已看过就过滤」——过滤只归 newsShouldAuto 管，
      // 否则本机记过版本之后，按钮点了打开也是空的，看起来像没反应。
      const sorted = entries.slice().sort((a, b) => compareVersion(a.version, b.version));
      // 入口只给最新版：默认只画最新这一条，历史版本点「历史版本」再展开
      //（旧版本本来就都在仓库 CHANGELOG 里，不占主视觉）。
      const shown = historyOpen ? sorted.slice(0, 12) : sorted.slice(0, 1);
      // 当前版本以 docs.version 为准，读不到才退回第一条（已按版本号降序，一定是最新的）。
      const current = String(version || (sorted[0] && sorted[0].version) || "");
      return h("div", { className: "sp-card sp-news", "data-news": current, "data-news-source": source || "host" },
        h("div", { className: "sp-news-top" },
          h("span", { className: "sp-news-title-main" }, t("spine.newsTitle")),
          h("button", {
            className: "sp-btn sp-news-ok",
            "data-news-ok": "1",
            onClick: () => onClose && onClose(current),
          }, t("spine.newsDismiss"))),
        h("div", { className: "sp-news-body" }, shown.map((entry, index) => h("section", {
          className: "sp-news-item" + (index === 0 ? " sp-news-first" : ""),
          key: entry.version,
        },
          h("div", { className: "sp-news-head" },
            h("span", { className: "sp-news-ver" }, "v" + entry.version),
            entry.date ? h("span", { className: "sp-news-date" }, entry.date) : null),
          entry.title ? h("div", { className: "sp-news-title" }, entry.title) : null,
          Array.isArray(entry.bullets) && entry.bullets.length
            ? h("ul", { className: "sp-news-list" }, entry.bullets.slice(0, 5).map((text, i) => h("li", { key: i }, text)))
            : null))),
        sorted.length > 1
          ? h("button", {
            className: "sp-btn sp-news-history",
            "data-news-history": historyOpen ? "hide" : "show",
            onClick: () => onToggleHistory && onToggleHistory(),
          }, (historyOpen ? t("spine.newsHistoryHide") : t("spine.newsHistory")) + "（" + sorted.length + "）")
          : null);
    }

    function renderPanel(props, state, scope, bump, setScope, mid, ui) {
      const t = props.t;
      const model = props.model;
      const actions = props.actions || {};
      // 面板的配置走自己的桥（cfg），设置页那份 configForms 模型只作后备。
      // shell() 抛错 = 状态未知，按只读处理（降级）。
      const cfg = (ui && ui.cfg) || null;
      const store = (ui && ui.store) || null;
      const shell = model && typeof model.shell === "function"
        ? (() => { try { return model.shell() || {}; } catch { return null; } })()
        : null;
      const all = scope === "all";
      // 诊断按「当前这条会话」取：全部会话视图下也要能报问题，就用面板自己的 sid。
      const sidForDiag = state && typeof state.sid === "string" ? state.sid : "";
      const timelineAll = Boolean(ui && ui.timelineAll);
      const global = (state && state.global) || {};
      const sessionCuts = Array.isArray(state && state.cuts) ? state.cuts : [];
      const settings = (state && state.settings) || {};
      /**
       * 刀的上下线要互相咬住，不能各调各的：
       * - 中刀启用线（deepCutAbove）必须**低于**大刀启用线（officialAbove）——
       *   否则上下文一过大刀先出手，中刀永远轮不到，开了等于没开；
       * - 大刀启用线反过来不能低于中刀启用线，两条线至少差 1 万 token。
       * 这里只改滑块的可拖范围（加提示），不动已存的值：改值仍然要用户自己拖。
       */
      const boundedMeta = (name) => {
        const base = KNOB_META[name];
        if (!base) return base;
        const midLine = Number(settings.deepCutAbove) || 0;
        const bigLine = Number(settings.officialAbove) || 0;
        const out = { ...base };
        if (name === "officialAbove" && midLine > 0) {
          out.min = Math.min(base.max, Math.max(base.min, midLine + 10000));
        }
        if (name === "deepCutAbove" && bigLine > 0) {
          out.max = Math.max(base.min, Math.min(base.max, bigLine - 10000));
        }
        return out;
      };
      const midEnabled = Number(settings.deepCutAbove) > 0;
      const bigEnabled = Number(settings.officialAbove) > 0;
      // 已经存反了（中刀线 ≥ 大刀线）就直说会怎样，而不是让两个滑块各显示各的。
      const knifeLineClash = midEnabled && bigEnabled && Number(settings.deepCutAbove) >= Number(settings.officialAbove);
      const docs = (state && state.docs) || {};
      const allKnives = global.knives || {};
      const subtitle = all
        ? t("spine.scopeAllHint") + " " + fmtClock(global.generatedAt)
        : t("spine.scopeSessionHint");
      // 显示成 v1.3.19；版本串本身带 v 的话不重复写（vv1.3.19）。
      const versionValue = String(docs.version ?? "").trim().replace(/^v/i, "");
      // 更新日志：优先宿主读回的 CHANGELOG 头几版；读不到就用包内内嵌的要点兜底。
      // 宁可用内嵌要点，也不要整块消失——升级后必须看得到改了什么。
      const bridgeNews = cfg && cfg.news && Array.isArray(cfg.news.entries) ? cfg.news.entries : [];
      const panelNews = {
        entries: mergeNews(bridgeNews, CLIENT_NEWS),
        source: bridgeNews.length ? "host" : "embedded",
      };
      // 总开关：作用在「当前范围」上——看本会话就关本会话，切到全部会话就关全部。
      const swState = (cfg && cfg.sw) || null;
      const switchReady = Boolean(store && cfg && cfg.status === "ready");
      const masterOn = swState ? Boolean(all ? swState.global : swState.session) : true;
      const masterBusy = Boolean(cfg && (cfg.swSaving || cfg.saving));
      const masterSwitch = h("label", {
        className: "sp-master" + (masterOn ? " sp-master-on" : ""),
        title: t("spine.switchHint"),
      },
        h("input", {
          type: "checkbox",
          "data-master": all ? "all" : "session",
          checked: masterOn,
          disabled: !switchReady || masterBusy,
          onChange: (event) => {
            const next = Boolean(event.target.checked);
            if (store) void store.setSwitch(all ? "all" : "session", next, state && state.sid);
          },
        }),
        h("span", { className: "sp-master-label" }, t(all ? "spine.switchAll" : "spine.switchSession")),
        h("span", { className: "sp-master-state" }, masterOn ? t("spine.on") : t("spine.offShort")));
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
        swState ? masterSwitch : null,
        h("span", { className: "sp-topbar-sub" }, subtitle),
        // 版本号不进收起状态的文档卡：要看版本得先展开「文档与出处」，实测没人会去展开。
        // 没有版本（老宿主 / 读不到 package.json）就不画这块，不留一个空的 v。
        // 版本徽标本身就是入口：点一下展开/收起「本版更新」，随时能看，不用等下次升级。
        // 右上角：文字入口在左，版本号在右。两个都能开合同一张更新日志卡。
        versionValue
          ? h("button", {
            type: "button",
            className: "sp-btn sp-news-entry" + (ui && ui.newsOpen ? " sp-news-entry-on" : ""),
            "data-news-open": "1",
            "aria-expanded": ui && ui.newsOpen ? "true" : "false",
            title: t(ui && ui.newsOpen ? "spine.newsOpen" : "spine.newsToggle"),
            onClick: () => ui && ui.toggleNews && ui.toggleNews(),
          }, t("spine.newsEntry"))
          : null,
        versionValue
          ? h("button", {
            type: "button",
            className: "sp-version",
            "data-version": versionValue,
            "data-news-toggle": "1",
            "aria-expanded": ui && ui.newsOpen ? "true" : "false",
            title: t("spine.version") + " " + versionValue + " · " + t(ui && ui.newsOpen ? "spine.newsOpen" : "spine.newsToggle"),
            onClick: () => ui && ui.toggleNews && ui.toggleNews(),
          }, "v" + versionValue)
          : null,
        h("button", {
          className: "sp-btn sp-topbar-reload",
          title: t("spine.reloadHint"),
          onClick: () => { try { globalThis.location?.reload?.(); } catch {} },
        }, t("spine.reloadPage")));
      if (!state) {
        return h("div", { className: "sp-root", ref: rootRef, "data-spine-cover": "", "data-conversation-composer-overlay": "" }, topbar,
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
      // 本会话有逐刀记录：条上按刀切段；全部会话只有按刀法的汇总，仍按刀法分段。
      const slices = all ? [] : cutBars(sessionCuts);
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
        slices.length
          ? h("div", { className: "sp-bar sp-bar-cut" }, slices.map((seg, index) => h("div", {
            key: "cut-seg-" + index,
            className: seg.first ? "sp-seg sp-seg-first" : "sp-seg",
            style: { flexGrow: String(seg.grow), flexBasis: "0", background: seg.color },
            title: t(KNIFE_LABEL[seg.kind]) + " −" + fmtTokens(seg.cut.tokens)
              + " (" + shareText(seg.cut.tokens, totalSaved) + ")"
              + " · " + (seg.cut.start && seg.cut.end ? seg.cut.start + "→" + seg.cut.end : "—")
              + " · " + fmtClock(seg.cut.time),
          })))
          : bars.length
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
      // 默认只列最近 TL_PREVIEW 刀，其余一键展开；展开后限高滚动，不把面板撑长。
      const newestFirst = sessionCuts.map((cut, index) => ({ cut, index: index + 1 })).reverse();
      const hiddenCuts = Math.max(0, newestFirst.length - TL_PREVIEW);
      const shownCuts = timelineAll ? newestFirst : newestFirst.slice(0, TL_PREVIEW);
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
            h("span", { className: "sp-num sp-cell-time" }, t("spine.colTime")),
            h("span", { className: "sp-num" }, t("spine.colFiles")),
            h("span", null, "")),
          h("div", { className: "sp-scroll" + (timelineAll ? " sp-scroll-tall" : "") },
            shownCuts.map((row) => h(CutRow, { key: row.cut.id + "-" + row.index, cut: row.cut, index: row.index, t, dir: state.shadowDir }))),
          hiddenCuts
            ? h("div", { className: "sp-tl-more" },
              h("button", {
                className: "sp-btn",
                onClick: () => ui?.toggleTimeline?.(),
              }, timelineAll
                ? t("spine.onlyRecent") + " " + TL_PREVIEW + " " + t("spine.cutsUnit")
                : t("spine.expandRest") + " " + hiddenCuts + " " + t("spine.cutsUnit")))
            : null)
        : null;
      // 草稿 > 桥给的生效值 > 投影里的生效值。草稿在第一层，改一格就能立刻看见。
      const currentOf = (name) => {
        if (cfg) {
          const own = cfg.draft[name];
          if (own !== undefined && own !== null) return String(own);
          const effective = Number(cfg.effective[name]);
          if (cfg.effective[name] !== undefined && Number.isFinite(effective)) return String(effective);
        }
        const field = model && typeof model.field === "function"
          ? (() => { try { return model.field(name) || {}; } catch { return {}; } })()
          : {};
        const staged = field && field.text !== undefined && field.text !== null ? String(field.text) : "";
        if (staged !== "") return staged;
        const resolved = Number(settings[name]);
        return Number.isFinite(resolved) ? String(resolved) : "";
      };
      // 桥通了就能拖；桥没连上（404/断线）时明确停手，别让人对着死控件点。
      // 桥还没答话（idle/loading）时按宿主 configForms 的判断走，兼容老宿主。
      const shellWritable = Boolean(shell) && shell.writable !== false;
      // 桥连上了就一定可写（写的是文件）；否则听宿主表单的，不为「桥没装」锁死控件。
      const writable = cfg && cfg.status === "ready" ? true : shellWritable;
      const saving = Boolean((cfg && cfg.saving) || (shell && shell.saving));
      // 只有桥真的连上了（ready）才接管；连不上就退回宿主设置表单，
      // 并保留滑块可用——不能因为宿主还没重启就把整片控件锁死。
      const bridged = Boolean(store && cfg && cfg.status === "ready");
      /**
       * 两选一的表：大刀归纳器（模型/脚本）、本地脚本版本（稳定/新版）。
       * 都只写草稿，点了保存才落盘——脚本版本会直接改变卡片内容，不该偷偷换。
       */
      const CHOICE_TABLE = {
        officialScript: {
          title: "spine.scriptChoiceTitle",
          options: [
            { value: 0, label: "spine.scriptModel", hint: "spine.scriptModelHint", key: "model" },
            { value: 1, label: "spine.scriptLocal", hint: "spine.scriptLocalHint", key: "local" },
          ],
        },
        scriptEngine: {
          title: "spine.engineTitle",
          // 读不到时按默认值高亮：引擎默认就是 1（新版），面板不能显示成「稳定版」。
          fallback: 1,
          options: [
            { value: 0, label: "spine.engineStable", hint: "spine.engineStableHint", key: "stable" },
            { value: 1, label: "spine.engineExplore", hint: "spine.engineExploreHint", key: "explore" },
          ],
        },
      };

      /**
       * 大刀归纳器的两选一：当前模型 / 本地脚本。
       *
       * 不做成滑块，因为它不是连续量；也不塞进预设档——预设是「刀法策略」，
       * 而这个选项会直接决定一次大刀花不花钱，得让人自己点。
       * 和别的旋钮一样只写草稿，点了保存才落盘。
       */
      const choiceGroup = (name) => {
        const table = CHOICE_TABLE[name] || CHOICE_TABLE.officialScript;
        const title = t(table.title);
        const now = currentOf(name);
        const raw = now === undefined || now === null || now === "" ? table.fallback : Number(now);
        const picked = Number(raw) > 0 ? 1 : 0;
        const fixed = Boolean(cfg && cfg.fixed && Object.prototype.hasOwnProperty.call(cfg.fixed, name));
        // 和旋钮同一套判定：桥的草稿，或宿主表单上已改未存，都算「改了还没保存」。
        const field = model && typeof model.field === "function"
          ? (() => { try { return model.field(name) || {}; } catch { return {}; } })()
          : {};
        const dirty = Boolean(cfg && (cfg.draft && Object.prototype.hasOwnProperty.call(cfg.draft, name)
          || (store && typeof store.dirty === "function" && store.dirty(name))))
          || Boolean(field.overridden);
        const options = table.options.map((option) => ({
          value: option.value,
          label: t(option.label),
          hint: t(option.hint),
          key: option.key,
        }));
        return h("div", { className: "sp-field sp-choice" },
          h("div", { className: "sp-field-head" },
            h("span", { className: "sp-field-title" }, title),
            dirty ? h("span", { className: "sp-tag" }, t("spine.scriptDraft")) : null,
            fixed ? h("span", { className: "sp-tag sp-tag-warn", title: t("spine.cfgFixed") }, t("spine.fixedTag")) : null),
          h("div", { className: "sp-choice-row" }, options.map((option) => h("button", {
            key: option.key,
            type: "button",
            // 不用 sp-btn-primary：那是「保存」的样式钩子，面板和测试都按它找保存按钮。
            className: "sp-btn sp-choice-btn" + (picked === option.value ? " sp-choice-on" : ""),
            "data-choice": name,
            "data-value": String(option.value),
            title: option.hint,
            disabled: !writable || saving,
            onClick: () => {
              if (bridged) store.edit(name, String(option.value));
              else actions.edit?.(name, String(option.value));
              bump();
            },
          }, option.label))),
          h("div", { className: "sp-choice-hint" }, options[picked].hint),
          h("div", { className: "sp-choice-now" },
            t("spine.scriptActive") + " · ",
            h("b", null, options[picked].label)));
      };
      const knob = (name) => {
        const label = LABELS[name] || [name, ""];
        const field = model && typeof model.field === "function"
          ? (() => { try { return model.field(name) || {}; } catch { return {}; } })()
          : {};
        const fixed = Boolean(cfg && cfg.fixed && Object.prototype.hasOwnProperty.call(cfg.fixed, name));
        return h(KnobInput, {
          key: name,
          t,
          name,
          label: label[0],
          hint: label[1],
          range: knobRange(t, name, boundedMeta(name)),
          meta: boundedMeta(name),
          disabled: !writable || saving,
          overridden: (Boolean(cfg && store && store.dirty(name))) || Boolean(field.overridden),
          fixed,
          value: currentOf(name),
          onEdit: (text) => {
            if (bridged) store.edit(name, text);
            else actions.edit?.(name, text);
            bump();
          },
          onReset: () => {
            if (bridged) store.reset(name);
            else actions.resetField?.(name);
            bump();
          },
          onToggle: (checked) => {
            const meta = boundedMeta(name) || {};
            const next = checked ? String(meta.onValue ?? meta.min) : "0";
            if (bridged) store.edit(name, next);
            else actions.edit?.(name, next);
            bump();
          },
        });
      };
      const valuesOfPreset = (preset) => preset.values || null;
      const matchesPreset = (preset) => {
        const values = valuesOfPreset(preset);
        if (!values) return false;
        return Object.keys(values).every((name) => {
          const want = Number(values[name]);
          const now = Number(currentOf(name));
          return Number.isFinite(want) && Number.isFinite(now) && Math.abs(now - want) < 1e-9;
        });
      };
      const applyPreset = (preset) => {
        const values = valuesOfPreset(preset) || {};
        if (bridged) store.setMany(values);
        else for (const key of Object.keys(values)) actions.edit?.(key, String(values[key]));
        bump();
      };
      const presetCustom = () => {
        // 点「自定义档」＝切回你自己调的那套值，不是清空。没有手工记录时才退回生效值。
        const restored = bridged && typeof store.applyCustom === "function" ? store.applyCustom() : false;
        if (!restored) {
          if (bridged) store.discard();
          else actions.discard?.();
        }
        bump();
      };
      // 只按现在这套值去对预设：对上哪档就高亮哪档，对不上就是自定义。
      const activePreset = (PRESETS.find((preset) => matchesPreset(preset)) || {}).id || "custom";
      const activeLabel = t(((PRESETS.find((preset) => preset.id === activePreset) || {}).label) || "spine.presetCustom");
      // 通道状态一直在：连不上就说连不上，存了给时间，失败了给原因。
      const draftCount = cfg ? Object.keys(cfg.draft).length : 0;
      const channelText = (() => {
        if (!cfg) return t("spine.cfgDown") + t("spine.channelFile");
        if (cfg.status === "unavailable") {
          const where = shell && shell.failed ? t("spine.saveFailed") + t("spine.hostRefused") : t("spine.cfgFallback");
          return t("spine.cfgDown") + (cfg.error || t("spine.channelDown")) + " · " + where;
        }
        if (cfg.status === "idle" || cfg.status === "loading") return t("spine.cfgLoading");
        if (cfg.saveError) return t("spine.saveFailed") + cfg.saveError;
        if (cfg.saving) return t("saving");
        if (cfg.savedAt) return t("spine.savedAt") + " " + fmtClock(cfg.savedAt);
        if (draftCount) return t("spine.draftPending") + " (" + draftCount + ")";
        return t("spine.cfgReady");
      })();
      const channelLine = h("div", {
        className: "sp-channel" + (cfg && cfg.status === "unavailable" ? " sp-channel-bad" : "") + (cfg && cfg.saveError ? " sp-channel-bad" : ""),
        title: cfg && cfg.file ? cfg.file : "",
      },
        h("span", { className: "sp-channel-label" }, t("spine.cfgChannel")),
        h("span", { className: "sp-channel-text" }, channelText));
      // 自定义档：本会话 / 本工作区 / 全部会话。桥会把这条会话能看到的档一起答回来。
      const presetsInfo = (cfg && cfg.presets) || null;
      const presetRows = [];
      if (presetsInfo && presetsInfo.scopes) {
        for (const key of ["session", "workspace", "all"]) {
          const bucket = presetsInfo.scopes[key] || { active: "", items: [] };
          for (const item of bucket.items || []) {
            presetRows.push({ scope: key, item, active: bucket.active === item.id });
          }
        }
      }
      const layer = (presetsInfo && presetsInfo.layer) || null;
      const workspaceKnown = Boolean(presetsInfo && presetsInfo.workspaceKnown);
      const scopeTag = (key) => t(key === "session" ? "spine.presetTagSession" : key === "workspace" ? "spine.presetTagWorkspace" : "spine.presetTagAll");
      const scopeName = (key) => t(key === "session" ? "spine.presetScopeSession" : key === "workspace" ? "spine.presetScopeWorkspace" : "spine.presetScopeAll");
      const scopeHint = (key) => t(key === "session" ? "spine.presetScopeSessionHint" : key === "workspace" ? "spine.presetScopeWorkspaceHint" : "spine.presetScopeAllHint");
      const presetUi = (ui && ui.preset) || {};
      const presetReady = Boolean(store && cfg && cfg.status === "ready");
      const presetBusy = Boolean((cfg && cfg.presetSaving) || saving);
      const submitPreset = () => {
        if (!store) return;
        const name = String(presetUi.name || "").trim();
        if (!name) return;
        void store.savePreset(presetUi.scope || "session", name).then((ok) => { if (ok) presetUi.close?.(); });
      };
      // 真生效的档写在标题后缀上：别人看面板一眼就知道现在吃的是哪档。
      const cutPointSub = layer ? scopeTag(layer.scope) + "「" + layer.name + "」" : activeLabel;
      const presetRow = h("div", { className: "sp-preset sp-preset-row" },
        PRESETS.map((preset) => h("button", {
          key: preset.id,
          className: "sp-btn" + (activePreset === preset.id && !layer ? " sp-btn-primary" : ""),
          title: t(preset.hint),
          disabled: !writable || saving,
          onClick: () => applyPreset(preset),
        }, t(preset.label))),
        h("button", {
          className: "sp-btn" + (activePreset === "custom" && !layer ? " sp-btn-primary" : ""),
          disabled: !writable || saving,
          onClick: presetCustom,
        }, t("spine.presetCustom")),
        presetsInfo
          ? h("button", {
            className: "sp-btn sp-btn-plus",
            "data-preset-add": "1",
            title: t("spine.presetAddHint"),
            disabled: !presetReady || presetBusy,
            onClick: () => presetUi.open?.(),
          }, t("spine.presetAdd"))
          : null);
      const customRow = presetRows.length
        ? h("div", { className: "sp-preset sp-preset-row sp-preset-custom" },
          presetRows.map((row) => h("span", {
            key: row.scope + ":" + row.item.id,
            className: "sp-chip" + (row.active ? " sp-chip-on" : "") + (presetUi.confirm === row.item.id ? " sp-chip-ask" : ""),
            "data-preset-chip": row.scope,
          },
            h("button", {
              className: "sp-chip-btn",
              title: t("spine.presetChipHint") + " " + row.item.name,
              disabled: !presetReady || presetBusy,
              onClick: () => {
                if (!store) return;
                // 已经是生效档就再点一下取消，省得去别处找开关。
                void store.applyPreset(row.scope, row.active ? "" : row.item.id);
                bump();
              },
            },
              h("span", { className: "sp-chip-name" }, row.item.name),
              h("span", { className: "sp-chip-tag" }, scopeTag(row.scope))),
            h("button", {
              className: "sp-chip-x",
              "data-preset-del": row.item.id,
              title: presetUi.confirm === row.item.id ? t("spine.presetDeleteAgain") : t("spine.presetDelete"),
              disabled: !presetReady || presetBusy,
              onClick: () => {
                if (!store) return;
                if (presetUi.confirm !== row.item.id) { presetUi.setConfirm?.(row.item.id); return; }
                presetUi.setConfirm?.("");
                void store.deletePreset(row.scope, row.item.id);
                bump();
              },
            }, "×"))))
        : null;
      const presetForm = presetUi.form && presetsInfo
        ? h("div", { className: "sp-preset-form" },
          h("div", { className: "sp-form-title" }, t("spine.presetFormTitle")),
          h("input", {
            className: "sp-input",
            "data-preset-name": "1",
            value: presetUi.name || "",
            placeholder: t("spine.presetNamePlaceholder"),
            maxLength: 24,
            onChange: (event) => presetUi.setName?.(event.target.value),
          }),
          h("div", { className: "sp-scope-row" },
            ["session", "workspace", "all"].map((key) => h("button", {
              key,
              "data-preset-scope": key,
              className: "sp-btn" + ((presetUi.scope || "session") === key ? " sp-btn-primary" : ""),
              title: scopeHint(key),
              disabled: key === "workspace" && !workspaceKnown,
              onClick: () => presetUi.setScope?.(key),
            }, scopeName(key)))),
          h("div", { className: "sp-preset-hint" }, workspaceKnown ? "" : t("spine.presetWorkspaceUnknown")),
          h("div", { className: "sp-preset" },
            h("button", {
              className: "sp-btn sp-btn-primary",
              disabled: !presetReady || presetBusy || !String(presetUi.name || "").trim(),
              onClick: submitPreset,
            }, t("spine.presetSave")),
            h("button", { className: "sp-btn", onClick: () => presetUi.close?.() }, t("spine.presetCancel"))))
        : null;
      const activeRow = layer
        ? h("div", { className: "sp-preset-active" },
          h("span", null, t("spine.presetLayer") + "：" + scopeName(layer.scope) + "「" + layer.name + "」"),
          h("button", {
            className: "sp-btn sp-btn-mini",
            disabled: !presetReady || presetBusy,
            onClick: () => { if (store) void store.applyPreset(layer.scope, ""); bump(); },
          }, t("spine.presetClear")))
        : null;
      const knobsCard = h("details", { className: "sp-details sp-card" },
        h("summary", { className: "sp-card-title" }, t("spine.cutPoint"),
          h("span", { className: "sp-card-sub" }, cutPointSub),
          h(Chevron)),
        presetRow,
        customRow,
        activeRow,
        presetForm,
        cfg && cfg.presetError ? h("div", { className: "sp-channel sp-channel-bad" }, t("spine.presetFailed") + cfg.presetError) : null,
        h("div", { className: "sp-preset" },
          h("span", { className: "sp-preset-hint" }, layer
            ? t("spine.presetSaveTarget") + " " + scopeName(layer.scope) + "「" + layer.name + "」"
            : writable ? t("spine.presetDraftHint") : t("spine.readOnly")),
          h("button", {
            className: "sp-btn sp-btn-primary",
            disabled: !writable || saving,
            onClick: () => {
              if (bridged) { void store.save(); return; }
              actions.save?.();
              bump();
            },
          }, saving ? t("saving") : t("save")),
          h("button", {
            className: "sp-btn",
            disabled: saving,
            onClick: () => {
              if (bridged) { store.discard(); return; }
              actions.discard?.();
              bump();
            },
          }, t("discard"))),
        channelLine,
        KNOB_GROUPS.map((group) => {
          const head = [
            t(group.title),
            group.experimental ? h("span", { className: "sp-tag sp-tag-warn" }, t("spine.experimental")) : null,
            group.collapsible ? h(Chevron) : null,
          ];
          const body = [
            group.hint ? h("div", { className: "sp-field-hint", style: { marginBottom: "8px" } }, t(group.hint)) : null,
            group.enable
              ? h(MidSwitch, {
                t,
                on: Number(currentOf(group.enable)) > 0,
                disabled: !writable || saving,
                ask: Boolean(mid && mid.ask),
                ack: Boolean(mid && mid.ack),
                onOpen: () => mid?.open?.(),
                onClose: () => mid?.close?.(),
                onAck: (value) => mid?.setAck?.(value),
                // 开关不走草稿：关掉是安全动作，改完立刻写文件，别让「关了但没保存」再骗一次人。
                onOff: () => {
                  if (bridged) { void store.saveNow({ [group.enable]: 0 }); return; }
                  actions.edit?.(group.enable, "0"); actions.save?.(); bump();
                },
                onEnable: () => {
                  if (bridged) { void store.saveNow({ [group.enable]: Number(group.on) }); mid?.close?.(); return; }
                  actions.edit?.(group.enable, String(group.on)); actions.save?.(); mid?.close?.(); bump();
                },
              })
              : null,
            group.choice ? choiceGroup(group.choice) : null,
            // 中刀线 ≥ 大刀线时直说后果：中刀永远轮不到，开了等于没开。
            knifeLineClash && (group.id === "mid" || group.id === "big")
              ? h("div", { className: "sp-warn", "data-knife-clash": "1" },
                h("div", { className: "sp-warn-body" },
                  t("spine.lineClashHint")
                  + " " + fmtTokens(Number(settings.deepCutAbove) || 0)
                  + " ≥ " + fmtTokens(Number(settings.officialAbove) || 0)))
              : null,
            group.keys.length ? h("div", { className: "sp-fields" }, group.keys.map(knob)) : null,
          ];
          return group.collapsible
            ? h("details", { key: group.id, className: "sp-group sp-details", "data-group": group.id },
              h("summary", { className: "sp-group-title" }, head), body)
            : h("div", { key: group.id, className: "sp-group" },
              h("div", { className: "sp-group-title" }, head), body);
        }));
      const docsCard = h("details", { className: "sp-details sp-card" },
        h("summary", { className: "sp-card-title" }, t("spine.docs"),
          h("span", { className: "sp-card-sub" }, t("spine.docsHint")),
          h(Chevron)),
        h("div", { className: "sp-detail" },
          h(DocRow, {
            t, label: t("spine.docsReadme"), value: docs.readme, which: "readme",
            exists: docs.readmeExists !== false, preview: cfg && cfg.doc, loading: Boolean(cfg && cfg.docLoading),
            onPreview: (which) => { void store?.openDoc?.(which); },
          }),
          cfg && cfg.newsError
            ? h("div", { className: "sp-docnote sp-docmiss" }, t("spine.newsUnavailable") + " · " + cfg.newsError)
            : null,
          h(DocRow, {
            t, label: t("spine.docsChangelog"), value: docs.changelog, which: "changelog",
            exists: docs.changelogExists !== false, preview: cfg && cfg.doc, loading: Boolean(cfg && cfg.docLoading),
            onPreview: (which) => { void store?.openDoc?.(which); },
          }),
          h(DocRow, { t, label: t("spine.docsRepo"), value: docs.repo, href: docs.repo }),
          h(DocRow, { t, label: t("spine.docsIssues"), value: docs.issues, href: docs.issues }),
          h(DocRow, { t, label: t("spine.version"), value: docs.version })));
      const debugCard = h("details", { className: "sp-details sp-card" },
        h("summary", { className: "sp-card-title" }, t("spine.debug"),
          h("span", { className: "sp-card-sub" }, t("spine.debugHint")),
          h(Chevron)),
        h("div", { className: "sp-detail" },
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.dirLabel")),
            h("code", { className: "sp-path", title: state.shadowDir || "" }, shortPath(state.shadowDir || "—")),
            h("button", { className: "sp-btn", onClick: () => copyText(state.shadowDir || "") }, t("spine.copyDir"))),
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.debugSid")),
            h("code", { className: "sp-path" }, state.sid || "—"),
            h("span", null)),
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.settingsFile")),
            h("code", { className: "sp-path", title: (cfg && cfg.file) || "" }, shortPath((cfg && cfg.file) || "—")),
            h("button", { className: "sp-btn", onClick: () => copyText((cfg && cfg.file) || "") }, t("spine.copyPath"))),
          h("div", { className: "sp-detail-row" },
            h("span", { className: "sp-dim" }, t("spine.cfgChannel")),
            h("span", { className: "sp-val" }, cfg
              ? (cfg.status === "unavailable" ? t("spine.channelDown") + " · " + (cfg.error || "") : t("spine.channelFile") + " · " + cfg.status)
              : t("spine.channelDown")),
            h("span", null)),
          // 原始 JSON 糊在面板上没人看得懂：计数按刀法摊开，设置按旋钮名+单位摊开；
          // 要原文（贴 issue 用）就点「复制 JSON」，别让人对着一行 JSON 猜。
          h("div", { className: "sp-dbg-head" },
            h("span", null, t("spine.debugCounts")),
            h("button", {
              className: "sp-btn",
              onClick: () => copyText(JSON.stringify({ kinds: counterKinds, savedBy })),
            }, t("spine.copyCounts"))),
          h("div", { className: "sp-dbg-line" }, KNIFE_ORDER.map((kind) =>
            t(KNIFE_LABEL[kind]) + " " + String(num(counterKinds[kind]))).join(" · ")),
          h("div", { className: "sp-dbg-head" },
            h("span", null, t("spine.debugSettings")),
            h("button", { className: "sp-btn", onClick: () => copyText(JSON.stringify(settings)) }, t("spine.copySettings"))),
          h("div", { className: "sp-dbg-grid" }, Object.keys(settings).length
            ? Object.keys(settings).map((name) => {
              const off = Boolean((KNOB_META[name] || {}).off) && !(Number(settings[name]) > 0);
              return h("div", { key: name, className: "sp-dbg-row" },
                h("span", null, ((LABELS[name] || [name])[0])),
                h("span", null, off ? t("spine.offState") : fmtKnobValue(name, settings[name])));
            })
            : h("div", { className: "sp-dim" }, "—")),
          // 报问题：诊断已经在本机脱敏（家目录、用户名、会话 id、token、绝对路径），
          // 复制走剪贴板，另一个按钮拼 GitHub issue 链接，对方点开就能贴。
          h("div", { className: "sp-dbg-head" },
            h("span", null, t("spine.diagTitle")),
            h("button", {
              className: "sp-btn",
              "data-diag": "copy",
              disabled: Boolean(cfg && cfg.diagLoading),
              onClick: () => { if (store) void store.diag(sidForDiag); },
            }, cfg && cfg.diagLoading ? t("spine.diagLoading") : t("spine.diagCopy")),
            h("button", {
              className: "sp-btn",
              "data-diag": "issue",
              disabled: !(cfg && cfg.diagUrl) || Boolean(cfg && cfg.diagLoading),
              onClick: () => { if (cfg && cfg.diagUrl) window.open(cfg.diagUrl, "_blank", "noopener"); },
            }, t("spine.diagIssue"))),
          h("div", { className: "sp-field-hint" }, t("spine.diagHint")),
          cfg && cfg.diagError ? h("div", { className: "sp-channel sp-channel-bad" }, cfg.diagError) : null));
      return h("div", { className: "sp-root", ref: rootRef, "data-spine-cover": "", "data-conversation-composer-overlay": "" },
        topbar,
        // 升级后第一眼：本版改了什么。浮层显示，不占文档流。
        // 宿主读不到就用内联要点兜底，绝不整块消失。
        ui && ui.newsOpen
          ? h("div", {
            className: "sp-news-scrim",
            key: "news-scrim",
            onClick: () => ui && ui.closeNews && ui.closeNews(),
          })
          : null,
        h("div", { className: "sp-news-layer", key: "news-layer" },
          h(NewsCard, {
            t,
            news: panelNews,
            source: panelNews.source,
            version: versionValue,
            open: Boolean(ui && ui.newsOpen),
            historyOpen: Boolean(ui && ui.newsHistory),
            onToggleHistory: ui && ui.toggleNewsHistory,
            onClose: ui && ui.closeNews,
          })),
        h("div", { className: "sp-grid" }, kpis),
        composition,
        statsCard,
        timelineCard,
        knobsCard,
        docsCard,
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
      // 中刀二次确认：先要说明、再勾「我明白」、最后点确认，三步都在面板里。
      const [midAsk, setMidAsk] = React.useState(false);
      const [midAck, setMidAck] = React.useState(false);
      const [timelineAll, setTimelineAll] = React.useState(false);
      // 自定义档：新建表单（＋）、名字、范围，以及「再点一次删除」的待确认 id。
      const [presetForm, setPresetForm] = React.useState(false);
      const [presetName, setPresetName] = React.useState("");
      const [presetScope, setPresetScope] = React.useState("session");
      const [presetConfirm, setPresetConfirm] = React.useState("");
      // 配置通道：store 只建一次，订阅它拿快照；load 只在挂载时跑一次。
      // 本版更新：升级后第一次自动展开；之后收起，点顶栏版本号随时再打开。
      const [newsToggle, setNewsToggle] = React.useState(null);
      // 更新日志默认只显示最新版；这个开关管「要不要把历史版本也摊开」。
      const [newsHistory, setNewsHistory] = React.useState(false);
      const [store] = React.useState(() => createSettingsStore());
      const cfg = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const panelSid = state && typeof state === "object" && typeof state.sid === "string" ? state.sid : "";
      const docsVersion = state && state.docs && typeof state.docs.version === "string"
        ? state.docs.version.trim().replace(/^v/i, "") : "";
      const newsOpen = newsToggle === null ? newsShouldAuto(docsVersion) : Boolean(newsToggle);
      React.useEffect(() => {
        // 纯测试环境没有 document/fetch：不跑网络，保留 idle 状态（界面按宿主模型走）。
        if (typeof document === "undefined" || typeof fetch !== "function") return;
        // 带上 sid：describe 才能把「本会话开关」也一起答回来；换会话时重新问一次。
        void store.load(panelSid);
        void store.loadNews();
      }, [store, panelSid]);
      try {
        if (state && state.projectionError) throw new Error(state.projectionError);
        return renderPanel(props, state, scope, () => setTick(tick + 1), setScope, {
          ask: midAsk,
          ack: midAck,
          open: () => { setMidAsk(true); setMidAck(false); },
          close: () => { setMidAsk(false); setMidAck(false); },
          setAck: (value) => setMidAck(Boolean(value)),
        }, {
          timelineAll,
          toggleTimeline: () => setTimelineAll((value) => !value),
          // 更新日志的状态必须放在 ui 里：面板读的是 ui.newsOpen / ui.toggleNews。
          // 之前放进第 6 个参数（mid），于是 open 恒为 false、按钮点了没反应。
          newsOpen,
          newsHistory,
          toggleNewsHistory: () => setNewsHistory((value) => !value),
          toggleNews: () => { setNewsHistory(false); setNewsToggle(!newsOpen); },
          closeNews: (version) => { writeSeenVersion(version || docsVersion); setNewsToggle(false); },
          cfg,
          store,
          preset: {
            form: presetForm,
            name: presetName,
            scope: presetScope,
            confirm: presetConfirm,
            open: () => { setPresetName(""); setPresetScope("session"); setPresetConfirm(""); setPresetForm(true); },
            close: () => { setPresetForm(false); setPresetConfirm(""); },
            setName: (value) => setPresetName(String(value == null ? "" : value)),
            setScope: (value) => setPresetScope(String(value || "session")),
            setConfirm: (value) => setPresetConfirm(String(value == null ? "" : value)),
          },
        });
      } catch (error) {
        // 渲染期抛错会把整条槽位条目打成空白：兜底成一条可见提示，别让人看到白屏。
        console.error('spine: panel render failed', error);
        return h("div", { className: "sp-root", ref: rootRef, "data-spine-cover": "", "data-conversation-composer-overlay": "" },
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
        // 面板要靠宿主打开本机文档：把上下文留给渲染期用（服务取不到也不影响加载）。
        setBridgeCtx(ctx);
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
        // 面板注册得比配置服务早：apply 时 get() 可能还拿不到模型。真拿到之前返回 null，
        // 之后每次问都再试一次，避免整场会话都停在「没有模型」的状态。
        const formFor = (id) => {
          if (!id) return null;
          const cached = forms.get(id);
          if (cached) return cached;
          try {
            const built = new SettingsFormModel(ctx.configForms.get(id), fields);
            forms.set(id, built);
            return built;
          } catch { return null; }
        };
        const activeModel = () => formFor(activeId) || formFor(NS);
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
        fmtTokens, fmtClock, fmtRowTime, renderPanel, SpinePanel, SPINE_CSS,
        KNIFE_COLOR, KNOB_GROUPS, MID_ON, PRESETS, KNOB_META, knobRange, fmtKnobValue, MidSwitch,
        shortPath, DocRow, openHostPath, setBridgeCtx, createSettingsStore, postBridge,
        cutBars, CutRow, Chevron,
        NewsCard, readSeenVersion, writeSeenVersion, NEWS_SEEN_KEY, newsShouldAuto, CLIENT_NEWS, mergeNews, compareVersion,
      },
    };
  },
});