import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 节点')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary scope="page">
      <App />
    </ErrorBoundary>
  </StrictMode>
)
