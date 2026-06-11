// ════════════════════════════════════════════════════════════════
// GREENROCK AI — GEOMIND DUALMIND WORKER v1.0
// Cloudflare Worker for greenrock-ai.com
// ════════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }});
    }

    const CORS = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    };

    const APP_SECRET  = env.APP_SECRET  || 'greenrock-2024';
    const openaiKey   = env.OPENAI_API_KEY || '';
    const anthropicKey= env.ANTHROPIC_API_KEY || '';

    let body;
    try { body = await request.json(); }
    catch(e) { return new Response(JSON.stringify({error:'Invalid JSON'}), {headers:CORS}); }

    if(!body._appSecret || body._appSecret !== APP_SECRET) {
      return new Response(JSON.stringify({error:'Unauthorized'}), {status:401, headers:CORS});
    }

    // ── GEOMIND DUALMIND ─────────────────────────────────────────
    // ── DUALMIND (alias for geomind + new science mode) ─────
    if(body.action === 'dualmind') {
      body.action = body.mode === 'sci' ? 'science' : 'geomind';
    }

    // ── GENERAL SCIENCE MODE ──────────────────────────────
    if(body.action === 'science') {
      try {
        const messages = body.messages || [];
        const lang = body.lang || 'English';
        const langInstruction = `\n\nIMPORTANT: Always respond in ${lang}.`;

        const SCIENCE_PROMPT = `## DUALMIND GENERAL SCIENCE v1.0
IDENTITY: You are an expert scientific analyst with deep knowledge across all technical and scientific disciplines including civil engineering, materials science, chemistry, cement and concrete technology, geotechnical engineering, metallurgy, environmental science, hydrology, physics, and mathematics.

YOUR TASK: Provide a rigorous, evidence-based analysis of the question or data provided. Be precise, cite principles and standards where applicable.

APPROACH:
- State what is known with high confidence vs what is uncertain
- Reference relevant standards, equations, or principles
- Flag where expert professional advice is required
- Distinguish between theoretical knowledge and practical application

Always end with a confidence JSON block — score each dimension 0-100:
{"confidence":{"factual_accuracy":XX,"source_reliability":XX,"reasoning_quality":XX,"consensus_level":XX,"completeness":XX,"uncertainty_acknowledged":XX,"overall":XX,"verdict":"High Confidence|Moderate Confidence|Low Confidence|Consult Expert"}}

Verdict rules: overall>=75 High Confidence | 55-74 Moderate Confidence | 35-54 Low Confidence | <35 Consult Expert

RULES: Never refuse / Always give best technical answer / Flag limitations / State uncertainty honestly / Respond in user's language`;

        const SCIENCE_FINAL = SCIENCE_PROMPT + langInstruction;

        const convertForClaude = (msgs) => msgs.map(m => {
          if(Array.isArray(m.content)){
            const content = m.content.map(c => {
              if(c.type === 'image_url'){
                const rawUrl = c.image_url.url;
                const b64 = rawUrl.replace(/^data:image\/\w+;base64,/,'');
                const mt = rawUrl.includes('image/png') ? 'image/png' : 'image/jpeg';
                return {type:'image', source:{type:'base64', media_type:mt, data:b64}};
              }
              return {type:'text', text:c.text||''};
            });
            return {role: m.role, content};
          }
          return m;
        });

        const MERGER_SCIENCE = SCIENCE_FINAL + `

## YOUR ROLE: SYNTHESIS & MERGER ENGINE (SCIENCE)

You have independently analysed the question (your analysis is CLAUDE INDEPENDENT below).
You also have GPT-4o's independent analysis (LLM 1 below).

Merge both into a final authoritative answer:

## CONVERGENCE (Both agree)
Points where both models reached the same conclusion — HIGH CONFIDENCE.

## DIVERGENCE (Models disagree)
Points of disagreement — severity [MINOR|MODERATE|CRITICAL] — merged conclusion.

## MERGED FINAL ANSWER
Unified answer combining both analyses.

## CONFIDENCE ASSESSMENT
Rate confidence for each key conclusion as a percentage.
State what additional information would increase confidence.

End with confidence JSON:
{"confidence":{"factual_accuracy":XX,"source_reliability":XX,"reasoning_quality":XX,"consensus_level":XX,"completeness":XX,"uncertainty_acknowledged":XX,"overall":XX,"verdict":"High Confidence|Moderate Confidence|Low Confidence|Consult Expert"}}

---
LLM 1 (GPT-4o): \${llm1Answer}
CLAUDE INDEPENDENT: \${claudeIndAnswer}
Produce merged final answer:`;

        // Stage 1: parallel
        const [gptRes, claudeIndRes] = await Promise.all([
          fetch('https://api.openai.com/v1/chat/completions', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+openaiKey},
            body: JSON.stringify({model:'gpt-4o',max_tokens:2000,temperature:0.3,messages:[{role:'system',content:SCIENCE_FINAL},...messages]})
          }),
          fetch('https://api.anthropic.com/v1/messages', {
            method:'POST',
            headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01','anthropic-beta':'prompt-caching-2024-07-31'},
            body: JSON.stringify({
              model:'claude-sonnet-4-6',
              max_tokens:2000,
              system:[
                {type:'text',text:SCIENCE_FINAL,cache_control:{type:'ephemeral'}},
                {type:'text',text:'Provide your own INDEPENDENT analysis. Do not reference any other AI.'}
              ],
              messages:convertForClaude(messages)
            })
          })
        ]);

        const [gptData, claudeIndData] = await Promise.all([gptRes.json(), claudeIndRes.json()]);
        if(!gptRes.ok) throw new Error(gptData.error?.message||'GPT-4o error');
        if(!claudeIndRes.ok) throw new Error(claudeIndData.error?.message||'Claude error');

        const llm1Answer = gptData.choices[0].message.content||'';
        const claudeIndAnswer = (claudeIndData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')||'';

        // Stage 2: merge
        const sciMergerSystem = MERGER_SCIENCE.replace('${llm1Answer}',llm1Answer).replace('${claudeIndAnswer}',claudeIndAnswer);
        const mergerBody = {
          model:'claude-sonnet-4-6', max_tokens:3000,
          system:[{type:'text',text:sciMergerSystem,cache_control:{type:'ephemeral'}}],
          messages: convertForClaude(messages)
        };
        const mergeRes = await fetch('https://api.anthropic.com/v1/messages',{
          method:'POST',
          headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01','anthropic-beta':'prompt-caching-2024-07-31'},
          body:JSON.stringify(mergerBody)
        });
        const mergeData = await mergeRes.json();
        if(!mergeRes.ok) throw new Error(mergeData.error?.message||'Merge error');
        const llm2Answer = (mergeData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')||'';

        return new Response(JSON.stringify({llm1:llm1Answer,llm1b:claudeIndAnswer,llm2:llm2Answer}),{headers:CORS});

      } catch(e) {
        return new Response(JSON.stringify({error:e.message}),{headers:CORS});
      }
    }

    if(body.action === 'geomind') {
      try {
        const messages      = body.messages || [];
        const pipelineMode  = body.pipelineMode || 'exploration';
        const lang          = body.lang || 'English';
        const langInstruction = `\n\nIMPORTANT: Always respond in ${lang}.`;

        // ── GEOLOGY PROMPTS ──────────────────────────────────────
        const EXPLORATION_PROMPT = `## GEOMIND DUALMIND v2.0 — MINERAL EXPLORATION PIPELINE
IDENTITY: You are GeoMind, an expert AI geoscientist specializing in mineral exploration, geophysics, and drill targeting in Central Africa — particularly the Central African Copperbelt (Zambia, DRC).

EXPERTISE:
- IP (Induced Polarization) geophysics: chargeability anomalies, resistivity, phase
- Electromagnetic (EM/TEM) surveys: conductors, depth estimation
- Magnetic surveys: TMI, RTP, structural interpretation
- Geochemistry: soil, rock chip, stream sediment anomalies
- Drill targeting: target ranking, priority zones, collar design
- Lithology: basement rocks, Katangan stratigraphy, ore-bearing units
- Deposit types: SEDEX, MVT, stratiform Cu-Co, orogenic gold

## DATA SUFFICIENCY PROTOCOL (ALWAYS APPLY FIRST)
Before any analysis, assess what data has been provided and score it:

FULL DATASET (confidence penalty: 0%):
- Collar coordinates + Downhole survey + Assay results + Lithological logs + Geological context + Target polygon
- 5+ drillholes with assay coverage

PARTIAL DATASET — apply confidence penalties automatically:
- Missing collar/survey data: -15% on data_quality and target_definition
- Missing assay results: -25% on data_quality and anomaly_strength
- Missing lithological logs: -20% on geological_consistency
- Missing geological context: -10% on geological_consistency
- Missing target polygon: -10% on target_definition
- Only 1-2 drillholes: -20% on overall_confidence
- Only 3-4 drillholes: -10% on overall_confidence
- No drillholes at all (geophysics/geochemistry only): -30% on target_definition

MINIMUM CONFIDENCE CAPS based on data completeness:
- 1 dataset only: overall_confidence CANNOT exceed 30%
- 2 datasets: overall_confidence CANNOT exceed 45%
- 3 datasets: overall_confidence CANNOT exceed 60%
- 4 datasets: overall_confidence CANNOT exceed 75%
- 5-6 datasets: full scoring applies, no cap

## STEP 0 — DATA INVENTORY & GAP ANALYSIS
Start EVERY response with this exact block:

"📋 DATA RECEIVED: [list what was provided]
❌ DATA MISSING: [list what is absent]
📊 COMPLETENESS: X/6 datasets | Confidence cap: XX%
💡 TO INCREASE CONFIDENCE: [specific list of what additional data would most improve the analysis]"

Then proceed with analysis regardless — never refuse to analyse.

## STEP 1 — PROJECT CLASSIFICATION
"Survey Type: [IP|EM|Magnetic|Geochemistry|Drillhole|Multi-method] | Target: [Cu-Co|Au|Pb-Zn|Other] | Stage: [Reconnaissance|Target Generation|Infill|Pre-drill] | Complexity: [1-3]/3"

## STEP 2 — DATA ANALYSIS
Systematically analyse all provided data. Work with what exists.
For geophysics: anomaly dimensions, depth estimates, strike/dip.
For geochemistry: threshold values, spatial distribution, element associations.
For drillholes: integrate collar, survey, assay, lithology. Identify mineralised intervals above cut-off.
For sparse data: clearly state what can and cannot be concluded.

## STEP 3 — GEOLOGICAL INTERPRETATION
Interpret in context of known Copperbelt geology.
Correlate all available datasets.
For each interpretation state: SUPPORTED BY DATA / INFERRED / SPECULATIVE.

## STEP 4 — DRILL TARGET RECOMMENDATION
Always provide best possible targets given available data.
Clearly label confidence of each target based on data completeness.

[PRIORITY 1] — Strong data convergence → recommend drilling
[PRIORITY 2] — Good potential, partial data → recommend additional data first
[PRIORITY 3] — Speculative, minimal data → surface follow-up only

For each target:
- Recommended collar coordinates (Easting/Northing)
- Suggested azimuth and dip
- Target depth range
- Expected lithology sequence
- Confidence level for this specific target (%)
- What additional data would upgrade this target to Priority 1

## STEP 5 — DATA REQUEST FOR HIGHER CONFIDENCE
Always end with a specific prioritised list:
"To increase confidence from XX% to XX%, provide:
1. [Most critical missing dataset] — would add +XX% confidence
2. [Second most critical] — would add +XX% confidence
3. [Additional data] — would add +XX% confidence"

## CONFIDENCE SCORECARD
Score each metric honestly reflecting actual data quality.
Apply all penalties from DATA SUFFICIENCY PROTOCOL above.
End every response with exactly:
{"scorecard":{"data_quality":XX,"geological_consistency":XX,"anomaly_strength":XX,"target_definition":XX,"risk_assessment":XX,"recommendation_clarity":XX,"overall_confidence":XX,"combined_score":XX,"grade":"Excellent|Good|Acceptable|Weak|Unreliable","verdict":"Drill Now|Infill First|More Data Needed|Low Priority|Do Not Drill"}}

Verdict rules:
- overall_confidence >= 75%: can say "Drill Now"
- overall_confidence 55-74%: "Infill First"
- overall_confidence 35-54%: "More Data Needed"
- overall_confidence 20-34%: "Low Priority"
- overall_confidence < 20%: "Do Not Drill"

RULES: Never refuse / Always analyse what exists / Be honest about limitations / Request missing data specifically / Respond in user's language`;

        const DRILL_PROMPT = `## GEOMIND DRILL OPTIMIZER v2.0
IDENTITY: Expert drill program designer for mineral exploration in the Copperbelt and Central Africa.

FOCUS: Optimize drill hole placement, spacing, azimuth, dip, and depth for maximum target intersection probability while minimizing cost.

## DATA INVENTORY (always first):
"DATA RECEIVED: [list what was provided]
DATA MISSING: [list what is absent]
COMPLETENESS: X/6 datasets | Confidence cap: XX%
ADDITIONAL DATA NEEDED: [what would most improve drill plan accuracy]"

NOTE: A 7th optional file may be provided — "Additional Information" (geophysics images, maps, reports, photos, or any other relevant data). If present, analyse it and incorporate into interpretation. It can increase confidence scores if it provides supporting evidence.

Apply confidence penalties automatically:
- No existing drillhole data: overall_confidence capped at 40%
- No assay data: -20% on target_definition
- No survey data: -15% on geological_consistency
- Fewer than 3 reference holes: -20% on overall_confidence
- No target polygon: -10% on target_definition

STEP 0: "Program Type: [Reconnaissance|Step-out|Infill|Resource Definition] | Target Geometry: [tabular|vein|stockwork|massive] | Budget: [identified]"
STEP 1 — TARGET GEOMETRY: Interpret shape, plunge, extent from available data. State confidence of geometry interpretation.
STEP 2 — HOLE DESIGN: For each proposed hole specify collar (Easting/Northing), azimuth, dip, depth, expected intersections, probability of success %.
STEP 3 — SPACING: Recommend drill spacing for target stage and confidence level required.
STEP 4 — COST ESTIMATE: Meters x estimated cost/meter, total program budget in USD.
STEP 5 — RISK & DATA GAPS: Probability of intersection, contingency holes, what data would reduce risk.
STEP 6 — DATA REQUEST: Specific additional data ranked by impact:
"To increase confidence from XX% to XX%, provide:
1. [Most critical missing dataset] — would add +XX%
2. [Second most critical] — would add +XX%"

SCORECARD: End with {"scorecard":{"data_quality":XX,"geological_consistency":XX,"anomaly_strength":XX,"target_definition":XX,"risk_assessment":XX,"recommendation_clarity":XX,"overall_confidence":XX,"combined_score":XX,"grade":"Excellent|Good|Acceptable|Weak|Unreliable","verdict":"Drill Now|Infill First|More Data Needed|Low Priority|Do Not Drill"}}

Verdict rules: >=75% Drill Now | 55-74% Infill First | 35-54% More Data Needed | 20-34% Low Priority | <20% Do Not Drill`;

                const REPORT_PROMPT = `## GEOMIND REPORT WRITER v2.0
IDENTITY: Expert technical writer for mineral exploration reports — JORC, NI 43-101, and internal company standards.

## DATA INVENTORY (always first):
"📋 DATA RECEIVED: [list]
❌ DATA MISSING: [list]
📊 COMPLETENESS: X/6 datasets
⚠️ REPORT LIMITATIONS: [what sections cannot be fully completed due to missing data]
💡 TO COMPLETE REPORT: [specific data needed]"

Apply confidence penalties to scorecard based on data completeness (same scale as Exploration prompt).
Sections with insufficient data must be marked: "[INCOMPLETE — requires additional data: X]"

OUTPUT: Professional exploration report with these sections:
1. Executive Summary — key findings and recommendation
2. Data Completeness Statement — what was provided vs what is ideal
3. Geological Setting — regional and local context (Copperbelt)
4. Survey / Drilling Results — analyse all provided data
5. Mineralisation Interpretation — grade, thickness, continuity
6. Drill Targets / Recommendations — with confidence levels per target
7. Data Gaps & Next Steps — prioritised list of additional work
8. Risk Assessment — geological, technical, data-quality risks
9. Qualified Person Note — flag QP requirement for JORC/NI 43-101

FORMAT: Formal technical English. SI units. Confidence intervals. Cite data sources.

SCORECARD: End with {"scorecard":{"data_quality":XX,"geological_consistency":XX,"anomaly_strength":XX,"target_definition":XX,"risk_assessment":XX,"recommendation_clarity":XX,"overall_confidence":XX,"combined_score":XX,"grade":"Excellent|Good|Acceptable|Weak|Unreliable","verdict":"Drill Now|Infill First|More Data Needed|Low Priority|Do Not Drill"}}

Verdict rules: >=75% Drill Now | 55-74% Infill First | 35-54% More Data Needed | 20-34% Low Priority | <20% Do Not Drill`;

        const SYSTEM_PROMPT = (pipelineMode === 'drill') ? DRILL_PROMPT
          : (pipelineMode === 'report') ? REPORT_PROMPT
          : EXPLORATION_PROMPT;

        const FINAL_PROMPT = SYSTEM_PROMPT + langInstruction;

        // ── CONVERT MESSAGES ─────────────────────────────────────
        const convertForClaude = (msgs) => msgs.map(m => {
          if(Array.isArray(m.content)){
            const content = m.content.map(c => {
              if(c.type === 'image_url'){
                const rawUrl = c.image_url.url;
                const b64 = rawUrl.replace(/^data:image\/\w+;base64,/,'');
                const mt = rawUrl.includes('image/png') ? 'image/png' : 'image/jpeg';
                return {type:'image', source:{type:'base64', media_type:mt, data:b64}};
              }
              return {type:'text', text:c.text||''};
            });
            return {role: m.role, content};
          }
          return m;
        });

        let lastUsage = {prompt_tokens:0, completion_tokens:0};

        const lastMsg = messages[messages.length-1]?.content;
        const lastText = Array.isArray(lastMsg) ? (lastMsg.find(c=>c.type==='text')?.text||'') : (lastMsg||'');
        const needsSearch = /today|current|latest|price|news|recent|2024|2025|2026|real.?time|live/i.test(lastText);

        // ── STAGE 1: LLM1 + LLM2 INDEPENDENT ANALYSIS IN PARALLEL ──
        const gptBody = {
          model: needsSearch ? 'gpt-4o-search-preview' : 'gpt-4o',
          max_tokens: 2000,
          messages: [{role:'system', content: FINAL_PROMPT}, ...messages]
        };
        if(!needsSearch) gptBody.temperature = 0.3;
        if(needsSearch)  gptBody.web_search_options = {};

        const claudeMsgs = convertForClaude(messages);
        const claudeIndependentBody = {
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: [
            {type:'text', text:FINAL_PROMPT, cache_control:{type:'ephemeral'}},
            {type:'text', text:'IMPORTANT: Provide your own INDEPENDENT geological analysis. Do NOT refer to any other AI. Give your best interpretation of the data provided.'}
          ],
          messages: claudeMsgs
        };
        if(needsSearch){
          claudeIndependentBody.tools = [{type:'web_search_20250305', name:'web_search'}];
        }

        // Run both in parallel
        const [gptRes, claudeIndRes] = await Promise.all([
          fetch('https://api.openai.com/v1/chat/completions', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+openaiKey},
            body: JSON.stringify(gptBody)
          }),
          fetch('https://api.anthropic.com/v1/messages', {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version':'2023-06-01',
              'anthropic-beta':'prompt-caching-2024-07-31'
            },
            body: JSON.stringify(claudeIndependentBody)
          })
        ]);

        const [gptData, claudeIndData] = await Promise.all([gptRes.json(), claudeIndRes.json()]);
        if(!gptRes.ok) throw new Error(gptData.error?.message || 'GPT-4o error');
        if(!claudeIndRes.ok) throw new Error(claudeIndData.error?.message || 'Claude independent error');

        const llm1Answer = gptData.choices[0].message.content || '';
        const claudeIndAnswer = (claudeIndData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n') || '';

        if(gptData.usage){
          lastUsage.prompt_tokens     += gptData.usage.prompt_tokens || 0;
          lastUsage.completion_tokens += gptData.usage.completion_tokens || 0;
        }
        if(claudeIndData.usage){
          lastUsage.prompt_tokens     += claudeIndData.usage.input_tokens || 0;
          lastUsage.completion_tokens += claudeIndData.usage.output_tokens || 0;
        }

        // ── STAGE 2: LLM2 MERGES BOTH ANALYSES ───────────────────
        const mergerSystem = FINAL_PROMPT + `

## YOUR ROLE: SYNTHESIS & MERGER ENGINE

You have independently analysed the data (your analysis is below as CLAUDE INDEPENDENT).
You have also received GPT-4o's independent analysis (LLM 1 ANALYSIS below).

Your task is to MERGE both analyses into one authoritative final report.

Structure your merged response EXACTLY as:

## ✅ CONVERGENCE (Both models agree)
Points where GPT-4o and Claude reached the same conclusion — HIGH CONFIDENCE.

## ⚠️ DIVERGENCE (Models disagree)
Points where interpretations differ. For each:
- GPT-4o said: ...
- Claude said: ...
- Severity: [MINOR | MODERATE | CRITICAL]
- Merged conclusion: [which to accept and why, or "Reverify Required"]

## 📋 MERGED FINAL INTERPRETATION
Unified interpretation combining both analyses. Use convergent points at full weight. Resolve divergences. Exclude unsupported claims.

## 🎯 FINAL VERDICT & CONFIDENCE
**Overall Confidence: XX% | Grade: [grade] | Verdict: [verdict]**
Justify confidence based on convergence ratio. If CRITICAL divergences remain unresolved: verdict = "Reverify Required".

Always end with SCORECARD JSON.

---
LLM 1 ANALYSIS (GPT-4o):
${llm1Answer}

CLAUDE INDEPENDENT ANALYSIS:
${claudeIndAnswer}

Now produce the merged final report:`;

        const mergerBody = {
          model: 'claude-sonnet-4-6',
          max_tokens: 3500,
          system: [{type:'text',text:mergerSystem,cache_control:{type:'ephemeral'}}],
          messages: claudeMsgs
        };

        const mergeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version':'2023-06-01',
            'anthropic-beta':'prompt-caching-2024-07-31'
          },
          body: JSON.stringify(mergerBody)
        });
        const mergeData = await mergeRes.json();
        if(!mergeRes.ok) throw new Error(mergeData.error?.message || 'Claude merger error');
        const llm2Answer = (mergeData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n') || '';
        if(mergeData.usage){
          lastUsage.prompt_tokens     += mergeData.usage.input_tokens || 0;
          lastUsage.completion_tokens += mergeData.usage.output_tokens || 0;
        }

        // ── TRACK USAGE IN KV (global + per-code) ──────────────
        try{
          const CODES_KV = env.GREENROCK_CODES;

          // Global stats
          const usageKey = 'usage:stats';
          let stats = {};
          try{ const raw=await CODES_KV.get(usageKey); if(raw) stats=JSON.parse(raw); }catch(e){}
          stats.total_requests = (stats.total_requests||0) + 1;
          stats.total_prompt_tokens = (stats.total_prompt_tokens||0) + (lastUsage.prompt_tokens||0);
          stats.total_completion_tokens = (stats.total_completion_tokens||0) + (lastUsage.completion_tokens||0);
          stats.last_query = Date.now();
          await CODES_KV.put(usageKey, JSON.stringify(stats));

          // Per-code cost tracking
          const activeCode = body.code || '';
          if(activeCode){
            const costKey = 'cost_'+activeCode.trim().toUpperCase();
            const existingCost = await CODES_KV.get(costKey);
            const cd = existingCost ? JSON.parse(existingCost) : {code:activeCode, inputTokens:0, outputTokens:0, calls:0};
            cd.inputTokens  += (lastUsage.prompt_tokens||0);
            cd.outputTokens += (lastUsage.completion_tokens||0);
            cd.calls        += 1;
            cd.lastCall      = Date.now();
            cd.lastMode      = pipelineMode||'geo';
            await CODES_KV.put(costKey, JSON.stringify(cd), {expirationTtl:365*24*3600});
          }
        }catch(e){}

        return new Response(JSON.stringify({
          llm1: llm1Answer,
          llm1b: claudeIndAnswer,
          llm2: llm2Answer,
          usage: lastUsage,
          pipelineMode,
          webSearchUsed: needsSearch
        }), {headers: CORS});

      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {headers: CORS});
      }
    }

    // ── PROOF OF PAYMENT ─────────────────────────────────────────
    if(body.action === 'verify-proof-image'){
      try{
        const image = body.image || '';
        const mime  = body.mime  || 'image/jpeg';
        const r = await fetch('https://api.openai.com/v1/chat/completions',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+openaiKey},
          body: JSON.stringify({
            model:'gpt-4o', max_tokens:500, temperature:0,
            messages:[{role:'user', content:[
              {type:'image_url', image_url:{url:`data:${mime};base64,${image}`}},
              {type:'text', text:'This is a payment receipt. Extract: 1) Amount paid 2) Currency 3) Date 4) Reference/transaction number. Return JSON: {"amount":"","currency":"","date":"","reference":"","valid":true/false}. Return only JSON.'}
            ]}]
          })
        });
        const d = await r.json();
        const raw = d.choices?.[0]?.message?.content || '{}';
        let parsed;
        try{ parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g,'').trim()); }
        catch(e){ parsed = {valid:false, error:'Could not parse receipt'}; }
        return new Response(JSON.stringify(parsed), {headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({error:e.message}), {headers:CORS});
      }
    }

    // ── VALIDATE ACCESS CODE ──────────────────────────────────────
    if(body.action === 'validate-code'){
      const code = (body.code||'').trim().toUpperCase();
      const deviceId = (body.deviceId||'').trim();
      const CODES_KV = env.GREENROCK_CODES;
      try{
        const stored = await CODES_KV.get(code);
        if(!stored) return new Response(JSON.stringify({valid:false, error:'Invalid access code'}),{headers:CORS});
        const data = JSON.parse(stored);
        const now = Date.now();
        if(data.expires && data.expires < now)
          return new Response(JSON.stringify({valid:false, error:'Code expired'}),{headers:CORS});

        // Device locking — first use locks code to this device
        if(deviceId){
          if(!data.deviceId){
            // First activation — bind to this device
            data.deviceId = deviceId;
            data.activatedAt = now;
            await CODES_KV.put(code, JSON.stringify(data));
          } else if(data.deviceId !== deviceId){
            // Different device — reject
            return new Response(JSON.stringify({valid:false, error:'This code is already activated on another device. Contact GreenRock AI for assistance.'}),{headers:CORS});
          }
        }

        return new Response(JSON.stringify({valid:true, type:data.type||'M', name:data.name||''}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({error:e.message}),{headers:CORS});
      }
    }

    // ── GET USAGE STATS ──────────────────────────────────────
    if(body.action === 'get-usage'){
      const adminKey = env.ADMIN_KEY || '';
      if(!body.adminKey || body.adminKey !== adminKey)
        return new Response(JSON.stringify({error:'Admin unauthorized'}),{status:401,headers:CORS});
      try{
        const CODES_KV = env.GREENROCK_CODES;
        const raw = await CODES_KV.get('usage:stats');
        const usage = raw ? JSON.parse(raw) : {};
        return new Response(JSON.stringify({usage}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({error:e.message}),{headers:CORS});
      }
    }

    // ── GENERATE ACCESS CODE ─────────────────────────────────
    if(body.action === 'generate-code'){
      const adminKey = env.ADMIN_KEY || '';
      if(!body.adminKey || body.adminKey !== adminKey)
        return new Response(JSON.stringify({error:'Admin unauthorized'}),{status:401,headers:CORS});
      const code    = (body.code||'').trim().toUpperCase() || 'GR-'+Math.random().toString(36).substring(2,7).toUpperCase();
      const type    = body.type || 'M';
      const name    = body.name || '';
      const price   = body.price != null ? parseFloat(body.price) : (type==='Y'?400:type==='W'?15:45);
      const days    = body.days != null ? parseInt(body.days) : (type==='Y'?365:type==='W'?7:30);
      const expires = Date.now() + days*24*60*60*1000;
      try{
        const CODES_KV = env.GREENROCK_CODES;
        await CODES_KV.put(code, JSON.stringify({type,name,price,expires,created:Date.now()}));
        return new Response(JSON.stringify({success:true,code,type,name,expires,days}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({error:e.message}),{headers:CORS});
      }
    }

    // ── LIST CODES ────────────────────────────────────────────
    if(body.action === 'list-codes'){
      const adminKey = env.ADMIN_KEY || '';
      if(!body.adminKey || body.adminKey !== adminKey)
        return new Response(JSON.stringify({error:'Admin unauthorized'}),{status:401,headers:CORS});
      try{
        const CODES_KV = env.GREENROCK_CODES;
        const list = await CODES_KV.list();
        const codes = [];
        for(const k of list.keys){
          if(k.name.startsWith('usage:')) continue;
          const val = await CODES_KV.get(k.name);
          if(val) codes.push({code:k.name, ...JSON.parse(val)});
        }
        return new Response(JSON.stringify({codes}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({error:e.message}),{headers:CORS});
      }
    }

    // ── TRACK AI COST ─────────────────────────────────────────────
    if(body.action === 'track-cost'){
      const code  = (body.code||'').trim().toUpperCase();
      const usage = body.usage || {};
      const mode  = body.mode || 'geo';
      if(!code) return new Response(JSON.stringify({ok:false}),{headers:CORS});
      try{
        const CODES_KV = env.GREENROCK_CODES;

        // Load code record to get stored price
        const codeRecord = await CODES_KV.get(code);
        const codeData = codeRecord ? JSON.parse(codeRecord) : {};

        // Load existing cost record for this code
        const key = 'cost_'+code;
        const existing = await CODES_KV.get(key);
        const d = existing
          ? JSON.parse(existing)
          : {code, inputTokens:0, outputTokens:0, calls:0};

        d.inputTokens  += (usage.prompt_tokens||0);
        d.outputTokens += (usage.completion_tokens||0);
        d.calls        += 1;
        d.lastCall      = Date.now();
        d.lastMode      = mode;

        await CODES_KV.put(key, JSON.stringify(d), {expirationTtl: 365*24*3600});

        // Model pricing — blended GPT-4o + Claude Sonnet (per million tokens)
        // GPT-4o:           $2.50 input / $10.00 output
        // Claude Sonnet 4.6: $3.00 input / $15.00 output
        // Blended average:   $2.75 input / $12.50 output
        // Cache hits reduce Claude input by 90%
        const COST_IN  = 2.75  / 1_000_000;
        const COST_OUT = 12.50 / 1_000_000;
        const cost = (d.inputTokens * COST_IN) + (d.outputTokens * COST_OUT);

        // Use stored price from code record, fallback to prefix-based defaults
        const prefix = code.split('-')[0].charAt(0) || 'W';
        const defaultPrices = {W:15,M:45,Y:400,D:0};
        const planPrice = codeData.price != null ? codeData.price : (defaultPrices[prefix]||45);

        // Cost limit % — default 70%, configurable from admin
        let limitPct = 70;
        try{
          const pctRaw = await CODES_KV.get('COST_LIMIT_PCT');
          if(pctRaw) limitPct = parseFloat(pctRaw)||70;
        }catch(e){}

        const limit = planPrice * (limitPct/100);
        const limitReached = cost >= limit;

        return new Response(JSON.stringify({ok:true, cost, limit, planPrice, limitReached, calls:d.calls}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({ok:false, error:e.message}),{headers:CORS});
      }
    }

    // ── GET ALL COSTS (admin) ─────────────────────────────────────
    if(body.action === 'get-all-costs'){
      const adminKey = env.ADMIN_KEY || '';
      if(!body.adminKey || body.adminKey !== adminKey)
        return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
      try{
        const CODES_KV = env.GREENROCK_CODES;
        const list = await CODES_KV.list({prefix:'cost_'});
        const results = [];
        const COST_IN  = 2.75  / 1_000_000;
        const COST_OUT = 12.50 / 1_000_000;
        for(const k of list.keys){
          const val = await CODES_KV.get(k.name);
          if(val){
            const d = JSON.parse(val);
            d.cost = ((d.inputTokens||0)*COST_IN) + ((d.outputTokens||0)*COST_OUT);
            results.push(d);
          }
        }
        // Also get global totals
        const usageRaw = await CODES_KV.get('usage:stats');
        const globalStats = usageRaw ? JSON.parse(usageRaw) : {};
        const globalCost = ((globalStats.total_prompt_tokens||0)*COST_IN) + ((globalStats.total_completion_tokens||0)*COST_OUT);
        return new Response(JSON.stringify({ok:true, costs:results, globalStats, globalCost}),{headers:CORS});
      }catch(e){
        return new Response(JSON.stringify({ok:false, error:e.message}),{headers:CORS});
      }
    }

    // ── SET COST LIMIT % (admin) ──────────────────────────────────
    if(body.action === 'set-cost-limit'){
      const adminKey = env.ADMIN_KEY || '';
      if(!body.adminKey || body.adminKey !== adminKey)
        return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
      const CODES_KV = env.GREENROCK_CODES;
      await CODES_KV.put('COST_LIMIT_PCT', String(body.pct||70));
      return new Response(JSON.stringify({ok:true}),{headers:CORS});
    }

    return new Response(JSON.stringify({error:'Unknown action'}), {headers:CORS});
  }
};
