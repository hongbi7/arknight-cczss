# 明日方舟数据自动更新管线

这套管线将可公开同步的 GameData 与只能从本地 PC 客户端读取的素材分开处理，避免云端把缺立绘、缺剪影的新干员直接发布。

## 更新通道

| 通道 | 数据来源 | 负责内容 | 结果 |
| --- | --- | --- | --- |
| GitHub Actions | `Kengxxiao/ArknightsGameData` + `fexli/ArknightsResource` | 干员属性、档案、势力层级、部署费用、攻击范围、技能机制、台词、搜索索引；优先补齐公开 E1/终局立绘、技能图标和势力 Logo，并生成剪影/显影 | 有变化时创建草稿 PR |
| Windows 本地更新器 | 上述公开项目 + 已安装的明日方舟 PC 客户端 | 公开素材镜像更新延迟或缺文件时，从本体兜底补齐素材 | 补齐草稿 PR 并运行严格校验 |

`server-data/data-version.json` 记录上游提交、生成文件 SHA-256、干员数量、素材缺口和人工复核项。`.update-work/data-update-report.json` 是更完整的本地/CI 报告，不提交仓库。

## 首次启用 GitHub 自动更新

1. 将 `.github/workflows/update-game-data.yml` 合入仓库默认分支。定时工作流只有位于默认分支时才会运行。
2. 在 GitHub 仓库的 **Settings → Actions → General → Workflow permissions** 中选择读写权限，并启用允许 GitHub Actions 创建 Pull Request 的选项。
3. 在 **Actions → Update Arknights game data** 手动运行一次，确认权限和草稿 PR 创建正常。

工作流每天 `20:37 UTC`（北京时间次日 `04:37`）检查一次，也支持手动触发。它使用固定的 `automation/arknights-game-data` 分支；如果该分支已有开放 PR，任务会跳过，避免覆盖人工补素材的提交。合并或关闭现有 PR 后，下次任务才会继续检测新版。

云端优先从持续自动更新的公开项目获取结构化数据与缺失素材，只下载当前项目真正缺少的文件，不克隆完整的大型素材仓库。公开素材会先转换为项目使用的 WebP，再生成完整剪影与局部显影。若公开镜像尚未跟上新版本或缺文件，报告状态为 `asset_refresh_required`，PR 保持草稿并交给本地客户端兜底；不会伪造素材或把半成品自动合并。

## 在 Windows 本地完成更新

项目默认会识别当前机器上的：

```text
G:\game\Hypergryph Launcher\games\Arknights
```

在仓库根目录运行：

```powershell
npm run update:data:local
```

也可以显式指定路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update_local.ps1 `
  -GameRoot "G:\game\Hypergryph Launcher\games\Arknights" `
  -GameDataRoot "D:\data\ArknightsGameData"
```

未传 `-GameDataRoot` 时，脚本会把上游仓库稀疏克隆到 `.cache/arknights-gamedata`，以后只做 fast-forward 更新。也可以通过环境变量 `ARKNIGHTS_GAME_ROOT` 指定客户端目录。

本地更新器会依次执行：

1. 检查 `.venv` 是否为完整可用的虚拟环境；不存在则创建，发现半残留则停止而不删除。
2. 安装或核对数据与素材依赖，并执行 `npm ci --ignore-scripts`。
3. fast-forward 更新公开 GameData；缓存有本地修改、远端不一致或目录是非 Git 残留时停止。
4. 重建全部结构化 JSON、人员档案，以及异类审查六域规则与题库。
5. 先从 `fexli/ArknightsResource` 按上游提交哈希获取缺少的立绘、Logo 和技能图标，生成剪影与显影。
6. 仅对公开镜像仍缺少的素材读取游戏本体兜底，并从本体精确导出服装品牌题实际引用的四选项皮肤立绘。
7. 再生成一次结构化数据，使新素材清单写回服务端映射；异类题库生成后再校验每张品牌皮肤均已落到公开素材目录。
8. 执行严格数据校验和 `npm test`。

默认只提取缺少的立绘和显影素材，适合新增干员。若游戏更新了旧干员时装，或素材生成规则有变化，使用全量刷新：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update_local.ps1 -ForceAssets
```

已有 `.cache/arknights-gamedata` 时可用 `-SkipFetch` 停止更新 GameData 缓存；再加 `-SkipPublicAssets` 可禁止访问公开素材镜像。参数不会在所需缓存不存在时悄悄降级。

## 完成自动草稿 PR

1. 检出自动化 PR 的 `automation/arknights-game-data` 分支。
2. 运行本地更新器，必要时为 `scripts/build_data.py` 增加新职业/子职业中文映射，或校正新势力 Logo。
3. 检查 `server-data/data-version.json` 的 `status` 必须为 `ready`。
4. 查看 `optionalSkillIcons`。技能图标是低信息量情报，部分技能没有独立图标时允许保留缺口，不阻止发布。
5. 提交本体派生素材和更新后的清单，确认 CI/本地测试通过后取消草稿并合并。

管线从不自动合并 PR。GameData 中的新字段、阵营归类或异常档案仍需要人判断，自动化只负责发现、生成和阻止不完整数据误发布。

## 状态与故障含义

- `ready`：结构正确，必需素材齐全，没有未知分类。
- `asset_refresh_required`：结构化数据可用，但需要本地客户端补图。
- `manual_review_required`：出现未翻译职业/子职业，或势力没有可用 Logo。
- `invalid`：名字索引、情报、熟悉度、档案或异类审查题库与干员集合不一致，生成步骤直接失败。异类审查会额外校验六域三难度的 18 个题桶、规则成员、证据归属、同域歧义及禁用维度。

素材严格校验不要求每个技能都有图标；缺失项记录在 `optionalSkillIcons`。完整剪影、局部显影、终局立绘、异类品牌题引用的皮肤及已声明的势力 Logo 属于必需素材。

## 单独执行与排错

只更新公开 GameData（等同云端生成阶段）：

```powershell
python scripts/update_game_data.py --data-only
```

使用已下载的 GameData，避免联网：

```powershell
python scripts/update_game_data.py --data-only `
  --gamedata-root "D:\data\ArknightsGameData" `
  --skip-fetch `
  --skip-public-assets
```

只检查当前仓库数据和素材：

```powershell
npm run validate:data
npm test
```

更新器不会清理缓存、删除虚拟环境、重置 Git 工作区或修改游戏安装目录。发生残留、脏缓存或非 fast-forward 状态时，需要先由维护者确认目录内容再处理。

## 公开来源与边界

- 结构化数据默认来自 [`Kengxxiao/ArknightsGameData`](https://github.com/Kengxxiao/ArknightsGameData) 当前 `zh_CN/gamedata/excel`；同时兼容旧 `cn/gamedata/excel` 布局。
- 缺少的立绘、技能图标和势力 Logo 优先来自 [`fexli/ArknightsResource`](https://github.com/fexli/ArknightsResource)，下载 URL 固定到本次解析出的提交哈希，避免同一次构建前后内容漂移。
- 素材仓库声明其中游戏文件版权属于鹰角网络，限教育与研究用途。本项目只用于非商业粉丝向学习；公开仓库不可用、内容下架或更新滞后时才读取用户自己的本地客户端。
- 管线未复制上述项目的程序代码。素材与游戏数据的权利仍归原权利人，来源说明见 `scripts/THIRD_PARTY_NOTICES.md`。
