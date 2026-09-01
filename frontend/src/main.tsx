import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The worker injects a server-rendered copy of the rankings for crawlers and for
// anyone without JavaScript. Once React is about to paint, it is redundant.
document.getElementById('ssr-fallback')?.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
