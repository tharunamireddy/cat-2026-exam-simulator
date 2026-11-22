const QUESTIONS=DATA.questions, KEY='cat-2026-advanced-single-attempt', MARKER=KEY+':claimed', DBNAME=KEY+':database';
const $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,record=null,blocked=false,busy=false,view='',renderedQuestion=-1,renderedSection=-1,tickBusy=false;
let anchorWall=Date.now(),anchorMono=performance.now(),timerId,lastPulse=performance.now();
const now=()=>Math.max(Date.now(),anchorWall+performance.now()-anchorMono,record?.lastSeen||0);
const clockString=ms=>{let s=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
const dateString=t=>new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'});
function toast(message){$('#toast').textContent=message;clearTimeout(timerId);timerId=setTimeout(()=>{$('#toast').textContent='';},5000);}
function fatal(error){blocked=true;document.querySelectorAll('dialog').forEach(d=>d.close());$('#main').innerHTML='<div class="fatal"><h1>Examination access blocked</h1><p>'+esc(error.message||error)+'</p><p>No new attempt has been created. An existing attempt is never replaced or reset. Its original deadlines continue to apply.</p><p class="muted">Use the same file and browser profile with browser storage available, then reload. If the stored record is damaged, this simulator will not overwrite it.</p></div>';}
function openDatabase(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DBNAME,1);req.onupgradeneeded=()=>req.result.createObjectStore('attempts');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('Persistent browser storage is unavailable. Open this file in a regular Chrome or Edge window with storage enabled.'));req.onblocked=()=>reject(Error('Browser storage is blocked by another window.'));});}
function transaction(mutator){return new Promise((resolve,reject)=>{
  const tx=db.transaction('attempts','readwrite'),store=tx.objectStore('attempts'),req=store.get('only-attempt');let out,failure;
  req.onsuccess=()=>{try{const original=req.result||null;out=mutator(original);if(out?.write)store.put(out.record,'only-attempt');}catch(e){failure=e;tx.abort();}};
  tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(failure||tx.error||Error('The attempt could not be saved.'));tx.onabort=()=>reject(failure||tx.error||Error('The attempt transaction was interrupted.'));
});}
function readMirror(){const raw=localStorage.getItem(KEY);if(!raw)return null;try{return Engine.validate(JSON.parse(raw),QUESTIONS);}catch(e){throw Error('The browser backup is damaged. The attempt is locked to prevent a replacement attempt.');}}
function mirror(r){if(!r)return;const old=readMirror();if(old&&old.id!==r.id)throw Error('Conflicting attempt identities were detected.');if(old&&(old.revision>r.revision||(old.revision===r.revision&&old.lastSeen>r.lastSeen)||(TERMINAL.has(old.state)&&!TERMINAL.has(r.state))))return;localStorage.setItem(MARKER,r.id);localStorage.setItem(KEY,JSON.stringify(r));}
function mergeStored(a,b){
  if(a)Engine.validate(a,QUESTIONS);if(b)Engine.validate(b,QUESTIONS);
  if(a&&b&&a.id!==b.id)throw Error('Conflicting saved attempts were detected.');
  if(a&&b&&TERMINAL.has(a.state)!==TERMINAL.has(b.state))return TERMINAL.has(a.state)?a:b;
  return !a?b:!b?a:b.revision>a.revision?b:a;
}
async function boot(){try{
  const probe=KEY+':storage-probe';localStorage.setItem(probe,'1');if(localStorage.getItem(probe)!=='1')throw Error('Browser storage is unavailable.');localStorage.removeItem(probe);
  db=await openDatabase();db.onversionchange=()=>{db.close();fatal(Error('The storage connection changed. Reload this page to reconnect to the original attempt.'));};
  const res=await transaction(stored=>{
    const restored=mergeStored(stored,readMirror()),claimed=localStorage.getItem(MARKER);
    if(claimed&&(!restored||restored.id!==claimed))throw Error('An attempt has already been claimed, but its saved record cannot be recovered. Starting again is prohibited.');
    if(restored){Engine.reconcile(restored,Math.max(Date.now(),restored.lastSeen),QUESTIONS,false,Date.now()<restored.lastWall-2000);return {record:restored,write:true};}
    return {record:null};
  });
  record=res.record;mirror(record);anchorWall=Math.max(Date.now(),record?.lastSeen||0);anchorMono=performance.now();render();
  if(record?.state==='IN_PROGRESS')toast('Original attempt resumed. Time has continued during the interruption.');
  setInterval(pulse,500);
}catch(e){fatal(e);}}
async function start(){if(busy||blocked)return;busy=true;try{
  const res=await transaction(existing=>{
    const saved=mergeStored(existing,readMirror());
    if(saved){const changed=Engine.reconcile(saved,Math.max(Date.now(),saved.lastSeen),QUESTIONS,false,Date.now()<saved.lastWall-2000);return {record:saved,write:changed};}
    if(localStorage.getItem(MARKER))throw Error('An attempt already exists. A second attempt cannot be started.');
    const r=Engine.create(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4))).map(x=>x.toString(16)).join('-'),Date.now(),QUESTIONS);
    // Claim before the transaction commits. A failed commit leaves a lock, never a fresh start.
    localStorage.setItem(MARKER,r.id);localStorage.setItem(KEY,JSON.stringify(r));
    return {record:r,write:true};
  });record=res.record;mirror(record);anchorWall=Math.max(Date.now(),record.lastSeen);anchorMono=performance.now();lastPulse=performance.now();render();
}catch(e){fatal(e);}finally{busy=false;}}
async function dispatch(action){if(busy||blocked||!record||TERMINAL.has(record.state))return;busy=true;const expected=record.revision;try{
  const t=now(),wall=Date.now();
  const res=await transaction(r=>{
    if(!r)throw Error('The active attempt record is missing. No replacement will be created.');Engine.validate(r,QUESTIONS);
    const changed=Engine.reconcile(r,Math.max(t,r.lastSeen),QUESTIONS,false,wall<r.lastWall-2000);
    if(TERMINAL.has(r.state)||changed)return {record:r,write:changed,notice:'The section deadline has passed.'};
    if(r.revision!==expected)return {record:r,write:false,notice:'This attempt changed in another tab. The latest saved state is shown; repeat your action if needed.'};
    let result;try{result=Engine.act(r,action,t,QUESTIONS);}catch(e){return {record:r,write:false,notice:e.message};}
    r.lastSeen=Math.max(r.lastSeen,t);r.lastWall=wall;return {record:r,write:result.changed,notice:result.notice};
  });record=res.record;mirror(record);render();if(res.notice)toast(res.notice);
}catch(e){fatal(e);}finally{busy=false;}}
async function pulse(){if(blocked||tickBusy)return;updateTimer();if(!record||TERMINAL.has(record.state)||busy)return;
  tickBusy=true;const t=now(),wall=Date.now(),elapsed=performance.now()-lastPulse;lastPulse=performance.now();
  try{const res=await transaction(r=>{
    if(!r)throw Error('The saved attempt is missing.');Engine.validate(r,QUESTIONS);
    if(TERMINAL.has(r.state))return {record:r,write:false};
    const previousSection=r.section;
    const changed=Engine.reconcile(r,Math.max(t,r.lastSeen),QUESTIONS,true,wall<r.lastWall-2000);
    // Count visible interaction time only, excluding sleep, closed windows and hidden tabs.
    if(!document.hidden&&elapsed<2000&&r.current===record.current&&r.revision===record.revision&&r.section===previousSection&&!TERMINAL.has(r.state))r.responses[r.current].timeMs+=Math.max(0,Math.min(elapsed,t-r.lastSeen));
    if(!TERMINAL.has(r.state)){r.lastSeen=Math.max(t,r.lastSeen);r.lastWall=wall;}
    return {record:r,write:true,changed};
  });const oldSection=record.section,oldRevision=record.revision,oldState=record.state;record=res.record;mirror(record);
  if(oldRevision!==record.revision||oldState!==record.state){render();if(oldSection!==record.section&&!TERMINAL.has(record.state))toast(SECTION_NAMES[oldSection]+' has closed. '+SECTION_NAMES[record.section]+' is now active.');}
  }catch(e){fatal(e);}finally{tickBusy=false;}}

const statusLabels={'unvisited':'Not Visited','unanswered':'Not Answered','answered':'Answered','review':'Marked for Review','answered-review':'Answered & Marked for Review'};
function legend(r=null){const counts=Object.fromEntries(Object.keys(statusLabels).map(k=>[k,0]));if(r)r.responses.slice(STARTS[r.section],STARTS[r.section]+COUNTS[r.section]).forEach(v=>counts[Engine.status(v)]++);
  return '<div class="legend">'+Object.entries(statusLabels).map(([k,v])=>'<div class="legend-row"><span class="badge '+k+'">'+(r?counts[k]:'')+'</span><span>'+v+(k==='answered-review'?'<br>(will be evaluated)':'')+'</span></div>').join('')+'</div>';}
function instructions(){return '<h2>General instructions</h2><ol><li>The examination lasts <strong>120 minutes</strong>. Answer VARC, DILR and QA in that order, with <strong>40 minutes per section</strong>. You cannot change sections or submit early. Each section closes automatically.</li><li>Use the question palette to move within the active section. Selecting an option does not save it. <strong>Save &amp; Next</strong> saves your answer, removes any review flag and moves forward. <strong>Mark for Review &amp; Next</strong> saves your answer and flags it for review. A saved answer marked for review <strong>is evaluated</strong>.</li><li>Clicking a palette number or Previous discards unsaved edits. <strong>Clear Response</strong> clears your current selection; use Save &amp; Next or Mark for Review &amp; Next to commit the cleared answer. At a section deadline, only saved answers are evaluated.</li><li>For TITA questions, use the <strong>on-screen numeric keypad</strong>. A physical keyboard does not enter answers. Decimal answers are accepted where requested; enter no units. Sequence questions require the exact digit order.</li><li>A basic on-screen calculator is available in every section. It uses immediate arithmetic (operations are evaluated in entry order), with square root, reciprocal and memory controls. The % key takes two numbers: B % A means B percent of A (for example, 250 + 15 % 250 = 287.5). Use paper for rough work.</li><li>Correct answers earn <strong>+3</strong>. Incorrect MCQs receive <strong>−1</strong>; incorrect TITA answers and unattempted questions receive <strong>0</strong>.</li><li>This is a <strong>single attempt</strong>. Reloading resumes the original record and deadlines. Time continues when this tab is hidden, the browser is closed, or the device is asleep. Missed sections close automatically. Completion or expiry permanently opens the read-only results.</li><li>Keep the file in the same location and use the same regular browser profile. Browser-local enforcement cannot survive deliberate deletion of all site data, a different profile, or edited source code. There is no server identity or trusted clock.</li></ol><h3>Question status</h3>'+legend()+'<p class="muted" style="margin-top:18px;font-size:14px">The outline identifies the current question. Palette colors reflect saved answers, not unsaved selections. A pending selection is restored after an interruption, but still requires explicit saving.</p>';}
function provenance(){return '<details><summary>Paper verification, sources and simulator scope</summary><p>Questions were extracted from <strong>CAT_2026_ADVANCED_FULL_MOCK_STUDENT_REVISED.pdf</strong> (23 pages). Keys and worked solutions come from the matching revised solutions PDF and Markdown. This is original, unofficial practice material; it is not an official CAT 2026 paper.</p><p>All 68 question records were checked for type, option count, key and explanation. All 44 DILR and QA keys agree with 45 arithmetic and exhaustive checks. VARC answers were reviewed against their passages; VARC Q2 retains the source’s qualification about the A/C distractor comparison. Difficulty and timing have not been calibrated on candidates.</p><ul><li><a target="_blank" rel="noopener" href="https://cdn.digialm.com/per/g06/pub/32842/EForms/image/CAT2025/CAT_2025_Media_Release_01_Dec_2025.pdf">CAT 2025 official section counts and timing</a></li><li><a target="_blank" rel="noopener" href="https://cdn.digialm.com/per/g06/pub/32842/EForms/image/CAT2025/Mock_Test_Links_V2_2025.pdf">CAT 2025 official clarification: no early section transitions in the actual examination</a></li><li><a target="_blank" rel="noopener" href="https://cdn.digialm.com/per/g06/pub/32842/EForms/CAT24/CAT_2024_Mock_Test_Navigation_Guide_v1.4.pdf">Official CAT navigation guide: palette and answer controls</a></li><li><a target="_blank" rel="noopener" href="https://cdn.digialm.com/per/g01/pub/756/EForms/CAT23/CAT_2023_Mock_Test_Navigation_Guide.pdf">Official CAT guide: scoring and on-screen input</a></li></ul><p>Simulator rules for interruptions are explicit: elapsed time is never restored, unsaved drafts are excluded on section closure, and a detected backward clock change expires the attempt. A live auto-submission is COMPLETED; a deadline recovered after interruption is EXPIRED. Both are permanent. Storage uses an IndexedDB transaction plus a local browser backup and attempt marker. Raw marks are reported without an invented percentile or scaled score.</p><p>Content formatting repairs: five joined words in the ecology passage were separated; the tournament formula was rendered with subscripts. Questions, choices and keyed answers are otherwise preserved.</p><p>Calculator verification: the published CAT guideline examples for binary percentage, square root, reciprocal and memory are regression-tested. The live official calculator and its PDF endpoint could not be fetched during verification. Ordinary chained operations in this implementation evaluate in entry order; exact live-calculator precedence is not independently certified. Use equals between steps to make calculation order explicit.</p></details>';}
function welcome(){view='welcome';$('#main').innerHTML='<section class="welcome"><div class="welcome-head"><small>COMMON ADMISSION TEST · PRACTICE EXAMINATION</small><h1 style="margin:10px 0">Advanced Full Mock — Revised</h1><p>Read the instructions before beginning your single timed attempt.</p></div><div class="facts"><div class="fact"><strong>68</strong><span>Questions</span></div><div class="fact"><strong>120 minutes</strong><span>Total examination time</span></div><div class="fact"><strong>204</strong><span>Maximum raw marks</span></div><div class="fact"><strong>One attempt</strong><span>Resumes after interruption</span></div></div><div class="instructions"><table><thead><tr><th>Section</th><th>Questions</th><th>Time</th></tr></thead><tbody>'+SECTION_NAMES.map((s,i)=>'<tr><td>'+s+' — '+SECTION_TITLES[i]+'</td><td>'+COUNTS[i]+'</td><td>40 minutes</td></tr>').join('')+'</tbody></table>'+instructions()+provenance()+'</div><div class="start-bar"><label class="consent"><input id="consent" type="checkbox"><span>I have read the instructions. I understand that starting creates my only attempt and that the timer continues during interruptions.</span></label><button class="primary" id="start" disabled>Start Examination</button></div></section>';
  $('#consent').onchange=e=>{$('#start').disabled=!e.target.checked;};$('#start').onclick=start;
}
function examShell(){view='exam';renderedQuestion=-1;renderedSection=record.section;
  $('#main').innerHTML='<div class="exam-shell"><nav class="sectionbar" aria-label="Examination sections">'+SECTION_NAMES.map((s,i)=>'<button '+(i!==record.section?'disabled':'')+' class="'+(i===record.section?'active':'')+'" aria-current="'+(i===record.section?'step':'false')+'">'+s+(i<record.section?' · Closed':i>record.section?' · Locked':'')+'</button>').join('')+'<span class="section-note">Section '+(record.section+1)+' of 3</span></nav><div class="candidate"><span class="avatar" aria-hidden="true">C</span><div><strong>Candidate</strong><small>Single attempt · '+esc(record.id.slice(0,8))+'</small></div><span class="mobile-time">Time Left<strong id="mobile-timer">40:00</strong></span></div><section class="question-space" aria-label="Question"><div class="question-top"><h1 id="question-number"></h1><span class="marks" id="marks"></span><div class="qtools"><button id="smaller" aria-label="Decrease question text size">A−</button><button id="larger" aria-label="Increase question text size">A+</button><button id="calc-open">Calculator</button><button id="instructions-open">Instructions</button></div></div><div class="question-body" id="question-body"></div></section><aside class="sidebar" aria-label="Question palette"><div class="timer" id="timer-wrap"><div>Time Left<small>Current section</small></div><strong id="timer" role="timer" aria-live="off">40:00</strong></div><div id="legend"></div><h2 class="palette-heading">'+SECTION_NAMES[record.section]+' · Choose a Question</h2><div id="palette" class="palette"></div><div class="palette-foot"><strong id="storage-status">Attempt saved in this browser</strong>Sections close at their original deadlines. Reloading does not restore time.</div></aside><div class="bottom-actions"><button id="mark">Mark for Review &amp; Next</button><button id="clear">Clear Response</button><button id="previous">Previous</button><button id="save" class="primary">Save &amp; Next</button></div><div class="submission"><div>Automatic '+(record.section===2?'submission':'section transition')+'<br><span>Available time must elapse</span></div></div></div>';
  $('#save').onclick=()=>dispatch({type:'SAVE'});$('#mark').onclick=()=>dispatch({type:'MARK'});$('#clear').onclick=()=>dispatch({type:'CLEAR'});$('#previous').onclick=()=>dispatch({type:'NAV',index:record.current-1});
  $('#palette').onclick=e=>{const b=e.target.closest('[data-question]');if(b)dispatch({type:'NAV',index:Number(b.dataset.question)});};
  $('#instructions-open').onclick=()=>showInfo('Examination instructions',instructions());
  $('#calc-open').onclick=()=>{if(!$('#calculator').open)$('#calculator').show();};
  $('#smaller').onclick=()=>setTextSize(-1);$('#larger').onclick=()=>setTextSize(1);
}
let textSize=16;
function setTextSize(delta){textSize=Math.max(14,Math.min(22,textSize+delta));document.documentElement.style.setProperty('--body-size',textSize+'px');}
function renderQuestion(){const i=record.current,q=QUESTIONS[i],changed=renderedQuestion!==i;
  $('#question-number').textContent='Question No. '+q.number;
  $('#marks').innerHTML=q.type+' · Marks: <b>+3</b> / <em>'+(q.type==='MCQ'?'−1':'0')+'</em>';
  if(changed){
    const context=q.context?DATA.contexts[q.context]:null;
    $('#question-body').innerHTML=(context?'<article class="passage-pane" tabindex="0" aria-label="'+(q.section===0?'Reading passage':'Set information')+'"><span class="context-label">'+(q.section===0?'Reading comprehension':'Information for this set')+'</span><h2>'+esc(context.title)+'</h2>'+context.html+'</article>':'')+'<div class="answer-pane '+(!context?'no-context':'')+'" tabindex="0" aria-label="Question and answer choices"><div class="question-text">'+q.html+'</div>'+(q.type==='MCQ'?'<div role="radiogroup" aria-label="Answer options">'+q.options.map((o,k)=>'<label class="option"><input type="radio" name="answer" value="'+String.fromCharCode(65+k)+'"><span><span class="option-letter">'+String.fromCharCode(65+k)+'. </span>'+o+'</span></label>').join('')+'</div>':keypad(q))+'<div id="answer-status" class="answer-status" role="status"></div></div>';
    $('#question-body').scrollTop=0;
    document.querySelectorAll('input[name="answer"]').forEach(input=>input.onchange=()=>dispatch({type:'DRAFT',value:input.value}));
    const pad=$('#answer-keypad');if(pad){
      pad.onpointerdown=e=>{if(e.target.closest('button'))e.preventDefault();};
      pad.onclick=async e=>{
        const button=e.target.closest('[data-key]');if(!button)return;
        const input=$('#tita-answer'),k=button.dataset.key;let v=record.draft,a=input.selectionStart??v.length,b=input.selectionEnd??a;
        if(k==='left'||k==='right'){const pos=Math.max(0,Math.min(v.length,a+(k==='left'?-1:1)));input.focus({preventScroll:true});input.setSelectionRange(pos,pos);return;}
        if(k==='back'){if(a===b&&a>0)a--;v=v.slice(0,a)+v.slice(b);}
        else if(k==='clear'){v='';a=0;}
        else if(k==='−'){if(v.startsWith('-')){v=v.slice(1);a=Math.max(0,a-1);}else{v='-'+v;a++;}}
        else{v=v.slice(0,a)+k+v.slice(b);a++;}
        await dispatch({type:'DRAFT',value:v});
        if($('#tita-answer')&&record.current===i){input.focus({preventScroll:true});input.setSelectionRange(a,a);}
      };
    }
    renderedQuestion=i;
  }
  document.querySelectorAll('input[name="answer"]').forEach(input=>input.checked=input.value===record.draft);
  if($('#tita-answer'))$('#tita-answer').value=record.draft;
  const response=record.responses[i],pending=record.draft!==response.answer;
  $('#answer-status').className='answer-status'+(!pending?' saved':'');
  $('#answer-status').textContent=pending?'Unsaved selection. Use Save & Next or Mark for Review & Next.':response.answer!==''?'Saved answer'+(response.marked?' · Marked for review; will be evaluated.':'.'):response.marked?'Marked for review · No saved answer.':'No saved answer.';
  $('#previous').disabled=i===STARTS[record.section];
}
function keypad(q){return '<div class="tita-wrap"><label for="tita-answer">Your answer'+(q.match==='sequence'?' (digit sequence)':'')+'</label><input id="tita-answer" readonly inputmode="none" autocomplete="off" aria-describedby="keypad-help"><div id="answer-keypad" class="keypad">'+['7','8','9','4','5','6','1','2','3','0','.','−','left','right','back','clear'].map(k=>'<button data-key="'+k+'" '+(k==='clear'?'class="wide"':k==='left'||k==='right'?'class="cursor-key"':'')+' aria-label="'+(k==='left'?'Move cursor left':k==='right'?'Move cursor right':k==='back'?'Backspace':k==='clear'?'Clear numeric entry':k==='−'?'Toggle minus sign':k==='.'?'Decimal point':k)+'">'+(k==='left'?'◀':k==='right'?'▶':k==='back'?'⌫':k==='clear'?'Clear entry':k)+'</button>').join('')+'<small id="keypad-help">Use this on-screen keypad. Your entry is saved only with Save &amp; Next or Mark for Review &amp; Next.</small></div></div>';}
function renderPalette(){const start=STARTS[record.section];$('#legend').innerHTML=legend(record);$('#palette').innerHTML=record.responses.slice(start,start+COUNTS[record.section]).map((r,j)=>'<span class="palette-cell '+(record.current===start+j?'current':'')+'"><button data-question="'+(start+j)+'" class="badge '+Engine.status(r)+'" aria-current="'+(record.current===start+j)+'" aria-label="Question '+(j+1)+', '+statusLabels[Engine.status(r)]+'">'+(j+1)+'</button></span>').join('');}
function updateTimer(){if(view!=='exam'||!record)return;const ms=record.sectionDeadlines[record.section]-now();$('#timer').textContent=clockString(ms);if($('#mobile-timer'))$('#mobile-timer').textContent=clockString(ms);$('#timer-wrap').classList.toggle('urgent',ms<=300000);}
function render(){if(blocked)return;document.body.dataset.attemptState=record?.state||ATTEMPT_STATES.NOT_STARTED;if(!record){if(view!=='welcome')welcome();return;}if(TERMINAL.has(record.state)){if(view!=='results'){document.querySelectorAll('dialog').forEach(d=>d.close());results();}return;}
  if(view!=='exam'||renderedSection!==record.section){document.querySelectorAll('dialog').forEach(d=>d.close());examShell();}
  renderQuestion();renderPalette();updateTimer();
}
function showInfo(title,content){$('#info-title').textContent=title;$('#info-content').innerHTML=content;if(!$('#info-dialog').open)$('#info-dialog').showModal();}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());

function results(){view='results';const total=record.results.total;
  $('#main').innerHTML='<section class="results"><div class="result-head"><div><span class="result-tag">'+(record.state==='COMPLETED'?'EXAMINATION COMPLETED':'ATTEMPT EXPIRED')+' · READ-ONLY</span><h1>Your examination results</h1><p class="muted" style="margin-bottom:0">'+esc(record.reason)+'</p></div><div class="result-actions"><button id="export-json">Download result</button><button id="export-csv">Export responses</button><button id="print-results">Print results</button></div></div><div class="result-body"><div class="metrics"><div class="metric"><b>'+total.score+' <small>/ 204</small></b><span>Raw score</span></div><div class="metric"><b>'+total.attempted+' <small>/ 68</small></b><span>Attempted</span></div><div class="metric"><b>'+(total.accuracy===null?'—':total.accuracy.toFixed(1)+'%')+'</b><span>Accuracy on attempted questions</span></div><div class="metric"><b>'+total.correct+'</b><span>Correct answers</span></div></div><h2>Section performance</h2><div class="table-scroll"><table class="summary-table"><thead><tr><th>Section</th><th>Score</th><th>Attempted</th><th>Correct</th><th>Incorrect</th><th>Unattempted</th><th>Accuracy</th><th>Penalty</th></tr></thead><tbody>'+[...record.results.sections,total].map((s,i)=>'<tr><td>'+(SECTION_NAMES[i]||'Total')+'</td><td>'+s.score+' / '+s.max+'</td><td>'+s.attempted+'</td><td>'+s.correct+'</td><td>'+s.incorrect+'</td><td>'+s.unattempted+'</td><td>'+(s.accuracy===null?'—':s.accuracy.toFixed(1)+'%')+'</td><td>'+(s.negativeMarks?'−'+s.negativeMarks:'0')+'</td></tr>').join('')+'</tbody></table></div><div class="note">Raw score = 3 × correct answers − incorrect MCQs. Wrong TITA answers and unattempted questions score zero. Saved answers marked for review are included. Percentiles and scaled CAT scores cannot be inferred from this individual mock attempt.</div><div class="info-grid" style="margin-top:22px"><p><strong>Attempt ID</strong><br><span class="footer-meta">'+esc(record.id)+'</span><br><strong>Started:</strong> '+esc(dateString(record.startTimestamp))+'<br><strong>Closed:</strong> '+esc(dateString(record.endedAt))+'</p><p><strong>Response breakdown</strong><br>'+total.mcq+' MCQs and '+total.tita+' TITA questions attempted.<br>'+total.negativeMarks+' mark'+(total.negativeMarks===1?'':'s')+' deducted for incorrect MCQs.<br><span class="muted">Question times count visible interaction only; interruptions are excluded.</span></p></div><h2>Question-by-question review</h2><div class="filters"><label>Section<select id="section-filter"><option value="all">All sections</option>'+SECTION_NAMES.map((n,i)=>'<option value="'+i+'">'+n+'</option>').join('')+'</select></label><label>Outcome<select id="outcome-filter"><option value="all">All outcomes</option><option>Correct</option><option>Incorrect</option><option>Unattempted</option><option value="marked">Marked for review</option></select></label><button id="expand-solutions">Expand shown questions</button><button id="collapse-solutions">Collapse shown questions</button></div><div id="reviews"></div><div class="footer-meta">Paper revision: '+esc(DATA.version)+'<br>Source PDF SHA-256: '+esc(DATA.sourceSha256)+'</div>'+provenance()+'</div></section>';
  $('#section-filter').onchange=renderReviews;$('#outcome-filter').onchange=renderReviews;
  $('#expand-solutions').onclick=()=>document.querySelectorAll('.review-item').forEach(d=>{d.open=true;populateReview(d);});$('#collapse-solutions').onclick=()=>document.querySelectorAll('.review-item').forEach(d=>d.open=false);
  $('#print-results').onclick=()=>window.print();
  $('#export-json').onclick=()=>download('cat-2026-result-'+record.id.slice(0,8)+'.json','application/json',JSON.stringify({paper:DATA.title,revision:DATA.version,attemptId:record.id,state:record.state,startTimestamp:record.startTimestamp,sectionDeadlines:record.sectionDeadlines,endedAt:record.endedAt,reason:record.reason,results:record.results},null,2));
  $('#export-csv').onclick=()=>{const rows=[['Question','Section','Type','Saved response','Key','Outcome','Marks','Marked for review','Visible seconds'],...record.results.rows.map(r=>[r.number,SECTION_NAMES[r.section],r.type,r.response,r.key,r.outcome,r.marks,r.marked,Math.round(r.timeMs/1000)])];download('cat-2026-responses.csv','text/csv',rows.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\r\n'));};renderReviews();
}
function renderReviews(){const section=$('#section-filter').value,outcome=$('#outcome-filter').value;
  const rows=record.results.rows.filter(r=>(section==='all'||r.section===Number(section))&&(outcome==='all'||outcome==='marked'&&r.marked||outcome===r.outcome));
  $('#reviews').innerHTML=rows.length?rows.map(r=>'<details class="review-item" data-id="'+r.id+'"><summary><strong>'+SECTION_NAMES[r.section]+' · Q'+r.number+'</strong> <span class="'+r.outcome.toLowerCase()+'">'+r.outcome+' · '+(r.marks>0?'+':'')+r.marks+' marks</span> <span class="muted"> · '+r.type+(r.marked?' · Marked for review':'')+' · '+Math.round(r.timeMs/1000)+'s visible time</span></summary><div class="review-content"></div></details>').join(''):'<div class="empty">No questions match these filters.</div>';
  document.querySelectorAll('.review-item').forEach(d=>d.ontoggle=()=>{if(d.open)populateReview(d);});
}
function populateReview(d){if(d.dataset.loaded)return;d.dataset.loaded='true';const index=QUESTIONS.findIndex(q=>q.id===d.dataset.id),q=QUESTIONS[index],r=record.results.rows[index],context=DATA.contexts[q.context];
  d.querySelector('.review-content').innerHTML='<div class="answer-comparison"><span>Your saved answer: <strong>'+esc(r.response||'Unattempted')+'</strong></span><span>Correct answer: <strong>'+esc(q.answer)+'</strong></span><span>Student PDF · page '+q.page+'</span></div>'+(r.unsavedAtClose!==null?'<p class="note">Unsaved '+(r.unsavedAtClose===''?'cleared entry':'entry “'+esc(r.unsavedAtClose)+'”')+' was excluded when the section closed.</p>':'')+(q.note?'<p class="note">'+esc(q.note)+'</p>':'')+(context?'<details class="result-context"><summary>View passage / set: '+esc(context.title)+'</summary>'+context.html+'</details>':'')+q.html+(q.options.length?'<ol type="A">'+q.options.map((o,k)=>'<li class="'+(String.fromCharCode(65+k)===q.answer?'correct':'')+'">'+o+'</li>').join('')+'</ol>':'')+'<div class="solution"><h3>Worked solution</h3>'+q.solution+'</div>';
}
function download(name,type,content){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}

// Four-function calculator: immediate execution, no eval or executable expressions.
let calc={display:'0',acc:null,op:null,fresh:true,memory:0,lastOp:null,lastOperand:null,percent:null};
function calcNumber(n){if(!Number.isFinite(n)||Math.abs(n)>1e15){calc.display='Error';calc.fresh=true;calc.acc=null;calc.op=null;return;}calc.display=String(Number(n.toPrecision(12)));calc.fresh=true;}
function calculate(a,b,op){return op==='+'?a+b:op==='−'?a-b:op==='×'?a*b:op==='÷'?(b===0?NaN:a/b):b;}
function calcKey(k){let value=Number(calc.display);
  if(calc.percent!==null&&['+','−','×','÷','='].includes(k)){value=calc.percent*value/100;calc.percent=null;calcNumber(value);calc.fresh=false;}
  if(/^[0-9.]$/.test(k)){if(calc.fresh||calc.display==='Error'){calc.display=k==='.'?'0.':k;calc.fresh=false;}else if(!(k==='.'&&calc.display.includes('.'))&&calc.display.replace('-','').length<14)calc.display=calc.display==='0'&&k!=='.'?k:calc.display+k;}
  else if(k==='AC')calc={display:'0',acc:null,op:null,fresh:true,memory:calc.memory,lastOp:null,lastOperand:null,percent:null};
  else if(k==='CE'){calc.display='0';calc.fresh=true;}
  else if(k==='⌫'){if(!calc.fresh)calc.display=calc.display.length>1?calc.display.slice(0,-1):'0';if(calc.display==='-')calc.display='0';}
  else if(k==='MC')calc.memory=0;
  else if(k==='MR')calcNumber(calc.memory);
  else if(Number.isFinite(value)){
    if(k==='MS')calc.memory=value;
    else if(k==='M+')calc.memory+=value;
    else if(k==='M−')calc.memory-=value;
    else if(k==='±'){calc.display=String(-value);}
    else if(k==='√')calcNumber(Math.sqrt(value));
    else if(k==='1/x')calcNumber(value===0?NaN:1/value);
    else if(k==='%'){calc.percent=calc.percent!==null?calc.percent*value/100:value;calc.fresh=true;}
    else if(['+','−','×','÷'].includes(k)){if(calc.op&&!calc.fresh)calcNumber(calculate(calc.acc,value,calc.op));calc.acc=Number(calc.display);calc.op=k;calc.fresh=true;calc.lastOp=null;}
    else if(k==='='){if(calc.op){calc.lastOp=calc.op;calc.lastOperand=value;calcNumber(calculate(calc.acc,value,calc.op));calc.acc=null;calc.op=null;}else if(calc.lastOp)calcNumber(calculate(value,calc.lastOperand,calc.lastOp));}
  }
  $('#calc-display').textContent=calc.display;$('#calc-memory').textContent=calc.memory!==0?'M · '+Number(calc.memory.toPrecision(10)):'Memory empty';$('#calc-operation').textContent=calc.percent!==null?(calc.op?calc.acc+' '+calc.op+' ':'')+calc.percent+' %':calc.op?calc.acc+' '+calc.op:'Basic calculator';
}
$('#calc-grid').innerHTML=['MC','MR','M+','M−','AC','CE','⌫','÷','7','8','9','×','4','5','6','−','1','2','3','+','±','0','.','=','√','1/x','%','MS'].map(k=>'<button data-calc="'+k+'" class="'+(k==='='?'eq':'')+'" aria-label="'+({'⌫':'Calculator backspace','AC':'All clear','CE':'Clear entry','MS':'Memory store','1/x':'Reciprocal','MR':'Memory recall','MC':'Memory clear','M+':'Memory add','M−':'Memory subtract','√':'Square root','±':'Change sign','%':'Percentage'}[k]||k)+'">'+(k==='AC'?'C':k)+'</button>').join('');
$('#calc-grid').onclick=e=>{const b=e.target.closest('[data-calc]');if(b)calcKey(b.dataset.calc);};
let drag=null;$('#calc-handle').onpointerdown=e=>{if(e.target.closest('button'))return;const rect=$('#calculator').getBoundingClientRect();drag={x:e.clientX-rect.left,y:e.clientY-rect.top};e.currentTarget.setPointerCapture(e.pointerId);};
$('#calc-handle').onpointermove=e=>{if(!drag)return;const dialog=$('#calculator');dialog.style.left=Math.max(0,Math.min(innerWidth-dialog.offsetWidth,e.clientX-drag.x))+'px';dialog.style.top=Math.max(0,Math.min(innerHeight-dialog.offsetHeight,e.clientY-drag.y))+'px';dialog.style.right='auto';};
$('#calc-handle').onpointerup=()=>drag=null;
document.addEventListener('visibilitychange',()=>{lastPulse=performance.now();pulse();});
window.addEventListener('pageshow',()=>{if(db)pulse();});
window.addEventListener('storage',async e=>{if(e.key!==KEY||!db||blocked||busy)return;if(!record){try{const res=await transaction(r=>({record:mergeStored(r,readMirror()),write:false}));if(res.record){record=res.record;render();await pulse();}}catch(error){fatal(error);}}else pulse();});
window.addEventListener('beforeunload',e=>{if(record?.state==='IN_PROGRESS'){e.preventDefault();e.returnValue='';}});
boot();
