# 视频音频提取 + 云盘上传服务 — 设计文档

日期:2026-09-01
状态:待实现

## 1. 目标与范围

一个**本地单用户** Web 服务。启动后浏览器打开页面,登录后粘贴视频链接(Bilibili、YouTube 等),服务提取该视频的音频、转码为**最高质量 mp3**,并上传到指定云盘目录(当前为百度网盘),页面实时展示整个操作进度。

视频网站**自动识别**:用户无需指定来源,系统根据 URL 交给默认 `YtDlpSource` 处理,yt-dlp 能识别的所有网站(Bilibili、YouTube 及上千站点)开箱即用,无需为每个网站写代码。

**明确不做(YAGNI)**:
- 无数据库(配置文件配置一切,进度存内存)。
- 无多用户 / 无公网多租户(单用户 + 简单登录即可)。
- 无任务队列(同一时刻只处理一个活动任务,忙碌时拒绝新任务)。
- 不做视频保存,只保留音频 mp3(上传后删除本地文件)。

**扩展点(必须抽象好)**:
- 视频来源:`VideoSource` 接口,默认实现 `YtDlpSource` 自动覆盖 yt-dlp 支持的全部网站(Bilibili、YouTube 等);仅当某网站 yt-dlp 无法处理时才需另写实现。
- 云盘:`CloudUploader` 接口,默认百度网盘;将来可加其他云盘。

## 2. 技术栈

- 运行时/语言:Node.js + TypeScript
- Web 框架:Fastify(或 Express)
- 前端:Vue 3 + Vite + Tailwind CSS(构建产物由后端静态托管)
- 进度推送:WebSocket
- 外部可执行依赖(子进程调用):`yt-dlp`、`ffmpeg`、`BaiduPCS-Go`
- 配置:`config.yaml`
- 容器化:`Dockerfile`(内置全部依赖)+ `docker-compose.yml`(测试与部署样例)

## 3. 整体架构

### 3.1 流水线(单任务,顺序执行)

```
贴链接 → ①解析元信息 → ②下载+抽取音频转 mp3 → ③上传到网盘 → ④清理临时文件
```

- 阶段②用 yt-dlp `-x --audio-format mp3 --audio-quality 0`(最高质量 VBR),下载与转码一步到位,ffmpeg 由 yt-dlp 内部调用。
- 上传成功后删除本地 mp3;失败或完成都会执行清理。

### 3.2 组件

| 组件 | 职责 | 依赖 |
|------|------|------|
| `WebServer` | 提供页面、REST API、WebSocket 推送 | Fastify |
| `AuthMiddleware` | 校验登录 session(签名 cookie),保护所有 API 与 WS | 配置中的用户名/密码 |
| `TaskRunner` | 编排 4 个阶段,汇总进度/错误,保证单活动任务 | VideoSource / CloudUploader |
| `VideoSource`(接口) | 解析+下载音频,产出本地 mp3;按 URL 自动选择实现 | 默认实现 `YtDlpSource`(spawn yt-dlp,覆盖全部 yt-dlp 支持站点) |
| `CloudUploader`(接口) | 上传文件到云盘目录 | 默认实现 `BaiduUploader`(spawn BaiduPCS-Go) |
| `ProgressParser` | 解析子进程输出 → 阶段/百分比(纯函数) | 无 |
| `Config` | 读取并校验配置文件 | yaml |

新增网站/云盘 = 加一个接口实现 + 配置指定,不改编排逻辑。

## 4. 数据流

```
浏览器 ──登录 POST /api/login {user,pass}────────► 校验→下发签名 cookie
浏览器 ──POST /api/tasks {url}──────────────────► TaskRunner 启动,返回 {taskId}
浏览器 ──WebSocket /ws (带 cookie)──────────────► 订阅进度
后端  ──推送 {stage, percent, message, status}─► 实时更新 UI
```

单用户单活动任务:若已有任务在跑,新提交返回「忙碌中」提示。

### 4.1 进度消息模型(WebSocket)

```ts
{
  taskId: string,
  stage: 'resolving' | 'downloading' | 'uploading' | 'cleaning' | 'done' | 'error',
  percent: number,        // 当前阶段 0-100
  title?: string,         // 解析到的视频标题
  message: string,        // 人类可读日志行
  status: 'running' | 'success' | 'failed'
}
```

- `downloading` 百分比:解析 yt-dlp stdout 的 `[download] xx.x%`。
- `uploading` 百分比:解析 BaiduPCS-Go 输出进度。
- 无法拿到精确百分比时,退化为「阶段进行中」的不确定进度条。

### 4.2 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录,成功下发签名 cookie |
| POST | `/api/logout` | 注销 |
| POST | `/api/tasks` | 提交链接,启动任务;忙碌时返回 409 |
| GET  | `/api/tasks/current` | 查询当前任务状态(页面刷新后恢复视图) |
| WS   | `/ws` | 订阅实时进度 |

## 5. 配置文件 `config.yaml`

```yaml
server:
  port: 8080
  sessionSecret: "改我"        # 签名 cookie 用
auth:
  username: "admin"
  password: "改我"
paths:
  tempDir: "/data/tmp"          # 下载临时目录
  ytdlp: "yt-dlp"               # 容器内为绝对路径
  ffmpeg: "ffmpeg"
audio:
  format: "mp3"
  quality: "0"                  # yt-dlp 最高质量 VBR
cloud:
  provider: "baidu"             # 扩展点:将来可换
  baidu:
    binary: "BaiduPCS-Go"
    bduss: "改我"               # 或首次容器内扫码登录
    targetDir: "/我的音频"       # 云盘目标目录
```

## 6. 错误处理

- **启动预检**:配置字段完整性 + 三个二进制(yt-dlp/ffmpeg/BaiduPCS-Go)可执行性;缺失即报错退出并给出明确提示。
- 每阶段失败 → WS 推 `status:'failed'` + 错误信息,前端红色提示,任务结束(用户可重新提交)。
- 失败/完成都执行临时文件清理;上传成功后删除本地 mp3。
- URL 非法 / yt-dlp 不支持该站点 → 解析阶段即返回明确错误。

## 7. 前端(Vue 3 + Vite + Tailwind)

- 视图:登录页 → 主页面。
- 主页面:链接输入框 + 提交按钮 + 分阶段进度条 + 实时日志区域;显示解析到的标题。
- 现代简洁清爽风格,响应式。
- 页面刷新后通过 `GET /api/tasks/current` 恢复当前任务视图。

## 8. 容器化

- `Dockerfile`:基于 node 镜像,预装 `yt-dlp`、`ffmpeg`、`BaiduPCS-Go`;构建前端产物并由后端托管。
- `docker-compose.yml`:映射端口,挂载 `config.yaml`、`tempDir`;一条命令起服务,用于本地测试与部署样例。
- 配置与数据目录通过 volume 挂载,镜像本身无状态。

## 9. 测试策略(TDD)

- **单元测试(重点)**:
  - `ProgressParser`:喂 yt-dlp / BaiduPCS-Go 样例输出 → 断言阶段与百分比。
  - `Config`:加载与字段校验。
  - `AuthMiddleware`:登录/未登录访问保护。
- **编排测试**:`TaskRunner` 用 mock 的 `VideoSource`/`CloudUploader` 跑全流程,验证阶段顺序、进度汇总、错误分支、忙碌拒绝。
- **接口契约测试**:任何 `CloudUploader`/`VideoSource` 实现须过同一组契约测试。
- **容器冒烟**:`docker-compose up` 起服务,登录并跑一次任务(可 mock 上传)验证端到端。
- 先写解析器与编排测试,再写实现。

## 10. 目录结构(建议)

```
/src
  /server        WebServer, routes, AuthMiddleware, ws
  /core          TaskRunner, ProgressParser, Config, 类型定义
  /sources       VideoSource 接口 + YtDlpSource
  /uploaders     CloudUploader 接口 + BaiduUploader
/web             Vue 3 + Vite 前端
/test            单元/编排/契约测试
Dockerfile
docker-compose.yml
config.example.yaml
```
