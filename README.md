# 知衡 · 校招筛选工作台

基于 Next.js App Router 的单体全栈应用，使用 TypeScript、Prisma + PostgreSQL、shadcn/ui + Tailwind CSS。团队通过共享密码访问同一个工作台，数据保存在 PostgreSQL，上传原件保存在 S3。

主流程：**准备材料 → 复核候选人 → 交付名单**。评价卡、模板、经理确认和反馈位于次级入口。AI 只起草标准、提取原文证据和待核实问题，最终招聘结论由 HR 确认。

## 本地开发

需要 Node.js 24、pnpm 12.16.1 和 Docker。使用已有的开源 MinIO 兼容镜像 [`pgsty/silo`](https://github.com/pgsty/silo) 作为本地对象存储，不自行构建 MinIO，也不提供文件系统存储后端。

```sh
cp .env.example .env
pnpm install
# 启动开发依赖并创建私有 bucket
docker compose up -d postgres minio
docker compose run --rm bucket-init
pnpm db:migrate
pnpm db:seed
pnpm dev
```

打开 http://localhost:3000，使用 `.env` 中的 `APP_PASSWORD` 登录。示例密码为 `zhiheng-demo`。`db:seed` 可重复运行，不覆盖已有示例项目；首页“一键体验示例”会另外创建一份项目。

默认 PostgreSQL 端口为 5438，S3 为 9000，存储控制台为 http://localhost:9001。端口冲突时修改 `.env` 对应端口和连接 URL。`bucket-init` 使用存储镜像自带的 `mcli` 创建本地私有 bucket。

## Docker 运行

```sh
cp .env.example .env
# 按需修改共享密码、AUTH_SECRET 等配置
# 启动本地服务：PostgreSQL + MinIO 兼容存储 + 一次性迁移 + 应用
docker compose up --build -d
```

应用默认监听 3000。`migrate` 成功后才启动应用；`bucket-init` 会创建私有 bucket。数据库和对象存储使用 Docker named volumes，重启容器不丢数据；`docker compose down` 保留数据，`down -v` 会删除本地数据。

生产环境使用已有 PostgreSQL 和 S3，只部署应用镜像并先运行一次迁移，不需要部署本地 MinIO 服务。cluster 的 Nomad / Traefik / Vault 接入方式见 [docs/cluster.md](docs/cluster.md)。

## 配置

所有密钥只在服务端读取，不使用 `NEXT_PUBLIC_*`。

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `APP_PASSWORD` | 共享访问密码 |
| `AUTH_SECRET` | 至少 32 位的随机会话签名密钥，可用 `openssl rand -hex 32` 生成 |
| `APP_URL` | 浏览器访问的应用地址 |
| `COOKIE_SECURE` | 本地 HTTP 为 `false`，生产 HTTPS 为 `true` |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容接口；Base URL 填供应商提供的完整接口前缀（不含 `/chat/completions`），保留供应商要求的路径 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` | 兼容 ai-hive 的 AI 配置；优先使用 `AI_*` |
| `OSS_ACCESS_KEY_ID` / `OSS_SECRET_ACCESS_KEY` | S3 凭据 |
| `OSS_BUCKET` / `OSS_REGION` | bucket 和区域 |
| `OSS_ENDPOINT` | 服务端可访问的 S3 地址；AWS S3 可留空 |
| `OSS_PUBLIC_ENDPOINT` | 可选，浏览器下载用的签名地址；不填则沿用 `OSS_ENDPOINT`。Compose 自动区分服务名和宿主机地址 |
| `OSS_PATH_PREFIX` | 对象前缀，默认 `ai-hr` |
| `OSS_FORCE_PATH_STYLE` | 本地 MinIO 兼容服务用 `true`，生产按 S3 服务要求设置 |
| `OSS_PRESIGN_EXPIRES_IN` | 下载签名有效秒数，默认 300 |

生产 S3 使用私有 bucket，应用凭据需要对应前缀的 PutObject、GetObject、DeleteObject 权限。应用保存对象 key，每次下载重新生成临时签名 URL。生产已有 bucket 不需要运行 `bucket-init`。未配置 AI 时可使用规则草稿及人工复核；未配置 S3 时可粘贴文本，不会改存本地磁盘。

## 使用与边界

- JD 和简历支持粘贴、TXT、Markdown、DOCX、文本 PDF；简历支持多文件上传，每批最多 30 份。单文件最多 15 MB，PDF 最多 12 页。扫描或损坏文件保留原件、标记异常，供人工补充文字。
- JD 文件提取的文字须点击“保存岗位材料”后生效。更新 JD 后，在“筛选依据”重新生成或手动调整评价卡。
- AI 草稿须核对并保存才生效。AI 证据必须逐字来自简历原文，AI 调用失败不覆盖已保存结果。
- 评价卡每次保存创建新版本，已有结论标记为待重新检查；修改简历原文后清除旧 AI 结果和逐项证据。
- 盲筛对界面和名单导出隐藏姓名、电话、邮箱、院校；原始简历下载和编辑须关闭盲筛。此功能用于共享工作台中的复核展示，不是用户权限隔离。
- 推荐名单只包含人工选择“建议进入面试”的候选人。需要至少确认一项原文证据，或填写至少 5 字的具体依据；待重新检查的记录会在名单中明确标注。
- 评价卡、名单 CSV、交付摘要可导出。经理反馈仅记录，不自动修改评价卡或人工结论。
- 不包含独立账号、权限系统、后台队列、图片 OCR、ZIP/JSON 导入或旧 localStorage 数据迁移。

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
docker build -t zhiheng-ai-hr:local .
```

默认测试包含规则、签名会话、AI 模拟响应、真实 DOCX/PDF 解析与存储失败边界。数据库测试必须显式提供独立测试库，测试会写入和删除自身创建的记录：

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5438/ai_hr_test pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5438/ai_hr_test pnpm test
# 另外验证真实 S3 上传、签名下载、解析失败和盲筛下载限制
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5438/ai_hr_test \
TEST_S3_ENDPOINT=http://localhost:9000 pnpm test
```

测试 S3 默认使用本地开发凭据与 `ai-hr` bucket，也可用 `TEST_S3_ACCESS_KEY_ID`、`TEST_S3_SECRET_ACCESS_KEY`、`TEST_S3_BUCKET` 覆盖。不要指向生产数据库或生产 bucket。

`GET /api/health` 成功返回 200，数据库不可用时返回 503。业务页面、Server Actions、上传、AI、下载和导出均校验登录。真实 AI 服务需要配置自己的凭据后做冒烟验证。

## GitHub Actions

推送 `main` 自动执行代码检查、数据库迁移、PostgreSQL/S3 集成测试、生产构建及 Docker 构建。推送 `main` 在检查通过后发布镜像并调用 cluster 自动部署，无需 Release 或版本标签；镜像仓库及部署凭据配置见 [GitHub Actions 说明](.github/README.md)。
