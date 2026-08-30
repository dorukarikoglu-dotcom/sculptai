export default function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'method_not_allowed'});
  return res.status(200).json({
    stripeConfigured:Boolean(process.env.STRIPE_RESTRICTED_KEY),
    acquisitionFeed:'/venture-engine/acquisition-feed.json',
    googleAdsScript:'/venture-engine/google-ads-script.txt',
    hardCaps:{dailyBilledTRY:500,totalBilledTRY:5000,maxAverageDailyBudgetTRY:250}
  });
}
