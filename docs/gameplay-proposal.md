# 猜干员 Gameplay 提升方案（调研 + 提案，未改代码）

> 状态：调研完成，等待评审。数据来源为公开仓库与社区 wiki，全部调研证据见文末附录。

## 一、痛点诊断（基于本地 425 名干员数据的量化分析）

| 痛点 | 数据证据 |
| --- | --- |
| 战斗经验 / 生日"没印象" | 生日有 **232 个不同值**（近乎均匀，信息量 7.47 bit 全维度最高，但玩家记不住）；战斗经验 31 个不同值 + 37 个未知；只能"蒙一个看箭头"，体验差 |
| 种族 / 出身地无大类分层 | 种族 45 种（25 未公开 + 13 未知 + 8 空）；出身地 33 种（20 未公开 + 17 未知）；两者都是纯 `exact/wrong` 二值，猜错时零信息 |
| 标签维度弱 | 全池只有 **19 种标签**，最大同标签组 `[输出]` 有 65 人；整组相同才判绿，命中率极低 |
| 冷门干员叫不出来 | 全池 425 人；`hot` 标志 = 五星及以上，覆盖 **78%**（331 人），几乎失去"热门"区分度；真正的窄池只有六星 136 人 |
| 深层结论 | 模拟显示：**随机猜 1 次，理论上候选已收敛到平均约 4 人**；20 问贪心模拟 **平均 8.9 问收敛到唯一解**。游戏信息量极大，难在"人脑算不动、记不住"，而非信息不足 |

→ 设计方向：**把隐性信息显性化**（服务端算好"剩余候选数"给玩家看），**把无印象维度换成玩家真正熟悉的维度**（阵营 / 声优 / 画师 / 技能 / 台词 / 立绘），**给纯二值维度加"接近"层级**（大类提示），**给叫不出名字的玩家一条不依赖命名的路径**（20 问模式）。

## 二、可用的新数据资产（调研结论）

| 数据 | 可用性 | 来源 | 获取成本 |
| --- | --- | --- | --- |
| 阵营/势力（teamId/groupId/nationId） | ✅ 解包数据有英文代号，中文队名需手工映射（~40 条） | `character_table.json`（CN dump）；队名对照：[wiki.gg Subfaction/data](https://arknights.wiki.gg/wiki/Module:Subfaction/data)、[fandom Faction](https://arknights.fandom.com/wiki/Faction) | 低（字典一次维护） |
| 声优 cvName | ✅ 解包数据直接有 | `charword_table.json`；另 [Ark-Voice](https://github.com/isHarryh/Ark-Voice) 元数据 | 低 |
| 台词（voiceTitle + voiceText） | ✅ 解包数据直接有（任命助理/交谈1/晋升…） | `charword_table.json`（CN dump） | 低 |
| 技能名（真银斩/过载…） | ✅ 解包数据直接有 | `skill_table.json` + `character_table.skills[]` | 低 |
| 立绘素材 | ✅ 已在本仓库，覆盖 **425/425**（E1）+ 360 款皮肤 | 本地 `public/img/operators` | 零 |
| 画师 | ⚠️ 解包无，需抓 wiki | [PRTS 画师一览](https://prts.wiki/w/ILLUST)、[fandom Illustrators](https://arknights.fandom.com/wiki/Illustrators) | 中（一次性抓取） |
| 实装时间 | ⚠️ 解包无，wiki 有完整表 | [PRTS 干员上线时间一览](https://prts.wiki/w/%E7%94%A8%E6%88%B7:Hydrogina/castle/%E5%B9%B2%E5%91%98%E4%B8%8A%E7%BA%BF%E6%97%B6%E9%97%B4%E4%B8%80%E8%A7%882) | 中（一次性抓取） |
| 种族大类（猫科/犬科/天使/恶魔…） | ⚠️ 无现成 JSON，有权威层级资料 | [fandom Race 系列页](https://arknights.fandom.com/wiki/Race/Ancient)、[萌娘百科 种族](https://zh.moegirl.org.cn/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F/%E7%A7%8D%E6%97%8F) | 低（手工字典，~45→12 类） |
| 热门度/持有率 | ⚠️ 有时间性、偏六星 | [penguin-stats Matrix API](https://developer.penguin-stats.io/public-api/api-v2-instruction/matrix-api)、[一图流练度统计](https://ark.yituliu.cn/survey/operator-progression-statistics) | 中（定期手工刷新） |
| 解包数据仓库 | ✅ CN/EN dump 双份 | [b331z3bub/Kengxxiao-ArknightsGameData](https://github.com/b331z3bub/Kengxxiao-ArknightsGameData)（CN）、[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（EN）、字段权威文档 [OpenArknightsFBS](https://github.com/MooncellWiki/OpenArknightsFBS) | — |

## 三、方案清单（P0 → P2 按优先级）

### P0 · 零新数据、快速见效（估计合计 1 周内）

**A1 剩余候选数反馈（最高性价比）**
每猜一次，服务端用已揭示的全部 12 维约束（含方向/接近语义）算出"仍满足条件的候选干员数"，随响应返回并显示（如"剩余候选：37 人"）。
- 价值：把 425 行档案的心算交给服务端，玩家立刻获得"我缩小了多少"的进度感，直接回应"很难排除锁定"。
- 防作弊：该计数是**已返回维度的纯函数**（拿着 wiki 的脚本本来就能算出来），不引入任何新信息类。
- 门槛：`lib/game.js` 加一个 `consistent()` 谓词 + 计数，约半天。

**A2 二十问模式（解决"冷门干员叫不出来"）**
玩家不输名字，改为每回合从服务端固定问题目录里挑一个问题（"站位是近战吗？""星级 ≥ 6？""是感染者吗？""种族是菲林？""身高 ≥ 170？"…），服务端回答是/否 + 剩余候选数；候选 ≤ 4 时进入复用现有 `/api/choices` 的四选一终局。本地模拟：贪心提问**平均 8.9 问、最多 10 问收敛到唯一解**，节奏像 Akinator。
- 价值：全程不需要玩家想起任何名字，冷门干员不再是障碍；且天然展示"分层排除"的乐趣。
- 防作弊：问题必须是服务端目录内的 id，禁止任意谓词（防"名字以 X 开头"类探测）；单问回答的信息 ≤ 现有猜一次的信息。

**A3 每日挑战 + 可分享结果卡（留存/传播）**
服务端以日期为种子确定性出题（`sha256(GAME_SECRET + YYYY-MM-DD)` 映射池索引），全员同题；结算生成无名字的 emoji 网格（🟩吻合 🟨接近 🟥不符 ⬛未知）供复制分享。
- 参考：[ak-guess](https://github.com/lie5860/ak-guess)（NGA [干员猜猜乐 thread](https://bbs.nga.cn/read.php?tid=31057740) 证明该形式催生了[开局策略研究](https://ngabbs.com/read.php?tid=40595921)）；Wordle 留存模式（[每日种子 + 分享网格](https://thehardcopy.co/wordles-viral-success-is-based-on-design/)）。
- 防作弊：分享卡只含颜色格，不含名字，任意时刻分享都不泄底。

**A4 无尽模式补上"胜利终点"**
无尽模式现在只能靠盲猜名字。加"剩余候选 ≤ 4 → 自动进入四选一终局"（复用 choices/pick），给无尽一个满意的收敛结局；计分 = 猜测次数。

**A5 局内干员图鉴 + 收集进度（缓解记名难）**
游戏内提供可浏览图鉴（立绘缩略图 + 名字 + 职业/星级/阵营筛选），点击图鉴里的干员直接提交猜测；跨局累计"点亮"已猜过的干员，展示收集度 % 与里程碑（100/200/300/425）。
- 价值：看见名字就能猜，弥补"叫不出来"；同时给无尽模式一个元目标。
- 实现：纯前端（`names.json` + 已有立绘 + localStorage），约 1–2 天。

**A6 难度池**
开局可选池：全部 425 / 五星及以上 331 / 六星 136；token 记录池 id，choices/pick 同池。后续（P2）可加"热门池"（由持有率数据手工刷新）。

**A7 情报解锁提示（把无印象维度变成奖励）**
每猜满 2–3 次，服务端免费揭示谜底的一个"无印象维度"真值（生日 / 战斗经验，或后续的实装时间），标注"情报解锁"。玩家不用背生日，照样能用它排除（配合 A1 的候选数反馈即可核对）。
- 价值：保留 12 维完整性，同时把最劝退的两个维度转成正反馈。
- 防作弊：显式设计内的揭示，与揭晓按钮同属授权信息，不构成泄漏；sudden 模式每用一次扣 1 次机会。

**A8 硬核模式（老玩家纵深）**
开关：数字/日期维度只显示 exact/wrong（隐藏 ↑↓ 与接近提示），并强制后续猜测必须满足已确认的绿色维度（Wordle hard mode）。回应 NGA 社区"最优开局把游戏解完了"的抱怨（[寒芒克洛丝开局帖](https://ngabbs.com/read.php?tid=40595921)）。

### P1 · 解包数据新维度 / 新模式（估计 1–2 周）

**B1 阵营（势力）维度** —— 替换"战斗经验"进默认 12 维
- 数据：CN dump `character_table.json` 的 `teamId`（辅以 groupId/nationId 兜底）+ 手工 `TEAM_ZH` 字典（企鹅物流/莱茵生命/黑钢国际/喀兰贸易/深海猎人/龙门近卫局…约 40 条，从 [wiki.gg Subfaction/data](https://arknights.wiki.gg/wiki/Module:Subfaction/data) 与 [fandom Faction](https://arknights.fandom.com/wiki/Faction) 整理）。
- 语义：exact/wrong（同职业维度），无阵营 → unknown；另可开"阵营池"。
- 玩家熟悉度远高于战斗经验，且是官方设定、天然带"组织分层"感。

**B2 声优（CV）维度** —— 替换"生日"进默认 12 维（生日移入 A7 情报解锁）
- 数据：`charword_table.json` 的 `cvName`（[Ark-Voice](https://github.com/isHarryh/Ark-Voice) 元数据同源）；机器人无 CV → unknown。
- 语义：exact/wrong。粉丝对"这个声优还配过谁"的记忆远强于生日；命中时信息量极大（CV 池上百人）。

**B3 技能模式（LOLdle Ability 式）**
顶部公开展示谜底的 3 个技能名（如"过载 / 扫射模式 / 天使的祝福"），玩家仍按现有 12 维档案盘猜人；技能名是公开数据（解包可得），展示不泄底，但对熟悉游戏的玩家是极强的"记忆钩子"。参考 [LoLdle 的 Ability 模式](https://dlegames.org/game/loldle)。

**B4 台词模式（LOLdle Quote 式，先文本后音频）**
公开展示谜底的一条台词（"任命助理：……"）或语音标题，猜干员；反馈盘复用现有档案盘。
- 第一阶段纯文本（`charword_table.json` 的 voiceTitle/voiceText，零版权风险，事实字符串）。
- 第二阶段可选音频（`voiceAsset` → [Ark-Voice](https://github.com/isHarryh/Ark-Voice) / [deepghs/arknights_voices_zh](https://huggingface.co/datasets/deepghs/arknights_voices_zh) 音频；音频 © 鹰角，非商业粉丝向可外链使用，先小规模试点）。
- "听声识人"是玩家社区公认的高乐趣题型（官方 CV 页 [ak.hypergryph.com/cvintro](https://ak.hypergryph.com/cvintro/) 亦印证声优是卖点）。

**B5 种族大类提示层**
手工字典把 45 种族映射到 ~12 大类（猫科/犬科/鸟/天使/恶魔/熊/兔/马/牛/羊/鹿/蛇/鼠/水族/机械/未知…）。种族维度增加"接近"档：猜的种族与谜底不同但**同大类 → 黄色"同类"**，仍隐藏具体种族。等价于身高"相差 15cm 内"的提示层级，让种族从"猜错零信息"变成"猜错也有方向"。

**B6 剪影模式（官方同款，零新资产）**
用现有 E1 立绘做纯黑剪影（CSS `filter: brightness(0)`），猜错一次提升透明度/缩放（Squirdle 式），猜满 N 次进四选一。官方[干员猜猜乐](https://www.9game.cn/news/6602473.html)（剪影 + 每日挑战）已验证该题型，社区也有 [Sporcle 剪影题](https://fr.sporcle.com/games/HoloMaru/arknights-characters-by-silhouette/results)。

**B7 细节裁切模式（可选加分项）**
对 E1 立绘做眼睛/武器等局部裁切出题（[JetPunk 同款](https://www.jetpunk.com/user-quizzes/1718413/guess-the-arknights-operator-by-their-weapon)），适合周更轮换题型。

### P2 · wiki 深水区（按需推进）

- **C1 画师维度 / 制作人员模式**：抓取 [PRTS 画师一览](https://prts.wiki/w/ILLUST) 生成 operator→画师 JSON；可做第 13 维或"画师+CV 双线索"模式。wiki 为 CC BY-SA/NC，只存事实字符串并注明来源。
- **C2 实装时间维度**：抓取 [PRTS 上线时间表](https://prts.wiki/w/%E7%94%A8%E6%88%B7:Hydrogina/castle/%E5%B9%B2%E5%91%98%E4%B8%8A%E7%BA%BF%E6%97%B6%E9%97%B4%E4%B8%80%E8%A7%882)，做 before/after 方向提示（"比开服更早/更晚"），90 天内标黄"同期"——"开服老干员 vs 新干员"玩家普遍有印象。
- **C3 别名/外号搜索**：给 `names.json` 加昵称字段（白咕咕→白面鸮 等，萌娘/社区整理），解决"知道外号不知道本名"。
- **C4 热门度分层**：用 [penguin-stats](https://developer.penguin-stats.io/public-api/api-v2-instruction/matrix-api) / [一图流](https://ark.yituliu.cn/survey/operator-progression-statistics) 持有率数据手工刷新"热门池"与建议排序权重（现 `hot` 78% 覆盖太宽）。
- **C5 音频台词模式升级**：见 B4 第二阶段。

## 四、维度改造建议（默认 12 维的去留）

| 维度 | 处置 | 理由 |
| --- | --- | --- |
| 职业/子职业/星级/站位/性别/身高/矿石病 | 保留 | 信息有效且可记忆（身高有方向+接近，矿石病对半切） |
| 标签 | 保留并优化 | 保留（少数场景好用），优化为"交集药丸 + 整组相同才绿"已较好，后续可考虑用阵营替代 |
| 战斗经验 | 移出默认维度 → 情报解锁提示 | 31 值 + 37 未知，玩家无印象 |
| 生日 | 移出默认维度 → 情报解锁提示 | 信息量最大但最不可记忆 |
| 出身地 | 保留 | 国家名玩家普遍知道（维多利亚/乌萨斯/炎…），P2 可加"区域大类" |
| 种族 | 保留 + 大类接近档（B5） | 增加同大类提示后猜错也有信息 |
| （新增）阵营 | 进入默认 12 维（B1） | 官方设定、有组织分层、玩家熟悉 |
| （新增）声优 | 进入默认 12 维（B2） | 粉丝记忆强、命中信息量大 |

## 五、路线图

1. **第 1 周（P0）**：A1 剩余候选数 → A4 无尽终局 → A3 每日挑战+分享 → A6 难度池 → A7 情报解锁（A2 二十问独立排期或紧随其后）。
2. **第 2–3 周（P1）**：B1 阵营 + B2 声优（需先跑通 CN dump 数据管线）→ B4 台词模式（文本）→ B3 技能模式 → B5 种族大类 → B6 剪影模式。
3. **第 4 周起（P2 按需）**：画师 / 实装时间 / 别名 / 热度池 / 音频台词。

数据管线注意：新增维度需扩 `scripts/build_data.py`（新增 CN dump 输入 + `TEAM_ZH`、`RACE_FAMILY`、`CV` 字典与 wiki 抓取脚本），沿用"生成物提交进 git、源文件不提交"的既有约定；所有新字段只进 `server-data/`，**绝不下发谜底值**（阵营/声优维度的响应只含所猜干员的值与 exact/wrong 状态，与现有职业/种族维度同构）。

## 六、风险与合规

- **防作弊等价性**：A1 计数、A2 问答均为"已返回信息的函数/子集"，不新增信息类；台词/技能/剪影模式展示的是公开可查数据；分享卡无名字；新维度沿用 exact/wrong 语义。
- **数据授权**：解包数据 © 鹰角（非商业粉丝项目参考使用，延续现状）；wiki 内容 CC BY-SA/NC，仅存事实字符串并在 README 注明来源；**不打包语音音频**（版权风险最高的部分，B4 先做纯文本）。
- **热门度数据**有时效性，作为人工刷新的"池/排序"配置而非游戏内维度。

## 附录：调研来源索引

解包数据：[CN dump](https://github.com/b331z3bub/Kengxxiao-ArknightsGameData) · [EN dump](https://github.com/Kengxxiao/ArknightsGameData) · [schema 文档](https://github.com/MooncellWiki/OpenArknightsFBS) · [语音资产](https://github.com/isHarryh/Ark-Voice) · [HF 语音数据集](https://huggingface.co/datasets/deepghs/arknights_voices_zh)

wiki 数据：[PRTS 画师](https://prts.wiki/w/ILLUST) · [PRTS 上线时间](https://prts.wiki/w/%E7%94%A8%E6%88%B7:Hydrogina/castle/%E5%B9%B2%E5%91%98%E4%B8%8A%E7%BA%BF%E6%97%B6%E9%97%B4%E4%B8%80%E8%A7%882) · [wiki.gg 阵营数据模块](https://arknights.wiki.gg/wiki/Module:Subfaction/data) · [fandom 势力](https://arknights.fandom.com/wiki/Faction) · [fandom 种族](https://arknights.fandom.com/wiki/Race/Ancient) · [fandom 画师](https://arknights.fandom.com/wiki/Illustrators) · [fandom 声优](https://arknights.fandom.com/wiki/Character_voices) · [萌娘 种族](https://zh.moegirl.org.cn/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F/%E7%A7%8D%E6%97%8F) · [萌娘 配音](https://moegirl.icu/zh-mo/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F/%E9%85%8D%E9%9F%B3%E6%BC%94%E5%91%98)

同类游戏：[ak-guess](https://github.com/lie5860/ak-guess) · [NGA 干员猜猜乐](https://bbs.nga.cn/read.php?tid=31057740) · [NGA 最优开局](https://ngabbs.com/read.php?tid=40595921) · [PTT 讨论](https://www.pttweb.cc/bbs/Arknights/M.1744783773.A.75D) · [官方干员猜猜乐](https://www.9game.cn/news/6602473.html) · [Sporcle 剪影](https://fr.sporcle.com/games/HoloMaru/arknights-characters-by-silhouette/results) · [JetPunk 细节题](https://www.jetpunk.com/user-quizzes/1718413/guess-the-arknights-operator-by-their-weapon) · [LoLdle](https://dlegames.org/game/loldle)

热度数据：[penguin-stats Matrix API](https://developer.penguin-stats.io/public-api/api-v2-instruction/matrix-api) · [一图流练度统计](https://ark.yituliu.cn/survey/operator-progression-statistics)

（本地量化分析：见本会话工作记录——12 维信息量、候选收敛模拟、20 问模拟、立绘覆盖率等，均可复现。）
