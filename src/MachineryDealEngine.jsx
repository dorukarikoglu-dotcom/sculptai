import React,{useEffect,useMemo,useState} from 'react'

const STORAGE_KEY='machinery-deal-engine-v1'

const seed={
  buyers:[
    {id:'arkay',name:'ARKAY',category:'Packaging / filling line',freshnessDays:7,endUser:true,contactable:true,usedAccepted:'unknown',hardSpecs:2,budgetKnown:false,deadlineKnown:false,status:'QUALIFY',notes:'Clarify capacity tolerance, bottle material/format/dimensions/closure, line integration vs standalone, and required delivery date.'},
    {id:'craftsman',name:'Craftsman',category:'Stone CNC / bridge saw',freshnessDays:5,endUser:true,contactable:true,usedAccepted:'yes',hardSpecs:4,budgetKnown:false,deadlineKnown:false,status:'MATCHING',notes:'Used bridge saw requirement. Introduction to USEL already sent; continue technical clarification and avoid duplicate outreach.'},
  ],
  inventory:[
    {id:'usel-combi-u7',seller:'USEL',brand:'Kiheung',model:'COMBI-U7',category:'CNC machining center',location:'Türkiye',price:55000,currency:'EUR',year:null,stockRef:'USEL-COMBI-U7',specs:'XYZ 1600×750×900 mm; table 1800×700 mm; Heidenhain TNC620; 4000 rpm; ISO50; universal head',commissionPct:null,commissionWritten:false,status:'LIVE',notes:'Seller says urgent sale. Treat as opportunistic slow/niche inventory; do not over-prioritize versus mainstream turning/press brake/fiber laser.'},
  ],
  deals:[],
  observations:[
    {id:'obs-turning',segment:'Mainstream CNC turning',priority:92,confidence:'medium-high',learning:'Strongest current demand+supply intersection. Prefer model-specific demand such as DMG Mori NLX-class.'},
    {id:'obs-press',segment:'3m / 100–150t CNC press brake',priority:88,confidence:'medium-high',learning:'Repeated demand signals plus tradable branded used supply.'},
    {id:'obs-laser',segment:'3015 branded fiber laser',priority:80,confidence:'medium',learning:'Healthy high-ticket supply; prioritize Trumpf/Amada/Mitsubishi and exact hard-spec fits.'},
    {id:'obs-stone',segment:'Stone CNC / bridge saw',priority:62,confidence:'medium-low',learning:'Keep adjacent to Craftsman; public procurement is often new-only, so private used-compatible buyers matter.'},
    {id:'obs-combi',segment:'Kiheung COMBI-U7',priority:42,confidence:'medium',learning:'Repeated duplicate/persistent inventory suggests niche/slow liquidity. Sell opportunistically.'},
  ]
}

function buyerScore(b){
  let s=0
  if(b.endUser)s+=25
  if(b.contactable)s+=15
  if((b.freshnessDays??99)<=14)s+=20
  if((b.freshnessDays??99)<=7)s+=5
  s+=Math.min(20,(Number(b.hardSpecs)||0)*4)
  if(b.usedAccepted==='yes')s+=10
  if(b.budgetKnown)s+=3
  if(b.deadlineKnown)s+=2
  return Math.min(100,s)
}

function normalize(v=''){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function tokenSet(v=''){return new Set(normalize(v).split(' ').filter(x=>x.length>2))}
function overlap(a,b){
  const A=tokenSet(a),B=tokenSet(b); if(!A.size||!B.size)return 0
  let n=0;A.forEach(x=>{if(B.has(x))n++})
  return n/Math.max(A.size,B.size)
}
function matchScore(b,i){
  let s=0
  if(normalize(b.category)===normalize(i.category))s+=55
  else s+=Math.round(overlap(b.category,i.category)*35)
  s+=Math.round(overlap(`${b.notes||''} ${b.category||''}`,`${i.specs||''} ${i.brand||''} ${i.model||''} ${i.category||''}`)*35)
  if(b.usedAccepted==='yes')s+=10
  return Math.min(100,s)
}
function fingerprint(i){return normalize([i.brand,i.model,i.location,i.stockRef].filter(Boolean).join('|'))}
function money(v,c='EUR'){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(v||0)}catch{return `${v||0} ${c}`}}

function Card({children,style}){return <div style={{background:'#111827',border:'1px solid #253047',borderRadius:16,padding:18,...style}}>{children}</div>}
function Badge({children,tone='gray'}){const m={gray:['#202938','#cbd5e1'],green:['#123524','#86efac'],amber:['#3a2a0d','#fde68a'],blue:['#112a46','#93c5fd'],red:['#3b161b','#fca5a5']};const [bg,c]=m[tone]||m.gray;return <span style={{background:bg,color:c,borderRadius:999,padding:'4px 9px',fontSize:12,fontWeight:700}}>{children}</span>}
function Btn({children,onClick,secondary=false}){return <button onClick={onClick} style={{border:secondary?'1px solid #334155':'none',background:secondary?'transparent':'#2563eb',color:'#fff',padding:'9px 12px',borderRadius:10,fontWeight:800,cursor:'pointer'}}>{children}</button>}

export default function MachineryDealEngine(){
  const [data,setData]=useState(()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||seed}catch{return seed}})
  const [tab,setTab]=useState('command')
  const [form,setForm]=useState({name:'',category:'Mainstream CNC turning',freshnessDays:1,hardSpecs:3,usedAccepted:'yes',notes:''})
  useEffect(()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(data)),[data])

  const rankedBuyers=useMemo(()=>[...data.buyers].map(x=>({...x,score:buyerScore(x)})).sort((a,b)=>b.score-a.score),[data.buyers])
  const dedupe=useMemo(()=>{const seen=new Map();for(const i of data.inventory){const f=fingerprint(i);if(!seen.has(f))seen.set(f,i)}return [...seen.values()]},[data.inventory])
  const matches=useMemo(()=>{
    const out=[];for(const b of rankedBuyers)for(const i of dedupe){const score=matchScore(b,i);if(score>=30)out.push({buyer:b,inventory:i,score})}
    return out.sort((a,b)=>b.score-a.score)
  },[rankedBuyers,dedupe])
  const strongMatches=matches.filter(m=>m.score>=70)
  const commissionReady=dedupe.filter(x=>x.commissionWritten&&Number(x.commissionPct)>0)
  const expectedCommission=commissionReady.reduce((t,x)=>t+(Number(x.price)||0)*(Number(x.commissionPct)||0)/100,0)

  function addBuyer(){
    if(!form.name.trim())return
    const buyer={id:`b-${Date.now()}`,name:form.name.trim(),category:form.category,freshnessDays:Number(form.freshnessDays)||0,endUser:true,contactable:true,usedAccepted:form.usedAccepted,hardSpecs:Number(form.hardSpecs)||0,budgetKnown:false,deadlineKnown:false,status:'QUALIFY',notes:form.notes}
    setData(d=>({...d,buyers:[buyer,...d.buyers]}));setForm(f=>({...f,name:'',notes:''}));setTab('buyers')
  }
  function patchInv(id,patch){setData(d=>({...d,inventory:d.inventory.map(x=>x.id===id?{...x,...patch}:x)}))}
  function reset(){if(confirm('Reset machinery engine local data to seeded defaults?'))setData(seed)}

  const tabs=['command','buyers','inventory','matches','market']
  return <div style={{minHeight:'100vh',background:'#070b12',color:'#e5e7eb',fontFamily:'Inter,ui-sans-serif,system-ui',padding:'28px'}}>
    <div style={{maxWidth:1250,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div><div style={{fontSize:13,fontWeight:900,letterSpacing:1.4,color:'#60a5fa'}}>DORUK · INTERNAL</div><h1 style={{margin:'6px 0 4px',fontSize:32}}>Machinery Deal Engine</h1><div style={{color:'#94a3b8'}}>Optimize for closed commission, not raw leads.</div></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{tabs.map(t=><Btn key={t} secondary={tab!==t} onClick={()=>setTab(t)}>{t.toUpperCase()}</Btn>)}</div>
      </div>

      {tab==='command'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginTop:22}}>
          <Card><div style={{color:'#94a3b8'}}>Qualified buyers</div><div style={{fontSize:34,fontWeight:900}}>{rankedBuyers.filter(x=>x.score>=70).length}</div><div style={{fontSize:12,color:'#64748b'}}>Target: 10</div></Card>
          <Card><div style={{color:'#94a3b8'}}>Strong matches</div><div style={{fontSize:34,fontWeight:900}}>{strongMatches.length}</div><div style={{fontSize:12,color:'#64748b'}}>Score ≥70</div></Card>
          <Card><div style={{color:'#94a3b8'}}>Written commission</div><div style={{fontSize:34,fontWeight:900}}>{commissionReady.length}</div><div style={{fontSize:12,color:'#64748b'}}>Target: 3</div></Card>
          <Card><div style={{color:'#94a3b8'}}>Expected commission</div><div style={{fontSize:34,fontWeight:900}}>{money(expectedCommission)}</div><div style={{fontSize:12,color:'#64748b'}}>Only written fee commitments</div></Card>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1.2fr .8fr',gap:14,marginTop:14}}>
          <Card><h3 style={{marginTop:0}}>Best current opportunities</h3>{matches.slice(0,6).map((m,idx)=><div key={idx} style={{display:'flex',justifyContent:'space-between',gap:16,padding:'12px 0',borderTop:'1px solid #1f2937'}}><div><b>{m.buyer.name}</b> → {m.inventory.brand} {m.inventory.model}<div style={{fontSize:12,color:'#94a3b8'}}>{m.buyer.category} · {m.inventory.location}</div></div><Badge tone={m.score>=70?'green':m.score>=50?'amber':'gray'}>{m.score}% fit</Badge></div>)}{!matches.length&&<div style={{color:'#94a3b8'}}>No candidate matches yet.</div>}</Card>
          <Card><h3 style={{marginTop:0}}>Priority segments</h3>{[...data.observations].sort((a,b)=>b.priority-a.priority).slice(0,5).map(o=><div key={o.id} style={{padding:'10px 0',borderTop:'1px solid #1f2937'}}><div style={{display:'flex',justifyContent:'space-between',gap:12}}><b>{o.segment}</b><Badge tone={o.priority>=85?'green':o.priority>=70?'blue':'amber'}>{o.priority}</Badge></div><div style={{fontSize:12,color:'#94a3b8',marginTop:5}}>{o.learning}</div></div>)}</Card>
        </div>
        <Card style={{marginTop:14}}><h3 style={{marginTop:0}}>Fast add private buyer</h3><div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr .6fr .6fr .7fr',gap:8}}>
          <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Company" style={input}/>
          <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} style={input}><option>Mainstream CNC turning</option><option>3m CNC press brake</option><option>3015 fiber laser</option><option>Stone CNC / bridge saw</option><option>CNC machining center</option><option>Packaging / filling line</option></select>
          <input type="number" value={form.freshnessDays} onChange={e=>setForm({...form,freshnessDays:e.target.value})} title="Freshness days" style={input}/>
          <input type="number" value={form.hardSpecs} onChange={e=>setForm({...form,hardSpecs:e.target.value})} title="Hard specs count" style={input}/>
          <select value={form.usedAccepted} onChange={e=>setForm({...form,usedAccepted:e.target.value})} style={input}><option value="yes">Used OK</option><option value="unknown">Used ?</option><option value="no">New only</option></select>
        </div><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Hard specs / urgency / integration / deadline" style={{...input,width:'100%',height:70,marginTop:8,boxSizing:'border-box'}}/><div style={{marginTop:8}}><Btn onClick={addBuyer}>Add + score</Btn></div></Card>
      </>}

      {tab==='buyers'&&<Card style={{marginTop:22}}><h3 style={{marginTop:0}}>Buyer qualification queue</h3>{rankedBuyers.map(b=><div key={b.id} style={{display:'grid',gridTemplateColumns:'1.2fr 1fr .6fr .8fr 2fr',gap:12,alignItems:'center',padding:'13px 0',borderTop:'1px solid #1f2937'}}><div><b>{b.name}</b><div style={{fontSize:12,color:'#94a3b8'}}>{b.status}</div></div><div>{b.category}</div><Badge tone={b.score>=70?'green':b.score>=50?'amber':'red'}>{b.score}/100</Badge><div style={{fontSize:12}}>fresh {b.freshnessDays}d · specs {b.hardSpecs} · used {b.usedAccepted}</div><div style={{fontSize:12,color:'#94a3b8'}}>{b.notes}</div></div>)}</Card>}

      {tab==='inventory'&&<Card style={{marginTop:22}}><div style={{display:'flex',justifyContent:'space-between'}}><h3 style={{marginTop:0}}>Inventory & commission gate</h3><Badge tone="blue">{data.inventory.length-dedupe.length} duplicates removed</Badge></div>{dedupe.map(i=><div key={i.id} style={{display:'grid',gridTemplateColumns:'1.1fr 1fr .9fr .8fr 1.2fr',gap:12,alignItems:'center',padding:'13px 0',borderTop:'1px solid #1f2937'}}><div><b>{i.brand} {i.model}</b><div style={{fontSize:12,color:'#94a3b8'}}>{i.seller} · {i.location}</div></div><div>{money(i.price,i.currency)}</div><div><input type="number" min="0" max="20" step="0.5" value={i.commissionPct??''} placeholder="fee %" onChange={e=>patchInv(i.id,{commissionPct:e.target.value===''?null:Number(e.target.value)})} style={{...input,width:90}}/></div><label style={{fontSize:12}}><input type="checkbox" checked={!!i.commissionWritten} onChange={e=>patchInv(i.id,{commissionWritten:e.target.checked})}/> written fee</label><div style={{fontSize:12,color:'#94a3b8'}}>{i.notes}</div></div>)}</Card>}

      {tab==='matches'&&<Card style={{marginTop:22}}><h3 style={{marginTop:0}}>Machine match queue</h3>{matches.map((m,idx)=><div key={idx} style={{display:'grid',gridTemplateColumns:'1fr 1fr .5fr 2fr',gap:12,padding:'13px 0',borderTop:'1px solid #1f2937'}}><b>{m.buyer.name}</b><div>{m.inventory.brand} {m.inventory.model}</div><Badge tone={m.score>=70?'green':m.score>=50?'amber':'gray'}>{m.score}%</Badge><div style={{fontSize:12,color:'#94a3b8'}}>{m.inventory.specs}</div></div>)}</Card>}

      {tab==='market'&&<Card style={{marginTop:22}}><h3 style={{marginTop:0}}>Rolling market intelligence</h3>{[...data.observations].sort((a,b)=>b.priority-a.priority).map(o=><div key={o.id} style={{display:'grid',gridTemplateColumns:'1.1fr .4fr .7fr 2fr',gap:12,padding:'13px 0',borderTop:'1px solid #1f2937'}}><b>{o.segment}</b><Badge tone={o.priority>=85?'green':o.priority>=70?'blue':'amber'}>{o.priority}</Badge><div style={{fontSize:12,color:'#94a3b8'}}>{o.confidence}</div><div style={{fontSize:12,color:'#cbd5e1'}}>{o.learning}</div></div>)}</Card>}

      <div style={{display:'flex',justifyContent:'space-between',marginTop:18,color:'#64748b',fontSize:12}}><span>V1 stores data locally in this browser. Next step: automated ingestion + shared persistence.</span><button onClick={reset} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer'}}>reset local data</button></div>
    </div>
  </div>
}

const input={background:'#0b1220',border:'1px solid #334155',color:'#e5e7eb',borderRadius:9,padding:'9px 10px',outline:'none'}
