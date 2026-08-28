const ALLOWED=new Set(['page_view','offer_click','checkout_view','buy_intent','purchase']);
const ID=/^[a-z0-9-]{2,40}$/;
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  try{
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
    if(raw.length>5000) return res.status(413).json({error:'too_large'});
    const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(!ID.test(String(b.id||''))||!ALLOWED.has(b.event)) return res.status(400).json({error:'bad_event'});
    const clean={
      tag:'VENTURE_EVENT',id:b.id,event:b.event,ts:new Date().toISOString(),
      source:String(b.source||'').slice(0,40),campaign:String(b.campaign||'').slice(0,80),
      value:Number.isFinite(Number(b.value))?Number(b.value):undefined,
      currency:String(b.currency||'').slice(0,6)
    };
    console.log(JSON.stringify(clean));
    return res.status(200).json({ok:true});
  }catch(e){return res.status(400).json({error:'invalid_json'});}
}