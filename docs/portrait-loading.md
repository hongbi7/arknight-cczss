# 立绘加载优化与验证

2026-09-09，分支 `codex/portrait-loading`。本次是仓库中的候选改动；没有修改 ECS、Nginx、Cloudflare 配置，也没有手动覆盖生产文件。上线仍走现有 Production CI → Pages 图片发布 → ECS 拉取成功版本的流程。

## 现象与范围

终局校验收到 API 响应后立即渲染档案文字，而旧实现此时才开始加载完整立绘。桌面端第二张及后续普通档案还使用 `loading="lazy"`。生产图片请求经过 `/img/...` → ECS 302 → Pages 唯一部署地址，图片连接及下载可能晚于档案入场动画。

本次检查确认了代码中的请求顺序及文件体积，没有采集用户大陆网络的 HAR，因此不能把用户的实际延迟全部归因于某一条线路，也不能保证开启 VPN 后会变快。Cloudflare 中国网络属于独立的企业订阅，并非免费 Pages 的默认能力，见 [Cloudflare 中国网络说明](https://developers.cloudflare.com/china-network/)。

## 改动

- 普通档案、终局档案和品牌时装卡片使用最大边长 640 像素、质量 72 的 WebP 轻量图，保留透明背景、比例和完整构图。点击放大时读取现有原图。卡片中的精细纹理可能比原图柔和。
- 提交已知干员时，提前请求该干员的普通立绘，与 API 请求并行。品牌指令需要由 API 确定具体时装，因此在响应后加载对应图片。不会为预加载而请求或泄露隐藏答案。
- API 返回后立即准备实际需要的图片，与移动端键盘收起等待并行。渲染卡片复用同一个 `Image` 元素，避免预加载后再创建元素导致额外请求。
- 新档案图片设置 `loading="eager"` 和 `fetchPriority="high"`。优先级只是浏览器提示，见 [MDN fetchpriority](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/fetchpriority)。
- 慢图显示“立绘加载中…”，解码完成后显示图片；文字和猜测操作不必等待图片。轻量图失败时尝试原图一次，原图也失败则显示“立绘暂时无法加载”。这仍使用原有 `/img` 路由，不是 CDN 断连后的 ECS 回源机制。
- 剪影、碎片、四选一题面及异常审计题面的图片仍使用原路径，避免改变视觉线索或扩大这次改动的范围。

## 文件统计

对当前仓库逐文件统计，单位为十进制 KB；以下是传输字节数变化，不是公网测速。

| 类别 | 数量 | 原图平均 | 卡片图平均 | 总字节减少 |
| --- | ---: | ---: | ---: | ---: |
| 普通立绘 | 429 | 108 KB | 64 KB | 40.6% |
| 终局立绘 | 421 | 375 KB | 118 KB | 68.6% |
| 品牌时装 | 353 | 253 KB | 114 KB | 54.8% |

合计 1,203 张：原图 293,325,196 字节，对应卡片图 117,381,926 字节，减少约 60.0%。原图仍保留，因此部署图片集合额外增加约 112 MiB，图片文件总数从 3,492 增加到 4,695。用户打开卡片时只请求轻量版本；放大时才额外请求原图。

公共索引 `public/data/portrait-previews.json` 只包含姓名与 ID 的公开映射、原图与轻量图路径。索引为 131,716 字节，gzip 后约 22 KB。构建所需的源文件散列、输出散列、尺寸及编码参数位于 `server-data/portrait-previews.json`，不交给浏览器。

## 更新与发布

```bash
# 安装图片工具依赖（数据更新环境已有此依赖）
python -m pip install -r scripts/requirements-public-assets.txt

# 手动更换或提取立绘后执行；完整数据更新管线会自动调用
npm run build:portraits

# 只检查，不重新编码，不写文件
npm run check:portraits
```

`scripts/update_game_data.py` 在全部原图提取、品牌图与数据集生成结束后构建轻量图，再计算数据版本。没有变化的源文件和有效输出会直接复用；源图或编码参数变化、输出丢失或损坏会触发对应文件重建。数据更新工作流会把两份索引和 `public/img/operators/cards/` 一并提交到草稿 PR。

单独手动修改图片时，应连同新索引、轻量图和更新后的 `server-data/data-version.json` 提交。使用数据更新管线生成正式数据版本；不要通过删除版本校验来发布。

Production CI 新增 `npm run check:portraits`，对提交中的索引和源图/轻量图散列做只读校验，并运行慢图回归。ECS 无需安装 Pillow 或在 2 核 2 GB 机器上编码图片。Pages 导出脚本原本就扫描 `public/img/`，会把新增轻量图纳入同一份不可变清单；仍需该提交的 CI、图片上传和远端检查全部成功才可部署。

合并到 `main` 后，等待 Production CI 全部成功，再由现有每天北京时间 12:30 的拉取任务部署。部署时间、回滚和故障处理沿用 [生产部署文档](production-deployment.md) 与 [Pages 图片文档](cloudflare-pages-images.md)。

## 验证

```bash
npm test
python -m unittest discover -s tests/data-pipeline -p 'test_*.py'
npm run check:portraits
npm run validate:production
npm run test:images:pages
npx playwright test tests/e2e/original-modes.spec.js tests/e2e/anomaly-flow.spec.js tests/e2e/portrait-loading.spec.js
```

新增浏览器测试在桌面和移动端分别拦住 API 或图片响应，验证预加载早于档案响应、慢图期间可以继续操作、卡片复用请求、放大才读取原图、轻量图失败回退及双重失败提示。这是可重复的浏览器行为测试，不等同于真实大陆线路或 3 Mbps 并发压测。

本次验证结果：游戏逻辑测试通过，15 项数据管线测试通过，16 项桌面/移动端浏览器测试通过；生产数据状态为 `ready`，Pages 导出和发布约束测试通过。实际导出为 4,695 张图片、484,040,625 字节；图片集合 SHA-256 为 `612c8f6408fc82f2f1b9d32cef4c1050d7f0f5b7e69d9184c70f51d47b1ce662`。桌面与移动端卡片截图保存在 `output/playwright/results/`，均已检查。

上线后可在浏览器 Network 面板关闭缓存，提交一名未猜过的干员，检查卡片请求是否为 `/img/operators/cards/...`。再点击放大，确认此时才新增原图请求。对比时分别记录无 VPN 和有 VPN 情况下的连接时间、首字节时间、下载时间，不要只比较总耗时。

如果换成轻量图后仍主要卡在连接或首字节阶段，继续压缩无法消除线路等待。届时需要按实际网络记录评估图片源；本次不承诺免费 Pages 在大陆达到固定响应时间。
