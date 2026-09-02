const PROCEDURES = new Set([
  'rhinoplasty','facelift','upper-blepharoplasty','lower-blepharoplasty',
  'breast-augmentation','breast-reduction','mastopexy','abdominoplasty',
  'liposuction','gynecomastia','otoplasty','other'
]);

const PROCEDURE_LABELS = {
  'rhinoplasty':'rhinoplasty (nose surgery)',
  'facelift':'facelift',
  'upper-blepharoplasty':'upper eyelid surgery',
  'lower-blepharoplasty':'lower eyelid surgery',
  'breast-augmentation':'breast augmentation',
  'breast-reduction':'breast reduction',
  'mastopexy':'breast lift',
  'abdominoplasty':'abdominoplasty (tummy tuck)',
  'liposuction':'liposuction',
  'gynecomastia':'gynecomastia surgery',
  'otoplasty':'otoplasty',
  'other':'an aesthetic procedure'
};

function clean(v,max=1200){
  return String(v||'').replace(/[<>]/g,'').trim().slice(0,max);
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key) return res.status(503).json({error:'analysis_not_configured'});
  try{
    const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const procedure=PROCEDURES.has(String(b.procedure||''))?String(b.procedure):'other';
    const goal=clean(b.goal,700);
    const concern=clean(b.concern,700);
    const proposedPlan=clean(b.proposedPlan,1200);
    const prior=clean(b.prior,500);
    if(goal.length<8) return res.status(400).json({error:'goal_required'});

    const prompt=`You are ConsultReady, an educational consultation-preparation assistant created for people considering elective aesthetic procedures. The user is considering ${PROCEDURE_LABELS[procedure]}.

Hard safety boundaries:
- Do NOT diagnose, determine candidacy, recommend whether the user should undergo the procedure, choose a technique, choose a surgeon, estimate an individual medical outcome, or provide individualized medical instructions.
- Do NOT rate attractiveness or create a beauty score.
- Do NOT claim that any proposed plan is medically right or wrong.
- Do NOT invent complication rates, credentials, prices, or facts.
- If the user mentions an urgent symptom, active complication, severe distress, self-harm, coercion, or body-dysmorphic preoccupation, say that this tool is not appropriate for that issue and advise speaking with an appropriate licensed professional.
- The output is educational and is meant to help the user ask better questions in a licensed clinician consultation.

User goal:
${goal}

Main concern or uncertainty:
${concern||'Not provided'}

Plan/quote they were told, if any:
${proposedPlan||'Not provided'}

Prior relevant procedure context, if any:
${prior||'Not provided'}

Return concise markdown with exactly these sections:
## What you appear to be trying to achieve
Reflect the goal neutrally in 2-4 bullets. Do not judge appearance.

## Questions worth asking your surgeon
Give 8-12 high-value, procedure-relevant questions. Focus on goals, trade-offs, alternatives to discuss, scars/incisions where relevant, recovery expectations, revision policy, anesthesia/setting, follow-up, and what would change the plan.

## Trade-offs to make explicit
List 3-6 preference trade-offs the user should decide how they value before consenting. Frame them as discussion points, not recommendations.

## What is still missing from the decision
Identify information absent from the user's description that a proper consultation would normally clarify. Do not request sensitive data.

## Consultation one-liner
Write one clear sentence the user can say at the start of the consultation to communicate their goal without prescribing a technique.

End with exactly: "Educational preparation only — not medical advice, diagnosis, candidacy assessment, or a predicted result."`;

    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1600,temperature:0.25,messages:[{role:'user',content:prompt}]})
    });
    const data=await r.json();
    if(!r.ok) return res.status(502).json({error:'analysis_failed'});
    const text=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
    if(!text) return res.status(502).json({error:'empty_analysis'});
    return res.status(200).json({report:text});
  }catch(e){
    return res.status(400).json({error:'invalid_request'});
  }
}
