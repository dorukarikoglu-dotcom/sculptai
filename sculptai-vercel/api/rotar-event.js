export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false});
  try{
    const {event,meta={}}=req.body||{};
    const allowed=new Set(["eligibility_check","checkout_view","buy_intent"]);
    if(!allowed.has(event)) return res.status(400).json({ok:false});
    const safeMeta={
      scope:["domestic","international"].includes(meta.scope)?meta.scope:undefined,
      outcome:["good","warn","bad"].includes(meta.outcome)?meta.outcome:undefined,
      amount:Number.isFinite(Number(meta.amount))?Number(meta.amount):undefined
    };
    console.log("ROTAR_FUNNEL",JSON.stringify({event,meta:safeMeta,ts:new Date().toISOString()}));
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({ok:true});
  }catch(e){
    console.error("ROTAR_FUNNEL_ERROR",e?.message||"unknown");
    return res.status(500).json({ok:false});
  }
}