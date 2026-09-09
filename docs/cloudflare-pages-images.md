# Cloudflare Pages 图片自动发布

本项目把游戏图片发布到一个专用的 Cloudflare Pages Direct Upload 项目。页面、JSON 和 `/api/` 仍由阿里云 ECS 的 Nginx 和 Node.js 提供；浏览器访问 `/img/...` 时，Nginx 根据当前 release 返回到该 release 对应 Pages **唯一部署地址**的 302，图片字节不经过 ECS 的 3 Mbps 出口。

```text
浏览器 ── 页面、JSON、API ──► ECS Nginx ──► Node.js（仅 /api）
   │
   └── /img/... ──► ECS Nginx 302 ──► <唯一部署>.项目名.pages.dev/img/...
```

图片 Pages 使用 `pages.dev` 地址本身不需要绑定游戏域名或为图片项目申请备案，也不需要 ECS SSH 密钥或 Cloudflare 凭证驻留在 ECS。这不改变日后将 ECS 游戏站公开给中国大陆用户所需的备案与网络配置。Nginx 和自动部署检查仍只使用 `127.0.0.1`，ECS 的每日北京时间 12:30 检查时间也不变。首次图片请求多一次很小的 302；浏览器缓存中的旧图片、在旧页面打开后发生的新发布，以及 Cloudflare 本身不可访问时，都不会由 Nginx 自动回源。

Pages 免费版的静态文件与请求额度适合本项目当前的图片规模；它不等同于中国大陆网络加速，应在目标网络实测。参见 Cloudflare 的[平台限制](https://developers.cloudflare.com/pages/platform/limits/)、[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)和[大陆网络说明](https://developers.cloudflare.com/china-network/)。

## 自动发布规则

图片发布是 `Production CI` 中 `main` 的一段工作：先完成数据、游戏和浏览器验证，再打包 `public/img`、上传 Pages，并校验返回的唯一部署 URL。Pull request 只执行测试，不上传图片，也不创建可供 ECS 采用的记录。

上传成功后，工作流会在 GitHub `cloudflare-images` environment 创建一条成功 deployment，记录：Git 提交 SHA、图片清单摘要、唯一 URL、workflow run ID 和 run attempt。它不会自动 inactive 旧记录，因此当前 release 与可回滚 release 仍各自保留对应 URL。ECS 只接受与**当前 main 提交、成功 CI 的同一次 run/attempt**相符的图片记录；不存在、过期或不匹配就拒绝把该版本切为 Pages 图片。

ECS 为候选 release 下载该记录后，以 `arkguess` 用户执行完整本地清单比对和远端图片抽样校验。只有校验通过，才把 `{ SHA, digest, URL, runID, attempt }` 写入 release 的 `image-pages.json`、更新 Nginx map 并切换 `app` 软链接。Nginx map 同时保留候选与旧 release 的不可变 URL，因此切换和回滚都会自动选择对应图片版本。

GitHub deployment 的作用与字段见 [Deployments REST API](https://docs.github.com/en/rest/deployments/deployments)。它是 ECS 可验证的发布证明，不能由分支别名或项目主域替代。

## 1. 创建 Pages 项目和 GitHub 凭证

这一节只需为图片项目执行一次。图片项目采用 Direct Upload。在本地电脑用 Wrangler 创建空项目，再由 CI 上传图片：

```bash
npx wrangler@4 login
npx wrangler@4 pages project create arknight-guess-images --production-branch main
```

第一条命令打开浏览器登录；第二条只创建项目。项目已存在时跳过创建。可以将示例名称替换为自己的名称，后续所有配置使用同一个值。参见 Cloudflare 的 [Direct Upload 建项步骤](https://developers.cloudflare.com/pages/get-started/direct-upload/#create-your-project)。

1. 在 Cloudflare Workers & Pages 确认刚创建的项目，项目名只能使用小写字母、数字和连字符。确认项目地址为 `项目名.pages.dev`；若因名称占用而被追加随机后缀，请换一个未占用的项目名，使项目名与地址前缀一致。本实现严格核对两者，不接受别名或其他项目的地址。
2. 在 Cloudflare 创建 API Token，权限仅授予此账户的 **Cloudflare Pages: Edit**。不要使用全局 API Key，也不要赋予 DNS、Workers、R2 或账户管理权限。Cloudflare 的 token 权限说明见 [API token 文档](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

   | 类型 | 名称 | 值 |
   | --- | --- | --- |
   | Variable | `IMAGE_PAGES_ENABLED` | `true` |
   | Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
   | Variable | `CLOUDFLARE_PAGES_PROJECT` | 第 1 步的项目名 |
   | Secret | `CLOUDFLARE_API_TOKEN` | 第 2 步的最小权限 token |

`IMAGE_PAGES_ENABLED` 未设置或不等于 `true` 时，CI 只会跳过图片上传。ECS 的行为仍由 `/etc/arknight-deploy.json` 的 `image_pages` 决定：它为 `null` 时继续本地发送 `/img`；若仍启用，则缺少当前 SHA 的验证记录会使新版本在切换前被拒绝，不能把“关闭 CI 上传”当作自动本地回退。token 只存在 GitHub Actions secret，不要放入仓库、`/etc/arknight-deploy.env`、ECS 用户家目录或 systemd 环境文件。

首次设置后，让一个新的 `main` 提交完整通过 `Production CI` 并成功生成 `cloudflare-images` deployment，才有可被 ECS 使用的记录。为已在 `main` 上存在、但没有图片 deployment 的同一 SHA 补设 variable，不会凭空产生记录；尤其当这个 SHA 已部署到 ECS 且 release 内没有 `image-pages.json` 时，再启用 `image_pages` 仍会被部署器拒绝。请用下一次通过 CI 的 `main` 提交启用图片发布。

## 2. ECS 启用图片版本绑定

先把包含此功能的版本发布到 ECS，但此时不必更改 Nginx。部署器默认禁用 Pages 图片：`/etc/arknight-deploy.json` 中 `image_pages` 缺失或为 `null` 时，全部图片继续本地提供。

用临时检出的当前 `deploy/install.sh` 升级已安装部署器，步骤见[生产部署文档](production-deployment.md#update-deployer)。安装器会创建 root 管理的 `/opt/arknight-guess/image-pages.map`，但会保留已有 map 文件，不会替换用户的 Nginx server 配置，也不会自动启用图片跳转。

私有仓库还需给 ECS 现有 GitHub fine-grained PAT 增加目标仓库的 **Deployments: Read-only** 权限；保留 Contents、Actions 只读。这与 GitHub Actions 自动获得的 `deployments: write` 权限不同，也与 Cloudflare token 无关。部署器读取记录返回 403 时先核对此项。

确认项目名后，编辑 root 管理的配置：

```bash
sudo nano /etc/arknight-deploy.json
```

添加或修改以下字段，其他字段保持不变：

```json
"image_pages": {
  "project": "arknight-guess-images"
}
```

启用前可先用 `null` 保持本地图片：

```json
"image_pages": null
```

配置 JSON 必须合法；错误的 project、缺少 Pages deployment、摘要不符或远端校验失败都会使候选发布在切换前失败，当前 app 与其已有图片路由保持运行。

## 3. 一次性配置 Nginx

自动发布的 runtime archive 只包含运行所需文件，**不包含 `deploy/`**。因此不要从 `/opt/arknight-guess/app/deploy/` 复制 Nginx 示例。用升级部署器时保留的临时 checkout；若已删除，以下命令重新取得仅含 `deploy/` 的临时 checkout。随后将 HTTP 层 map 示例安装为 `/etc/nginx/conf.d/arknight-image-pages.conf`。它必须在 `http {}` 范围被 Nginx 加载，不能贴入站点 `server {}` 块：

```bash
IMAGE_NGINX_DIR=$(mktemp -d /tmp/arknight-image-nginx.XXXXXX)
git clone --depth 1 --filter=blob:none --sparse --branch main \
  https://github.com/hongbi7/arknight-cczss.git "$IMAGE_NGINX_DIR"
git -C "$IMAGE_NGINX_DIR" sparse-checkout set deploy
sudo install -o root -g root -m 0644 \
  "$IMAGE_NGINX_DIR/deploy/nginx-image-pages-http.conf.example" \
  /etc/nginx/conf.d/arknight-image-pages.conf
```

上述匿名 clone 适用于公开仓库。私有仓库按[安装包方式](production-deployment.md#install-deployer)从已登录 GitHub 的本地电脑导出 main 的 `deploy/`、通过 Workbench 上传并解包，再将 `IMAGE_NGINX_DIR` 设为解包目录，执行上面的 `install` 命令。不要把 PAT 写进 clone URL。

该文件以 `$realpath_root` 查询 `/opt/arknight-guess/image-pages.map`。map 的默认值为空；只有已验证 release 的 `public` 真实目录有 URL，才允许 302。示例设置 `map_hash_bucket_size 128`，以容纳带 40 位 SHA 的完整路径；若其他 HTTP 配置已经设置此指令，保留一处且至少为 128，避免重复定义。参见 [Nginx map 哈希设置](https://nginx.org/en/docs/http/ngx_http_map_module.html#map_hash_bucket_size)。

接着，用临时 checkout 中的 [location 示例](../deploy/nginx-images-pages.location.example)替换游戏站点中原有的 `location ^~ /img/` 块：

```bash
sudo cat "$IMAGE_NGINX_DIR/deploy/nginx-images-pages.location.example"
sudo nano /etc/nginx/sites-available/arknight-guess
```

将前一条命令显示的完整 `location` 块粘贴到站点配置。新 location 在 `$arknight_image_origin` 非空时返回 `302` 和 `Cache-Control: no-store`，否则用原来的 `try_files` 本地发送图片。删除旧的手工固定 SHA/Pages URL 片段，避免它与 map 规则冲突。临时 checkout 可保留到本次配置验收完成。

检查并载入：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

若 `nginx -t` 或 reload 失败，修正配置后重试，**不要**开启 `image_pages`。部署器在每次带图片映射的发布前也会执行 Nginx 检查；检查失败不会切换 release。

Nginx 只重定向，让浏览器直接连接 Pages；不要使用 `proxy_pass` 代理 Pages，否则图片仍消耗 ECS 出口带宽。

## 4. 首次发布与验收

确认当前 `main` 的 Production CI 已在 `cloudflare-images` environment 显示成功 deployment，然后在 ECS 启动一次部署检查：

```bash
sudo systemctl start arknight-deploy.service
sudo journalctl -u arknight-deploy.service -n 150 --no-pager
sudo /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py status
```

部署日志应显示图片 deployment 被接受、远端抽样校验完成及最终 release SHA。确认 release 内的记录和 map：

```bash
RELEASE_DIR=$(readlink -f /opt/arknight-guess/app)
sudo cat "$RELEASE_DIR/image-pages.json"
sudo cat /opt/arknight-guess/image-pages.map
curl -I http://127.0.0.1/img/REPLACE_WITH_AN_EXISTING_IMAGE.webp
```

最后一条在有对应 Pages map 的 release 上应返回 302，`Location` 是 `https://<唯一部署>.<项目>.pages.dev/img/...`；跟随跳转应返回图片。对没有记录的手工基线、旧 release 或禁用 `image_pages` 的部署，应正常返回本地图片 200。

可用既有 SSH 隧道在浏览器中验收，无需开放新端口：

```bash
ssh -N -L 127.0.0.1:8080:127.0.0.1:80 YOUR_LOGIN_USER@YOUR_ECS_IP
```

打开 `http://127.0.0.1:8080`，禁用浏览器缓存后检查首页、三个模式、异常审计的四张选项图、终局候选、图片放大和移动布局。开发者工具应显示 API 仍来自 ECS，图片最终请求到 Pages。

## 回滚、关闭与排错

发布器的普通回滚命令会在切换前核对旧版本的 GitHub 发布记录，并重新验证 Pages 清单、摘要和图片样本；通过后才切回旧 `app` 软链接，并依据 map 选回那个 release 的图片 URL。没有图片记录的旧版本使用本地图片。回滚后发布器会 pin 自动发布，按[生产部署文档](production-deployment.md#operations)处理并在确认后 `resume`。不要删除当前或可回滚 release 对应的 Pages 历史部署。

要临时关闭 CDN，先把 `/etc/arknight-deploy.json` 的 `image_pages` 改为 `null`，然后运行一次部署检查。部署器会清空 map，使当前及后续 release 立即恢复本地图片；不要删除 `image-pages.map`，它仍是 Nginx 已加载的 include 文件。Pages 或用户网络故障时，Nginx 无法根据浏览器的下载失败自动切回 ECS，管理员需要用这一方式介入。

| 现象 | 原因与处理 |
| --- | --- |
| CI 没有 `cloudflare-images` deployment | 检查只在 `main` 上传；核对 `IMAGE_PAGES_ENABLED=true`、三个 GitHub 配置项和 secret。修正后让新的 `main` 提交完成 CI。 |
| `no matching image deployment` 或 deployment 被拒绝 | 当前 SHA 没有同一成功 CI run/attempt 的记录，或项目名、摘要、run 信息不一致。不要手工填写 URL；先修正 CI 配置并让新提交重新验证。 |
| 远端图片抽样或清单验证失败 | Pages 访问策略、项目、上传内容或网络异常。当前 release 保持不变；查看 CI 和 `arknight-deploy.service` 日志。 |
| `nginx -t`/reload 失败 | map 文件位置或 `/img/` location 配置错误。修正后先手动 `nginx -t`，再启动部署服务。 |
| 图片仍由 ECS 返回 200 | 当前 release 没有 `image-pages.json`、`image_pages` 未启用、map 未被 Nginx 加载，或 URL 与 `$realpath_root` 不匹配。核对上述三个文件与 `readlink -f` 输出。 |
| 浏览器拿到旧图片 | 旧页面已加载的图片或之前的本地图片缓存不会随发布自动刷新。禁用缓存并刷新页面重试；新图片请求按当前 release 路由，并非整页版本固定。 |

本轮实现没有把前端图片地址改为直接 Pages URL，也没有为 CDN 故障实现自动回源。保留 `public/img` 是发布预检、回滚和本地回退所必需的。
