# 明日方舟 · 干员猜谜（Arknights Operator Guessing Game）

一个网页版猜干员小游戏：系统随机藏一名干员作为"谜底"，你输入任意干员代号（支持拼音/首字母），系统按档案维度反馈对错。终局校验 V3 增加势力层级与 Logo、S1–S3 技能范围逐槽交集、标准部署费用、轮换档案字段，以及完成本局战术指令后解锁的单条情报。

**三种模式：**

- **终局校验（高危）**：默认 6 次猜测，可在 1–20 次间自定义；机会用尽会弹出**终局抉择**，干扰项会优先贴合此前猜出的绿色线索，猜错即失败。
- **全域检索**：不限猜测次数，靠 12 维线索一路逼近答案。
- **异类审查**：进入终端后选择综合审查或六个单域主题，每局 10 题，从四名干员中找出唯一不满足共性规则的异类；标准难度起步，三连对升级、两连错降级，基础/标准/危机题基础分为 100/150/220。高难综合审查初始提供 2 次共性扫描，每连续答对 3 题奖励 1 次，单域主题会提前列出当前题库涵盖的大类。服装品牌题会为四名候选切换到实际对应品牌的皮肤。

三种模式均基于当前 425 名干员数据出题。

- 星级、站位、职业、子职业、Tag —— 来自 `character_table.json`
- 性别、战斗经验、出身地、生日、种族、身高、矿石病感染情况 —— 来自 `handbook_info_table.json`
- 谜底保存在服务端（加密 token），玩家无法直接从网页源码读到答案。

---

## 目录结构

```
arknight-cczss/
├─ public/                     # 前端静态资源（唯一对外可见）
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/app.js                # 模式选择 / 拼音搜索 / 四选一弹窗
│  └─ data/names.json          # 干员名单、拼音与熟悉度排序字段（不含谜底档案）
├─ server-data/operators.json  # 全部干员 12 维档案（仅服务端使用，不对外提供）
├─ server-data/operator-archives.json # 人员档案完整章节（仅终局后下发）
├─ server-data/operator-clues.json # 匿名提示素材映射与技能机制（仅服务端使用）
├─ server-data/operator-familiarity.json # 熟悉度冷启动分与审计信息
├─ server-data/anomaly-rules.json # 异类审查规则成员表（仅服务端使用）
├─ server-data/anomaly-questions.json # 异类审查预生成题库（仅服务端使用）
├─ api/                        # Vercel Serverless 接口
│  ├─ new.js                   #   GET  /api/new?mode=sudden|endless   开新局
│  ├─ guess.js                 #   POST /api/guess   提交猜测，返回对比+新 token+剩余次数
│  ├─ choices.js               #   POST /api/choices 终局校验机会用尽后返回终局候选
│  ├─ pick.js                  #   POST /api/pick    提交四选一选择，判定胜负
│  ├─ clue.js                  #   POST /api/clue    解码已授权的单条情报
│  ├─ anomaly/                 #   异类审查 themes / new / scan / answer / next
│  └─ reveal.js                #   GET  /api/reveal  放弃本局，揭晓答案
├─ lib/game.js                 # 核心逻辑（token 加密 / 随机谜底 / 维度对比 / 干扰项生成）
├─ scripts/build_data.py       # 数据构建脚本（档案、势力、范围、费用、技能与熟悉度）
├─ scripts/build_anomaly_data.py # 六域规则提取、歧义审计与静态题库生成
├─ scripts/extract_anomaly_skin_art.py # 从本体导出服装品牌题引用的具体皮肤立绘
├─ scripts/build_gameplay_assets.py # 从本体生成 Logo、匿名技能图标、剪影与立绘碎片
├─ server.js                   # 本地运行服务器（零依赖，复用 api 目录的逻辑）
├─ vercel.json                 # Vercel 部署配置
└─ package.json
```

## 本地运行

```bash
node server.js        # 或 npm start
```

然后浏览器打开 http://localhost:3000 即可游玩。

## 数据如何生成（改了游戏数据后要执行）

推荐使用已经配置好的双通道自动更新管线：GitHub Actions 每天检查公开 GameData，优先从公开素材项目补齐新干员图片并创建草稿 PR；只有公开镜像暂缺时，Windows 本地更新器才读取已安装的游戏客户端兜底，随后执行严格校验。

```powershell
# 本机一键更新；默认会识别 G:\game\Hypergryph Launcher\games\Arknights
npm run update:data:local

# 旧干员时装或素材生成规则变化时全量刷新
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update_local.ps1 -ForceAssets
```

首次启用、GitHub 权限、草稿 PR 完成流程和故障状态详见 [`docs/data-update-pipeline.md`](docs/data-update-pipeline.md)。管线会将上游提交、生成文件哈希、素材缺口和人工复核项写入 `server-data/data-version.json`；不会自动合并不完整更新。

以下命令适用于需要单独调试某一步的情况。

GameData 源 JSON 不在本仓库。将 `ARKNIGHTS_GAMEDATA_ROOT` 指向当前公开仓库的 `zh_CN/gamedata/excel`，或指向包含该目录的 GameData 仓库根目录；脚本也兼容旧的 `cn/gamedata/excel`：

```powershell
$env:ARKNIGHTS_GAMEDATA_ROOT="G:\path\to\cn\gamedata\excel"
python -m pip install -r scripts/requirements-data.txt
npm run build:data
```

数据脚本还读取 `gacha_table`、`uniequip_table` 和 `building_data`。它会生成服务器档案、熟悉度审计数据、情报映射、异类审查六域规则和题库，以及前端只用于搜索的名单。异类审查数据始终保留在 `server-data/`；每个技能使用满级 `rangeId`，没有独立范围的技能继承干员最高精英阶段的基础范围。

从本地 PC 本体生成派生图片：

```powershell
python -m pip install -r scripts/requirements-art.txt
python scripts/build_gameplay_assets.py --game-root "G:\game\Hypergryph Launcher\games\Arknights"
# 生成规则变化后，用 --clues-only --force 覆盖既有情报图
```

素材脚本不会修改游戏安装目录；它只读取本体包并在 `public/img/factions`、`public/img/clues` 中生成 WebP。“局部显影”素材是完整暗色剪影叠加一小块彩色区域，不是原立绘裁片。技能图标和情报立绘使用匿名哈希文件名，完整映射仅保存在服务端数据中。

完整人员档案由 `npm run build:archives` 从项目根目录下临时的 `.handbook-info-table.json` 生成；源表不提交，生成后的 `server-data/operator-archives.json` 需要提交。该数据仅在猜中、揭晓或终局选择结束后返回。

脚本已处理各种脏数据：
- 战斗经验有"格斗经验 / 表演经验 / 工程经验"等变体，统一归入"战斗经验"并数字化成"年"
- 中文数字解析（八年→8、十一年→11、没有战斗经验→0、保密/未知→null）
- 生日解析为 月/日，未知值置 null
- 感染者 / 非感染者自动归类
- 机器人（Castle-3 等）字段映射：产地→出身地、高度→身高、设定性别→性别
- 伊芙利特档案中损坏的尾部数据会被截断
- 职业（CASTER→术士 等 8 类）与 72 种子职业（`subProfessionId`→中文分支名，如 `physician`→医师、`healer`→疗养师、`reaperrange`→散射手）的中文翻译内置在脚本的 `PROFESSION_ZH` / `SUBPROFESSION_ZH` 两个字典里；游戏更新出现新子职业时，在字典里补一行即可
- 每个干员生成 0–100 的 `familiarityScore` 和 S/A/B/C 档。主信号来自 `scripts/operator-popularity-signals.json` 中的一图流持有率、精二率与专精率快照（作为实际养成/使用投入代理），`scripts/familiarity-overrides.json` 作为经典低星、主线角色等社区认知锚点；本体曝光只在外部信号缺失时承担较大权重
- 三类信号同时可用时，熟悉度按“本体曝光 15% + 养成/使用投入 52% + 搜索与社区讨论 33%”融合；缺少讨论度时自动回退为本体曝光 25% + 养成/使用投入 75%。讨论度内部权重配置在 `scripts/popularity-source-weights.json`：Bilibili 视频搜索 48%、百度指数 18%、Bing 网页搜索 12%、YouTube 视频搜索 10%、PRTS 社区检索 7%、人工社区锚点 5%；仅对当前确有可靠数据的来源重新归一化，缺失来源不会被补成零分
- `npm run refresh:attention` 会刷新匿名公开搜索快照并写入 `scripts/operator-attention-signals.json`。任何搜索/视频来源必须覆盖至少 90% 干员才会进入正式熟悉度；接口限流、验证码与软失败只会使该来源停用，不会把缺失误判成冷门。百度指数需人工导出，YouTube 需授权 API Key，均预留权重但在没有合规数据时不生效

## 工作原理（防作弊）

1. 打开页面 → `GET /api/new?mode=...`。当前终局校验使用 `GET /api/new?mode=sudden&v=3`；V1/V2 接口继续保留用于兼容旧客户端。
2. 前端每次猜测 → `POST /api/guess`，服务端解密 token 拿到谜底，与所猜干员逐维度对比，返回结果 + **新 token**（内含猜测历史，用于生成干扰项）。
3. V3 对比结果不含谜底名称、谜底属性、谜底范围或可识别资源文件名；S1–S3 分别只返回猜测干员范围格及其与谜底同槽技能的重叠状态，不返回谜底独有格。技能协议局会同时展示被猜干员各技能的触发、技力回复、充能和弹药信息。
4. 终局校验机会用尽 → `POST /api/choices`：服务端先保证主职业与性别，再优先满足此前锁定的绿色维度（锁定种族权重最高）和本局战术指令；未锁定维度不参与候选评分，候选池不足时才逐层放宽。接口只返回代号与必要图片，不返回职业或星级。`POST /api/pick` 判定终局胜负。
5. V3 开局公开一条技能协议、战场响应或身份档案主题；浏览器记录近期出现的主题并交由服务端软降权，尽量让兼容主题轮换一遍后再重复，同时始终保留少量重复概率。玩家使用符合主题的不同干员推进指令，通常需要 3 次命中，冷门目标降为 2 次，极冷门且主题较难时降为 1 次。完成后先播放“条件达成”确认，再自动读取一条不可重抽的情报，侧栏战术指令片左滑并由情报卡接替。情报强度同时参考目标熟悉度与主题信息量；技能图标和技能机制奖励的权重较低，但一旦抽中会一次给出该干员全部 S1–S3（或 S1–S2）资料。当技能协议已经公开同类机制时，该局不会再用技能机制作为重复奖励。六星目标的剪影奖励会额外降权，只有熟悉度 30 以下的极冷门六星保留完整概率，31–40 分仍保留少量概率，常见六星基本不出剪影。若本局解锁剪影或局部显影，终局候选统一使用剪影展示并保留干员代号。

## 验证

```bash
npm test
```

测试覆盖 V1/V2/V3 模式隔离、轮换顺序、S1–S3 逐槽范围比较与谜底范围防泄漏、战术指令进度与冷门谜底门槛、V3 全技能奖励与主题去重、情报解码、终局阶段校验，以及异类审查题库容量、出题约束、接口防泄漏、扫描器、动态难度、难度计分和十题评级。

异类审查前端的完整接口契约、视觉约束和 Kimi K3 提示词见 [`docs/anomaly-audit-frontend-handoff.md`](docs/anomaly-audit-frontend-handoff.md)。

## 部署上线（Vercel，免费）

方式一：GitHub 导入（推荐）

1. 把本仓库推到 GitHub。
2. 打开 vercel.com → Add New Project → Import 该仓库。
3. Root Directory 保持仓库根目录；仓库内 `vercel.json` 已固定 Framework Preset 为 **Other**、静态输出目录为 `public`，无需填写 Build Command。

方式二：命令行

```bash
npm i -g vercel      # 装一次即可
vercel login
vercel --archive=tgz # 预览环境
vercel --prod --archive=tgz
```

当前 `public` 包含完整立绘和情报素材，原始体积约 241 MiB，超过 Vercel Hobby 的 CLI 源文件上传上限；免费方案应使用 GitHub 集成部署。CLI 方式适合 Pro，或未来把 `public/img` 迁移到对象存储之后使用；`--archive=tgz` 主要减少数千个小文件的上传请求，并不能保证把已压缩的 WebP 素材降到 Hobby 上限以内。

项目固定使用 Node.js 24.x，并将 Serverless 函数部署在香港 `hkg1`；静态资源仍由 Vercel 全球 CDN 分发。API 响应禁止缓存，避免局面 token、揭晓结果或辅助情报被中间缓存复用；CSS、JS 与前端数据短缓存 5 分钟，图片缓存 1 天，以兼顾加载速度和数据更新时效。

### 部署后必做：设置加密密钥

在 Vercel 项目 → Settings → Environment Variables 添加：

| 变量名       | 值                 | 环境      |
| ------------ | ------------------ | --------- |
| `GAME_SECRET` | 任意长随机字符串     | Production |

正式环境必须设置 `GAME_SECRET`；建议 Preview 也使用一条独立密钥。修改密钥会令部署前签发的对局 token 失效。

首次上线后可检查响应头：

```bash
curl -I https://你的域名/js/app.js
curl -sD - "https://你的域名/api/new?mode=sudden&v=3" -o /dev/null
```

前者应出现静态缓存策略，后者应出现 `Cache-Control: no-store`。生产域名若主要面向中国大陆玩家，建议从目标地区实测延迟；`hkg1` 可降低函数往返距离，但不等同于中国大陆境内 CDN 或备案线路。

### 其他平台参考

- **Render / Railway / 云服务器**：这些平台跑常驻进程。直接部署本仓库，启动命令 `npm start`（即 `node server.js`），并设置 `GAME_SECRET` 环境变量。`server.js` 与 Vercel 函数复用同一套 `lib/game.js`，逻辑一致。
- **Cloudflare Pages + Functions**：页面放 `public/`，六个 API 改写成 `functions/` 目录的 Worker 格式即可（逻辑可直接搬 `lib/game.js`）。

## 后续扩展：加干员立绘

每个干员数据里都带稳定的 `id`（如 `char_103_angel`），方便日后挂图片：

- **静态方案**：把立绘放进 `public/img/{id}.webp`，前端在名字单元格里渲染图片即可（已预留接口）。
- **CDN 方案**：把图片放对象存储（OSS / R2 / 图床），在 `server-data/operators.json` 里加一个 `imgUrl` 字段。注意：猜中前绝不能把"谜底"的图片地址返回给前端，否则等于直接泄露答案。可以让 `guess` 接口只返回**你所猜干员**自己的图片地址。

## 已知边界

- 部分干员个别档案为"未公开 / 未知"（如机械干员没有生日），该维度显示灰色 `?`。
- 黄色 = 接近：生日相差 2 个月内、或身高相差 15cm 内会标黄，且仍显示高低方向（`↓`/`↑` / `→更晚` / `←更早`），鼠标悬浮提示接近阈值（身高相差 15cm 以内 / 生日 2 个月内），不显示具体差值；星级 / 战斗经验等其他数字只显示高/低（红色 + 方向箭头），不再泛黄。
- 特殊档案用黑斜线标出：变体战斗经验（格斗经验 / 表演经验等，数值照常参与高/低对比）以及出身地 / 种族为"未知 / 未公开 / 不明"时，对应格子叠加深色斜纹。
- 身高个别是玩笑数值（如 35cm），按原始档案处理。
- 终局候选会尽量贴合玩家已确认的绿色维度；若同池内没有足够干员能同时满足全部绿色条件（如已锁定 4 个以上维度），会退而求其次选"满足最多条件"的干员，并保证至少 3 个、通常 4 个选项。
- 若要防止脚本狂刷接口，后续可在服务端加简单限流（每个 token 最多猜 N 次）。

## 免责声明

本项目为粉丝向学习作品，数据来源为游戏内公开档案，仅用于学习与娱乐，不用于任何商业用途。
