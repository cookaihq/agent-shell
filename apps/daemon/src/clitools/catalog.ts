/**
 * CLI 工具目录——从 CodePilot cli-tools-catalog.ts 移植，仅保留 zh 字段。
 * 字段映射规则见 spec §A.3（docs/superpowers/specs/2026-06-08-cli-tools-codepilot-port-design.md）。
 *
 * friendliness 计分：CodePilot 中每个工具最多 5 个布尔
 *   agentFriendly / supportsJson / supportsSchema / supportsDryRun / contextFriendly
 * 各为 true 的个数即为 friendliness（0..5）。
 */

import type { CliToolDef } from '@agent-shell/contracts'

export const CLI_TOOLS_CATALOG: CliToolDef[] = [
  // ── 1. FFmpeg ──────────────────────────────────────────────────────────────
  // friendliness: 5个布尔全无 → 0
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    binNames: ['ffmpeg', 'ffprobe'],
    summary: '音视频处理瑞士军刀，支持转码、剪辑、合并、流处理',
    categories: ['media'],
    installMethods: [
      { method: 'brew', command: 'brew install ffmpeg', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'FFmpeg 是最强大的开源音视频处理工具，支持几乎所有格式的转码、剪辑、合并、滤镜处理和流媒体操作。Claude 可以帮你生成复杂的 FFmpeg 命令。',
    useCases: ['视频格式转换（MP4/MKV/WebM 互转）', '音频提取和转码', '视频剪辑和拼接', '添加字幕和水印', '调整分辨率和码率'],
    guideSteps: ['安装 FFmpeg（推荐使用 Homebrew）', '安装完成后在终端输入 ffmpeg -version 验证', '在对话中描述你的音视频处理需求，Claude 会生成对应命令'],
    examplePrompts: [
      { label: 'Convert to MP4', prompt: '把 input.mov 转换成 MP4 格式，保持原始质量' },
      { label: 'Extract audio', prompt: '从视频文件中提取音频并保存为 MP3' },
      { label: 'Compress video', prompt: '将视频压缩到 10MB 以内，尽量保持画质' },
    ],
    friendliness: 0,
    home: 'https://ffmpeg.org',
    repoUrl: 'https://github.com/FFmpeg/FFmpeg',
    docsUrl: 'https://ffmpeg.org/documentation.html',
    custom: false,
  },

  // ── 2. jq ──────────────────────────────────────────────────────────────────
  // friendliness: supportsJson=true → 1
  {
    id: 'jq',
    name: 'jq',
    binNames: ['jq'],
    summary: '轻量级 JSON 处理器，支持查询、过滤、转换',
    categories: ['data'],
    installMethods: [
      { method: 'brew', command: 'brew install jq', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'jq 是命令行下的 JSON 处理利器，可以对 JSON 数据进行查询、过滤、映射和格式化。适合处理 API 响应、配置文件和日志分析。',
    useCases: ['解析和格式化 JSON 数据', '从 API 响应中提取特定字段', '批量转换 JSON 文件', '分析 JSON 格式的日志'],
    guideSteps: ['安装 jq', '运行 jq --version 验证安装', '使用管道将 JSON 数据传给 jq 处理'],
    examplePrompts: [
      { label: 'Parse JSON', prompt: '用 jq 从 package.json 中提取所有依赖名称' },
      { label: 'Filter array', prompt: '用 jq 过滤 JSON 数组中 status 为 active 的项目' },
    ],
    friendliness: 1,
    home: 'https://jqlang.github.io/jq/',
    repoUrl: 'https://github.com/jqlang/jq',
    docsUrl: 'https://jqlang.github.io/jq/manual/',
    custom: false,
  },

  // ── 3. ripgrep ─────────────────────────────────────────────────────────────
  // friendliness: supportsJson=true → 1
  {
    id: 'ripgrep',
    name: 'ripgrep',
    binNames: ['rg'],
    summary: '极速文本搜索工具，比 grep 快数倍',
    categories: ['search'],
    installMethods: [
      { method: 'brew', command: 'brew install ripgrep', platforms: ['darwin', 'linux'] },
      { method: 'cargo', command: 'cargo install ripgrep', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: 'ripgrep (rg) 是一个面向行的搜索工具，递归搜索当前目录中的正则表达式模式。它默认尊重 .gitignore 规则，速度极快。',
    useCases: ['在代码库中搜索特定模式', '查找包含特定文本的文件', '替代 grep 进行大规模搜索', '搜索时自动跳过 .gitignore 中的文件'],
    guideSteps: ['安装 ripgrep', '运行 rg --version 验证安装', '使用 rg "pattern" 搜索当前目录'],
    examplePrompts: [
      { label: 'Search code', prompt: '用 ripgrep 在项目中搜索所有 TODO 注释' },
      { label: 'Find usage', prompt: '用 rg 搜索某个函数在哪些文件中被调用' },
    ],
    friendliness: 1,
    home: 'https://github.com/BurntSushi/ripgrep',
    repoUrl: 'https://github.com/BurntSushi/ripgrep',
    custom: false,
  },

  // ── 4. yt-dlp ──────────────────────────────────────────────────────────────
  // friendliness: supportsJson=true → 1
  {
    id: 'yt-dlp',
    name: 'yt-dlp',
    binNames: ['yt-dlp'],
    summary: '功能强大的视频下载工具，支持数千个网站',
    categories: ['download', 'media'],
    installMethods: [
      { method: 'brew', command: 'brew install yt-dlp', platforms: ['darwin', 'linux'] },
      { method: 'pipx', command: 'pipx install yt-dlp', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: 'yt-dlp 是 youtube-dl 的活跃分支，支持从数千个网站下载视频和音频。功能包括格式选择、字幕下载、播放列表处理等。',
    useCases: ['下载在线视频', '提取视频中的音频', '下载字幕文件', '批量下载播放列表'],
    guideSteps: ['安装 yt-dlp', '运行 yt-dlp --version 验证安装', '使用 yt-dlp URL 下载视频'],
    examplePrompts: [
      { label: 'Download video', prompt: '用 yt-dlp 下载这个视频的最高画质版本' },
      { label: 'Extract audio', prompt: '用 yt-dlp 只下载音频并转为 MP3' },
    ],
    friendliness: 1,
    home: 'https://github.com/yt-dlp/yt-dlp',
    repoUrl: 'https://github.com/yt-dlp/yt-dlp',
    docsUrl: 'https://github.com/yt-dlp/yt-dlp#readme',
    custom: false,
  },

  // ── 5. Pandoc ──────────────────────────────────────────────────────────────
  // friendliness: 5个布尔全无 → 0
  {
    id: 'pandoc',
    name: 'Pandoc',
    binNames: ['pandoc'],
    summary: '通用文档格式转换器，支持 Markdown/HTML/PDF/DOCX 等',
    categories: ['document'],
    installMethods: [
      { method: 'brew', command: 'brew install pandoc', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'Pandoc 是一个通用的文档格式转换器，支持 Markdown、HTML、LaTeX、PDF、DOCX、EPUB 等数十种格式之间的相互转换。',
    useCases: ['Markdown 转 PDF/DOCX', 'HTML 转 Markdown', '批量文档格式转换', '生成电子书（EPUB）'],
    guideSteps: ['安装 Pandoc', '运行 pandoc --version 验证安装', '使用 pandoc input.md -o output.pdf 转换文件'],
    examplePrompts: [
      { label: 'MD to PDF', prompt: '用 pandoc 把 README.md 转成 PDF' },
      { label: 'HTML to MD', prompt: '用 pandoc 把网页 HTML 转成 Markdown' },
    ],
    friendliness: 0,
    home: 'https://pandoc.org',
    repoUrl: 'https://github.com/jgm/pandoc',
    docsUrl: 'https://pandoc.org/MANUAL.html',
    custom: false,
  },

  // ── 6. ImageMagick ─────────────────────────────────────────────────────────
  // friendliness: 5个布尔全无 → 0
  {
    id: 'imagemagick',
    name: 'ImageMagick',
    binNames: ['magick', 'convert'],
    summary: '强大的图片处理工具，支持格式转换、缩放、裁剪、特效',
    categories: ['media'],
    installMethods: [
      { method: 'brew', command: 'brew install imagemagick', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'ImageMagick 是一个功能丰富的图片处理套件，支持 200+ 种图片格式的读写和转换，以及缩放、裁剪、旋转、合成、特效等操作。',
    useCases: ['批量图片格式转换', '图片缩放和裁剪', '添加水印和文字', '图片拼接和合成', 'PDF 转图片'],
    guideSteps: ['安装 ImageMagick', '运行 magick --version 验证安装', '使用 magick convert input.png output.jpg 转换图片'],
    examplePrompts: [
      { label: 'Batch resize', prompt: '用 ImageMagick 批量将文件夹中的图片缩放到 800px 宽' },
      { label: 'Add watermark', prompt: '用 ImageMagick 给图片添加文字水印' },
    ],
    friendliness: 0,
    home: 'https://imagemagick.org',
    repoUrl: 'https://github.com/ImageMagick/ImageMagick',
    docsUrl: 'https://imagemagick.org/script/command-line-processing.php',
    custom: false,
  },

  // ── 7. Google Workspace CLI ────────────────────────────────────────────────
  // friendliness: agentFriendly+supportsJson+supportsSchema+supportsDryRun+contextFriendly → 5
  {
    id: 'gws',
    name: 'Google Workspace CLI',
    binNames: ['gws'],
    summary: 'Google Workspace 命令行工具，支持 Drive/Gmail/Calendar/Sheets 等 API 操作',
    categories: ['productivity'],
    installMethods: [
      { method: 'npm', command: 'npm install -g @googleworkspace/cli', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: 'gws 是 Google Workspace 的官方命令行工具，通过 Google Discovery Service 动态生成命令，自动覆盖所有 Workspace API。输出为结构化 JSON，天然适合 AI 代理和脚本集成。首次使用需通过 OAuth 完成身份认证。',
    useCases: ['管理 Google Drive 文件（上传、下载、搜索）', '读取和发送 Gmail 邮件', '操作 Google Sheets 数据', '管理 Google Calendar 日程', '在 CI/脚本中自动化 Google Workspace 操作'],
    guideSteps: ['安装 gws：npm install -g @googleworkspace/cli', '按需安装 AI Agent Skills（如 npx skills add https://github.com/googleworkspace/cli/tree/main/skills/gws-drive）', '运行 gws auth setup 配置 Google Cloud 项目（需要 gcloud CLI 或手动配置 OAuth）', '运行 gws auth login -s drive,gmail,sheets 选择需要的 API 权限并登录', '使用 gws drive files list 等命令操作 Workspace 资源'],
    examplePrompts: [
      { label: 'List Drive files', prompt: '用 gws 列出我 Google Drive 根目录下的文件' },
      { label: 'Send email', prompt: '用 gws 发送一封测试邮件' },
      { label: 'Read spreadsheet', prompt: '用 gws 读取 Google Sheets 表格中的数据' },
    ],
    friendliness: 5,
    home: 'https://github.com/googleworkspace/cli',
    repoUrl: 'https://github.com/googleworkspace/cli',
    docsUrl: 'https://github.com/googleworkspace/cli#readme',
    custom: false,
  },

  // ── 8. ElevenLabs CLI ──────────────────────────────────────────────────────
  // friendliness: agentFriendly+supportsDryRun → 2
  {
    id: 'elevenlabs',
    name: 'ElevenLabs CLI',
    binNames: ['elevenlabs'],
    summary: 'AI 语音代理管理工具，支持创建、配置、部署语音代理',
    categories: ['productivity'],
    installMethods: [
      { method: 'npm', command: 'npm install -g @elevenlabs/cli', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: 'ElevenLabs CLI 让你通过命令行管理 AI 语音代理。支持创建代理模板、推送/拉取配置同步、监控状态、生成嵌入代码，以及 CI/CD 集成。编码代理可以直接管理你的语音代理。',
    useCases: ['创建和配置 AI 语音代理', '推送/拉取代理配置同步', '管理 Webhook 和客户端工具集成', '通过 CI/CD 自动部署语音代理', '生成网页嵌入代码'],
    guideSteps: ['安装：npm install -g @elevenlabs/cli', '运行 elevenlabs init 初始化项目结构', '运行 elevenlabs auth login 配置 API 密钥（密钥存储在 ~/.agents/api_keys.json）', '运行 elevenlabs agents add 从模板创建代理'],
    examplePrompts: [
      { label: 'Create agent', prompt: '用 ElevenLabs CLI 创建一个客服语音代理' },
      { label: 'Sync config', prompt: '把本地的语音代理配置推送到 ElevenLabs 平台' },
    ],
    friendliness: 2,
    home: 'https://elevenlabs.io',
    repoUrl: 'https://github.com/elevenlabs/cli',
    docsUrl: 'https://elevenlabs.io/docs/eleven-agents/operate/cli',
    custom: false,
  },

  // ── 9. Stripe CLI ──────────────────────────────────────────────────────────
  // friendliness: agentFriendly+supportsJson → 2
  {
    id: 'stripe',
    name: 'Stripe CLI',
    binNames: ['stripe'],
    summary: '支付集成命令行工具，支持资源管理、Webhook 调试、日志监控',
    categories: ['productivity'],
    installMethods: [
      { method: 'brew', command: 'brew install stripe/stripe-cli/stripe', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'Stripe CLI 是 Stripe 官方命令行工具，支持在沙箱中创建/查询/更新支付资源、实时监控 API 日志、触发和转发 Webhook 事件到本地开发服务器。还可安装 Projects 插件统一管理第三方服务凭证和环境变量。',
    useCases: ['在沙箱中创建和管理支付资源', '实时监控 API 请求日志', '触发和转发 Webhook 事件到本地', '通过 Projects 插件管理多服务凭证和环境变量', '在 CI/CD 中自动化支付测试'],
    guideSteps: ['安装：brew install stripe/stripe-cli/stripe', '运行 stripe login 完成身份认证（会在浏览器中打开配对页面）', '运行 stripe listen --forward-to localhost:4242/webhooks 转发 Webhook 事件到本地', '记录 listen 命令输出的 webhook signing secret（whsec_...）用于签名验证'],
    examplePrompts: [
      { label: 'Forward webhooks', prompt: '用 Stripe CLI 把 Webhook 事件转发到我的本地服务器' },
      { label: 'Trigger event', prompt: '用 Stripe CLI 触发一个 checkout.session.completed 事件' },
      { label: 'View logs', prompt: '用 Stripe CLI 实时查看 API 请求日志' },
    ],
    friendliness: 2,
    home: 'https://stripe.com/docs/stripe-cli',
    repoUrl: 'https://github.com/stripe/stripe-cli',
    docsUrl: 'https://docs.stripe.com/stripe-cli',
    custom: false,
  },

  // ── 10. 网易云音乐 CLI ────────────────────────────────────────────────────
  // friendliness: agentFriendly → 1
  {
    id: 'ncm-cli',
    name: '网易云音乐 CLI',
    binNames: ['ncm-cli'],
    summary: '网易云音乐命令行播放器，支持搜索、播放、歌单管理，专为 AI Agent 设计',
    categories: ['media'],
    installMethods: [
      { method: 'npm', command: 'npm install -g @music163/ncm-cli', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: 'ncm-cli 是网易云音乐的命令行客户端，支持音乐搜索、播放控制、歌单管理、每日推荐等功能，内置全屏 TUI 播放器。专为 AI Agent 设计，提供 Claude Code 技能和 OpenClaw 集成，支持自然语言控制音乐播放。需要 mpv 播放器和网易云音乐账号。',
    useCases: ['搜索和播放网易云音乐', '管理和创建歌单', '获取每日推荐和个性化内容', '通过 AI Agent 自然语言控制音乐', 'TUI 全屏播放器体验'],
    guideSteps: ['安装：npm install -g @music163/ncm-cli', '安装 mpv 播放器（本地播放必需）：brew install mpv', '运行 ncm-cli configure 配置 API 凭证（需要网易云开发者账号的 App ID 和 Private Key）', '运行 ncm-cli login 扫码登录网易云音乐账号'],
    examplePrompts: [
      { label: 'Play music', prompt: '帮我播放一首轻松的音乐' },
      { label: 'Search song', prompt: '搜索周杰伦的晴天并播放' },
      { label: 'Daily picks', prompt: '播放我的每日推荐歌曲' },
    ],
    friendliness: 1,
    home: 'https://www.npmjs.com/package/@music163/ncm-cli',
    repoUrl: 'https://github.com/nicepkg/ncm-cli',
    custom: false,
  },

  // ── 11. 即梦 Dreamina CLI ─────────────────────────────────────────────────
  // friendliness: agentFriendly+supportsJson → 2
  {
    id: 'dreamina',
    name: '即梦 Dreamina CLI',
    binNames: ['dreamina'],
    summary: '即梦 AI 创作工具包，支持文生图、文生视频、图生图、图生视频',
    categories: ['media'],
    installMethods: [
      { method: 'brew', command: 'curl -fsSL https://jimeng.jianying.com/cli | bash', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: '即梦 Dreamina CLI 是面向 AI Agent 的创作工具包，让你的 Agent 能够使用即梦的图片和视频生成能力。无需额外开通会员，Agent 可以自动使用你的即梦账号进行文生图、文生视频、图生图、图生视频等任务。支持异步任务轮询、结果下载、历史记录查询。',
    useCases: ['文字描述生成图片（text2image）', '文字描述生成视频（text2video）', '图片风格转换（image2image）', '静态图片转动态视频（image2video）', '批量自动化创作任务'],
    guideSteps: ['安装：curl -fsSL https://jimeng.jianying.com/cli | bash', '运行 dreamina login 完成浏览器登录授权', '运行 dreamina user_credit 验证登录状态', '使用 dreamina text2image --prompt="描述" 开始生成'],
    examplePrompts: [
      { label: 'Generate image', prompt: '用即梦生成一张赛博朋克风格的城市夜景图片' },
      { label: 'Generate video', prompt: '用即梦把这段描述生成一个 5 秒的短视频' },
      { label: 'Image to video', prompt: '用即梦把这张图片转成动态视频' },
    ],
    friendliness: 2,
    home: 'https://jimeng.jianying.com',
    custom: false,
  },

  // ── 12. 飞书 Lark CLI ─────────────────────────────────────────────────────
  // friendliness: agentFriendly+supportsJson+supportsSchema+supportsDryRun+contextFriendly → 5
  {
    id: 'lark-cli',
    name: '飞书 Lark CLI',
    binNames: ['lark-cli'],
    summary: '飞书开放平台命令行工具，覆盖消息、文档、多维表格、日历、邮箱等 200+ 命令',
    categories: ['productivity'],
    installMethods: [
      { method: 'npm', command: 'npm install -g @larksuite/cli', platforms: ['darwin', 'linux', 'win32'] },
    ],
    detailIntro: '飞书 Lark CLI 是飞书开放平台的命令行工具，为 AI Agent 原生设计。覆盖日历、即时通讯、云文档、多维表格、电子表格、任务、知识库、邮箱、视频会议等 11 大业务域，提供 200+ 命令和 19 个 AI Agent Skills。支持三层调用架构（快捷命令→API 命令→通用调用），内置结构化输出和 dry-run 预览。',
    useCases: ['发送消息和管理群聊', '创建和编辑飞书文档', '操作多维表格和电子表格数据', '查看日历日程和管理任务', '搜索和阅读邮件'],
    guideSteps: ['安装：npm install -g @larksuite/cli', '安装全部 19 个 AI Agent Skills：npx skills add larksuite/cli -y', '运行 lark-cli config init --new 配置应用凭证（需在浏览器中完成授权）', '运行 lark-cli auth login --recommend 完成登录授权', '运行 lark-cli auth status 验证登录状态'],
    examplePrompts: [
      { label: 'Send message', prompt: '用飞书 CLI 给某个群聊发一条消息' },
      { label: 'Create doc', prompt: '用飞书 CLI 创建一个新文档并写入内容' },
      { label: 'View agenda', prompt: '用飞书 CLI 查看我今天的日程安排' },
    ],
    friendliness: 5,
    home: 'https://github.com/larksuite/cli',
    repoUrl: 'https://github.com/larksuite/cli',
    custom: false,
  },
]

/**
 * 除精选目录外，检测时额外探测的常见 CLI 工具。
 * 条目格式：[id, displayName, binName]
 * 原样从 CodePilot cli-tools-catalog.ts 移植。
 */
export const EXTRA_WELL_KNOWN_BINS: Array<[string, string, string]> = [
  ['wget', 'wget', 'wget'],
  ['curl', 'curl', 'curl'],
  ['git', 'Git', 'git'],
  ['python3', 'Python 3', 'python3'],
  ['node', 'Node.js', 'node'],
  ['go', 'Go', 'go'],
  ['rustc', 'Rust', 'rustc'],
  ['docker', 'Docker', 'docker'],
  ['kubectl', 'kubectl', 'kubectl'],
  ['terraform', 'Terraform', 'terraform'],
  ['gh', 'GitHub CLI', 'gh'],
  ['aws', 'AWS CLI', 'aws'],
  ['gcloud', 'Google Cloud CLI', 'gcloud'],
  ['sox', 'SoX', 'sox'],
  ['sqlite3', 'SQLite', 'sqlite3'],
  ['htop', 'htop', 'htop'],
  ['tmux', 'tmux', 'tmux'],
  ['bat', 'bat', 'bat'],
  ['fd', 'fd', 'fd'],
  ['fzf', 'fzf', 'fzf'],
]
