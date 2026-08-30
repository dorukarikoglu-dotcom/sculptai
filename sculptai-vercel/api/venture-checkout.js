const OFFERS={
  flightclaim:{name:'RötarHakkım DIY Başvuru Paketi',amount:29900,currency:'try',returnPath:'/ventures/rotarhakkim/'},
  salaryask:{name:'SalaryAsk Negotiation Pack',amount:1900,currency:'usd',returnPath:'/ventures/salaryask/'},
  weddingwords:{name:'WeddingWords Speech Pack',amount:2900,currency:'usd',returnPath:'/ventures/weddingwords/'},
  datingprofile:{name:'ProfileFix Full Profile Rebuild',amount:1900,currency:'usd',returnPath:'/ventures/profilefix/'},
  interviewloop:{name:'InterviewLoop Interview Pack',amount:1200,currency:'usd',returnPath:'/ventures/interviewloop/'}
};

const BASE_URL='https://sculptai-brown.vercel.app';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const key=process.env.STRIPE_RESTRICTED_KEY;
  if(!key) return res.status(503).json({error:'checkout_not_configured'});
  try{
    const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const id=String(b.id||'');
    const offer=OFFERS[id];
    if(!offer) return res.status(400).json({error:'unknown_venture'});
    const source=String(b.source||'direct').slice(0,40);
    const campaign=String(b.campaign||'').slice(0,80);
    const p=new URLSearchParams();
    p.set('mode','payment');
    p.set('line_items[0][price_data][currency]',offer.currency);
    p.set('line_items[0][price_data][unit_amount]',String(offer.amount));
    p.set('line_items[0][price_data][product_data][name]',offer.name);
    p.set('line_items[0][quantity]','1');
    p.set('client_reference_id',id);
    p.set('metadata[venture_id]',id);
    p.set('metadata[source]',source);
    p.set('metadata[campaign]',campaign);
    p.set('success_url',`${BASE_URL}/venture-engine/payment-success.html?venture=${encodeURIComponent(id)}&session_id={CHECKOUT_SESSION_ID}`);
    p.set('cancel_url',`${BASE_URL}${offer.returnPath}?checkout=cancelled&utm_source=${encodeURIComponent(source)}&utm_campaign=${encodeURIComponent(campaign)}`);
    const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:p.toString()
    });
    const data=await r.json();
    if(!r.ok){
      console.error(JSON.stringify({tag:'VENTURE_CHECKOUT_ERROR',id,status:r.status,type:data?.error?.type,code:data?.error?.code,message:data?.error?.message}));
      return res.status(502).json({error:'stripe_checkout_failed'});
    }
    console.log(JSON.stringify({tag:'VENTURE_CHECKOUT_CREATED',id,sessionId:data.id,source,campaign}));
    return res.status(200).json({url:data.url});
  }catch(e){
    console.error(JSON.stringify({tag:'VENTURE_CHECKOUT_ERROR',message:String(e?.message||e)}));
    return res.status(400).json({error:'invalid_request'});
  }
}
