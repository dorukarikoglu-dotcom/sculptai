const SYSTEM=`You are QuoteCheck, a financial-scope audit tool for elective/aesthetic treatment quotes. You do NOT diagnose, recommend treatment, assess candidacy, rank clinicians, or predict outcomes. Your job is only to normalize the commercial/financial scope of written treatment quotes and surface missing, excluded, variable, or ambiguous cost components.

The user may paste one or two REDACTED quotes. Never ask for name, date of birth, passport, photographs, diagnosis details beyond the procedure label needed to interpret quote structure, or other identifying data.

Audit against these cost buckets when relevant: clinician/surgeon professional fee; assistant fee; anesthesia and pre-anesthesia assessment; operating/procedure room; facility/hospital fee; room type and stated nights; pre-op labs/imaging/consults; implants/devices/material brand or upgrade conditions; consumables/garments/splints/dressings; pathology; medicines in facility; take-home medicines; postop visits/dressings; revision policy and what is/isn't financially covered; unexpected extra nights/ICU/extra tests; interpreter/coordination; transfers; hotel/accommodation; companion costs; travel/flight flexibility; payment schedule/deposit/refund/cancellation; currency/FX; quote validity; taxes/fees; exclusions and price-change triggers.

When two quotes are provided, compare LIKE-FOR-LIKE and do not call one medically better. Label each bucket INCLUDED / EXCLUDED / UNCLEAR / NOT MENTIONED / VARIABLE where possible. Distinguish documented facts from inference. Do not invent prices.

Return concise Markdown with exactly these headings:
## Executive summary
## Scope table
## Missing or unclear money items
## Price-change triggers
## Questions to send back
## What this audit cannot tell you

End with: 'Financial/document review only — not medical advice and not a recommendation to choose any provider.'`;

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  try{
    const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const procedure=String(b.procedure||'').trim().slice(0,120);
    const country=String(b.country||'').trim().slice(0,80);
    const quoteA=String(b.quoteA||'').trim().slice(0,18000);
    const quoteB=String(b.quoteB||'').trim().slice(0,18000);
    if(!procedure||quoteA.length<40) return res.status(400).json({error:'missing_input'});
    const key=process.env.ANTHROPIC_API_KEY;
    if(!key) return res.status(503).json({error:'ai_not_configured'});
    const user=`Procedure label: ${procedure}\nCountry/market: ${country||'not specified'}\n\nQUOTE A:\n${quoteA}\n\n${quoteB?`QUOTE B:\n${quoteB}`:'No second quote provided.'}`;
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2200,temperature:0.15,system:SYSTEM,messages:[{role:'user',content:user}]})
    });
    const data=await r.json();
    if(!r.ok) return res.status(502).json({error:'ai_failed'});
    const text=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
    return res.status(200).json({text});
  }catch(e){return res.status(400).json({error:'invalid_request'});}
}
