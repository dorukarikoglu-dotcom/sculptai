import { createClient } from '@supabase/supabase-js'

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='GET'){res.status(405).json({ok:false,error:'method_not_allowed'});return}
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY
  if(!url||!key){res.status(200).json({ok:true,persisted:false,events:[]});return}
  try{
    const supabase=createClient(url,key,{auth:{persistSession:false}})
    const {data,error}=await supabase.from('machinery_events').select('*').order('ts',{ascending:false}).limit(500)
    if(error)throw error
    res.status(200).json({ok:true,persisted:true,events:data||[]})
  }catch(error){console.error('MACHINERY_EVENTS_ERROR',error?.message||error);res.status(200).json({ok:true,persisted:false,events:[],warning:'supabase_read_failed'})}
}
