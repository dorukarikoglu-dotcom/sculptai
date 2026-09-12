import React,{useEffect,useMemo,useState} from 'react'
import MachineryDealEngineV2 from './MachineryDealEngineV2.jsx'

const norm=(v='')=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const scoreBuyer=b=>{let s=0;if(b.endUser!==false)s+=25;if(b.contactable!==false)s+=15;if((b.freshnessDays??99)<=14)s+=20;if((b.freshnessDays??99)<=7)s+=5;s+=Math.min(20,(Number(b.hardSpecs)||0)*4);if(b.usedAccepted==='yes')s+=10;if(b.budgetKnown)s+=3;if(b.deadlineKnown)s+=2;return Math.min(100,s)}
const invKey=i=>norm([i.brand,i.model,i.location,i.stockRef||i.sourceId].join('|'))
const buyerKey=b=>norm([b.company||b.buyer,b.category].join('|'))
const pills={urgent:'#7f1d1d',advance:'#14532d',qualify:'#713f12',follow:'#1e3a8a',review:'#374151'}

function eventToEntity(e){
 if(e.type==='buyer')return {kind:'buyer',key:buyerKey(e),name:e.company||e.buyer||'Unknown buyer',category:e.category||'Unknown',...e}
 if(e.type==='inventory')return {kind:'inventory',key:invKey(e),name:`${e.brand||''} ${e.model||''}`.trim()||'Unknown machine',...e}
 return null
}
function actionFor(b,inventory,emailEvents){
 const bs=scoreBuyer(b)
 const sameMail=emailEvents.filter(e=>norm(e.company||e.buyer||e.seller).includes(norm(b.name||b.company||'')))
 const latest=sameMail.at(-1)
 if(latest?.emailIntent==='negative')return {rank:5,label:'Snooze / replace',tone:'review',why:'Negative reply'}
 if(latest?.emailIntent==='technical_question')return {rank:94,label:'Answer hard specs',tone:'urgent',why:'Buyer asked a technical question'}
 if(latest?.emailIntent==='positive')return {rank:96,label:'Advance now',tone:'urgent',why:'Positive buyer reply'}
 if(bs<70)return {rank:55,label:'Qualify buyer',tone:'qualify',why:`Qualification ${bs}/100`}
 const candidates=inventory.filter(i=>norm(i.category)===norm(b.category))
 if(!candidates.length)return {rank:72,label:'Find exact inventory',tone:'follow',why:'Qualified buyer, no category-fit inventory'}
 const gated=candidates.find(i=>i.commissionWritten&&Number(i.commissionPct)>0)
 if(!gated)return {rank:88,label:'Lock seller commission',tone:'advance',why:'Fit inventory exists but fee is not locked'}
 return {rank:92,label:'Prepare introduction',tone:'advance',why:`Written ${gated.commissionPct}% fee + buyer fit`}
}

export default function MachineryDealEngineV3(){
 const [events,setEvents]=useState([]),[status,setStatus]=useState({loading:true,persisted:false}),[reply,setReply]=useState({subject:'',body:'',party:''}),[classified,setClassified]=useState(null),[view,setView]=useState('execution')
 async function sync(){setStatus(s=>({...s,loading:true}));try{const r=await fetch('/api/machinery-events',{cache:'no-store'});const j=await r.json();setEvents(j.events||[]);setStatus({loading:false,persisted:!!j.persisted,warning:j.warning||null})}catch{setStatus({loading:false,persisted:false,warning:'feed_unreachable'})}}
 useEffect(()=>{sync();const id=setInterval(sync,60000);return()=>clearInterval(id)},[])
 const buyers=useMemo(()=>{const m=new Map();events.filter(e=>e.type==='buyer').forEach(e=>{const x=eventToEntity(e);if(x)m.set(x.key,{...(m.get(x.key)||{}),...x})});return [...m.values()]},[events])
 const inventory=useMemo(()=>{const m=new Map();events.filter(e=>e.type==='inventory').forEach(e=>{const x=eventToEntity(e);if(x)m.set(x.key,{...(m.get(x.key)||{}),...x})});return [...m.values()]},[events])
 const emails=events.filter(e=>e.type==='email_event')
 const deals=events.filter(e=>e.type==='deal')
 const queue=useMemo(()=>buyers.map(b=>({buyer:b,action:actionFor(b,inventory,emails)})).sort((a,b)=>b.action.rank-a.action.rank),[buyers,inventory,emails])
 const positive=emails.filter(e=>['positive','technical_question','commission','commercial'].includes(e.emailIntent)).length
 async function classify(){const r=await fetch('/api/machinery-classify-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reply)});const j=await r.json();setClassified(j);if(j.ok&&reply.party.trim()){await fetch('/api/machinery-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'email_event',source:'gmail_bridge',company:reply.party,emailIntent:j.intent,nextAction:j.nextAction,notes:`${reply.subject} ${reply.body}`.slice(0,1500)})});await sync()}}
 const btn=(active)=>({border:'1px solid #334155',background:active?'#2563eb':'transparent',color:'#fff',padding:'9px 12px',borderRadius:10,fontWeight:800,cursor:'pointer'})
 return <div style={{minHeight:'100vh',background:'#060a11',color:'#e5e7eb',fontFamily:'Inter,system-ui'}}>
  <div style={{maxWidth:1280,margin:'0 auto',padding:'26px'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}><div><div style={{fontSize:12,fontWeight:900,color:'#22c55e',letterSpacing:1.4}}>MACHINERY DEAL ENGINE · V3</div><h1 style={{margin:'6px 0'}}>Execution Control Plane</h1><div style={{color:'#94a3b8'}}>Discovery → reply intelligence → commission gate → introduction → close</div></div><div style={{display:'flex',gap:8}}><button style={btn(view==='execution')} onClick={()=>setView('execution')}>EXECUTION</button><button style={btn(view==='pipeline')} onClick={()=>setView('pipeline')}>PIPELINE</button><button style={btn(false)} onClick={sync}>SYNC</button></div></div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginTop:18}}>
    {[[queue.filter(x=>x.action.rank>=85).length,'Hot actions'],[buyers.length,'Remote buyers'],[inventory.length,'Unique inventory'],[positive,'Meaningful replies'],[deals.length,'Deal events']].map(([v,l])=><div key={l} style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:16}}><div style={{fontSize:30,fontWeight:900}}>{v}</div><div style={{color:'#94a3b8',fontSize:12}}>{l}</div></div>)}
   </div>
   <div style={{marginTop:10,fontSize:12,color:'#94a3b8'}}>Feed: {status.loading?'syncing…':status.persisted?'shared storage':'fallback / no shared persistence'}{status.warning?` · ${status.warning}`:''}</div>
   {view==='execution'?<div style={{display:'grid',gridTemplateColumns:'1.25fr .75fr',gap:14,marginTop:16}}>
    <div style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:18}}><h3 style={{marginTop:0}}>Next-best-action queue</h3>{queue.length?queue.slice(0,20).map((q,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr .9fr .45fr 1.5fr',gap:10,padding:'12px 0',borderTop:'1px solid #1f2937',alignItems:'center'}}><div><b>{q.buyer.name}</b><div style={{fontSize:12,color:'#94a3b8'}}>{q.buyer.category}</div></div><div><span style={{background:pills[q.action.tone],padding:'5px 8px',borderRadius:999,fontSize:12,fontWeight:800}}>{q.action.label}</span></div><div style={{fontWeight:900}}>{q.action.rank}</div><div style={{fontSize:12,color:'#cbd5e1'}}>{q.action.why}</div></div>):<div style={{color:'#94a3b8'}}>No remote buyer events yet. V2 seed/local data remains available in Pipeline.</div>}</div>
    <div style={{background:'#111827',border:'1px solid #263247',borderRadius:14,padding:18}}><h3 style={{marginTop:0}}>Gmail reply bridge</h3><input value={reply.party} onChange={e=>setReply({...reply,party:e.target.value})} placeholder="Company / party" style={inp}/><input value={reply.subject} onChange={e=>setReply({...reply,subject:e.target.value})} placeholder="Subject" style={{...inp,marginTop:8}}/><textarea value={reply.body} onChange={e=>setReply({...reply,body:e.target.value})} placeholder="Reply body" style={{...inp,height:140,marginTop:8,resize:'vertical'}}/><button onClick={classify} style={{...btn(true),marginTop:8}}>Classify + ingest</button>{classified&&<div style={{marginTop:12,fontSize:13}}><b>{classified.intent}</b> · {classified.confidence}%<br/><span style={{color:'#94a3b8'}}>{classified.nextAction}</span></div>}<div style={{fontSize:11,color:'#64748b',marginTop:12}}>This classifier is deterministic and auditable. The ChatGPT Gmail connector can feed the same event schema when used in the hourly workflow.</div></div>
   </div>:<div style={{marginTop:18}}><MachineryDealEngineV2/></div>}
  </div>
 </div>
}
const inp={width:'100%',boxSizing:'border-box',background:'#0b1220',border:'1px solid #334155',color:'#e5e7eb',borderRadius:9,padding:'9px 10px',outline:'none'}
