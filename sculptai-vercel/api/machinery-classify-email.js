function text(v=''){return String(v).toLowerCase()}
function has(t,terms){return terms.some(x=>t.includes(x))}

export default async function handler(req,res){
  if(req.method!=='POST'){res.status(405).json({ok:false,error:'method_not_allowed'});return}
  const b=req.body||{}
  const t=text(`${b.subject||''} ${b.body||''}`)
  let intent='other',score=20,nextAction='review'
  if(has(t,['not interested','no interest','remove me','unsubscribe','not looking','do not contact'])){intent='negative';score=95;nextAction='close_or_snooze'}
  else if(has(t,['interested','please send','send details','more information','price','quotation','quote','offer','available','inspection','video','photos'])){intent='positive';score=85;nextAction='qualify_and_advance'}
  else if(has(t,['what is the','can you confirm','please confirm','specification','specs','dimensions','year','hours','control','spindle','delivery','shipping','warranty'])){intent='technical_question';score=80;nextAction='answer_hard_specs'}
  else if(has(t,['commission','success fee','fee','percentage','%','prim','komisyon'])){intent='commission';score=90;nextAction='lock_written_fee'}
  else if(has(t,['sold','deal','purchase order','po ','invoice','payment','wire','deposit'])){intent='commercial';score=90;nextAction='commercial_close'}
  else if(has(t,['out of office','automatic reply','auto reply'])){intent='auto_reply';score=90;nextAction='follow_up_later'}
  res.setHeader('Cache-Control','no-store')
  res.status(200).json({ok:true,intent,confidence:score,nextAction})
}
