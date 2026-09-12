import React,{useEffect,useMemo,useState} from 'react'
import MachineryDealEngineV3 from './MachineryDealEngineV3.jsx'

const norm=(v='')=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const BASE={
 'Mainstream CNC turning':35,
 '3m / 100–150t CNC press brake':25,
 '3015 branded fiber laser':20,
 'Stone CNC / bridge saw':10,
 'Other high-ticket machinery':10,
}
const reward={prospect:0,outreach_sent:.25,reply:1,positive_reply:2,verified_buyer:4,strong_match:6,written_commission:8,introduction:10,inspection:20,negotiation:30,closed_sale:100}
function seg(e){return e.segment||e.category||e.machineSegment||'Other high-ticket machinery'}
function outcomeReward(e){
 const s=String(e.outcome||e.stage||e.status||e.emailIntent||'').toLowerCase()
 if(e.type==='email_event'){
  if(e.emailIntent==='positive')return 2
  if(e.emailIntent==='technical_question'||e.emailIntent==='commercial'||e.emailIntent==='commission')return 1.5
  if(e.emailIntent==='negative')return -1
  return .25
 }
 if(e.type==='deal'){
  if(s.includes('closed'))return 100
  if(s.includes('negoti'))return 30
  if(s.includes('inspect'))return 20
  if(s.includes('intro'))return 10
  if(s.includes('commission'))return 8
  if(s.includes('match'))return 6
  if(s.includes('verified'))return 4
 }
 if(e.type==='buyer')return e.status==='VERIFIED'?4:e.status==='OUTREACH_SENT'?.25:0
 if(e.type==='inventory'&&e.commissionWritten&&Number(e.commissionPct)>0)return 8
 return reward[s]||0
}
function learn(events){
 const stats={};for(const k of Object.keys(BASE))stats[k]={segment:k,n:0,reward:0,positive:0,negative:0,closed:0}
 for(const e of events){const k=seg(e);if(!stats[k])stats[k]={segment:k,n:0,reward:0,positive:0,negative:0,closed:0};const r=outcomeReward(e);stats[k].n++;stats[k].reward+=r;if(r>0)stats[k].positive++;if(r<0)stats[k].negative++;if(r>=100)stats[k].closed++}
 const rows=Object.values(stats).map(x=>{const prior=BASE[x.segment]??10;const evidence=Math.min(1,x.n/20);const avg=x.n?x.reward/x.n:0;const quality=Math.max(.25,Math.min(3,1+avg/12));const learned=prior*(1-evidence)+prior*quality*evidence;return {...x,prior,avg,evidence,rawWeight:learned}})
 const total=rows.reduce((s,x)=>s+x.rawWeight,0)||1;rows.forEach(x=>x.weight=100*x.rawWeight/total)
 return rows.sort((a,b)=>b.weight-a.weight)
}
function money(v,c='EUR'){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(v||0)}catch{return `${v||0} ${c}`}}

export default function MachineryDealEngineV4(){
 const [events,setEvents]=useState([]),[status,setStatus]=useState({loading:true,persisted:false}),[view,setView]=useState('learning')
 async function sync(){setStatus(s=>({...s,loading:true}));try{const r=await fetch('/api/machinery-events',{cache:'no-store'});const j=await r.json();setEvents(j.events||[]);setStatus({loading:false,persisted:!!j.persisted,warning:j.warning||null})}catch{setStatus({loading:false,persisted:false,warning:'feed_unreachable'})}}
 useEffect(()=>{sync();const id=setInterval(sync,60000);return()=>clearInterval(id)},[])
 const model=useMemo(()=>learn(events),[events])
 const realized=events.filter(e=>e.type==='deal'&&String(e.status||e.stage||e.outcome||'').toLowerCase().includes('closed')).reduce((s,e)=>s+(Number(e.commission)||0),0)
 const samples=events.length
 const confidence=samples>=100?'high':samples>=30?'medium':samples>=10?'low-medium':'low'
 const btn=(on)=>({border:'1px solid #334155',background:on?'#7c3aed':'transparent',color:'#fff',padding:'9px 12px',borderRadius:10,fontWeight:800,cursor:'pointer'})
 return <div style={{minHeight:'100vh',background:'#050811',color:'#e5e7eb',fontFamily:'Inter,system-ui'}}><div style={{maxWidth:1320,margin:'0 auto',padding:26}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}><div><div style={{fontSize:12,fontWeight:900,color:'#a78bfa',letterSpacing:1.4}}>MACHINERY DEAL ENGINE · V4</div><h1 style={{margin:'6px 0'}}>Outcome Learning Loop</h1><div style={{color:'#94a3b8'}}>Observe → predict → act → outcome → reward → reallocate.</div></div><div style={{display:'flex',gap:8}}><button style={btn(view==='learning')} onClick={()=>setView('learning')}>LEARNING</button><button style={btn(view==='execution')} onClick={()=>setView('execution')}>EXECUTION</button><button style={btn(false)} onClick={sync}>SYNC</button></div></div>
  {view==='learning'?<>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginTop:18}}>{[[samples,'Training events'],[confidence,'Model confidence'],[model[0]?.segment||'—','Top allocation'],[`${(model[0]?.weight||0).toFixed(1)}%`,'Top weight'],[money(realized),'Realized commission']].map(([v,l])=><div key={l} style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:16}}><div style={{fontSize:typeof v==='string'&&v.length>16?17:30,fontWeight:900}}>{v}</div><div style={{color:'#94a3b8',fontSize:12}}>{l}</div></div>)}</div>
   <div style={{marginTop:10,fontSize:12,color:'#94a3b8'}}>Auto-train cadence: hourly via event outcomes · persistence: {status.persisted?'shared':'fallback/local'} · confidence remains conservative until enough outcomes exist.</div>
   <div style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:18,marginTop:16}}><h3 style={{marginTop:0}}>Adaptive discovery allocation</h3>{model.map((m,i)=><div key={m.segment} style={{display:'grid',gridTemplateColumns:'1.4fr .45fr .45fr .45fr .55fr 1fr',gap:10,padding:'12px 0',borderTop:'1px solid #1f2937',alignItems:'center'}}><b>{m.segment}</b><div>{m.prior}% prior</div><div>{m.weight.toFixed(1)}%</div><div>n={m.n}</div><div>R={m.reward.toFixed(1)}</div><div style={{color:m.weight>m.prior?'#86efac':m.weight<m.prior?'#fca5a5':'#cbd5e1',fontWeight:800}}>{m.weight>m.prior?'↑ allocate more':m.weight<m.prior?'↓ allocate less':'→ hold'}</div></div>)}</div>
   <div style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:18,marginTop:16}}><h3 style={{marginTop:0}}>Reward policy</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8}}>{Object.entries(reward).map(([k,v])=><div key={k} style={{background:'#0b1220',borderRadius:10,padding:10}}><b>{k}</b><div style={{color:'#a78bfa',fontSize:20,fontWeight:900}}>+{v}</div></div>)}</div><p style={{fontSize:12,color:'#94a3b8'}}>Negative replies receive −1. Raw listing counts receive no reward. Closed sales dominate the learning signal so the engine cannot optimize for activity theater.</p></div>
  </>:<MachineryDealEngineV3/>}
 </div></div>
}
