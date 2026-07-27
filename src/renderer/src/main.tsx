import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { RecorderOverlay } from './RecorderOverlay'
import './styles.css'

const params = new URLSearchParams(window.location.search)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {params.has('overlay') ? <RecorderOverlay /> : <App />}
  </React.StrictMode>
)
