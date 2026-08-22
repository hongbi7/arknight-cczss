# 明日方舟 · 干员猜谜（Arknights Operator Guessing Game）

一个网页版猜干员小游戏：系统随机藏一名干员作为"谜底"，你输入任意干员代号（支持拼音/首字母），系统按 **12 个档案维度** 反馈对错，身高 / 生日 / 星级 / 战斗经验等维度还会提示"高 / 低 / 更早 / 更晚"。

**两种模式：**

- **终局校验（高危）**：默认 6 次猜测，可在 1–20 次间自定义；机会用尽会弹出**终局抉择**，干扰项会优先贴合此前猜出的绿色线索，猜错即失败。
- **全域检索**：不限猜测次数，靠 12 维线索一路逼近答案。

两种模式都从全部 425 名干员中随机出题。

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
│  └─ data/names.json          # 干员名单+拼音+热门标记（不含档案数据）
├─ server-data/operators.json  # 全部干员 12 维档案（仅服务端使用，不对外提供）
├─ server-data/operator-archives.json # 人员档案完整章节（仅终局后下发）
├─ api/                        # Vercel Serverless 接口
│  ├─ new.js                   #   GET  /api/new?mode=sudden|endless   开新局
│  ├─ guess.js                 #   POST /api/guess   提交猜测，返回对比+新 token+剩余次数
│  ├─ choices.js               #   POST /api/choices 终局校验机会用尽后返回终局候选
│  ├─ pick.js                  #   POST /api/pick    提交四选一选择，判定胜负
│  └─ reveal.js                #   GET  /api/reveal  放弃本局，揭晓答案
├─ lib/game.js                 # 核心逻辑（token 加密 / 随机谜底 / 维度对比 / 干扰项生成）
├─ scripts/build_data.py       # 数据构建脚本（解析 JSON → 生成数据文件，含拼音与热门标记）
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

两个源 JSON 不在本仓库（避免体积与版权问题），路径写死在 `scripts/build_data.py` 顶部：

```python
CHAR_PATH = r"H:\配置\下载\character_table.json"
HANDBOOK_PATH = r"H:\配置\下载\handbook_info_table.json"
```

如果文件位置变了，改这两行即可。脚本依赖 `pypinyin`（首次使用先 `pip install pypinyin`）。然后运行：

```bash
python scripts/build_data.py
```

它会生成 `server-data/operators.json`（全量档案，服务端专用）和 `public/data/names.json`（干员名单 + 拼音 + 热门标记，前端联想用）。生成的两个文件**需要提交进 git**，否则部署后没有数据。

完整人员档案由 `npm run build:archives` 从项目根目录下临时的 `.handbook-info-table.json` 生成；源表不提交，生成后的 `server-data/operator-archives.json` 需要提交。该数据仅在猜中、揭晓或终局选择结束后返回。

脚本已处理各种脏数据：
- 战斗经验有"格斗经验 / 表演经验 / 工程经验"等变体，统一归入"战斗经验"并数字化成"年"
- 中文数字解析（八年→8、十一年→11、没有战斗经验→0、保密/未知→null）
- 生日解析为 月/日，未知值置 null
- 感染者 / 非感染者自动归类
- 机器人（Castle-3 等）字段映射：产地→出身地、高度→身高、设定性别→性别
- 伊芙利特档案中损坏的尾部数据会被截断
- 职业（CASTER→术士 等 8 类）与 72 种子职业（`subProfessionId`→中文分支名，如 `physician`→医师、`healer`→疗养师、`reaperrange`→散射手）的中文翻译内置在脚本的 `PROFESSION_ZH` / `SUBPROFESSION_ZH` 两个字典里；游戏更新出现新子职业时，在字典里补一行即可
- 每个干员附带 `hot`（五星及以上=true）和全拼/首字母拼音，用于模式分级与模糊搜索；`hot` 规则如需调整（如手动加入冷门热门名单），改脚本里 `rarity >= 5` 的判断即可

## 工作原理（防作弊）

1. 打开页面 → `GET /api/new?mode=...`，服务端按模式从对应池里随机挑一个干员，用 `GAME_SECRET` 以 AES-256-GCM 加密成 token 返回。
2. 前端每次猜测 → `POST /api/guess`，服务端解密 token 拿到谜底，与所猜干员逐维度对比，返回结果 + **新 token**（内含猜测历史，用于生成干扰项）。
3. 对比结果**不含谜底名称**，只有对错与高低提示；只有猜中时才返回答案。
4. 终局校验机会用尽 → `POST /api/choices`：服务端算出此前猜测里所有“绿色（命中）”维度，优先选择完全满足绿色条件的干扰项；数量不足时按职业、性别优先级放宽，最终返回 3–4 个候选。`POST /api/pick` 判定终局胜负。
5. 这样玩家只能看到"哪项对、哪项高/低"，拿不到完整档案，无法直接作弊。

## 部署上线（Vercel，免费）

方式一：命令行（最快）

```bash
npm i -g vercel      # 装一次即可
vercel login
vercel               # 预览环境（每次 vercel 重新部署预览）
vercel --prod        # 生产环境
```

方式二：GitHub 导入

1. 把本仓库推到 GitHub。
2. 打开 vercel.com → Add New Project → Import 该仓库。
3. Framework Preset 选 **Other**（或直接保持默认，`public` 目录会自动被识别为静态资源，`api` 目录为 Serverless 函数）。

### 部署后必做：设置加密密钥

在 Vercel 项目 → Settings → Environment Variables 添加：

| 变量名       | 值                 | 环境      |
| ------------ | ------------------ | --------- |
| `GAME_SECRET` | 任意长随机字符串     | Production |

（不设置也能跑，但会用代码里的默认密钥，正式对外建议设置。）

### 其他平台参考

- **Render / Railway / 云服务器**：这些平台跑常驻进程。直接部署本仓库，启动命令 `npm start`（即 `node server.js`），并设置 `GAME_SECRET` 环境变量。`server.js` 与 Vercel 函数复用同一套 `lib/game.js`，逻辑一致。
- **Cloudflare Pages + Functions**：页面放 `public/`，五个 API 改写成 `functions/` 目录的 Worker 格式即可（逻辑可直接搬 `lib/game.js`）。

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
