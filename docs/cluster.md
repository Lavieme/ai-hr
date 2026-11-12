# 接入 mayfly/cluster

本项目是单个 Next.js 服务，参考 ai-hive 的 Docker / Nomad / Traefik / Vault 接口，不依赖 ai-hive 的源码或 monorepo。部署代码位于 cluster 的 `playbooks/apps/ai-hr/`，推送本项目 main 后由 GitHub Actions 调用。本次只修改代码，不执行线上部署。

## 镜像与迁移

```sh
docker build -t <registry>/ai-hr:<tag> .
docker push <registry>/ai-hr:<tag>
```

cluster 已提供一个 service job，以及一个使用同一镜像的 batch 迁移 job。先完成数据库备份和迁移，再部署应用；不在每个应用副本启动时并发迁移。

| 项目 | 设置 |
| --- | --- |
| 应用容器命令 | 默认 `node server.js` |
| 迁移容器命令 | `node_modules/.bin/prisma migrate deploy` |
| 工作目录 | `/app` |
| 容器端口 | `3000` |
| 监听地址 | `0.0.0.0` |
| 运行用户 | 非 root，UID/GID 1001 |
| 健康检查 | `GET /api/health`，间隔 15s，超时 5s |
| 初始副本数 | `1`，按访问量调整 |
| 初始资源 | CPU 500 MHz、内存 768 MB，按实际 PDF 解析量调整 |

迁移任务仅需 `DATABASE_URL`；应用任务使用下表中的配置。构建阶段不需要生产数据库、AI 或 S3 凭据。

## Vault 与环境变量

仿照 ai-hive，使用 Nomad template 从独立路径 `secret/data/ai-hr/config` 注入 `secrets/app.env`，设置 `env = true` 和 `change_mode = "restart"`。不要把密钥放进镜像或 Git。

| 应用环境变量 | 建议来源 |
| --- | --- |
| `DATABASE_URL` | Vault `database_url`，为 ai-hr 建立独立数据库 |
| `APP_PASSWORD` | Vault `app_password` |
| `AUTH_SECRET` | Vault `auth_secret`，随机值至少 32 位 |
| `AI_API_KEY` | Vault `ai_api_key`，可使用已有供应商凭据 |
| `OSS_ACCESS_KEY_ID` | Vault `oss_access_key_id` |
| `OSS_SECRET_ACCESS_KEY` | Vault `oss_secret_access_key` |
| `APP_URL` | inventory 配置，例如 `https://hr.example.com` |
| `COOKIE_SECURE` | `true` |
| `AI_BASE_URL` / `AI_MODEL` | inventory 中的模型服务配置 |
| `OSS_BUCKET` / `OSS_REGION` / `OSS_ENDPOINT` | 已有生产 S3 配置 |
| `OSS_PATH_PREFIX` | `ai-hr`，与其他应用对象隔离 |
| `OSS_FORCE_PATH_STYLE` | 按现有 S3 服务要求设置 |
| `OSS_PUBLIC_ENDPOINT` | 通常不填；只有服务端与浏览器使用不同 S3 地址时才配置 |
| `OSS_PRESIGN_EXPIRES_IN` | `300` |

S3 bucket 保持私有。复用现有存储服务即可，不部署 Compose 中的 MinIO 兼容服务或 bucket-init。临时下载 URL 的域名必须能从浏览器访问。

## Nomad / Traefik

参考 `playbooks/apps/ai-hive/templates/ai-hive.nomad.j2`，简化为一个 `ai-hr-web` group：`network.port.http.to = 3000`，service name 使用 `ai-hr-web`，Vault policy 沿用 cluster 允许的策略。

Traefik tags 采用 cluster 现有风格，路由名改为 `ai-hr-web`：HTTP router 使用 `Host(域名)` 并重定向 HTTPS，HTTPS router 使用 `entrypoints=https`、`tls=true`、`certresolver=letsencrypt`。保留 Host/Origin 转发；Server Actions 使用同源请求，`APP_URL` 应与最终 HTTPS 域名一致。上传请求上限至少 16 MB，AI 请求超时至少 75s。

迁移成功、健康检查通过后，用共享密码完成一次“新建项目 → 上传 JD 和简历 → AI 证据提取 → 人工复核 → 导出”的冒烟检查。AI/S3 不纳入 `/api/health`，避免供应商临时故障导致应用重启；其错误会在操作时提示。

回滚应用使用前一个镜像 tag，数据库迁移不自动回滚。数据只存在 PostgreSQL 与 S3，应用容器不需要持久化卷。

## GitHub 自动部署

推送 main 后，工作流完成检查、测试和镜像构建，发布 `main` 与 `sha-<完整提交 SHA>`，再通过 SSH 调用 cluster 的 `playbooks/apps/ai-hr/deploy.yml`。不依赖 Release 或版本标签。应用与迁移都使用本次 SHA 镜像；镜像仓库作为参数传入，与 GitHub 的构建地址一致。

首次启用前，先提交并推送 cluster 部署代码，在 cluster 的加密 `inventories/prod/group_vars/all/vault.yml` 配置 `vault_ai_hr`，并完成 DNS 和镜像拉取权限设置。字段和默认值见 cluster 的 `playbooks/apps/ai-hr/README.md`。GitHub SSH、仓库及路径设置见 [GitHub Actions 说明](../.github/README.md)。

生产默认复用现有 ai-hive 私有 bucket 并使用 `ai-hr` 前缀；可通过 `ai_hr_oss_*` 参数改为独立 bucket。实际模型服务地址通过 `ai_hr_ai_base_url` 配置，密钥来自 Vault。

控制机手动部署或回滚：

```sh
ansible-playbook -i inventories/prod/hosts.ini playbooks/apps/ai-hr/deploy.yml \
  -e ai_hr_image_repo=<registry>/<image> \
  -e ai_hr_image_tag=sha-<完整提交SHA>
```

main 流水线串行执行，迁移失败阻止应用更新。手动部署也应避免并发运行；数据库迁移不自动回滚。
