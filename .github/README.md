# GitHub Actions

参考 ai-hive，使用单应用 Dockerfile，并通过 SSH 调用 cluster Ansible。不需要 Release、版本标签或 Release Please：推送 main 即可触发部署。

## 自动流程

`ci.yml` 仅在推送 main 时运行：

1. 检查代码、校验 Prisma、迁移全新测试数据库，并执行两次示例初始化。
2. 运行单元和 PostgreSQL/S3 集成测试、Next 生产构建、类型检查。
3. 构建 Docker 镜像，推送 `main` 和 `sha-<完整提交 SHA>` 镜像标签。
4. main 通过 SSH 更新控制机上的 cluster 仓库，运行 `playbooks/apps/ai-hr/deploy.yml`，显式传入本次镜像仓库和 SHA 标签。
5. cluster 同步 Vault、创建数据库、执行迁移，成功后更新应用并验证健康。

main 流水线串行执行，避免取消正在运行的迁移。测试使用临时 PostgreSQL 和社区 MinIO 兼容镜像，AI 使用模拟响应，不需要生产凭据。

## 镜像仓库

与 ai-hive 一致，镜像构建在 `self-hosted` runner 上使用 Docker Buildx 的 `docker` driver，通过 `docker/build-push-action` 直接使用根目录 `Dockerfile` 构建并推送 `linux/amd64` 镜像。runner 需要可用的 Docker。当前 Dockerfile 自行安装依赖并构建 Next，无需在宿主机重复构建。

镜像路径固定为 `<DOCKER_REGISTRY>/lavieme/ai-hr`，仓库主机默认 `ghcr.io`。使用 Secrets 中的用户名和密码登录，不使用自动 Token 回退。cluster 需要独立配置私有镜像拉取权限。

在 Settings → Secrets and variables → Actions 的 Repository secrets 中配置，所有自定义配置统一使用 Secret：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DOCKER_REGISTRY` | 仓库主机，可含端口，不含 `https://`；默认 `ghcr.io` |
| Secret | `DOCKER_USERNAME` | 镜像仓库登录用户，与 ai-hive 相同 |
| Secret | `DOCKER_PASSWORD` | 镜像仓库推送密码或 Token，与 ai-hive 相同 |

## 部署控制机

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DEPLOY_HOST` | 与 ai-hive 相同的 SSH 部署控制机 |
| Secret | `DEPLOY_USERNAME` | SSH 用户 |
| Secret | `DEPLOY_KEY` | SSH 私钥 |
| Secret | `DEPLOY_PORT` | 可选，默认 `22` |

部署方式沿用 ai-hive：SSH 进入控制机的 `~/Workspace/cluster`，更新仓库、加载 direnv，然后执行 Ansible。

首次启用前，将 cluster 新增的 ai-hr 部署代码提交并推送。控制机需要能够拉取 cluster 仓库，具备 Ansible、Nomad、direnv，并已配置 Ansible Vault 解密环境和集群访问凭据。参考 ai-hive，工作流加载该目录的 `direnv export bash`；生产密钥不经 GitHub 传递。

还需在 cluster 的加密 `vault.yml` 配置 `vault_ai_hr`、域名 DNS、已有 S3 bucket 的访问权限。具体字段与部署命令见 [cluster 接入说明](../docs/cluster.md) 及 cluster 的 `playbooks/apps/ai-hr/README.md`。发布失败时查看对应检查、构建或 SSH 步骤；回滚通过 cluster 指定之前的 SHA 镜像标签。
