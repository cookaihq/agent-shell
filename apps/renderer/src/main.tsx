import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// 自托管字体（替代被墙的 Google Fonts：fonts.googleapis.com / fonts.gstatic.com 在国内 TLS 握手被 GFW 重置）。
// 仅 latin 子集（CJK 本就走系统字体回退）；weight 对齐原 Google Fonts 请求。Vite 打包 woff2，运行时不再联网取字体。
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-500.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/source-serif-4/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import './styles/base.css'
import './styles/markdown.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
