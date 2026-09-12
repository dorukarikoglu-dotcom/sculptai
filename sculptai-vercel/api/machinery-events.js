import { createClient } from '@supabase/supabase-js'

const fallbackEvents=[
 {type:'buyer',source:'gmail',company:'ARKAY ZERO PROOF',category:'Packaging / filling line',freshnessDays:8,endUser:true,contactable:true,usedAccepted:'unknown',hardSpecs:4,budgetKnown:false,deadlineKnown:false,status:'OUTREACH_SENT',notes:'Sept 4 immediate-purchase rotary bottling/filling requirement: 12–18 filling heads, vacuum overflow, around 1800 bottles/hour for 1 L bottles. Need capacity tolerance, bottle material/format/dimensions/closure, integration vs standalone, delivery deadline.',ts:'2026-09-12T07:00:00Z'},
 {type:'buyer',source:'gmail',company:'Craftsman',category:'Stone CNC / bridge saw',freshnessDays:2,endUser:true,contactable:true,usedAccepted:'yes',hardSpecs:2,budgetKnown:false,deadlineKnown:false,status:'INTRODUCTION_SENT',notes:'Current requirement for a used bridge saw with table/slab loader. Direct introduction to USEL already sent.',ts:'2026-09-12T07:00:01Z'},
 {type:'buyer',source:'gmail',company:'Meta-Tec',category:'CNC machining center',freshnessDays:1,endUser:true,contactable:true,usedAccepted:'unknown',hardSpecs:0,budgetKnown:false,deadlineKnown:false,status:'PROSPECT_OUTREACH_SENT',notes:'Cold prospect only; contacted about Kiheung COMBI-U7. No reply yet. Do not treat as verified buyer.',ts:'2026-09-12T07:00:02Z'},
 {type:'buyer',source:'gmail',company:'Pro-Mil Engineering',category:'CNC machining center',freshnessDays:1,endUser:true,contactable:true,usedAccepted:'unknown',hardSpecs:0,budgetKnown:false,deadlineKnown:false,status:'PROSPECT_OUTREACH_SENT',notes:'Cold prospect only; contacted about Kiheung COMBI-U7 as secondary capacity. No reply yet. Do not treat as verified buyer.',ts:'2026-09-12T07:00:03Z'},
 {type:'buyer',source:'gmail',company:'EURO-MILL',category:'CNC machining center',freshnessDays:1,endUser:true,contactable:true,usedAccepted:'unknown',hardSpecs:0,budgetKnown:false,deadlineKnown:false,status:'PROSPECT_OUTREACH_SENT',notes:'Cold prospect only; contacted about Kiheung COMBI-U7. No reply yet. Do not treat as verified buyer.',ts:'2026-09-12T07:00:04Z'},
 {type:'inventory',source:'gmail',seller:'USEL',brand:'Kiheung',model:'COMBI-U7',category:'CNC machining center',location:'Türkiye',price:55000,currency:'EUR',stockRef:'USEL-COMBI-U7',specs:'XYZ 1600×750×900 mm; table 1800×700 mm; Heidenhain TNC620; 4000 rpm; ISO50; universal head',commissionPct:null,commissionWritten:false,status:'LIVE_URGENT',notes:'Seller says urgent to sell. Seller has agreed in writing to pay a success fee on Doruk-introduced customers, but percentage is not yet locked.',ts:'2026-09-12T07:00:05Z'},
 {type:'email_event',source:'gmail',company:'USEL',emailIntent:'commission',nextAction:'Lock exact seller success-fee percentage before revealing any new buyer identity',notes:'USEL confirmed in writing that sales to Doruk-introduced customers can carry a commission, but did not state a percentage.',ts:'2026-09-12T07:00:06Z'},
 {type:'observation',source:'web',category:'Mainstream CNC turning',priority:92,confidence:'medium-high',learning:'DMG MORI continues to feature NLX 2500 prominently in its used-machine program; fresh used supply is active. No fresh private end-user demand verified in this run.',ts:'2026-09-12T07:00:07Z'},
 {type:'observation',source:'web',category:'3015 branded fiber laser',priority:80,confidence:'medium',learning:'Fresh used supply remains active around Bystronic Bysmart Fiber 3015 and Amada Ensis 3015 AJ. Buyer-side private demand still needs stronger verification.',ts:'2026-09-12T07:00:08Z'}
]

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='GET')return res.status(405).json({ok:false})
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY
 if(!url||!key)return res.status(200).json({ok:true,persisted:false,events:fallbackEvents,warning:'seeded_fallback_feed'})
 try{
  const s=createClient(url,key,{auth:{persistSession:false}}),r=await s.from('machinery_events').select('*').order('ts',{ascending:false}).limit(500)
  if(r.error)throw r.error
  const events=(r.data||[]).length?r.data:fallbackEvents
  return res.status(200).json({ok:true,persisted:true,events,warning:(r.data||[]).length?null:'seeded_fallback_feed'})
 }catch(e){
  console.error(e?.message||e)
  return res.status(200).json({ok:true,persisted:false,events:fallbackEvents,warning:'supabase_read_failed_seeded'})
 }
}
