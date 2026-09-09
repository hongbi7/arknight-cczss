# Cloudflare Pages 图片部署方案与实施步骤

本方案只把游戏图片部署到 Cloudflare Pages，页面、JSON 和 `/api/` 继续由现有 ECS 提供。使用 Pages 自带的 HTTPS 地址，不需要绑定尚未完成备案的域名。

仓库现在提供图片打包工具、远程校验工具以及可选 Nginx 配置片段。这些文件不会自动创建 Cloudflare 项目、上传素材或修改 ECS。首次接入采用人工验证后的版本绑定；完整的图片自动发布设计见最后一节，尚未接入当前生产管线。

## 1. 部署结构与免费范围

```text
浏览器 ── 页面 / JSON / API ──► ECS：Nginx + Node.js
   │
   └── /img/... ──► Nginx 返回 302（仅很小的响应）
                         │
                         ▼
              固定部署版本的 *.pages.dev/img/...
                         │
                         └── 图片直接传给浏览器
```

图片字节不经过 ECS 出口。第一张未缓存的图片会多一次重定向；先采用这个方式，是因为当前 HTML、CSS、客户端素材映射和 API 都已有 `/img/` 路径，可以统一接入。API 的健康检查与本机 Nginx 入口保持原样。

Pages 纯静态资源请求免费且不限请求数，不调用 Functions。本次实际打包约 3,500 张图片，符合免费版每站 20,000 文件、单文件 25 MiB 的限制；工具会在上传前检查这些限制。参见 [静态资源计费](https://developers.cloudflare.com/pages/functions/pricing/) 和 [平台限制](https://developers.cloudflare.com/pages/platform/limits/)。

本方案不使用 R2、Workers、付费图片转换或自定义域名。Cloudflare 的免费网络不包含其单独销售的大陆网络服务，应在目标用户的网络上验证图片访问速度。参见 [大陆网络说明](https://developers.cloudflare.com/china-network/)。

## 2. 先准备与游戏版本相符的图片包

在本地项目根目录运行，需要 Node.js 24：

```powershell
node scripts/build_image_pages.js
```

输出目录为 `output/cloudflare-pages`，已经被 Git 忽略。工具只导出 `public/img` 中的常规图片，保留原目录结构：

```text
output/cloudflare-pages/
├── img/
│   ├── operators/
│   └── ...
├── assets-manifest.json
├── _headers
├── 404.html
└── index.html
```

`index.html` 是简单的图片站说明，不是游戏页面。清单记录图片路径、大小、SHA-256 和整套图片的摘要，用来与 ECS 上实际使用的图片逐一比对。`404.html` 让不存在的图片返回 404，防止误返回 SPA 首页；行为依据 [Pages 文件服务说明](https://developers.cloudflare.com/pages/configuration/serving-pages/)。

`_headers` 为公开图片配置跨源访问、禁止搜索收录及缓存验证。当前游戏用 `<img>`、CSS 和图片预览展示素材，没有读取 Canvas 像素；跨源图片可用于这些现有流程。使用 `max-age=0, must-revalidate` 保留浏览器的 ETag 验证，暂不对可能复用的文件路径设置一年 `immutable`。参见 [Pages 响应头配置](https://developers.cloudflare.com/pages/configuration/headers/)。

**上传目录必须是 `output/cloudflare-pages`。** 不要上传整个仓库或 `server-data`；这里不需要生产 `GAME_SECRET`。再次打包只会重建工具自己生成的输出目录，若该目录有未知内容或符号链接，工具会拒绝覆盖。

打包器读取当前磁盘上的图片，不会把它自动变成 `main` 的图片。现有本地修改需要按正常流程提交、合并、通过 CI 并部署；正式接入前，第 5 步必须与 ECS 的实际图片比对通过。

## 3. 创建 Pages 项目并上传

本项目文件数超过控制台拖拽上传的 1,000 文件限制，所以使用 Wrangler 的 Direct Upload。Wrangler 支持最多 20,000 文件；后续也能由 GitHub Actions 执行同类上传。参见 [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。

先登录 Cloudflare：

```powershell
npx wrangler@4 login
```

按浏览器提示登录并授权。然后创建图片项目，下例名称可以改成你自己的；若名称不可用，请换一个，并同步修改后续命令：

```powershell
npx wrangler@4 pages project create arknight-guess-images --production-branch main
```

采用 Direct Upload 后无需把 GitHub 仓库连接到 Pages，也无需为游戏设置框架。项目类型确定后不能直接切换成 Git 集成项目；如以后需要那种方式，可以创建另一个项目。参见 [Direct Upload 的集成限制](https://developers.cloudflare.com/pages/get-started/direct-upload/)。

上传刚才的输出目录到一个图片验收分支：

```powershell
npx wrangler@4 pages deploy output/cloudflare-pages --project-name arknight-guess-images --branch image-baseline --commit-dirty=true
```

`--commit-dirty=true` 允许上传当前目录生成的静态制品，并不代表它通过生产 CI。命令参数见 [Wrangler Pages 命令](https://developers.cloudflare.com/workers/wrangler/commands/pages/)。

记录上传结果中的**唯一部署地址**，格式类似：

```text
https://<部署哈希>.arknight-guess-images.pages.dev
```

这里的部署哈希由 Cloudflare 返回，不是 Git 提交 SHA，不能自行填写。不要用会随下一次上传变化的 `image-baseline.arknight-guess-images.pages.dev` 分支别名，也不要用项目主域代替。唯一部署地址指向该次原子部署，旧版本仍能单独访问；保留正在使用及回滚所需的部署，不要删除它们。参见 [唯一部署地址与分支别名](https://developers.cloudflare.com/pages/configuration/preview-deployments/)。

在 Cloudflare 的 Workers & Pages 中可以查看项目和部署记录。浏览器必须能直接访问图片，所以本图片部署不要配置需要登录的 Access 访问策略。

## 4. 本地校验与速度对比

将下面的占位地址替换成刚才得到的唯一部署地址：

```powershell
node scripts/check_image_pages.js --base-url https://REPLACE_HASH.REPLACE_PROJECT.pages.dev
```

校验器只读运行，检查：

- 图片清单与本地 `public/img` 的全部路径、大小和 SHA-256 是否一致。
- 实际下载少量代表性图片，检查内容哈希、图片 Content-Type 和跨源响应头。
- 不存在的图片是否返回 404。

它不会把整套数百 MiB 图片重新下载一遍，因此这是全量本地清单比对和远程抽样验收，不是远程每个文件的逐字节下载验证。失败时先排查上传目录、上传版本和访问策略，不进入 Nginx 接入步骤。

在浏览器打开打包日志中的样本图片，分别用家庭宽带和手机网络测试；与原 ECS 同一张图片比较完成时间和失败率。测速应关闭代理并记录网络条件，浏览器开发者工具勾选 Disable cache 后再比较首次加载。如果 Pages 在目标网络上持续更慢或不可访问，可保留图片部署作为备用，暂不切换入口。

## 5. 在 ECS 上确认同一套图片

先按 [生产部署文档](production-deployment.md) 完成 release 目录与 `app` 软链接的迁移。本步骤利用不可变的 release 目录进行版本绑定，不适用于仍直接在同一 Git 目录里 `git pull` 更新的运行方式。

把只读校验工具复制到 ECS 的临时目录；替换登录用户和公网 IP，SSH 仍使用你现有的可信 IP 限制：

```powershell
scp scripts/check_image_pages.js LOGIN_USER@ECS_IP:/tmp/check_image_pages.js
```

在 ECS 的 Bash 中运行：

```bash
RELEASE_DIR=$(readlink -f /opt/arknight-guess/app)
printf '%s\n' "$RELEASE_DIR"
node /tmp/check_image_pages.js \
  --base-url https://REPLACE_HASH.REPLACE_PROJECT.pages.dev \
  --local-root "$RELEASE_DIR"
```

目录应是 `/opt/arknight-guess/releases/<40位Git提交SHA>`。使用解析后的固定路径，避免每日自动发布切换软链接后，比对过程读到另一个版本。校验器打印通过验证的真实 `public` 根目录，下一步必须使用这个路径。

如果 ECS 与本地图片不同，校验会失败。应先让两端使用同一个正式版本，或者从 ECS 对应的提交重新打包和上传，再重新校验。不要仅凭开局 API 成功就认为图片版本也一致。

## 6. 给 Nginx 加入版本绑定的图片跳转

先备份当前站点配置：

```bash
sudo cp /etc/nginx/sites-available/arknight-guess \
  /etc/nginx/sites-available/arknight-guess.before-pages-$(date +%Y%m%d-%H%M%S)
sudo nano /etc/nginx/sites-available/arknight-guess
```

仅替换已有的 `location ^~ /img/` 块，其他监听、API 代理和静态目录规则保持当前配置。可复制仓库的 [Nginx 图片片段](../deploy/nginx-images-pages.location.example)，填入刚才校验通过的 **release SHA** 和 **Pages 唯一部署地址**：

```nginx
location ^~ /img/ {
    if ($realpath_root = "/opt/arknight-guess/releases/REPLACE_WITH_RELEASE_SHA/public") {
        add_header Cache-Control "no-store" always;
        return 302 https://REPLACE_HASH.REPLACE_PROJECT.pages.dev$request_uri;
    }

    try_files $uri =404;
    add_header Cache-Control "public, max-age=86400, stale-while-revalidate=604800";
    access_log off;
}
```

`$realpath_root` 是当前静态根目录解析软链接后的路径。只有校验过的那一个 release 才跳转；以后 12:30 发布到新 release 时，该条件不匹配，就自动使用新 release 自带的本地图片。回滚到其他 release 也会使用其本地图片；回滚到这个已绑定版本则继续使用对应的固定 Pages 部署。

这让首次试用能与已有每日自动发布共存。**它还不是每个新版本都会自动启用 Pages 的完整管线。** 本地 `public/img` 必须保留。不可变发布目录和 Nginx 变量的定义见 [Nginx 核心模块](https://nginx.org/en/docs/http/ngx_http_core_module.html#variables)，响应头的配置位置见 [响应头模块](https://nginx.org/en/docs/http/ngx_http_headers_module.html)。

检查通过后再 reload；这里不需要重启 Node：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

不要使用 `proxy_pass` 把 Pages 图片转发回来，那样图片仍会经过 ECS 出口。也不要用长期缓存的 301；当前 302 返回 `no-store`，便于立即回退。

## 7. 验收与回退

保持生产示例当前的本机监听方式，在 ECS 上用实际存在的图片路径检查：

```bash
curl -I http://127.0.0.1/img/REPLACE_WITH_EXISTING_IMAGE.webp
curl -IL http://127.0.0.1/img/REPLACE_WITH_EXISTING_IMAGE.webp
curl -fsS http://127.0.0.1/api/health
```

当前运行的 release 与绑定路径一致时，第一条应返回 302 和固定 Pages 地址；跟随跳转后应为 200，Content-Type 为图片类型。若返回本地图片 200，先检查是否已经自动发布到另一个 release，以及绑定路径是否与校验输出一致。

需要在本地浏览器操作游戏时，可通过已有 SSH 登录建立本地端口转发，无需开放服务器新端口或绑定域名：

```powershell
ssh -N -L 8080:127.0.0.1:80 LOGIN_USER@ECS_IP
```

保持该终端运行，浏览器访问 `http://127.0.0.1:8080`。确认首页、三个模式、异常审计的四张选项图、终局候选、图片放大及手机布局都正常。开发者工具里图片最终地址应是 Pages，API 仍走游戏入口；首次测试禁用缓存，避免先前缓存的同源图片让跳转看起来没有生效。

若 Pages 在用户网络上故障，恢复备份的站点配置（使用第 6 步实际生成的文件名），然后重新 `nginx -t`、reload，即可回到本地图片。也可以直接恢复 [原 Nginx 模板](../deploy/nginx-arknight-guess.conf.example) 中的 `/img/` 块；不要覆盖已经单独调整过的其他站点设置。

Nginx 302 后不会知道浏览器是否成功下载 Pages 图片，因此当前方案不承诺远端故障时自动回源；回退由管理员执行。部署 API 的健康检查也不能代替外部用户对图片的验收。

## 8. 后续自动化发布设计

当前生产 CI、部署器和每天北京时间 12:30 的 timer 没有因本方案被改为自动上传图片。要长期免人工维护，应再完成下面的链路：

```text
main 的精确提交
    ↓
Production CI：游戏 / 数据 / 浏览器检查
    ↓
打包图片 → Wrangler 上传 → 校验唯一部署 URL
    ↓
记录：Git SHA + 图片摘要 + Pages 唯一部署 URL
    ↓
ECS 在 12:30 拉取该 SHA
    ↓
核对图片版本并准备 release 的图片配置
    ↓
切换应用与图片配置，验证；失败时一起回滚
```

实施要点：

1. 在受信任的 `main` CI 中上传，使用只针对相应 Cloudflare 账户的 `Cloudflare Pages: Edit` API Token；保存在 GitHub Secrets，账户 ID 和项目名保存在配置中。首次本地 OAuth 登录不等于 GitHub 已有凭证。参见 [使用 CI Direct Upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。
2. 图片上传及远程校验必须是 `Production CI` 成功条件的一部分。仅增加一个独立图片 workflow，不会自动成为当前 ECS 部署器的发布门禁。
3. 发布记录绑定精确 Git SHA、图片摘要和唯一部署地址。ECS 需读取和验证该记录，在 root 管理的部署流程中更新 Nginx 图片配置，并把配置变动纳入失败恢复；不能直接执行从仓库取得的任意 root 脚本。
4. 保留仍在运行、可回滚及活跃客户端所需的 Pages 部署。多个版本使用各自的唯一地址，不依赖会变化的项目主域；仅在同一个可变 URL 后加 `?v=SHA` 并不能恢复已被覆盖的文件内容。
5. 完整自动化还应让前端按版本直接请求图片 URL，处理旧页面跨发布的资源一致性，减少逐图重定向，并设计远端失败时的本地降级。首次试用的目录绑定解决的是当前服务版本对应哪套图片，不承诺页面一直打开跨多个版本时仍固定在旧版本。

这些自动化改造尚未实现，不应在上线记录中标为完成。本文提供的首次接入步骤可以先验证免费 Pages 在目标网络上的实际收益，再决定是否继续接入自动化。
