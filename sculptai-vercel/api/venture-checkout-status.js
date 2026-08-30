const ALLOWED=new Set(['flightclaim','salaryask','weddingwords','datingprofile','interviewloop']);

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'method_not_allowed'});
  const key=process.env.STRIPE_RESTRICTED_KEY;
  if(!key) return res.status(503).json({error:'checkout_not_configured'});
  const sessionId=String(req.query?.session_id||'');
  const requestedId=String(req.query?.venture||'');
  if(!/^cs_[A-Za-z0-9_]+$/.test(sessionId)||!ALLOWED.has(requestedId)) return res.status(400).json({error:'bad_request'});
  try{
    const r=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{
      headers:{Authorization:`Bearer ${key}`}
    });
    const s=await r.json();
    if(!r.ok) return res.status(502).json({error:'stripe_lookup_failed'});
    const id=String(s?.metadata?.venture_id||'');
    if(id!==requestedId||!ALLOWED.has(id)) return res.status(400).json({error:'venture_mismatch'});
    const paid=s.payment_status==='paid';
    if(paid){
      console.log(JSON.stringify({
        tag:'VENTURE_EVENT',id,event:'purchase',verified:true,sessionId:s.id,
        ts:new Date().toISOString(),source:String(s?.metadata?.source||'stripe').slice(0,40),
        campaign:String(s?.metadata?.campaign||'').slice(0,80),
        value:Number(s.amount_total||0)/100,currency:String(s.currency||'').toUpperCase()
      }));
    }
    return res.status(200).json({paid,payment_status:s.payment_status||'unknown',amount:Number(s.amount_total||0)/100,currency:String(s.currency||'').toUpperCase()});
  }catch(e){
    return res.status(500).json({error:'verification_failed'});
  }
}
