# 生产部署与自动发布

这份文档面向第一次接触本项目的部署者，以 Ubuntu 24.04 LTS、Node.js 24 和 GitHub 仓库为例。公开仓库可匿名拉取；私有仓库需要本节后文的专用只读凭证。按顺序操作即可从一台新 ECS 建立本机可访问的站点，再启用自动发布；已有站点的用户可以跳过首次安装部分。

- **全新服务器**：[准备仓库与服务器](#prepare) → [首次安装应用](#bootstrap) → [安装自动部署器](#install-deployer) → [首次发布与启用定时](#first-release)。
- **已有手工部署**：核对[迁移前条件](#migration)后，从[安装自动部署器](#install-deployer)继续，保留现有生产密钥。
- **平时立即更新**：直接看[手动触发部署](#manual-deploy)。故障处理见[回滚与日常检查](#operations)。

标为“本地电脑”的命令在自己的终端运行；其余 `bash` 命令均在登录 ECS 后运行。把 `YOUR_LOGIN_USER`、`YOUR_ECS_IP` 等占位符替换为实际值。每个步骤出现错误时先停止并检查，不要继续复制后面的命令。首次安装命令只适用于尚未存在本项目用户、目录和配置的服务器。

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

私有 GitHub 仓库需要在 ECS 配置专用 fine-grained PAT，只授权目标仓库的 Contents 与 Actions 只读权限。该令牌同时用于读取 CI 和 HTTPS Git 拉取；配置及轮换方法见[私库凭证](#private-credentials)。

<a id="prepare"></a>

## 1. 准备仓库与服务器

### 1.1 确认准备发布的代码已在 main

先将完整代码、JSON、素材、`deploy/` 和 `.github/workflows/production-ci.yml` 合并到目标仓库的 `main`。打开仓库 **Actions → Production CI**，确认当前 `main` 提交的运行结果为绿色成功；PR 分支上的绿色检查不能代替合并后主分支的检查。如果尚无主分支运行记录，按[手动触发部署的第一步](#manual-ci)运行 CI。

本文使用 `hongbi7/arknight-cczss`。如果部署自己的 fork，请把文中 GitHub 仓库地址替换为自己的地址，并在安装部署器后把 `/etc/arknight-deploy.json` 的 `repository` 改成自己的 `所有者/仓库名`；确认 fork 的 Actions 已启用。不要把某个功能分支直接当作生产版本。

### 1.2 登录 ECS

准备一个能使用 `sudo` 的登录账号，以及至少数 GiB 的空闲磁盘空间。仅保留可信个人公网 IP 对 TCP 22 的访问；本教程当前阶段不需要开放 80/443，也不开放 3000。备案未完成时不绑定域名，Nginx 只监听服务器回环地址。ECS 需要能出站访问 Ubuntu 软件源、NodeSource、GitHub 和 GitHub API。

在本地电脑运行，或通过阿里云 Workbench 登录：

```bash
ssh YOUR_LOGIN_USER@YOUR_ECS_IP
```

在 ECS 上安装基础工具：

```bash
sudo apt update
sudo apt install -y git nginx curl ca-certificates openssl python3 util-linux nano
sudo timedatectl set-timezone Asia/Shanghai
df -h /opt
free -h
swapon --show
```

2 GiB 内存实例建议先准备 2 GiB Swap；如果系统已经有合适的 Swap，不要重复创建。自动部署下载前要求至少 2 GiB 空闲磁盘，实际还需容纳完整应用、备份和 Git 缓存，应留出更多余量。ECS 不执行数据生成，也不需要安装 Python 数据处理依赖或 Playwright 浏览器。

### 1.3 安装系统级 Node.js 24

部署服务固定使用 `/usr/bin/node`，不能仅在个人账号的 nvm 环境中安装。以下使用 NodeSource 的系统软件源：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/arknight-nodesource-setup.sh
sudo bash /tmp/arknight-nodesource-setup.sh
sudo apt install -y nodejs
/usr/bin/node --version
npm --version
```

Node 版本必须显示 `v24.x.x`；如果脚本下载或安装失败，先解决网络或软件源问题。安装方式参考 [NodeSource 的 Ubuntu 安装说明](https://github.com/nodesource/distributions/blob/master/DEV_README.md)。

<a id="bootstrap"></a>

## 2. 全新服务器首次安装应用

自动部署安装脚本需要一个已能运行的应用作为回滚基线，因此先完成本节。已有手工部署的用户不要重复创建用户、克隆到原目录或生成新密钥，直接核对下一节的迁移条件。

### 2.1 创建服务用户并取得代码

下列直接 `clone` 适用于公开仓库。私库首次建站仍先执行创建用户和两个目录的命令，再在自己已登录 GitHub 的本地仓库用 `git fetch origin`、`git archive --format=tar.gz --output=bootstrap.tar.gz origin/main` 导出主分支，并通过 Workbench 上传到 ECS 临时目录。确认其对应提交 CI 成功后，在空的 `app` 目录中以 `arkguess` 解包，例如 `sudo -u arkguess tar -xzf /tmp/bootstrap.tar.gz -C /opt/arknight-guess/app`；记录本地 `git rev-parse origin/main` 的 SHA。解包版不含 `.git`，跳过下方 clone 和 rev-parse。不要为首次安装把个人 GitHub 凭证写进仓库 URL。

```bash
sudo useradd --system --user-group --no-create-home \
  --home-dir /opt/arknight-guess --shell /usr/sbin/nologin arkguess
sudo install -d -o root -g root -m 0755 /opt/arknight-guess
sudo install -d -o arkguess -g arkguess -m 0755 /opt/arknight-guess/app
sudo -u arkguess git clone --depth 1 --branch main --single-branch \
  https://github.com/hongbi7/arknight-cczss.git /opt/arknight-guess/app
sudo -u arkguess git -C /opt/arknight-guess/app rev-parse HEAD
```

将最后输出的 40 位 SHA 与 GitHub 上成功的 `Production CI` 主分支运行核对。如果克隆期间 `main` 有更新，等待这个实际克隆版本的 CI 成功后再启动服务。

本项目没有前端构建步骤，当前运行时没有第三方 npm 依赖，应用与游戏单元测试可以直接使用 Node 运行；首次 ECS 安装无需 `npm install`。数据和图片直接使用已经通过 CI 的仓库文件。运行游戏测试：

```bash
cd /opt/arknight-guess/app
sudo -u arkguess npm test
```

只有测试通过才继续。将来如果项目新增生产依赖，应先升级部署流程，不能套用当前的无依赖安装步骤。

### 2.2 生成并保护生产密钥

以下命令只在密钥文件不存在时创建文件，将随机密钥直接写入文件，不会打印密钥：

```bash
sudo sh -eu -c '
  test ! -e /etc/arknight-guess.env
  umask 077
  secret=$(openssl rand -hex 32)
  printf "GAME_SECRET=%s\n" "$secret" > /etc/arknight-guess.env
  chown root:root /etc/arknight-guess.env
  chmod 600 /etc/arknight-guess.env
'
sudo stat -c '%a:%U:%G' /etc/arknight-guess.env
```

最后应输出 `600:root:root`。已有文件时创建命令会停止，应保留原密钥并检查现有配置。密钥文件不要提交到 GitHub；请单独安全备份，更换密钥会使正在进行的对局 token 失效。

### 2.3 安装并启动 Node 服务

```bash
sudo install -o root -g root -m 0644 \
  /opt/arknight-guess/app/deploy/arknight-guess.service \
  /etc/systemd/system/arknight-guess.service
sudo systemctl daemon-reload
sudo systemctl enable --now arknight-guess.service
sudo systemctl status arknight-guess.service --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

服务应为 `active (running)`，接口应返回 `{"status":"ok","release":"local"}`。首次克隆还没有自动发布生成的版本标记，所以 `local` 正常。服务示例已设置 `HOST=127.0.0.1`、`PORT=3000`、`SERVE_STATIC=false`，此时直接访问 Node 的 `/` 返回 404 也正常，页面由下一步的 Nginx 提供。

如果服务启动失败，先查看 `sudo journalctl -u arknight-guess.service -n 100 --no-pager`，重点检查 Node 路径、密钥文件、应用目录和端口占用。

### 2.4 安装本机 Nginx 站点

以下命令针对全新 Ubuntu 的默认 Nginx 配置，移除的只是默认站点启用链接。如果服务器还有其他站点，应先检查现有 `listen` 和默认虚拟主机，避免覆盖其配置。

```bash
sudo install -o root -g root -m 0644 \
  /opt/arknight-guess/app/deploy/nginx-arknight-guess.conf.example \
  /etc/nginx/sites-available/arknight-guess
if [ -L /etc/nginx/sites-enabled/default ]; then
  sudo unlink /etc/nginx/sites-enabled/default
fi
sudo ln -s /etc/nginx/sites-available/arknight-guess /etc/nginx/sites-enabled/arknight-guess
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl -fsSI http://127.0.0.1/
curl -fsS http://127.0.0.1/api/health
sudo -u arkguess node /opt/arknight-guess/app/scripts/check_deployment.js --base-url http://127.0.0.1
```

首页应返回 HTTP 200，经过 Nginx 的健康接口也应返回 `status: "ok"`；检查脚本应输出健康检查和三种模式开局通过。`nginx -t` 失败时不要 reload，先修正配置。Nginx 根目录必须是 `app/public`，不能是仓库根目录或 `server-data`。

### 2.5 在自己的浏览器中验收

由于站点只监听回环地址，直接打开 ECS 公网 IP 不会显示游戏。在本地电脑另开一个终端建立 SSH 隧道，并让该终端保持运行：

```bash
ssh -N -L 127.0.0.1:8080:127.0.0.1:80 YOUR_LOGIN_USER@YOUR_ECS_IP
```

浏览器打开 `http://127.0.0.1:8080`，分别开始终局校验、无尽模式和异类审查，确认页面、图片和 API 正常。若本地 8080 被占用，可把命令中的 8080 改为 8081，并使用对应浏览器地址。关闭隧道终端只会结束本地访问，不会停止 ECS 上的服务。

<a id="migration"></a>

## 3. 迁移前条件

先完成当前前端细节、运行测试并将完整版本合并到 GitHub `main`。本地未提交的修改以及尚在功能分支的提交不会被服务器自动获取。

服务器应已按现有手工方案配置：

- Ubuntu、Node.js 24、Nginx 和 Git 已安装；`node -v` 显示 `v24.x`。
- `arkguess` 是 `/usr/sbin/nologin` 服务用户；现有 `arknight-guess.service` 已运行。
- 当前实际应用目录是 `/opt/arknight-guess/app`，内容来自已确认的 `main` 版本；可以是 Git 工作目录或首次上传解包的版本。
- `/etc/arknight-guess.env` 存在，内容含 `GAME_SECRET=...`，并且权限为 `root:root`、`0600`。
- Nginx 已在本机 `127.0.0.1:80` 把站点根目录设为 `/opt/arknight-guess/app/public`，只把 `/api/` 反向代理到 `127.0.0.1:3000`。
- ECS 能以出站 HTTPS 访问 `github.com` 和 `api.github.com`。不需要放宽入站 SSH。

生产密钥必须固定留在 `/etc/arknight-guess.env`，不要提交到 Git。更换它会使正在进行的 token 对局失效。

备案通过前无需把站点绑定到域名。自动部署会从本机 Nginx 入口完成校验；需要测试时请在 ECS 本机执行 `curl http://127.0.0.1/`，不要为了部署器临时开放端口或创建证书。

<a id="install-deployer"></a>

## 4. 安装自动部署器

先把包含本部署文件和 CI 工作流的提交合并到 `main`。以下匿名下载适用于公开仓库；私库使用后面的安装包方式。两种方式都不会对正在运行的 `/opt/arknight-guess/app` 执行 `git pull`：

```bash
DEPLOY_INSTALL_DIR=$(mktemp -d /tmp/arknight-deploy-install.XXXXXX)
git clone --depth 1 --filter=blob:none --sparse --branch main \
  https://github.com/hongbi7/arknight-cczss.git "$DEPLOY_INSTALL_DIR"
git -C "$DEPLOY_INSTALL_DIR" sparse-checkout set deploy
sudo bash "$DEPLOY_INSTALL_DIR/deploy/install.sh"
```

私库在自己已登录 GitHub 的本地仓库执行（实例 ID 替换为自己的值）：

```bash
git fetch origin
git rev-parse origin/main
git archive --format=tar.gz --output=installer.tar.gz origin/main deploy
workbench upload installer.tar.gz /tmp/arknight-installer.tar.gz -i YOUR_INSTANCE_ID
```

记录输出 SHA，并确认是准备安装的版本。在 ECS 执行：

```bash
DEPLOY_INSTALL_DIR=$(mktemp -d /tmp/arknight-deploy-install.XXXXXX)
tar -xzf /tmp/arknight-installer.tar.gz -C "$DEPLOY_INSTALL_DIR"
sudo bash "$DEPLOY_INSTALL_DIR/deploy/install.sh"
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

安装完成后可保留这个临时目录用于核对，后续重装使用新的临时目录即可。用 `sudo nano /etc/arknight-deploy.json` 检查配置；部署自己 fork 的用户此时必须修改 `repository`。其中 `public_url` 是部署器经 Nginx 验证静态资源的入口：

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

现有 Nginx 如果监听 `127.0.0.1:8080`，应把 `public_url` 改成 `http://127.0.0.1:8080`；不要仅为符合示例改动已有站点端口，也不要误用返回 Nginx 欢迎页的默认站点。

<a id="private-credentials"></a>

### 私库凭证与轮换

私库必须配置凭证；公开仓库匿名 API 经常限流时也可配置。在 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens 创建专用令牌，Repository access 只选择目标仓库，Contents 和 Actions 均设为 Read-only，Metadata 保持只读，并设置到期时间。不要使用具有仓库写权限的个人日常令牌。[GitHub 令牌说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

在 ECS 使用编辑器写入 `/etc/arknight-deploy.env`，不要在命令行参数、聊天或日志中粘贴令牌：

```ini
GITHUB_TOKEN=REPLACE_WITH_DEDICATED_READ_ONLY_TOKEN
```

```bash
sudo chown root:root /etc/arknight-deploy.env
sudo chmod 600 /etc/arknight-deploy.env
sudo stat -c '%a:%U:%G' /etc/arknight-deploy.env
```

应返回 `600:root:root`。安装器会拒绝权限不符或为软链接的凭证文件。systemd 每次启动部署服务时读取该文件，无需把令牌提交到仓库或设置为 GitHub Actions secret。

令牌只在部署协调器读取 API 和 `arkdeploy` 的 Git fetch 进程中使用。Git 的认证头通过进程环境配置传入，限定于目标 GitHub 仓库 URL，禁用重定向与凭证存储助手；不会写入命令行、Git remote、缓存配置或发布目录，也不会传给 `arkguess` 的候选 Node 进程。实现依据 [Git 环境配置说明](https://git-scm.com/docs/git-config#Documentation/git-config.txt-GIT_CONFIG_COUNT)。

到期前创建同权限的新令牌，在没有部署运行时替换 env 文件中的值，保持 `root:root`、`0600`，手动执行一次部署检查确认 API 和 Git 均可访问，再撤销旧令牌。401/404 可能表示令牌过期、选错仓库或权限不足，403 也可能是限流；失败发生在切换前会保留当前线上版本。直接在命令行运行 Python `check` 不会自动加载这个 env 文件，请通过 `systemctl start arknight-deploy.service` 触发。

<a id="first-release"></a>

## 5. 首次发布与启用定时

确认目标仓库当前 `main` 的 `Production CI` 成功后，在 ECS 手动启动第一次发布：

```bash
sudo systemctl start arknight-deploy.service
sudo journalctl -u arknight-deploy.service -n 100 --no-pager
sudo systemctl show arknight-deploy.service -p Result -p ExecMainStatus
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1/api/health
curl -fsSI http://127.0.0.1/
```

只有日志出现 `deployed <SHA>`，且健康接口的 SHA 与主分支提交一致，才说明首个自动发布成功。如果日志为 `no successful production CI run`，本次检查只是跳过发布；等 GitHub 上当前 `main` 的 CI 成功后重跑上一条命令。`arknight-deploy.service` 是 oneshot，完成后显示 `inactive (dead)` 属于正常状态，需结合退出码和日志判断结果。

确认成功后启用周期检查：

```bash
sudo systemctl enable --now arknight-deploy.timer
systemctl list-timers arknight-deploy.timer
systemd-analyze calendar '*-*-* 12:30:00 Asia/Shanghai'
```

首次安装保留的手工版本可能尚无 `/api/health`（返回 404），或者没有 `deployment-version.json`（接口返回 `release: "local"`）。回滚到这份基线时，部署器改为验证服务、一次 sudden 开局和本机 Nginx 首页。首个自动发布成功后，`/api/health` 应返回 `status: "ok"` 和 40 位 release 提交 SHA。`app-manual-backup-*` 保留完整旧目录，不参与自动清理。

<a id="manual-deploy"></a>

## 6. 手动触发部署：立即更新，不等 12:30

手动发布使用同一个部署服务，仍会检查当前 `main` 的 CI、预检候选版本并验证切换结果。它不能部署未合并分支，也不能绕过失败的 CI。timer 未启用时也能手动运行；手动执行不会改变下一次 12:30 的定时计划。

<a id="manual-ci"></a>

### 6.1 在 GitHub 确认或手动运行 CI

先合并需要发布的 PR。如果当前 `main` 最新一次 `Production CI` 已成功，无需再跑 CI，直接继续 6.2。没有成功记录时：

1. 打开目标仓库的 **Actions** 页，选择 **Production CI**。
2. 点击 **Run workflow**，分支选择 **main**，再点击运行。
3. 打开新运行记录，等待整个工作流绿色成功，并核对其提交 SHA 仍是当前 `main`。

手动运行需要仓库写权限，且工作流文件应已在默认分支；本项目已配置 `workflow_dispatch`。看不到按钮时先核对权限、文件是否合并及 fork 的 Actions 开关。操作依据 [GitHub 手动运行工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

如果本地已安装并登录 GitHub CLI，也可在本地电脑运行（fork 用户替换仓库名）：

```bash
gh workflow run production-ci.yml --repo hongbi7/arknight-cczss --ref main
gh run watch --repo hongbi7/arknight-cczss
```

在 `run watch` 的列表中选择刚触发的运行。GitHub 的 **Run workflow** 只启动 CI，**不会直接触发 ECS 部署**。CI 成功后继续下一步，或者等待每日 12:30。

### 6.2 在 ECS 立即执行一次部署检查

```bash
sudo /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py status
sudo systemctl start arknight-deploy.service
sudo systemctl show arknight-deploy.service -p Result -p ExecMainStatus
sudo journalctl -u arknight-deploy.service -n 100 --no-pager
```

`systemctl start` 通常等待这次 oneshot 完成，首次下载可能耗时较长；可在第二个 SSH 窗口用 `sudo journalctl -u arknight-deploy.service -f` 查看进度，按 Ctrl+C 退出日志跟随不会停止部署。完成后的 `inactive (dead)` 正常，`Result=success` 和 `ExecMainStatus=0` 仅说明检查正常结束，还需要看日志判断是否实际发布。[systemctl 手册](https://manpages.ubuntu.com/manpages/noble/man1/systemctl.1.html)

如果服务已经在执行，不要反复 `restart` 中断它；等待这次完成。也不要对 `app` 手动 `git pull`：安装部署器后它是指向发布目录的软链接，正式 release 也不包含 `.git`。仅重启 `arknight-guess.service` 只会重启当前代码，不会下载新版本。

| 本次日志 | 含义和下一步 |
| --- | --- |
| `deployed <SHA>` | 已切换并完成发布检查，继续核对健康接口。 |
| `already deployed <SHA>` | 当前已是这个版本，不会重复部署或重启。 |
| `no successful production CI run for <SHA>` | 当前 main 尚无符合条件的成功 CI，本次未更新；完成 6.1 后重试。 |
| `automatic deployment is pinned` | 发布已暂停，手动 `start` 也不会绕过；查明回滚或失败原因后按下一段解除。 |
| `deployment refused` / `deployment failed` | 查看同一次运行前后的日志及应用状态，修复网络、磁盘、权限或应用问题后再试。 |

若状态显示 `pinned=true`，先按[回滚与日常检查](#operations)确认故障已经修复，再执行：

```bash
sudo /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py resume
sudo systemctl start arknight-deploy.service
```

`resume` 只解除暂停，不会立即部署，也不会开启一个已禁用的 timer；上面的 `start` 才启动本次检查。

### 6.3 确认真正发布成功

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1/api/health
curl -fsSI http://127.0.0.1/
readlink -f /opt/arknight-guess/app
sudo /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py status
```

两处健康响应的 `release` 都应是本次日志中 `deployed` 的 40 位 SHA，首页应为 HTTP 200，`app` 应指向 `/opt/arknight-guess/releases/<同一个SHA>`。再通过 SSH 隧道打开页面验收。若发布后 `main` 又有新提交，它要通过自己的 CI 后才能在下一次检查发布；不要把后来的 SHA 与本次部署混为一谈。

## 7. Nginx 与 Node 服务调整

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

<a id="operations"></a>

## 8. 回滚与日常检查

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

## 9. 调整已安装的部署器

已安装旧版本的用户需要手动把 `/etc/arknight-deploy.json` 的 `public_url` 改为 `http://127.0.0.1`。重新用临时检出的当前 `deploy/install.sh` 安装后，脚本会更新 timer 文件但保留该配置；接着执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart arknight-deploy.timer
systemctl list-timers arknight-deploy.timer
systemd-analyze calendar '*-*-* 12:30:00 Asia/Shanghai'
```

这样才会使用每日北京时间 12:30 的计划。安装脚本和 timer 不会自动修改已存在的 `public_url`、Nginx、证书或正在运行的游戏服务。

日历表达式明确指定 `Asia/Shanghai`，不依赖服务器显示时区；`Persistent=false` 表示错过当天时点不会在开机时补跑。语法与补跑行为参见 Ubuntu 的 [systemd.time](https://manpages.ubuntu.com/manpages/noble/man7/systemd.time.7.html) 和 [systemd.timer](https://manpages.ubuntu.com/manpages/noble/man5/systemd.timer.5.html) 手册。

## 10. 更新部署器本身

部署器不会自行更新，也不会自动提权更新 systemd 或 Nginx。要升级它，先把相应仓库提交合并到 `main`，再用临时检出的该版本重新运行 `deploy/install.sh`。脚本会暂停 timer、保留配置和现有 release，然后重新安装部署器文件；完成后先手动运行一次 `arknight-deploy.service`，确认无误再恢复 timer。

## 11. 实现边界与参考

本地验证覆盖游戏测试、数据校验、浏览器核心流程、部署器故障与归档测试、安装脚本语法。真正的 Ubuntu systemd、本机 Nginx 目录权限及首次迁移需要按上述步骤在 ECS 上验证；备案通过后再验证域名/HTTPS。仓库文件完成不代表服务器已经启用自动部署。

GitHub 运行记录的字段与查询方式见 [Workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)。当前数据任务使用的 `GITHUB_TOKEN` 推送不会触发普通 `push` 工作流，人工合并后的主分支推送会运行 CI；如果以后改成机器人自动合并，需同时处理这个触发边界，或者在 `main` 上显式手动触发 `Production CI`。参见 [GitHub token 的触发规则](https://docs.github.com/en/actions/concepts/security/github_token)。
