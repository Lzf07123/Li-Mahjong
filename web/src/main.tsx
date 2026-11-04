import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 生产环境注册 Service Worker:离线兜底 + 静态资源缓存(开发模式跳过,不影响热更新)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败(如非 HTTPS/localhost 环境)静默忽略,不影响任何功能 */
    });
  });
}
