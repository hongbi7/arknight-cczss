# 生产部署与自动发布

本项目在生产环境使用以下结构：

```text
本机 Nginx（127.0.0.1:80） ── /api/ ──► Node.js 24（127.0.0.1:3000，systemd）
   │                         ▲
   └── /opt/arknight-guess/app/public
                             │
                    app 软链接指向当前 release
                             ▲
GitHub main + 通过 CI ──► ECS 定时主动拉取
```

Nginx 直接提供 `public/`，包括约数百 MiB 的图片；Node 只处理 `/api/`。没有 Docker、宝塔或数据库。游戏状态在加密 token 中，题库和档案是仓库内的 JSON，因此每个发布目录都是可独立运行的版本。

部署器由 ECS 主动建立 HTTPS 出站连接到 GitHub。GitHub Actions 没有服务器私钥，也不会 SSH 到 ECS，现有“22 端口仅允许个人公网 IP”的安全组规则可以保持不变。备案未通过前，本方案不需要域名、DNS 或证书；示例 Nginx 只监听 `127.0.0.1:80`，自动部署检查不会经过公网。无论何时都不要公开 3000。

## 发布规则

自动数据任务继续只创建草稿 PR。先审查数据、素材和严格校验结果，再把 PR 合并到 `main`。生产部署器只考虑 `main` 当前头提交，且该提交最新一次 `production-ci.yml` 的 `push` 或手动运行必须成功完成。PR 的检查结果不会直接授权生产发布；合并后会重新检查实际的 `main` 提交。草稿、未合并分支、旧提交的成功记录和只跑了一半的更新都不会发布。

`Production CI` 使用 Node 24、Python 3.13，执行游戏单元测试、部署故障测试、数据管线测试、已提交 JSON 的哈希与素材完整性校验，以及现有的桌面/移动端三模式核心流程回归。它不会重新生成游戏数据，不需要生产密钥，也不需要服务器登录凭据。

ECS 每天北京时间 12:30:00 启动一次检查，计时精度为一秒，错过该时间不会补跑。这里的时间是开始检查的时间，不是发布完成的保证时间；下载、候选测试和切换仍需要时间。若当天 `main` 的 CI 尚未成功，部署器会跳过，等到第二天 12:30 再检查，也可以在 CI 成功后手动运行 `systemctl start arknight-deploy.service`。下载耗时较长时不会叠加新任务。它发现目标提交后才下载、测试并切换 `app` 软链接。CI 成功表示仓库版本已验证；服务器端仍以 `journalctl` 和健康检查确认它实际部署成功。

这个时间只控制 ECS 部署检查；现有数据更新工作流的定时规则、草稿 PR 流程和合并后触发 CI 的规则都不改变。

目前只支持公开 GitHub 仓库。私有仓库需要另行设计只读部署凭证和密钥轮换，不能仅通过在本机加入 token 来假定可用。

## 部署前条件

先完成当前前端细节、运行测试并将完整版本合并到 GitHub `main`。本地未提交的修改以及尚在功能分支的提交不会被服务器自动获取。

服务器应已按现有手工方案配置：

- Ubuntu、Node.js 24、Nginx 和 Git 已安装；`node -v` 显示 `v24.x`。
- `arkguess` 是 `/usr/sbin/nologin` 服务用户；现有 `arknight-guess.service` 已运行。
- 当前实际 Git 工作目录是 `/opt/arknight-guess/app`，分支为 `main`。
- `/etc/arknight-guess.env` 存在，内容含 `GAME_SECRET=...`，并且权限为 `root:root`、`0600`。
- Nginx 已在本机 `127.0.0.1:80` 把站点根目录设为 `/opt/arknight-guess/app/public`，只把 `/api/` 反向代理到 `127.0.0.1:3000`。
- ECS 能以出站 HTTPS 访问 `github.com` 和 `api.github.com`。不需要放宽入站 SSH。

生产密钥必须固定留在 `/etc/arknight-guess.env`，不要提交到 Git。更换它会使正在进行的 token 对局失效。

备案通过前无需把站点绑定到域名。自动部署会从本机 Nginx 入口完成校验；需要测试时请在 ECS 本机执行 `curl http://127.0.0.1/`，不要为了部署器临时开放端口或创建证书。

## 一次性安装

先把包含本部署文件和 CI 工作流的提交合并到 `main`。在 ECS 上用一个临时目录取得安装脚本；这不会对正在运行的 `/opt/arknight-guess/app` 执行 `git pull`：

```bash
git clone --depth 1 --filter=blob:none --sparse --branch main \
  https://github.com/hongbi7/arknight-cczss.git /tmp/arknight-deploy-install
git -C /tmp/arknight-deploy-install sparse-checkout set deploy
sudo bash /tmp/arknight-deploy-install/deploy/install.sh
```

临时稀疏克隆只取安装所需的 `deploy/` 和根目录文件。首个正式发布仍需下载完整运行资源；若实际下载速度受限于 3 Mbps，数百 MiB 图片可能需要十几分钟。后续部署保留 bare Git 缓存，浅抓取当前主分支并复用已有 Git 对象。完整 release、手工基线备份、临时 archive 和 Git 缓存仍占用本机空间。发布器默认保留 3 个 release，下载前要求至少 2 GiB 空闲；建议实际预留更多，不要在磁盘接近满时启用自动发布。服务器不会安装 npm 包或执行数据构建；将来新增生产依赖时，部署器会拒绝发布，需先更新部署流程。

安装脚本会验证 Ubuntu 工具、Node 24、现有应用服务和用户、以及 `GAME_SECRET` 文件的所有者和权限。它还会：

- 停止已有部署 timer 并获得部署锁，避免与正在进行的检查并发；
- 创建不可登录的 `arkdeploy` 用户，用于管理 `/opt/arknight-guess/releases` 和 `/opt/arknight-guess/repository.git`；
- 将原有实际 `app` 目录改名为 `app-manual-backup-<UTC 时间>`，然后创建同名 `app` 软链接指向该完整备份；
- 安装部署器、systemd unit 和默认配置，但保留已经存在的部署配置或部署环境文件；
- 不重启当前 Node 服务、不改写既有 Nginx/Certbot 配置、也不启用 timer。

部署协调器和配置保存在 root 管理的位置。拉取/归档 Git 由 `arkdeploy` 执行，候选服务及开局检查由 `arkguess` 执行；仓库中的应用脚本不会以 root 身份运行。生产 `GAME_SECRET` 不会传给 Git 或候选预检。已解包的正式版本保持 root 所有，应用用户只有读取权限。

这次目录切换是一次很短的静态文件路径转换；备份通过重命名保留，安装脚本不递归删除应用目录。运行中的 Node 继续使用原版本，直到未来发布时才重启。

检查 `/etc/arknight-deploy.json`，其中 `public_url` 是部署器经 Nginx 验证静态资源的入口：

```json
{
  "repository": "hongbi7/arknight-cczss",
  "branch": "main",
  "workflow": "production-ci.yml",
  "root_dir": "/opt/arknight-guess",
  "service": "arknight-guess",
  "app_user": "arkguess",
  "deploy_user": "arkdeploy",
  "health_url": "http://127.0.0.1:3000",
  "public_url": "http://127.0.0.1",
  "keep_releases": 3
}
```

如果 GitHub API 匿名访问经常触发限额，可创建只具公开只读权限的 token 并保存到 `/etc/arknight-deploy.env`：

```ini
GITHUB_TOKEN=...
```

该文件若创建，也应使用 `root:root` 和 `0600`。它只用于 GitHub API 读取，不会赋予 CI 服务器访问权限，也不能把私有仓库支持变成已配置状态。

先手动做一次检查并查看结果：

```bash
sudo systemctl start arknight-deploy.service
sudo journalctl -u arknight-deploy.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3000/api/health
curl -fsSI http://127.0.0.1/
```

只有日志出现 `deployed <SHA>`，且健康接口的 SHA 与主分支提交一致，才说明首个自动发布成功。如果日志为 `no successful production CI run`，本次检查只是跳过发布；等 GitHub 上当前 `main` 的 CI 成功后重跑上一条命令。`arknight-deploy.service` 是 oneshot，完成后显示 `inactive (dead)` 属于正常状态，需结合退出码和日志判断结果。

确认成功后启用周期检查：

```bash
sudo systemctl enable --now arknight-deploy.timer
systemctl list-timers arknight-deploy.timer
```

首次安装保留的手工版本可能尚无 `/api/health`（返回 404），或者没有 `deployment-version.json`（接口返回 `release: "local"`）。回滚到这份基线时，部署器改为验证服务、一次 sudden 开局和本机 Nginx 首页。首个自动发布成功后，`/api/health` 应返回 `status: "ok"` 和 40 位 release 提交 SHA。`app-manual-backup-*` 保留完整旧目录，不参与自动清理。

## Nginx 与 Node 服务

[Nginx 示例](../deploy/nginx-arknight-guess.conf.example) 是备案前的本机配置：它只监听 `127.0.0.1:80`，以便部署器检查 `index.html`、`data/names.json` 和 `/api/health` 是否来自同一 release，站点不会对外提供访问。`/api/` 使用 `no-store`，`index.html` 使用 `no-cache`，而图片可缓存一天并允许陈旧内容短暂复用。

备案通过、域名解析生效后，再创建或修改 HTTPS 虚拟主机，配置证书和需要的公开 `listen 80/443`，并把 `/etc/arknight-deploy.json` 的 `public_url` 改为正式 `https://` 域名。保留本示例的 `root`、`location` 与缓存规则，且不要把 `server-data/` 设为可访问根目录。此切换不是自动部署器会执行的操作。

[Node systemd 示例](../deploy/arknight-guess.service) 增加了 `SERVE_STATIC=false`，使生产 Node 仅处理 API；Nginx 已直接发送静态文件。为避免覆盖现有服务，可按需创建 systemd drop-in：

```bash
sudo systemctl edit arknight-guess.service
```

填入：

```ini
[Service]
Environment=SERVE_STATIC=false
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart arknight-guess.service
```

这一步是可选的：Node 默认仍可在本地直接发送静态文件。无论是否设置，Nginx 都应继续从 `app/public` 发送静态资源，且绝不能把 `server-data/` 设为可访问根目录。

## 发布、回滚与日常检查

自动检查和发布日志：

```bash
sudo journalctl -u arknight-deploy.service -f
sudo systemctl status arknight-deploy.timer
sudo journalctl -u arknight-guess -f
sudo tail -f /var/log/nginx/error.log
```

查看部署状态和可回滚版本：

```bash
sudo /usr/bin/python3 /usr/local/lib/arknight-deploy/pull_deploy.py status
```

若需要手工回到状态列出的 40 位提交 SHA，把下例的 `REPLACE_WITH_40_CHARACTER_SHA` 替换为实际提交号：

```bash
sudo /usr/bin/python3 /usr/local/lib/arknight-deploy/pull_deploy.py rollback REPLACE_WITH_40_CHARACTER_SHA
```

回滚成功会把该提交设为当前版本，并将 `/opt/arknight-guess/deploy-state.json` 标记为 `pinned`，从而暂停自动升级。排查完成后明确恢复自动发布：

```bash
sudo /usr/bin/python3 /usr/local/lib/arknight-deploy/pull_deploy.py resume
sudo systemctl start arknight-deploy.service
```

发布器为候选版本运行检查；切换后的健康检查还会比较经本机 Nginx 读取的 `index.html` 和 `data/names.json` 哈希，确认静态根目录确实指向同一 release。如果切换或健康检查失败，会恢复上一个已知可用 release 并重启服务。恢复成功后它会记录失败提交并自动设为 `pinned`，避免下一个每日检查重复造成中断。排查或修复后使用 `resume` 明确解除暂停。每次发布仍会重启 Node，因而会有短暂请求中断。题库改版时，旧 token 对局也不承诺可以继续；固定的 `GAME_SECRET` 只避免因密钥变动额外使所有 token 失效。

切换前会先将恢复记录写入 `deploy-state.json`。若断电、进程被杀或服务超时导致操作中断，下次 `check` 会优先恢复记录中的上一版本并暂停发布；恢复也失败时会保留记录并明确报错。此时先查应用日志，不要删除状态文件或盲目 `resume`。网络、GitHub API、磁盘或候选预检在切换前失败时，当前版本继续运行。

系统升级前创建 ECS 快照，并备份 `/etc/arknight-guess.env`、`/etc/arknight-deploy.json`、Nginx 配置和证书续期配置。没有数据库需要备份。2 GB 内存实例建议准备 2 GB Swap：常驻游戏服务限制为 768 MiB，部署服务也限制为 768 MiB（候选 Node 的堆上限为 384 MiB），还需要给 Ubuntu、Nginx 和内核留出余量。持续观察 CPU、内存、磁盘和公网带宽；当 3 Mbps 经常跑满时，优先将 `/img` 迁移至 OSS + CDN。

## 调整已安装的部署器

已安装旧版本的用户需要手动把 `/etc/arknight-deploy.json` 的 `public_url` 改为 `http://127.0.0.1`。重新用临时检出的当前 `deploy/install.sh` 安装后，脚本会更新 timer 文件但保留该配置；接着执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart arknight-deploy.timer
systemctl list-timers arknight-deploy.timer
systemd-analyze calendar '*-*-* 12:30:00 Asia/Shanghai'
```

这样才会使用每日北京时间 12:30 的计划。安装脚本和 timer 不会自动修改已存在的 `public_url`、Nginx、证书或正在运行的游戏服务。

日历表达式明确指定 `Asia/Shanghai`，不依赖服务器显示时区；`Persistent=false` 表示错过当天时点不会在开机时补跑。语法与补跑行为参见 Ubuntu 的 [systemd.time](https://manpages.ubuntu.com/manpages/noble/man7/systemd.time.7.html) 和 [systemd.timer](https://manpages.ubuntu.com/manpages/noble/man5/systemd.timer.5.html) 手册。

## 更新部署器本身

部署器不会自行更新，也不会自动提权更新 systemd 或 Nginx。要升级它，先把相应仓库提交合并到 `main`，再用临时检出的该版本重新运行 `deploy/install.sh`。脚本会暂停 timer、保留配置和现有 release，然后重新安装部署器文件；完成后先手动运行一次 `arknight-deploy.service`，确认无误再恢复 timer。

## 实现边界与参考

本地验证覆盖游戏测试、数据校验、浏览器核心流程、部署器故障与归档测试、安装脚本语法。真正的 Ubuntu systemd、本机 Nginx 目录权限及首次迁移需要按上述步骤在 ECS 上验证；备案通过后再验证域名/HTTPS。仓库文件完成不代表服务器已经启用自动部署。

GitHub 运行记录的字段与查询方式见 [Workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)。当前数据任务使用的 `GITHUB_TOKEN` 推送不会触发普通 `push` 工作流，人工合并后的主分支推送会运行 CI；如果以后改成机器人自动合并，需同时处理这个触发边界，或者在 `main` 上显式手动触发 `Production CI`。参见 [GitHub token 的触发规则](https://docs.github.com/en/actions/concepts/security/github_token)。
