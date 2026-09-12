import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import {DealflowExperiment,AutoBidExperiment} from './FrontierExperiments.jsx'
import MachineryDealEngineV2 from './MachineryDealEngineV2.jsx'

const path=window.location.pathname
const RoutedApp=path==='/frontier/dealflow'||path==='/frontier/dealflow/'
  ?DealflowExperiment
  :path==='/frontier/autobid'||path==='/frontier/autobid/'
    ?AutoBidExperiment
    :path==='/machinery-engine'||path==='/machinery-engine/'
      ?MachineryDealEngineV2
      :App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RoutedApp />
  </React.StrictMode>,
)
