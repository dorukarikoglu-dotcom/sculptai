import React from 'react'
import ReactDOM from 'react-dom/client'
import App,{ ErrorBoundary } from './App.jsx'
import MachineryDealEngineV2 from './MachineryDealEngineV2.jsx'

const path=window.location.pathname
const RoutedApp=path==='/machinery-engine'||path==='/machinery-engine/'?MachineryDealEngineV2:App

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <RoutedApp />
  </ErrorBoundary>
)
