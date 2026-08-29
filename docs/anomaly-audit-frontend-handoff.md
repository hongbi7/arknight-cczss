# 异类审查前端交接（Kimi K3）

本分支已经完成异类审查的服务端规则、一万余道静态题库、10 题局内状态、计分、扫描器、主题目录与五个 API。前端仍保持原生 HTML/CSS/JavaScript：

- `public/index.html`
- `public/css/style.css`
- `public/js/app.js`

不要引入框架或前端构建步骤，不要把 `server-data/anomaly-rules.json`、`server-data/anomaly-questions.json` 或任何规则成员表复制到 `public/`。

## 可直接交给 Kimi K3 的提示词

```text
你正在修改一个已有的明日方舟工业风原生 Web 游戏。请先完整阅读 public/index.html、public/css/style.css、public/js/app.js，理解当前“终局校验 / 全域检索”的 DOM、状态管理、响应式断点、扫描线、切屏 wipe、卡片入场、终局选择和无障碍处理，再新增第三种玩法“异类审查 / ANOMALY AUDIT”。不要重构或破坏原有两种玩法，不要引入 React/Vue、第三方 UI 库或前端构建步骤。

视觉目标：延续当前明日方舟式工业终端语言——硬直角、细描边、微网格、编号、英文小字、斜切、扫描线、克制的辉光和信息密度；异类审查使用缪尔赛思与莱茵生命语义的绿色主题。建议局部变量为 --accent: #48e0a4、--accent-rgb: 72,224,164，背景仍保持当前 #080b0f / #10151b 的黑灰层级，不要把页面做成普通赛博霓虹或大面积亮绿。可以使用已有本地素材：/img/operators/e1/char_249_mlyss.webp、/img/operators/final/char_249_mlyss.webp、/img/factions/rhine.webp。缪尔赛思作为审查系统引导者和构图主元素，但不能遮挡四张答题卡；优先用渐隐遮罩、负空间、局部裁切和低饱和背景融入。保留现有字体、动效节奏和 prefers-reduced-motion 兼容。

信息架构允许你在保持整体风格一致的前提下自由设计，但必须覆盖以下完整流程：
1. 模式选择页将“终局校验 / 全域检索 / 异类审查”作为三份等权协议档案有机整合；每张卡只保留自己的主视觉，不重复使用执棋者或蛤蟆背景。缪尔赛思头部必须完整可见。
2. 点击“异类审查”后先进入审查终端，再选择“综合审查”或六个单域主题，不在模式选择卡里堆叠配置，也不提供难度选择。主题目录右侧只显示所选主题涵盖的题库大类，不展开具体规则。
3. 综合审查固定 10 题，配额为作战编制 1、身份归属 2、技能协议 2、战术特性 2、后勤履历 2、形象档案 1，并提供初始两次、每题至多一次的共性扫描；每连续答对三题奖励一次。单域审查也是 10 题，但不支持扫描。
4. 审查主界面清楚显示第 n/10 题、当前域中英标签、动态难度与升降级进度、总分、连胜和扫描剩余次数；主体四张干员卡必须使用接口给出的图片。服装品牌题会下发对应品牌皮肤，不能自行替换回 E1 图。桌面端建议 2×2 或横向 4 卡，移动端不得依赖横向溢出。
5. 选择与提交必须分离：第一次点卡只产生清楚的选中/取消状态，再点独立“确认异类”按钮才 POST /api/anomaly/answer。确认期间锁按钮避免重复请求。
6. 综合审查的扫描器点击后 POST /api/anomaly/scan，显示当前共性规则提示并明确本题最终得分乘 0.6；成功后本题不可重复用，下一题若仍有额度则恢复可用。扫描器不是排除一个选项。
7. 回答后进入证据揭示态：异类卡与三张共性卡要有不同但不过度晃眼的状态；显示规则标题/说明、四人的 evidence.value、得分拆分，以及 supportingRules（有则显示为次级符合项）。此时才出现“下一份档案”。不要自动瞬间跳题，给玩家理解规则的时间。
8. 第 10 题完成后展示评级、评级指数、挑战指数、难度履历、总分、正确数、准确率、平均用时、最高连胜和各域正确率，并提供“重新审查”和“返回协议选择”。
9. 所有网络失败、无效状态和重复点击要有现有风格的可恢复提示；始终只保存并提交服务器最新返回的 token。不要在浏览器内存构建题库或规则成员表。

交互动效方向（可以自行微调）：开题像档案装载，四卡错峰 40–70ms 入场；选中时用边框闭合、编号锁定和短扫描，不要用弹跳；确认后用一次横向审查扫描，证据逐卡显影；正确异类使用克制的蓝色边框，玩家错选仍使用红色，结算使用缪尔赛思终局立绘与莱茵 Logo 构成“审查完成”画面。所有关键状态不能只靠颜色表达，必须同时有文字、图标或描边变化。

请自行完成桌面、平板和手机布局，沿用项目 2 空格缩进、JavaScript 双引号、CSS kebab-case。实现后至少手测：综合审查两次初始扫描跨题消耗、三连对扫描奖励、任意单域无扫描、服装品牌皮肤、答错、连续快速点击确认、刷新/失效 token、移动端四卡与结算页，以及原有 sudden/endless 全流程未回归。
```

## 固定玩法与计分

- 每局固定 10 题；每题四名干员中三人满足同一规则，一人为异类。
- 六个审查域为：`roster` 作战编制、`identity` 身份归属、`skill` 技能协议、`battle` 战术特性、`logistics` 后勤履历、`visual` 形象档案。
- 作战编制不使用星级和标签；形象档案不使用 CV；整个题库不使用生日、身高、战斗经验或机密档案。
- 对外不提供难度选择，所有主题从标准审查开始；连续答对 3 题升一级，连续答错 2 题降一级，最低基础审查、最高危机审查。下一题会从实际等级对应的题库桶抽取。
- 基础、标准、危机审查的基础分依次为 100、150、220；20 秒内有线性时间奖励，最高为基础分的 40%。
- 连胜倍率每层 +5%，最多计算五层；使用扫描器后当前题总分乘 0.6；答错得 0 分并清空连胜。
- 最终评级指数由准确率占 55%、难度加权挑战指数占 45% 得出，S/A/B 阈值依次为 88/72/52。
- 系统平衡异类在四个位置的出现次数；单名干员整局最多出现两次，并尽量不在相邻题重复。单域题库的规则数不足以覆盖十题时允许规则复现，但不会复现相同题目。

## API 契约

所有 token 都是不透明字符串。客户端必须用每次响应里的新 token 覆盖旧 token。

### 开局

```http
GET /api/anomaly/new?domain=mixed
```

`domain` 为 `mixed` 或六个域 ID，默认 `mixed`。开局前可用 `GET /api/anomaly/themes` 读取七个主题、题库大类和可用规则摘要；该目录不包含稳定题目 ID 或规则 ID。

```json
{
  "version": 4,
  "mode": "anomaly",
  "config": { "domain": "mixed", "totalRounds": 10, "scannerLimit": 2, "scannerRewardEvery": 3, "difficultyUpStreak": 3, "difficultyDownStreak": 2 },
  "score": 0,
  "correctCount": 0,
  "streak": 0,
  "difficulty": { "id": "standard", "level": 2, "label": "标准审查", "labelEn": "STANDARD", "scoreMultiplier": 1.5 },
  "difficultyProgress": { "correct": 0, "wrong": 0, "correctRequired": 3, "wrongRequired": 2 },
  "token": "opaque",
  "question": {
    "round": 1,
    "totalRounds": 10,
    "difficulty": { "id": "standard", "level": 2, "label": "标准审查", "labelEn": "STANDARD", "scoreMultiplier": 1.5 },
    "domain": { "id": "battle", "label": "战术特性", "labelEn": "TACTICAL TRAIT" },
    "options": [
      { "id": "char_x", "name": "干员代号", "imageUrl": "/img/operators/e1/char_x.webp", "artKind": "e1" }
    ],
    "scannerAvailable": true,
    "scansRemaining": 2
  }
}
```

`options` 始终有四项。开题响应不会给出哪一项是异类，也不会下发规则、证据或规则成员表。

### 使用扫描器

```http
POST /api/anomaly/scan
Content-Type: application/json

{ "token": "opaque" }
```

成功响应包含新 `token`、`scannerAvailable: false`、递减后的 `scansRemaining` 和 `hint: { title, description }`。本题不能重复扫描；下一题若综合审查仍有额度，`question.scannerAvailable` 会恢复为 `true`。综合审查初始拥有两次扫描，每连续答对三题由答题响应的 `result.scannerReward: 1` 奖励一次；单域主题始终不可扫描。

### 确认答案

```http
POST /api/anomaly/answer
Content-Type: application/json

{ "token": "opaque", "pickId": "char_x" }
```

成功响应包含新 token、累计分数及：

```json
{
  "finished": false,
  "result": {
    "correct": true,
    "chosenId": "char_x",
    "oddId": "char_x",
    "rule": { "id": "...", "domain": "battle", "title": "...", "description": "..." },
    "evidence": [
      { "id": "char_x", "name": "干员代号", "match": false, "value": "该干员的实际值" }
    ],
    "supportingRules": [
      { "id": "...", "title": "...", "description": "..." }
    ],
    "points": {
      "base": 150,
      "timeBonus": 43,
      "streakMultiplier": 1.1,
      "hintMultiplier": 1,
      "total": 212
    },
    "difficulty": { "id": "standard", "level": 2, "label": "标准审查", "labelEn": "STANDARD", "scoreMultiplier": 1.5 },
    "nextDifficulty": { "id": "standard", "level": 2, "label": "标准审查", "labelEn": "STANDARD", "scoreMultiplier": 1.5 },
    "difficultyChange": 0,
    "elapsedMs": 5700
  }
}
```

`evidence` 始终有四项。第十题时 `finished` 为 `true`，响应额外带 `summary`：`rating`、`ratingIndex`、`challengeIndex`、`score`、`correctCount`、`accuracy`、`averageElapsedMs`、`maxStreak`、`highestDifficulty`、`difficulties`、`domains`；此时不再调用 next。

### 下一题

```http
POST /api/anomaly/next
Content-Type: application/json

{ "token": "opaque" }
```

只能在非终局题回答完成后调用，返回新 token 和与开局相同结构的 `question`。

通用错误为 `{ "error": "错误码" }`，状态码通常为 400。需要覆盖：`invalid_domain`、`invalid_session`、`invalid_phase`、`invalid_pick`、`scan_unavailable`、`question_bank_unavailable`、`bad_request`、`request_too_large`、`method_not_allowed`。

## 验收边界

- 原有 `sudden`、`endless` 必须完整可用。
- 异类审查开题界面和浏览器状态不能出现稳定题目 ID、`ruleId`、`oddId`、`majorityIds`、`evidence`、规则成员或正确项标记。
- 不读取或公开 `server-data/`，不新增前端题库 JSON。
- 选择态、提交中、回答揭示、扫描已用、终局、错误态均可见且可恢复。
- 键盘焦点、按钮禁用态、`aria-live` 和 `prefers-reduced-motion` 不低于现有页面水平。
