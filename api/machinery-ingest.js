import { createClient } from '@supabase/supabase-js'

const ALLOWED = new Set(['buyer','inventory','observation','deal','email_event'])
const clamp=(v,n=500)=>v==null?null:String(v).slice(0,n)
const normalize=(v='')=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const fp=(x)=>normalize([x.type,x.company||x.seller||x.buyer,x.brand,x.model,x.category,x.location,x.stockRef,x.sourceId,x.email].filter(Boolean).join('|'))

function sanitize(body){
  const type=clamp(body.type,30)
  if(!ALLOWED.has(type))return null
  const data={
    type, ts:new Date().toISOString(), source:clamp(body.source,80)||'manual', sourceId:clamp(body.sourceId,120),
    company:clamp(body.company,160), buyer:clamp(body.buyer,160), seller:clamp(body.seller,160), email:clamp(body.email,180),
    category:clamp(body.category,160), brand:clamp(body.brand,100), model:clamp(body.model,120), location:clamp(body.location,160), stockRef:clamp(body.stockRef,120),
    price:Number.isFinite(Number(body.price))?Number(body.price):null, currency:clamp(body.currency,10), freshnessDays:Number.isFinite(Number(body.freshnessDays))?Number(body.freshnessDays):null,
    hardSpecs:Number.isFinite(Number(body.hardSpecs))?Number(body.hardSpecs):null, usedAccepted:clamp(body.usedAccepted,20), endUser:body.endUser===true,
    contactable:body.contactable===true, budgetKnown:body.budgetKnown===true, deadlineKnown:body.deadlineKnown===true,
    commissionPct:Number.isFinite(Number(body.commissionPct))?Number(body.commissionPct):null, commissionWritten:body.commissionWritten===true,
    specs:clamp(body.specs,1500), notes:clamp(body.notes,2500), status:clamp(body.status,60), priority:Number.isFinite(Number(body.priority))?Number(body.priority):null,
    confidence:clamp(body.confidence,40), learning:clamp(body.learning,1200), payload:body.payload&&typeof body.payload==='object'?body.payload:null
  }
  data.fingerprint=fp(data)
  return data
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST'){res.status(405).json({ok:false,error:'method_not_allowed'});return}
  const item=sanitize(req.body||{})
  if(!item){res.status(400).json({ok:false,error:'invalid_type'});return}
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY
  if(!url||!key){console.log('MACHINERY_INGEST',JSON.stringify(item));res.status(200).json({ok:true,persisted:false,item});return}
  try{
    const supabase=createClient(url,key,{auth:{persistSession:false}})
    const {data,error}=await supabase.from('machinery_events').upsert(item,{onConflict:'fingerprint'}).select().single()
    if(error)throw error
    res.status(200).json({ok:true,persisted:true,item:data})
  }catch(error){console.error('MACHINERY_INGEST_ERROR',error?.message||error);res.status(200).json({ok:true,persisted:false,item,warning:'supabase_write_failed'})}
}
