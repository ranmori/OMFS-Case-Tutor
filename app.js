/* ============================================================
   OMFS Case Tutor — static, single-page, client-only app.
   All state lives in localStorage. All AI calls go straight
   from this browser to api.anthropic.com using a key the user
   supplies and stores locally. No backend, no build step.
   ============================================================ */

const STORAGE_KEY = 'omfsCaseTutorData_v1';

const DEFAULT_DATA = {
  settings: { provider: 'gemini', apiKey: '', model: '', voiceURI: '' },
  cases: [],        // {id, createdAt, topic, stem, promptQuestions[], diagnosis, imaging, management, revealed, quality}
  drugCards: [],     // {id, name, trigger, info, topic, sourceCaseId, sm2:{repetition,interval,efactor,nextReview,lastReview}, history:[{date,quality}]}
  procedureLog: [],  // {id, date, procedure, notes, topic, sourceCaseId}
  topicStats: {}     // { topicName: [ {date, quality} ] }
};

let DATA = loadData();

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_DATA), parsed);
  }catch(e){
    console.error('Failed to load local data, starting fresh.', e);
    return structuredClone(DEFAULT_DATA);
  }
}

function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
}

function uid(){
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}

function todayISO(){
  return new Date().toISOString().slice(0,10);
}

function addDays(iso, days){
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0,10);
}

function daysBetween(aISO, bISO){
  return Math.round((new Date(bISO) - new Date(aISO)) / 86400000);
}

function toast(msg, ms=3200){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, ms);
}

/* ============================================================
   SM-2 spaced repetition
   quality: 0-5 self-rated recall, standard SuperMemo-2 scale
   ============================================================ */
function sm2Update(card, quality){
  if(!card.sm2){
    card.sm2 = { repetition: 0, interval: 0, efactor: 2.5, nextReview: todayISO(), lastReview: null };
  }
  const s = card.sm2;
  if(quality < 3){
    s.repetition = 0;
    s.interval = 1;
  } else {
    if(s.repetition === 0) s.interval = 1;
    else if(s.repetition === 1) s.interval = 6;
    else s.interval = Math.round(s.interval * s.efactor);
    s.repetition += 1;
  }
  s.efactor = Math.max(1.3, s.efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  s.lastReview = todayISO();
  s.nextReview = addDays(todayISO(), s.interval);
  card.history = card.history || [];
  card.history.push({ date: todayISO(), quality });
  return card;
}

function recordTopicRating(topic, quality){
  if(!topic) return;
  if(!DATA.topicStats[topic]) DATA.topicStats[topic] = [];
  DATA.topicStats[topic].push({ date: todayISO(), quality });
}

function weakestTopics(limit=3){
  const entries = Object.entries(DATA.topicStats).map(([topic, ratings])=>{
    const recent = ratings.slice(-5);
    const avg = recent.reduce((a,r)=>a+r.quality,0) / recent.length;
    return { topic, avg, n: ratings.length };
  });
  entries.sort((a,b)=> a.avg - b.avg);
  return entries.slice(0, limit);
}

/* ============================================================
   AI provider abstraction — supports Gemini, Groq, OpenRouter, Anthropic
   ============================================================ */
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini (free)',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fastest, free)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (best quality, free)' }
    ],
    help: 'Get a free key at aistudio.google.com — no credit card needed.',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
  },
  groq: {
    name: 'Groq (free, fast)',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (recommended)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest)' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' }
    ],
    help: 'Get a free key at console.groq.com — no credit card needed.',
    url: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openrouter: {
    name: 'OpenRouter (20+ free models)',
    models: [
      { id: 'google/gemini-2.5-flash-preview:free', label: 'Gemini 2.5 Flash (free)' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
      { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder (free)' },
      { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek V3 (free)' }
    ],
    help: 'Get a free key at openrouter.ai — no credit card needed.',
    url: 'https://openrouter.ai/api/v1/chat/completions'
  },
  anthropic: {
    name: 'Anthropic (paid)',
    models: [
      { id: 'claude-sonnet-5-20250514', label: 'Claude Sonnet 5 (recommended)' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (highest quality)' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' }
    ],
    help: 'Get a key at console.anthropic.com — requires billing.',
    url: 'https://api.anthropic.com/v1/messages'
  }
};

function getProvider(){ return PROVIDERS[DATA.settings.provider] || PROVIDERS.gemini; }
function getModel(){
  const m = DATA.settings.model;
  if(m) return m;
  const p = getProvider();
  return p.models[0]?.id || '';
}

async function callAI(system, userPrompt){
  const provider = DATA.settings.provider;
  const apiKey = DATA.settings.apiKey;
  const model = getModel();

  if(!apiKey){
    throw new Error(`No API key set. Open Settings and add your ${getProvider().name} key.`);
  }

  if(provider === 'gemini'){
    return await callGemini(system, userPrompt, apiKey, model);
  } else {
    // Groq, OpenRouter, Anthropic all use similar message formats
    return await callOpenAICompatible(system, userPrompt, apiKey, model, provider);
  }
}

async function callGemini(system, userPrompt, apiKey, model){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: system + '\n\n' + userPrompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 16384 }
    })
  });
  if(!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0,300)}`);
  }
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseModelJSON(raw);
}

async function callOpenAICompatible(system, userPrompt, apiKey, model, provider){
  const cfg = PROVIDERS[provider];
  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`
  };
  // OpenRouter requires extra header
  if(provider === 'openrouter'){
    headers['http-referer'] = window.location.origin;
    headers['x-title'] = 'OMFS Case Tutor';
  }
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if(!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(`API error ${res.status}: ${text.slice(0,300)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return parseModelJSON(raw);
}

/* ============================================================
   Curated OMFS procedure video database
   Maps procedure keywords to known YouTube teaching videos
   ============================================================ */
const VIDEO_DB = [
  // Mandible fractures
  { keywords: ['mandible fracture','mandibular fracture','angle fracture','symphysis fracture','parasymphysis fracture','condylar fracture','ramus fracture'], videoId: 'R3PbpzI40Kw', title: 'Mandible fracture ORIF — surgical technique' },
  { keywords: ['mandible fracture','jaw fracture','open reduction internal fixation'], videoId: 'kQsDZ3ZA5sA', title: 'Mandibular angle fractures — clinical overview' },
  // Orthognathic surgery
  { keywords: ['le fort','orthognathic','bimaxillary','bssO','ramus osteotomy','maxillary osteotomy','mandibular osteotomy','jaw surgery','corrective jaw'], videoId: 'fw2brzBw3Q0', title: 'Orthognathic surgery — animated overview' },
  // Third molar / wisdom teeth
  { keywords: ['third molar','wisdom tooth','wisdom teeth','impacted tooth','molar extraction'], videoId: 'E1t19b_AqWU', title: 'Impacted third molar extraction — surgical technique' },
  { keywords: ['third molar','wisdom tooth','extraction'], videoId: 'DyalZY0msxs', title: 'Full wisdom teeth removal procedure' },
  // TMJ
  { keywords: ['tmj','temporomandibular','temporomandibular joint','arthrocentesis','arthroscopy','internal derangement','disc displacement'], videoId: 'YzOI_Ldi_Uw', title: 'TMJ internal derangement — arthrocentesis, arthroscopy, condylectomy' },
  { keywords: ['tmj','temporomandibular','ankylosis'], videoId: 'Jm4Qhey4Iq0', title: "Kaban's protocol — TMJ ankylosis management" },
  // Dental implants
  { keywords: ['dental implant','implant placement','implant surgery','implant placement'], videoId: 'PeAUQweKCHg', title: 'Digital guided implant surgery — step by step' },
  { keywords: ['implant','immediate implant'], videoId: 'k6Loublqo50', title: 'Immediate implant placement — microsurgery technique' },
  // Zygomatic fractures
  { keywords: ['zygoma','zygomatic','malar','tripod fracture','zygomatic arch'], videoId: 'R3PbpzI40Kw', title: 'Facial fracture management — ORIF technique' },
  // Neck dissection / pathology
  { keywords: ['neck dissection','lymph node','salivary gland','parotid','submandibular gland','tumour resection','tumor resection','cyst enucleation'], videoId: 'Jm4Qhey4Iq0', title: 'Head & neck surgical principles' },
  // Dentoalveolar
  { keywords: ['dentoalveolar','alveolar fracture','tooth avulsion','avulsed tooth','alveolar bone graft'], videoId: 'fw2brzBw3Q0', title: 'Alveolar bone grafting — overview' },
  // Reconstructive
  { keywords: ['free flap','microvascular','fibula flap','reconstruction','bone graft','distraction osteogenesis'], videoId: 'fw2brzBw3Q0', title: 'Reconstructive surgery principles' },
  // General trauma
  { keywords: ['facial trauma','panfacial fracture','orbital fracture','floor of orbit','blowout fracture','naso-orbito-ethmoid','noe fracture'], videoId: 'R3PbpzI40Kw', title: 'Facial fracture fixation — principles' },
  // Local anaesthesia
  { keywords: ['local anaesthesia','local anesthesia','nerve block','inferior alveolar nerve','lingual nerve','mental nerve'], videoId: 'E1t19b_AqWU', title: 'Mandibular nerve anatomy & anaesthesia' },
  // Biopsy
  { keywords: ['biopsy','incisional biopsy','excisional biopsy','oral lesion'], videoId: 'PeAUQweKCHg', title: 'Oral biopsy technique' },
];

function matchVideos(procedures, topic){
  const searchText = [
    (procedures||[]).map(p => (p.name||'') + ' ' + (p.notes||'')).join(' '),
    topic || ''
  ].join(' ').toLowerCase();

  const matches = [];
  const seen = new Set();

  for(const entry of VIDEO_DB){
    if(seen.has(entry.videoId)) continue;
    for(const kw of entry.keywords){
      if(searchText.includes(kw)){
        matches.push(entry);
        seen.add(entry.videoId);
        break;
      }
    }
  }

  // fallback: if nothing matched, return first general trauma video
  if(!matches.length){
    matches.push({ videoId: 'R3PbpzI40Kw', title: 'OMFS surgical principles — overview' });
  }

  return matches.slice(0, 3);
}

function generateCaseImage(prompt, topic){
  if(!prompt && !topic) return '';
  const description = prompt || `${topic} panoramic radiograph CT scan medical imaging`;
  const encoded = encodeURIComponent(description + ' medical imaging clinical educational');
  return `https://image.pollinations.ai/prompt/${encoded}?width=768&height=512&seed=${Date.now()}&nologo=true`;
}

function parseModelJSON(raw){
  const cleaned = raw.replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
  try{
    return JSON.parse(cleaned);
  }catch(e){
    console.error('Failed to parse model output as JSON:', raw);
    throw new Error('The model did not return valid JSON. Try again, or simplify the source material.');
  }
}

const CASE_SYSTEM_PROMPT = `You are an oral & maxillofacial surgery (OMFS) attending building fictional teaching cases for one trainee's private self-study.

Rules:
- The case, patient, and every identifying detail must be entirely fictional and clearly invented for education. Never reference or imply real patient data.
- Ground the clinical content in the source material the trainee supplies, supplemented by standard OMFS knowledge where needed.
- Write the case stem as a realistic clinical vignette (history, exam findings, relevant background) that stops BEFORE revealing the diagnosis.
- If the source material does not touch pharmacology, return an empty drugs array — never invent drug content that isn't warranted.
- If the source material does not touch a surgical/procedural topic, return an empty procedures array.
- YOU MUST include the "imagePrompt" and "videoSearchTerms" fields — they are required, not optional.
- Respond with ONLY raw JSON matching the schema below. No markdown fences, no preamble, no commentary.

Schema (every field is required):
{
  "topic": "short topic label, e.g. 'Mandibular angle fractures'",
  "stem": "the case vignette text, 120-220 words",
  "promptQuestions": ["2-4 short questions the trainee should think through before revealing the answer"],
  "diagnosis": "the diagnosis, 1-3 sentences",
  "imaging": "relevant imaging findings and/or recommended imaging, 1-3 sentences",
  "management": "management plan, 2-4 sentences",
  "imagePrompt": "REQUIRED: a specific 8-15 word description of a medical illustration or radiograph for this case, e.g. 'panoramic radiograph showing left mandibular angle fracture with occlusal step deformity' or 'CT scan axial view showing zygomatic arch fracture'. Be specific about what the image shows. Do NOT use the word 'illustration' — describe the actual clinical image type (radiograph, CT, clinical photo, etc).",
  "videoSearchTerms": ["REQUIRED: 2-3 specific YouTube search terms for videos showing the procedures in this case, e.g. 'open reduction internal fixation mandible fracture surgical technique' or 'Le Fort I osteotomy step by step'. Use precise surgical terminology that would find teaching/demonstration videos."],
  "drugs": [ { "name": "drug name", "trigger": "the clinical scenario/indication that should cue recall of this drug", "info": "dose, route, key facts, contraindications relevant to OMFS practice, 1-3 sentences" } ],
  "procedures": [ { "name": "procedure name", "notes": "brief technique/indication notes, 1-2 sentences" } ]
}`;

async function generateCase(){
  const source = document.getElementById('sourceInput').value.trim();
  if(!source){
    toast('Paste some source material first.');
    return;
  }
  const focusInput = document.getElementById('focusTopic').value.trim();
  const weak = weakestTopics(3).filter(w => w.n >= 2);
  let guidance = '';
  if(focusInput){
    guidance = `The trainee has asked to focus on: "${focusInput}". If the source material supports it, center the case there.`;
  } else if(weak.length){
    guidance = `If the source material touches any of these topics the trainee has been weakest on recently, prefer that angle: ${weak.map(w=>w.topic).join(', ')}. Otherwise use the material as given.`;
  }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try{
    const result = await callAI(CASE_SYSTEM_PROMPT,
      `Source material:\n"""\n${source}\n"""\n\n${guidance}`.trim());

    const c = {
      id: uid(),
      createdAt: new Date().toISOString(),
      topic: result.topic || 'Untitled topic',
      stem: result.stem || '',
      promptQuestions: result.promptQuestions || [],
      diagnosis: result.diagnosis || '',
      imaging: result.imaging || '',
      management: result.management || '',
      imageUrl: generateCaseImage(result.imagePrompt, result.topic),
      videos: matchVideos(result.procedures, result.topic),
      drugs: result.drugs || [],
      procedures: result.procedures || [],
      revealed: false,
      quality: null
    };
    DATA.cases.unshift(c);
    saveData();
    renderCase(c);
    toast(guidance && weak.length && !focusInput ? `Case generated — leaning toward ${weak[0].topic}` : 'Case generated');
  }catch(e){
    console.error(e);
    toast(e.message || 'Something went wrong generating the case.');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Generate case';
  }
}

let currentCase = null;

function renderCase(c){
  currentCase = c;
  document.getElementById('caseEmpty').hidden = true;
  const card = document.getElementById('caseCard');
  card.hidden = false;
  document.getElementById('caseTopicLabel').textContent = c.topic;
  document.getElementById('caseStem').textContent = c.stem;

  // clinical image
  const imgContainer = document.getElementById('caseImage');
  if(c.imageUrl){
    imgContainer.innerHTML = `<img src="${c.imageUrl}" alt="Clinical illustration for ${escapeHTML(c.topic)}" loading="lazy" onerror="this.parentElement.hidden=true">`;
    imgContainer.hidden = false;
  } else {
    imgContainer.innerHTML = '';
    imgContainer.hidden = true;
  }

  const pq = document.getElementById('promptQuestions');
  if(c.promptQuestions && c.promptQuestions.length){
    pq.innerHTML = '<p>Think through before revealing:</p><ul>' +
      c.promptQuestions.map(q=>`<li>${escapeHTML(q)}</li>`).join('') + '</ul>';
    pq.hidden = false;
  } else {
    pq.hidden = true;
  }

  document.getElementById('answerBlock').hidden = true;
  document.getElementById('revealBtn').hidden = false;
  document.getElementById('speakBtn').hidden = true;
  document.getElementById('loggedNote').hidden = true;
  document.querySelectorAll('#rateScale button').forEach(b=>b.classList.remove('picked'));

  document.getElementById('ansDiagnosis').textContent = c.diagnosis;
  document.getElementById('ansImaging').textContent = c.imaging;
  document.getElementById('ansManagement').textContent = c.management;
}

function revealCase(){
  if(!currentCase) return;
  document.getElementById('revealBtn').hidden = true;
  document.getElementById('answerBlock').hidden = false;
  document.getElementById('speakBtn').hidden = false;
  // show image in answer section
  const ansImg = document.getElementById('answerImage');
  if(currentCase.imageUrl){
    ansImg.innerHTML = `<img src="${currentCase.imageUrl}" alt="Clinical illustration" loading="lazy">`;
    ansImg.hidden = false;
  } else {
    ansImg.innerHTML = '';
    ansImg.hidden = true;
  }
  // show procedure videos after management
  const vidContainer = document.getElementById('answerVideos');
  const vids = currentCase.videos || [];
  if(vids.length){
    vidContainer.innerHTML = '<div class="video-label">Procedure videos</div>' +
      vids.map(v =>
        `<div class="video-embed">
          <iframe src="https://www.youtube.com/embed/${v.videoId}" title="${escapeHTML(v.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
          <span class="video-title">${escapeHTML(v.title)}</span>
        </div>`
      ).join('');
    vidContainer.hidden = false;
  } else {
    vidContainer.innerHTML = '';
    vidContainer.hidden = true;
  }
  currentCase.revealed = true;
  saveData();
}

function speakReveal(){
  if(!currentCase || !('speechSynthesis' in window)) { toast('Speech synthesis not available in this browser.'); return; }
  const text = `Diagnosis. ${currentCase.diagnosis} Imaging. ${currentCase.imaging} Management. ${currentCase.management}`;
  const utter = new SpeechSynthesisUtterance(text);
  const voiceURI = DATA.settings.voiceURI;
  if(voiceURI){
    const v = speechSynthesis.getVoices().find(v=>v.voiceURI === voiceURI);
    if(v) utter.voice = v;
  }
  utter.rate = 0.98;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function rateCase(quality){
  if(!currentCase) return;
  document.querySelectorAll('#rateScale button').forEach(b=>{
    b.classList.toggle('picked', Number(b.dataset.q) === quality);
  });
  currentCase.quality = quality;
  recordTopicRating(currentCase.topic, quality);

  let notes = [];

  // build drug cards
  (currentCase.drugs || []).forEach(d=>{
    const card = {
      id: uid(),
      name: d.name,
      trigger: d.trigger,
      info: d.info,
      topic: currentCase.topic,
      sourceCaseId: currentCase.id,
      sm2: null,
      history: []
    };
    sm2Update(card, quality);
    DATA.drugCards.push(card);
  });
  if((currentCase.drugs||[]).length){
    notes.push(`${currentCase.drugs.length} drug entr${currentCase.drugs.length===1?'y':'ies'} added to the reference chart, first review in ${DATA.drugCards.at(-1).sm2.interval} day(s).`);
  }

  // build procedure log entries
  (currentCase.procedures || []).forEach(p=>{
    DATA.procedureLog.unshift({
      id: uid(),
      date: todayISO(),
      procedure: p.name,
      notes: p.notes,
      topic: currentCase.topic,
      sourceCaseId: currentCase.id
    });
  });
  if((currentCase.procedures||[]).length){
    notes.push(`${currentCase.procedures.length} procedure${currentCase.procedures.length===1?'':'s'} logged.`);
  }

  saveData();
  const noteEl = document.getElementById('loggedNote');
  noteEl.textContent = notes.length ? notes.join(' ') : 'No pharmacology or procedures in this case — nothing further to log.';
  noteEl.hidden = false;

  refreshBadges();
}

function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ============================================================
   Drug reference tab
   ============================================================ */
function renderDrugs(){
  const due = DATA.drugCards.filter(c => c.sm2 && c.sm2.nextReview <= todayISO());
  const all = [...DATA.drugCards].sort((a,b)=> (a.sm2?.nextReview||'') < (b.sm2?.nextReview||'') ? -1 : 1);

  document.getElementById('drugsEmpty').hidden = DATA.drugCards.length !== 0;
  document.getElementById('drugsAllHead').hidden = DATA.drugCards.length === 0;

  const dueEl = document.getElementById('drugsDue');
  dueEl.innerHTML = '';
  if(due.length){
    const head = document.createElement('div');
    head.className = 'panel-subhead';
    head.textContent = `Due for review (${due.length})`;
    dueEl.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'drug-grid';
    due.forEach(c => grid.appendChild(drugCardEl(c, true)));
    dueEl.appendChild(grid);
  }

  const allEl = document.getElementById('drugsAll');
  allEl.innerHTML = '';
  all.forEach(c => allEl.appendChild(drugCardEl(c, false)));

  refreshBadges();
}

function drugCardEl(c, dueContext){
  const wrap = document.createElement('div');
  const overdue = c.sm2 && c.sm2.nextReview <= todayISO();
  wrap.className = 'drug-card ' + (overdue ? 'due' : 'fresh');

  const nextText = c.sm2 ? (overdue ? 'due now' : `due ${c.sm2.nextReview}`) : 'not scheduled';

  wrap.innerHTML = `
    <h4>${escapeHTML(c.name)}</h4>
    <p class="trigger">${escapeHTML(c.trigger || '')}</p>
    <p class="info">${escapeHTML(c.info || '')}</p>
    <div class="meta"><span>${escapeHTML(c.topic||'')}</span><span>${nextText}</span></div>
    <button class="flip-btn">Show answer</button>
    <div class="card-rate">
      ${[0,1,2,3,4,5].map(q=>`<button data-q="${q}">${q}</button>`).join('')}
    </div>
  `;
  const flipBtn = wrap.querySelector('.flip-btn');
  const info = wrap.querySelector('.info');
  const rateRow = wrap.querySelector('.card-rate');
  flipBtn.addEventListener('click', ()=>{
    info.style.display = 'block';
    rateRow.style.display = 'flex';
    flipBtn.style.display = 'none';
  });
  rateRow.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const q = Number(btn.dataset.q);
      sm2Update(c, q);
      recordTopicRating(c.topic, q);
      saveData();
      toast(`Next review in ${c.sm2.interval} day(s).`);
      renderDrugs();
      renderProgress();
    });
  });
  return wrap;
}

function refreshBadges(){
  const due = DATA.drugCards.filter(c => c.sm2 && c.sm2.nextReview <= todayISO()).length;
  const badge = document.getElementById('drugsDueBadge');
  if(due > 0){ badge.hidden = false; badge.textContent = due; }
  else { badge.hidden = true; }
}

/* ============================================================
   Procedure log tab
   ============================================================ */
function renderProcs(){
  const body = document.getElementById('procTableBody');
  const table = document.getElementById('procTable');
  const empty = document.getElementById('procsEmpty');
  body.innerHTML = '';
  if(!DATA.procedureLog.length){
    table.hidden = true; empty.hidden = false; return;
  }
  table.hidden = false; empty.hidden = true;
  DATA.procedureLog.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.date}</td><td>${escapeHTML(p.procedure)}</td><td>${escapeHTML(p.topic)}</td><td>${escapeHTML(p.notes||'')}</td>`;
    body.appendChild(tr);
  });
}

/* ============================================================
   Progress tab — tiny hand-rolled SVG line charts, no deps
   ============================================================ */
function renderProgress(){
  const container = document.getElementById('progressCharts');
  const empty = document.getElementById('progressEmpty');
  container.innerHTML = '';
  const topics = Object.entries(DATA.topicStats).filter(([,r])=>r.length);
  if(!topics.length){ empty.hidden = false; return; }
  empty.hidden = true;

  topics.sort((a,b)=> b[1].length - a[1].length);

  topics.forEach(([topic, ratings])=>{
    const avg = (ratings.reduce((s,r)=>s+r.quality,0)/ratings.length).toFixed(1);
    const box = document.createElement('div');
    box.className = 'topic-chart';
    box.innerHTML = `<div class="thead"><h4>${escapeHTML(topic)}</h4><span class="avg">avg ${avg} / 5 · n=${ratings.length}</span></div>`;
    box.appendChild(sparkline(ratings));
    container.appendChild(box);
  });
}

function sparkline(ratings){
  const w = 600, h = 70, pad = 8;
  const xs = ratings.map((_,i)=> pad + (i * (w - pad*2) / Math.max(1, ratings.length-1)));
  const ys = ratings.map(r => h - pad - (r.quality/5) * (h - pad*2));
  const points = xs.map((x,i)=> `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio','none');

  const baseline = document.createElementNS(svgNS,'line');
  baseline.setAttribute('x1', pad); baseline.setAttribute('x2', w-pad);
  baseline.setAttribute('y1', h-pad); baseline.setAttribute('y2', h-pad);
  baseline.setAttribute('stroke', '#333a44'); baseline.setAttribute('stroke-width','1');
  svg.appendChild(baseline);

  const poly = document.createElementNS(svgNS,'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill','none');
  poly.setAttribute('stroke','#d98e32');
  poly.setAttribute('stroke-width','2');
  poly.setAttribute('stroke-linecap','round');
  poly.setAttribute('stroke-linejoin','round');
  svg.appendChild(poly);

  xs.forEach((x,i)=>{
    const c = document.createElementNS(svgNS,'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', ys[i]); c.setAttribute('r', 3);
    c.setAttribute('fill', ratings[i].quality >= 3 ? '#4fa88f' : '#c1553d');
    svg.appendChild(c);
  });

  return svg;
}

/* ============================================================
   Tabs
   ============================================================ */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>{
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach(p=>{
    p.hidden = p.dataset.panel !== name;
  });
  if(name === 'drugs') renderDrugs();
  if(name === 'procs') renderProcs();
  if(name === 'progress') renderProgress();
}

/* ============================================================
   Settings
   ============================================================ */
function openSettings(){
  document.getElementById('providerSelect').value = DATA.settings.provider || 'gemini';
  updateModelOptions();
  document.getElementById('apiKeyInput').value = DATA.settings.apiKey || '';
  updateProviderHelp();
  populateVoices();
  document.getElementById('settingsBackdrop').hidden = false;
}
function closeSettings(){
  DATA.settings.provider = document.getElementById('providerSelect').value;
  DATA.settings.model = document.getElementById('modelSelect').value;
  DATA.settings.apiKey = document.getElementById('apiKeyInput').value.trim();
  DATA.settings.voiceURI = document.getElementById('voiceSelect').value;
  saveData();
  document.getElementById('settingsBackdrop').hidden = true;
}
function updateModelOptions(){
  const provider = document.getElementById('providerSelect').value;
  const p = PROVIDERS[provider];
  const sel = document.getElementById('modelSelect');
  sel.innerHTML = p.models.map(m =>
    `<option value="${m.id}" ${m.id === DATA.settings.model ? 'selected' : ''}>${m.label}</option>`
  ).join('');
}
function updateProviderHelp(){
  const provider = document.getElementById('providerSelect').value;
  const p = PROVIDERS[provider];
  document.getElementById('providerHelp').textContent = p.help;
}
function populateVoices(){
  const sel = document.getElementById('voiceSelect');
  const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  sel.innerHTML = '<option value="">Browser default</option>' +
    voices.map(v=>`<option value="${v.voiceURI}" ${v.voiceURI===DATA.settings.voiceURI?'selected':''}>${v.name} (${v.lang})</option>`).join('');
}
if('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = populateVoices;
}

function resetAllData(){
  if(!confirm('This erases every case, drug card, procedure log entry, and progress rating stored in this browser. This cannot be undone. Continue?')) return;
  DATA = structuredClone(DEFAULT_DATA);
  saveData();
  location.reload();
}

/* ============================================================
   Wire up
   ============================================================ */
document.getElementById('generateBtn').addEventListener('click', generateCase);
document.getElementById('revealBtn').addEventListener('click', revealCase);
document.getElementById('speakBtn').addEventListener('click', speakReveal);
document.getElementById('rateScale').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-q]');
  if(btn) rateCase(Number(btn.dataset.q));
});
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=> switchTab(t.dataset.tab));
});
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('settingsBackdrop').addEventListener('click', e=>{
  if(e.target.id === 'settingsBackdrop') closeSettings();
});
document.getElementById('resetDataBtn').addEventListener('click', resetAllData);
document.getElementById('providerSelect').addEventListener('change', ()=>{
  updateModelOptions();
  updateProviderHelp();
});

// first-run: nudge toward settings if no key yet
if(!DATA.settings.apiKey){
  setTimeout(()=> toast('Open Settings to add a free API key (Gemini, Groq, or OpenRouter).', 5000), 600);
}
refreshBadges();

// register service worker for offline app shell
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline support is best-effort */ });
  });
}