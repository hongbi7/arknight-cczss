# Cloudflare Pages 图片部署操作记录（2026-09-09）

时间均为北京时间。目标实例 `i-uf6et2zckziswwrhhmpe`，地域 `cn-shanghai`。本文记录实际执行的命令、结果和原因；未执行的工作会明确标注。凭证内容不进入记录。

**最终状态：2026-09-09 19:33:52 部署成功，19:35:43 入口验收通过。** 当前应用为 `9b1d0d544549c1a8f4b7abafb45bd3dccf4487b2`；3,492 张图片通过清单/抽样校验，固定 origin 为 `https://9925819a.arknight-guess-images.pages.dev`。Nginx 仍只在 `127.0.0.1:8080` 提供游戏入口，Node 在 `127.0.0.1:3000`；每日 12:30 timer 正常。用户已完成两项凭证操作，无待完成的人工配置。

## 1. 连接前核对（本地）

执行 `git status --short`、`git branch --show-current`、`workbench connect --help`，确认本地 Pages 分支为 `codex/cloudflare-pages-images`，原工作区干净，Workbench 已安装。用 GitHub CLI 查询 Actions 变量、Secret 名称和 main CI。首次受沙箱网络代理阻断，重试正常网络环境后确认 GitHub 登录有效，变量和 Secret 列表均为空。

main 的成功 CI 为 [34335654265](https://github.com/hongbi7/arknight-cczss/actions/runs/34335654265)，SHA 为 `c8b9ed073839a1d572d2508afbd62a7882d35862`。main 新增了私有仓库认证支持；本地 Pages 提交 `9d48805` 尚未推送，因此不能直接从 main 安装 Pages 功能。需要先兼容这两部分，再通过 CI 发布。

## 2. 18:58 连接并读取运行配置（服务器，只读）

本地执行：

```powershell
workbench connect -i i-uf6et2zckziswwrhhmpe
```

连接到 Ubuntu 24.04.4 LTS，登录用户 root。随后执行：

```bash
date --iso-8601=seconds
id
readlink -f /opt/arknight-guess/app
cat /opt/arknight-guess/app/deployment-version.json
cat /etc/arknight-deploy.json
systemctl is-active arknight-guess nginx arknight-deploy.timer
systemctl list-timers arknight-deploy.timer --no-pager
cat /opt/arknight-guess/deploy-state.json
nginx -t
cat /etc/nginx/sites-available/arknight-guess
ls -l /etc/nginx/conf.d /opt/arknight-guess/image-pages.map /usr/local/lib/arknight-deploy/pull_deploy.py
curl -fsS http://127.0.0.1/api/health
```

原因：先确认回滚基线、正在运行的服务、真实入口和安装差异，再考虑修改。

结果：

- app 指向 `releases/c8b9ed073839a1d572d2508afbd62a7882d35862`；版本标记与 CI 一致。
- 游戏、Nginx、每日部署 timer 都是 active。known_good 仅包含这个 SHA，pinned 为 false。
- 实际 Nginx 游戏站监听 `127.0.0.1:8080`，部署配置 public_url 同为 `http://127.0.0.1:8080`；必须保留此端口。
- Nginx 语法通过；`/img/` 当前本地发送。配置目录中还有其他站点所用的 WebSocket map，不能覆盖。
- Pages map 不存在，部署配置没有 image_pages 字段，服务器尚未启用 Pages。
- 对默认 80 端口的初次健康探测返回 404；这是入口不同，并非游戏故障。

## 3. 19:01 核对正确入口与资源（服务器，只读）

交互会话发送多行命令时，Workbench 把以 `/usr/bin/...` 开头的输入识别为自己的指令菜单，未能可靠执行整组检查。后续改用官方 `workbench exec`，每次是独立 shell，便于准确记录和复现。已在交互会话确认 8080 健康接口返回正确 SHA；其他资源检查以下面的非交互结果为准。

```powershell
workbench exec -i i-uf6et2zckziswwrhhmpe -c 'date --iso-8601=seconds; /usr/bin/node --version; free -h; df -h /opt; sha256sum /usr/local/lib/arknight-deploy/pull_deploy.py; systemctl cat arknight-deploy.timer; curl -fsS http://127.0.0.1:8080/api/health' --timeout 30
```

原因：确认系统资源够用、保存旧部署器指纹，并验证实际部署入口。

结果：Node `v24.20.0`；可用内存约 959 MiB，无 Swap；磁盘剩余 33 GiB。旧部署器 SHA-256 为 `e795513643dc1ab03cca5df8438d4b69a90b0ea4b68f5ed690dd8ea73f4ed17d`。timer 为每日 `12:30:00 Asia/Shanghai`、`Persistent=false`。8080 健康接口返回 `status=ok` 及上述 c8b9ed0 SHA。到这里服务器尚无配置变更。

## 4. Cloudflare 人工登录

打开 Cloudflare Dashboard 后发现需要登录，请用户本人完成登录和二次验证。用户已回复“已登录”。后续账号配置待记录；不会将密码或 API Token 写入本文。

## 5. 检查私库 Deployments 权限（服务器，只读）

通过 `workbench exec` 运行 Python：只在进程内读取 `/etc/arknight-deploy.env` 中现有 GITHUB_TOKEN，用 Authorization 请求目标仓库的 `/deployments?per_page=1`，不打印 token，也不复制到本地。

第一次请求返回 HTTP 403。为区分限流与权限不足，第二次增加对 HTTPError 的捕获，仅输出 JSON message 和 `X-Accepted-GitHub-Permissions`。第二次实际执行的服务器脚本如下：

```python
import pathlib, urllib.request, urllib.error, json
p = pathlib.Path('/etc/arknight-deploy.env')
token = next((x.partition('=')[2].strip().strip(chr(34)).strip(chr(39)) for x in p.read_text().splitlines() if x.startswith('GITHUB_TOKEN=')), '')
request = urllib.request.Request('https://api.github.com/repos/hongbi7/arknight-cczss/deployments?per_page=1', headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'arknight-deployment-preflight'})
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        print('GitHub Deployments HTTP', response.status)
except urllib.error.HTTPError as error:
    print('GitHub Deployments HTTP', error.code)
    print('Message:', json.loads(error.read()).get('message'))
    print('Required permissions:', error.headers.get('X-Accepted-GitHub-Permissions'))
```

结果：`Resource not accessible by personal access token`，需要 `deployments=read`。已请用户编辑现有 fine-grained PAT，增加 Deployments 只读权限；不要求重新生成，也未读取其明文到工具输出。

## 6. 合并代码并准备 CI（本地/GitHub）

执行 `git fetch origin main` 和 `git merge --no-edit origin/main`，自动合并为 `0e0235f`，保留 main 的私库认证功能。补充私库图片发布的权限说明，提交 `5ca008e`。执行部署与图片测试：35 项 Python 部署测试通过，1 项 Linux Nginx 测试在 Windows 跳过；图片导出、验证、发布记录和 JS/Python 合同测试全部通过。

推送 `codex/cloudflare-pages-images` 并创建 [PR #13](https://github.com/hongbi7/arknight-cczss/pull/13)，由 Ubuntu CI 再验证。Cloudflare 控制台中创建 Direct Upload 项目 `arknight-guess-images`，已进入上传阶段；未上传游戏源码。GitHub 已设置非秘密变量 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_PAGES_PROJECT。上传 Secret 由用户本人配置，IMAGE_PAGES_ENABLED 尚未打开。

## 7. 19:10 备份当前配置（服务器，仅新增备份）

通过 `workbench exec` 执行：

```bash
set -eu
backup_dir=$(mktemp -d /root/arknight-pages-backup-20260909.XXXXXX)
chmod 700 "$backup_dir"
cp -a /etc/arknight-deploy.json "$backup_dir/arknight-deploy.json"
cp -a /usr/local/lib/arknight-deploy/pull_deploy.py "$backup_dir/pull_deploy.py"
cp -a /etc/nginx/sites-available/arknight-guess "$backup_dir/nginx-arknight-guess.conf"
cp -a /etc/systemd/system/arknight-deploy.service /etc/systemd/system/arknight-deploy.timer "$backup_dir/"
cp -a /opt/arknight-guess/deploy-state.json "$backup_dir/deploy-state.json"
readlink -f /opt/arknight-guess/app > "$backup_dir/app-target.txt"
nginx -T > "$backup_dir/nginx-effective.conf" 2> "$backup_dir/nginx-check.txt"
systemctl show arknight-deploy.timer -p ActiveState -p UnitFileState -p NextElapseUSecRealtime > "$backup_dir/timer-state.txt"
printf 'BACKUP_DIR=%s\n' "$backup_dir"
date --iso-8601=seconds
```

结果：备份路径 `/root/arknight-pages-backup-20260909.4eXHYZ`，目录权限 0700。原因：保存配置、旧部署器、基线指向及定时器状态，为失败恢复提供依据。完整 Nginx 配置只保存在服务器 root 私有目录，未复制其他站点内容到本文。游戏服务与 Nginx 此时没有重启或重载。

## 8. 上传安装包与真实 Nginx 隔离测试（服务器临时目录）

本地用 `git archive --format=tar.gz --output=output/cloudflare-ecs-5ca008e.tar.gz 5ca008e deploy tests/deployment/test_nginx_image_routing.py` 导出脚本与测试。包约 20.2 KB，不含凭证、游戏源码或题库。通过 Workbench 上传：

```powershell
workbench upload output/cloudflare-ecs-5ca008e.tar.gz /tmp/cloudflare-ecs-5ca008e.tar.gz -i i-uf6et2zckziswwrhhmpe
```

Workbench 使用阿里云 OSS 中转传输。服务器通过 `workbench exec` 执行：

```bash
set -eu
printf '%s\n' '3f443ba9ce4b7d96a130c60f6a0a48a71d9e52af9b6e7686acaac7ef4d8f973f  /tmp/cloudflare-ecs-5ca008e.tar.gz' | sha256sum -c -
stage_dir=$(mktemp -d /opt/arknight-guess/pages-setup-5ca008e.XXXXXX)
chmod 755 "$stage_dir"
tar -xzf /tmp/cloudflare-ecs-5ca008e.tar.gz -C "$stage_dir"
printf 'STAGE_DIR=%s\n' "$stage_dir"
python3 "$stage_dir/tests/deployment/test_nginx_image_routing.py" -v
curl -fsS http://127.0.0.1:8080/api/health
```

结果：包哈希一致；解包到 `/opt/arknight-guess/pages-setup-5ca008e.i2wsza`。真实 Nginx 测试通过：独立临时配置、随机回环端口和独立 PID，验证 A→B→A 图片 URL 随软链接切换，以及无记录版本本地返回 200；测试完成自动退出。正式 8080 入口仍健康，SHA 未变。原因：在用户实际 Ubuntu/Nginx 环境验证上一轮 Windows 无法执行的部分，且不改动正式站点。

## 9. 19:14 生成并审查 Nginx 候选（服务器暂存目录）

通过 Workbench 运行以下 Python，读取现有站点，只替换唯一的 `/img/` 块，并将结果写到暂存目录：

```python
from pathlib import Path
import textwrap
stage = Path('/opt/arknight-guess/pages-setup-5ca008e.i2wsza')
original = Path('/etc/nginx/sites-available/arknight-guess').read_text()
marker = '    location ^~ /img/ {'
assert original.count(marker) == 1
start = original.index(marker)
end = original.index('\n    }', start) + len('\n    }')
previous = original[start:end]
assert previous.count('{') == 1 and previous.count('}') == 1
snippet = (stage / 'deploy/nginx-images-pages.location.example').read_text().rstrip()
candidate = original[:start] + textwrap.indent(snippet, '    ') + original[end:]
assert 'listen 127.0.0.1:8080;' in candidate
(stage / 'nginx-arknight-guess.candidate.conf').write_text(candidate)
```

随后执行 `diff -u /etc/nginx/sites-available/arknight-guess /opt/arknight-guess/pages-setup-5ca008e.i2wsza/nginx-arknight-guess.candidate.conf`。结果只有 `/img/` 增加按 map 跳转的逻辑；现有 8080、gzip、日志、安全头及 API 代理均保留。原因：避免直接用通用模板覆盖此服务器的定制配置。

## 10. 合并并升级部署器（服务器首次配置变更）

PR CI [34343994637](https://github.com/hongbi7/arknight-cczss/actions/runs/34343994637) 成功，包括 Ubuntu 上的真实 Nginx 集成测试。合并 PR #13，main 为 `9b1d0d544549c1a8f4b7abafb45bd3dccf4487b2`。本地比较 `git diff 5ca008e origin/main -- deploy` 为空，确认上传脚本与 main 一致。

通过 Workbench 执行：

```bash
set -eu
stage=/opt/arknight-guess/pages-setup-5ca008e.i2wsza
backup=/root/arknight-pages-backup-20260909.4eXHYZ
cmp /usr/local/lib/arknight-deploy/pull_deploy.py "$backup/pull_deploy.py"
cmp /etc/nginx/sites-available/arknight-guess "$backup/nginx-arknight-guess.conf"
bash "$stage/deploy/install.sh" > "$backup/install-pages.log" 2>&1
cat "$backup/install-pages.log"
cmp "$stage/deploy/pull_deploy.py" /usr/local/lib/arknight-deploy/pull_deploy.py
stat -c '%a:%U:%G %n' /opt/arknight-guess/image-pages.map
curl -fsS http://127.0.0.1:8080/api/health
```

原因：先确认备份后配置没有被他人修改；再通过项目安装器升级部署器。结果：安装器创建 `image-pages.map`（0644 root:root）、更新部署器与 systemd 部署 unit、暂时停止 timer、保留原 JSON 配置与凭证；没有重启游戏。安装日志保存在上述备份目录，正式入口仍为 c8b9ed0。

## 11. 19:21 安装 Nginx 映射并恢复 timer

第一次将带 `set -Eeuo pipefail` 的脚本直接交给 Workbench，默认 `/bin/sh` 在第一行报 `Illegal option -o pipefail`，尚未执行任何配置写入。立即以 `bash <<'BASH' ... BASH` 明确使用 Bash，执行下面的脚本：

```bash
set -Eeuo pipefail
stage=/opt/arknight-guess/pages-setup-5ca008e.i2wsza
backup=/root/arknight-pages-backup-20260909.4eXHYZ
new_http=/etc/nginx/conf.d/arknight-image-pages.conf
test ! -e "$new_http"
if nginx -T 2>/dev/null | grep -Eq '^[[:space:]]*map_hash_bucket_size[[:space:]]'; then
  printf '%s\n' 'Existing map_hash_bucket_size needs review before installing duplicate directive'
  exit 1
fi
restore_nginx() {
  cp -a "$backup/nginx-arknight-guess.conf" /etc/nginx/sites-available/arknight-guess
  if test -f "$new_http" && cmp -s "$new_http" "$stage/deploy/nginx-image-pages-http.conf.example"; then
    rm -- "$new_http"
  fi
  nginx -t && systemctl reload nginx
}
trap 'result=$?; restore_nginx; exit "$result"' ERR
install -o root -g root -m 0644 "$stage/deploy/nginx-image-pages-http.conf.example" "$new_http"
install -o root -g root -m 0644 "$stage/nginx-arknight-guess.candidate.conf" /etc/nginx/sites-available/arknight-guess
nginx -t
systemctl reload nginx
curl -fsS http://127.0.0.1:8080/api/health
sample=$(python3 -c 'from pathlib import Path; import urllib.parse; p=Path("/opt/arknight-guess/app/public"); f=next((p/"img").rglob("*.webp")); print("/"+urllib.parse.quote(f.relative_to(p).as_posix()))')
printf '\nLOCAL_IMAGE_SAMPLE=%s\n' "$sample"
curl -fsSI "http://127.0.0.1:8080$sample"
trap - ERR
systemctl enable --now arknight-deploy.timer
systemctl show arknight-deploy.timer -p ActiveState -p NextElapseUSecRealtime
date --iso-8601=seconds
```

原因：检测重复 map 指令、安装经审查的配置，并设置失败恢复；Nginx 使用平滑 reload。结果：`nginx -t` 成功，游戏健康，`/img/factions/action4.webp` 返回 200、image/webp、10876 字节，说明空 map 仍走本地图片。timer 已恢复 active，下一次为 2026-09-10 12:30 CST。恢复函数没有被触发，未删除任何正式配置。

## 12. 凭证就绪，触发实际图片发布

用户回复“凭证已配置”。GitHub Secret 名称查询确认 CLOUDFLARE_API_TOKEN 已存在（不读取值）；ECS 重跑第 5 节同一权限探测，现在返回 HTTP 200。

本地设置 `IMAGE_PAGES_ENABLED=true` 后，在 main 执行 `gh workflow run production-ci.yml --repo hongbi7/arknight-cczss --ref main`。调用返回网络 `unexpected EOF`，因此没有盲目重复触发；查询运行列表确认实际已创建 [34345028813](https://github.com/hongbi7/arknight-cczss/actions/runs/34345028813)，SHA 为 9b1d0d5。此前 main push CI [34344638864](https://github.com/hongbi7/arknight-cczss/actions/runs/34344638864) 已成功，但当时图片开关未打开，不能代替这次带图片发布的 CI。

## 13. CI 图片发布成功（GitHub/Cloudflare）

手动运行 34345028813 的 validate 与 publish_images 均成功。GitHub Deployment ID 为 `6348594674`，run attempt 为 1，绑定 SHA 为 `9b1d0d544549c1a8f4b7abafb45bd3dccf4487b2`。

- 固定图片 origin：`https://9925819a.arknight-guess-images.pages.dev`
- 图片清单 SHA-256：`8cf7851da05b4d49698792d0aeb5a57578ab36115c96071fbc0d8231a43d1f68`
- 记录中的样本路径：`/img/chessmaster.png`
- 本地浏览器打开 `/img/factions/action4.webp`，识别并显示为 240×240 WebP，确认本地网络可访问此 Pages 部署。

只上传专用图片导出目录；game secret、GitHub PAT、服务端题库和 API 没有上传到 Pages。

## 14. 19:27:38 启用 ECS 绑定并启动发布

通过 `workbench exec` 执行以下脚本，原子修改 JSON 并启动 systemd 发布任务：

```bash
set -eu
python3 - <<'PY'
from pathlib import Path
import json, os
path = Path('/etc/arknight-deploy.json')
configuration = json.loads(path.read_text())
assert configuration['repository'] == 'hongbi7/arknight-cczss'
assert configuration['public_url'] == 'http://127.0.0.1:8080'
assert configuration.get('image_pages') is None, 'image_pages changed since preflight'
configuration['image_pages'] = {'project': 'arknight-guess-images'}
new_path = path.with_name(path.name + '.pages.new')
with new_path.open('x') as output:
    json.dump(configuration, output, indent=2)
    output.write('\n')
    output.flush()
    os.fsync(output.fileno())
os.chmod(new_path, path.stat().st_mode & 0o777)
os.replace(new_path, path)
print('Enabled image_pages for arknight-guess-images; public_url preserved at 127.0.0.1:8080')
PY
systemctl start --no-block arknight-deploy.service
systemctl show arknight-deploy.service -p ActiveState -p SubState -p Result
journalctl -u arknight-deploy.service -n 30 --no-pager
date --iso-8601=seconds
```

原因：仅在 CI 与图片记录全部成功后开启 ECS 图片绑定；不直接改 app 软链接，让部署器执行完整防护流程。文件写入先 flush/fsync，再原子替换；保留 8080 和原文件权限。

启动后首次日志含此前 17:48 的历史记录，不能将旧日志当成本次成功。随后执行以下只读命令，限定本次起始时间：

```bash
systemctl show arknight-deploy.service -p ActiveState -p SubState -p Result -p ExecMainStatus
journalctl -u arknight-deploy.service --since "2026-09-09 19:27:35" -n 100 --no-pager
readlink -f /opt/arknight-guess/app
```

19:27:42 部署器批准了 9b1d0d5 及运行 34345028813；19:28:21 完成私库 Git 拉取，随后归档/候选验证。此时 app 仍指向 c8b9ed0，属于正常的发布前验证阶段。

## 15. 首次 ECS 图片校验失败，诊断后重试

用 `journalctl --since "2026-09-09 19:28:25"` 读取后续日志：19:28:36 新候选的健康接口及 sudden、endless、anomaly 开局均通过；19:28:50 图片验证报 `Cloudflare Pages image check failed: fetch failed`。systemd 为 exit-code/1，app 仍指向 c8b9ed0，未进行正式切换。日志记录此次任务 CPU 28.367 秒、内存峰值 768.0M；没有据此将网络错误归因于内存。

随后在服务器执行以下诊断（显式 Bash、无配置修改）：

```bash
getent ahosts 9925819a.arknight-guess-images.pages.dev
curl -I --connect-timeout 8 --max-time 20 https://9925819a.arknight-guess-images.pages.dev/assets-manifest.json
runuser -u arkguess -- env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin NODE_ENV=production /usr/bin/node -e 'fetch("https://9925819a.arknight-guess-images.pages.dev/assets-manifest.json").then(async r=>{console.log("Node HTTP",r.status); await r.body.cancel();}).catch(e=>{console.log("Node fetch error", e.message); console.log("Cause", e.cause); process.exitCode=1;})'
curl -fsS http://127.0.0.1:8080/api/health
```

原因：区分 DNS、HTTPS、运行用户/环境与暂时连通性问题，不放松 TLS、摘要或发布校验。

结果：DNS 正常返回 Cloudflare 的 IPv4/IPv6；curl 返回 HTTP/2 200，Node 使用与部署器相同的 arkguess/最小环境也返回 200；游戏入口仍正常。因此把首次错误视为可能的瞬时网络故障，未修改任何网络保护或验证逻辑。

19:32:37 通过 Workbench 再次执行：

```bash
date --iso-8601=seconds
systemctl start --no-block arknight-deploy.service
systemctl show arknight-deploy.service -p ActiveState -p SubState
cat /opt/arknight-guess/deploy-state.json
```

任务进入 activating；状态仍以旧 SHA 为 last_successful，pinned=false。此次重试仍走完整下载/候选/远端图片校验。

## 16. 19:33:52 发布成功

分别以 `--since "2026-09-09 19:32:35"`、`--since "2026-09-09 19:33:29"` 读取本次重试日志，并查询 service 的 ActiveState/SubState/Result/ExecMainStatus 和 app 指向。

结果：

- 19:33:29：候选健康检查及三模式开局通过。
- 19:33:49：Pages 校验通过，Files=3492，清单摘要及唯一 URL 与 CI 记录一致；正式 release 目录生成。
- 19:33:50：生成 map，Nginx 语法检查通过并重载。
- 19:33:52：app 已切到 9b1d0d5，Node 重启后健康检查、三模式开局、静态版本与图片重定向检查通过，日志输出 `deployed 9b1d0d544549c1a8f4b7abafb45bd3dccf4487b2`。
- systemd oneshot 为 `Result=success`、`ExecMainStatus=0`，完成后 inactive/dead 是正常状态。
- 重试任务日志报告 CPU 26.689 秒、内存峰值 445.4M；保留旧 c8b9ed0 release 可回滚。

首次网络错误通过保持原配置的完整重试恢复，没有跳过图片验证，也没有更改 TLS 或网络策略。

## 17. 19:35 正式入口验收及日志留存

通过 Workbench 执行：

```bash
set -eu
curl -fsS http://127.0.0.1:8080/api/health
printf '\n'
curl -fsSI http://127.0.0.1:8080/img/factions/action4.webp
curl -fsSL --connect-timeout 8 --max-time 30 -o /dev/null -w 'Followed image: HTTP %{http_code}, bytes %{size_download}, total_seconds %{time_total}\n' http://127.0.0.1:8080/img/factions/action4.webp
python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py status
cat /opt/arknight-guess/app/image-pages.json
cat /opt/arknight-guess/image-pages.map
systemctl show arknight-deploy.timer -p ActiveState -p NextElapseUSecRealtime
ss -ltn 'sport = :3000 or sport = :8080'
backup=/root/arknight-pages-backup-20260909.4eXHYZ
journalctl -u arknight-deploy.service --since '2026-09-09 19:27:35' --no-pager > "$backup/deploy-pages.log"
chmod 600 "$backup/deploy-pages.log"
cp -a /opt/arknight-guess/app/image-pages.json "$backup/active-image-pages.json"
nginx -T > "$backup/nginx-after.conf" 2> "$backup/nginx-after-check.txt"
date --iso-8601=seconds
```

原因：独立核对用户流量实际经过的入口，并保存部署前后证据，不只依赖 CI 或安装器输出。

结果：

- 健康接口返回 `status=ok` 和 9b1d0d5。
- 图片入口返回 HTTP 302、`Cache-Control: no-store`，Location 为 `https://9925819a.arknight-guess-images.pages.dev/img/factions/action4.webp`。
- 跟随重定向后 HTTP 200、10876 字节；此单次小图请求耗时约 0.835 秒，不代表所有图片或网络的性能保证。
- image-pages.json 的 SHA/run/attempt/digest/URL 与 CI 完全一致；map 只将当前 release 的真实 public 路径指向该唯一 URL。
- 部署状态 pinned=false；新旧两版均列为可回滚。
- timer active，下次 2026-09-10 12:30 CST；游戏端口 8080 和 Node 端口 3000 均只监听回环地址。
- 原配置备份、安装日志、两次发布日志、发布后 Nginx 配置、已激活图片记录均留在 `/root/arknight-pages-backup-20260909.4eXHYZ/`。

## 18. 日后恢复操作（本次未执行）

需要暂时让图片回到 ECS 时，将 `/etc/arknight-deploy.json` 的 `image_pages` 改为 `null`，执行 `sudo systemctl start arknight-deploy.service`。部署器会清空已加载的 map；不要删除 map include 文件。

需要回到本次之前的应用版本时，可执行下列命令。使用 systemd-run 加载私库凭证环境，避免未来回滚到带图片记录的版本时因未加载 token 而无法验证：

```bash
sudo systemd-run --wait --pipe --collect \
  -p EnvironmentFile=/etc/arknight-deploy.env \
  /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py \
  rollback c8b9ed073839a1d572d2508afbd62a7882d35862
```

回滚后自动发布会 pinned；明确要恢复自动发布时执行 `sudo /usr/bin/python3 -I /usr/local/lib/arknight-deploy/pull_deploy.py resume`，再按需启动部署服务。旧 c8b9ed0 没有图片记录，回滚到它后使用本地图片。不要删除当前及可回滚 release 对应的 Pages 部署。

## 19. 保存本文并核对副本

本文保存在仓库 `docs/operations/2026-09-09-cloudflare-pages.md`，另通过以下命令存入本次服务器备份目录，便于以后只登录 ECS 也能查看操作原因和恢复步骤：

```powershell
workbench upload docs/operations/2026-09-09-cloudflare-pages.md /root/arknight-pages-backup-20260909.4eXHYZ/operation-record.md -i i-uf6et2zckziswwrhhmpe
workbench exec -i i-uf6et2zckziswwrhhmpe -c 'chmod 600 /root/arknight-pages-backup-20260909.4eXHYZ/operation-record.md; stat -c "%a:%U:%G %n" /root/arknight-pages-backup-20260909.4eXHYZ/operation-record.md; sha256sum /root/arknight-pages-backup-20260909.4eXHYZ/operation-record.md'
```

副本权限设为 root:root 0600，并将服务器 SHA-256 与本地文件校验值比较。本文及本次上传的安装包不包含任何凭证明文。

## 20. 收尾交互连接

退出最初的交互连接时，Workbench 输入框保留了第 3 节中未完成的 `/us` 前缀；第一次发送 detach 被拼成 `/us/detach`，Bash 返回 `No such file or directory`，没有产生文件或服务变更。随后在干净提示符输入 `/detach`，Workbench 明确提示已暂离，会话保留，原连接命令仍可重新接入。后续正式操作一直通过非交互 `workbench exec` 完成。

补齐本附记后，用第 19 节相同的上传命令加 `--force` 更新本文副本，再设置 0600 并重新比较 SHA-256。此覆盖仅针对本次刚创建的操作记录；配置备份和发布日志均保留。
