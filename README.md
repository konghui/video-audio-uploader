# 视频音频提取 → 云盘上传服务

一个**本地单用户** Web 服务:粘贴视频链接(Bilibili / YouTube 等),自动提取音频、转成你选择的格式(默认最高质量 mp3),上传到你的百度网盘指定目录,并在页面实时显示进度。还能在界面上**浏览 / 下载 / 删除**云盘目录里的文件。

> 完整的分步部署与使用说明见 [`docs/使用与部署文档.md`](docs/使用与部署文档.md)。

## ✨ 功能

- 🎬 **多网站支持**:基于 `yt-dlp`,自动支持 Bilibili、YouTube 及上千个网站,无需为每个网站写代码
- 🎵 **音频格式可选**:界面下拉选择 `mp3`(默认)/ `m4a` / `opus` / `aac` / `flac` / `wav` / `vorbis` / `alac` / `best`,最高质量
- ☁️ **上传到百度网盘**:提取的音频自动上传到你配置的目录
- 📂 **云盘目录管理**:界面直接浏览目标目录内容,支持**下载**和**删除**文件
- 📊 **实时进度**:WebSocket 推送 解析 → 下载转码 → 上传 → 完成 全流程进度与日志
- ✅ **链接支持性校验**:提交前先校验链接是否支持,显示标题/时长
- 🔒 **简单登录鉴权**:用户名/密码来自配置文件,签名 cookie 会话
- 🐳 **容器化**:一个镜像内置全部依赖(node / yt-dlp / ffmpeg / deno / BaiduPCS-Go),`docker compose` 一键启动
- 🧩 **可扩展抽象**:`VideoSource`(视频来源)与 `CloudUploader`(云盘)是两个接口,将来加新网站/新云盘只需加一个实现

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 20+ · TypeScript · Fastify · WebSocket |
| 前端 | Vue 3 · Vite · Tailwind CSS |
| 外部工具(容器内置) | `yt-dlp`(下载)· `ffmpeg`(转码)· `deno`(YouTube JS 运行时)· `BaiduPCS-Go`(百度网盘) |
| 测试 | Vitest(67 个单元测试) |
| 无数据库 | 全部由 `config.yaml` 驱动,进度/会话存内存 |

## 🚀 快速开始(Docker / Podman)

```bash
# 1. 克隆
git clone https://github.com/konghui/video-audio-uploader
cd video-audio-uploader

# 2. 准备配置(填入你的账号密码、百度 BDUSS/STOKEN、目标目录)
cp config.example.yaml config.yaml
vim config.yaml

# 3. 启动
docker compose up -d          # 或:podman compose up -d

# 4. 打开浏览器
open http://localhost:8080
```

用配置里的用户名/密码登录 → 粘贴视频链接 → 选格式 → 校验 → 开始提取并上传。

## ⚙️ 配置 `config.yaml`

```yaml
server:
  port: 8080
  sessionSecret: "改成随机字符串"    # 签名 cookie 用,务必修改
auth:
  username: "admin"                  # 登录用户名
  password: "改成你的密码"
paths:
  tempDir: "/data/tmp"               # 容器内临时目录(compose 已挂载)
  ytdlp: "yt-dlp"                     # 容器内为 PATH 命令
  ffmpeg: "ffmpeg"
audio:
  format: "mp3"                      # 默认格式(界面可覆盖)
  quality: "0"                       # yt-dlp 最高质量 VBR
cloud:
  provider: "baidu"
  baidu:
    binary: "BaiduPCS-Go"
    bduss: "改成你的 BDUSS"           # 百度 cookie,见下
    stoken: "改成你的 STOKEN"         # 百度 cookie,上传必需!
    targetDir: "/小爱音乐"            # 网盘目标目录
```

### 如何获取百度 BDUSS 和 STOKEN(上传必需)

1. 浏览器登录 https://pan.baidu.com
2. 按 `F12` → `Application`/应用 → `Cookies` → 选 `https://pan.baidu.com`
3. 复制名为 **`BDUSS`** 和 **`STOKEN`** 两个 cookie 的值,分别填入配置

> ⚠️ **STOKEN 必填**:只填 BDUSS 会在上传时报「代码: -6, 消息: 请重新登录」。BDUSS 只够登录/查配额,上传/列目录需要 STOKEN。
> 🔐 BDUSS/STOKEN 是敏感凭证,`config.yaml` 已被 `.gitignore`,切勿提交或外泄。

## 🖥️ 使用

1. **登录**:输入配置里的用户名/密码
2. **选格式**:URL 输入框旁的下拉框(默认 mp3)
3. **校验**:粘贴链接后点「校验」,显示 ✅ 支持:标题 (时长)
4. **提取并上传**:点「开始提取并上传」,进度条 + 实时日志展示全过程
5. **云盘目录**:下方卡片列出目标目录文件,每行可**下载**(保存到本机)或**删除**;完成后自动刷新

## 🧑‍💻 本地开发(不用容器)

需要本机安装 `node 20+`、`yt-dlp`、`ffmpeg`(YouTube 还需 `deno`)、`BaiduPCS-Go`。

```bash
npm install
cp config.example.yaml config.yaml   # 把 ytdlp/ffmpeg/BaiduPCS-Go 改成本机路径或命令名
npm run build                        # 编译后端到 dist/
cd web && npm install && npm run build && cd ..   # 构建前端到 web/dist/
CONFIG_PATH=config.yaml node dist/index.js

# 或前端热更新开发:
cd web && npm run dev                # 代理 /api 与 /ws 到 :8080
```

测试:

```bash
npx vitest run     # 67 个单元测试
```

## 🩺 故障排查

| 现象 | 原因与解决 |
|------|-----------|
| 上传报「代码: -6 请重新登录」 | 缺 `STOKEN`,在 config 补上 |
| 上传报「代码: -9 文件不存在」 | 目标目录不存在——应用会自动 `mkdir`,若仍失败请手动创建 |
| 上传报「上传结果未知」/「已存在跳过」 | 目标已存在=成功(已按成功处理);其他未知输出会保守报失败 |
| 大文件上传很慢/传不完 | 网络到百度带宽/稳定性问题(尤其容器 VM 内);小文件正常,换网络或稍等 |
| YouTube 解析失败(No JS runtime) | 需要 `deno`(容器已内置;本地需自行安装) |
| 启动即退出,提示缺二进制 | 启动预检失败,确认 `yt-dlp`/`ffmpeg`/`BaiduPCS-Go` 可执行 |
| arm64(Apple Silicon)上 BaiduPCS-Go 无法执行 | Dockerfile 已按架构自动选 amd64/arm64 资产 |

## 📁 目录结构

```
src/
  core/      types / config / progress-parser / task-runner / baidu-list
  sources/   VideoSource 接口 + YtDlpSource
  uploaders/ CloudUploader 接口 + BaiduUploader
  server/    Fastify 路由 / 鉴权 / WebSocket / 入口
web/         Vue 3 + Vite + Tailwind 前端
test/        Vitest 单元测试
Dockerfile · docker-compose.yml · config.example.yaml
docs/        设计文档、实现计划、使用与部署文档
```

## 🔐 安全说明

- 面向**本地单用户**场景,鉴权为简单的用户名/密码 + 签名 cookie
- 若要暴露到公网,请自行加 HTTPS、更强鉴权、CSRF 防护等
- `config.yaml`、`data/` 已 gitignore,不会进版本库

## 📄 许可

个人项目,按需使用。
