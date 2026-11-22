const SECTION_MS = 40 * 60 * 1000;
const SECTION_NAMES = ['VARC','DILR','QA'];
const SECTION_TITLES = ['Verbal Ability & Reading Comprehension','Data Interpretation & Logical Reasoning','Quantitative Ability'];
const STARTS = [0,24,46];
const COUNTS = [24,22,22];
const TERMINAL = new Set(['COMPLETED','EXPIRED']);
const ATTEMPT_STATES = Object.freeze({NOT_STARTED:'NOT_STARTED',IN_PROGRESS:'IN_PROGRESS',COMPLETED:'COMPLETED',EXPIRED:'EXPIRED'});
const Engine = (() => {
  const numeric = v => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v);
  function canonical(v) {
    let s=String(v).trim(), neg=s[0]==='-'; s=s.replace(/^[+-]/,'');
    let [whole,frac='']=s.split('.'); whole=(whole||'0').replace(/^0+(?=\d)/,''); frac=frac.replace(/0+$/,'');
    return (neg && (whole!=='0'||frac)?'-':'')+whole+(frac?'.'+frac:'');
  }
  function status(r) { return r.answer!=='' ? (r.marked?'answered-review':'answered') : r.marked?'review':r.visited?'unanswered':'unvisited'; }
  function score(record, questions) {
    const rows=questions.map((q,i)=>{
      const r=record.responses[i], attempted=r.answer!=='';
      const correct=attempted && (q.match==='number' ? numeric(r.answer)&&canonical(r.answer)===canonical(q.answer) : r.answer===q.answer);
      return {id:q.id,section:q.section,number:q.number,type:q.type,response:r.answer,key:q.answer,attempted,correct,
        outcome:!attempted?'Unattempted':correct?'Correct':'Incorrect',marks:!attempted?0:correct?3:q.type==='MCQ'?-1:0,
        marked:r.marked,visited:r.visited,timeMs:r.timeMs,unsavedAtClose:r.unsavedAtClose??null};
    });
    function aggregate(rs) {
      const attempted=rs.filter(r=>r.attempted).length,correct=rs.filter(r=>r.correct).length;
      return {questions:rs.length,attempted,correct,incorrect:attempted-correct,unattempted:rs.length-attempted,
        score:rs.reduce((s,r)=>s+r.marks,0),max:rs.length*3,accuracy:attempted?100*correct/attempted:null,
        negativeMarks:rs.filter(r=>r.marks<0).length,mcq:rs.filter(r=>r.type==='MCQ'&&r.attempted).length,
        tita:rs.filter(r=>r.type==='TITA'&&r.attempted).length,timeMs:rs.reduce((s,r)=>s+r.timeMs,0)};
    }
    return {rows,sections:[0,1,2].map(s=>aggregate(rows.filter(r=>r.section===s))),total:aggregate(rows)};
  }
  function create(id,now,questions) {
    return {schema:1,paper:DATA.version,id,state:'IN_PROGRESS',revision:1,startTimestamp:now,
      sectionDeadlines:[1,2,3].map(i=>now+i*SECTION_MS),lastSeen:now,lastWall:Date.now(),current:0,section:0,
      draft:'',responses:questions.map((q,i)=>({answer:'',marked:false,visited:i===0,timeMs:0,saves:0})),
      sectionClosed:[false,false,false],sectionEndedAt:[null,null,null],endedAt:null,results:null,
      reason:null,events:[{at:now,type:'START'}]};
  }
  function log(r,type,now,details={}) { r.events.push({at:now,type,...details});if(r.events.length>1000)r.events.splice(1,1); }
  function discard(r,atClose=false) { if(atClose&&r.draft!==r.responses[r.current].answer) r.responses[r.current].unsavedAtClose=r.draft; r.draft=r.responses[r.current].answer; }
  function finish(r,now,kind,questions,reason) {
    if(TERMINAL.has(r.state))return;
    discard(r,true);r.state=kind;r.endedAt=Math.min(now,r.sectionDeadlines[2]);r.reason=reason;
    r.sectionClosed=[true,true,true];r.sectionEndedAt=r.sectionEndedAt.map((t,i)=>t??Math.min(now,r.sectionDeadlines[i]));
    r.results=score(r,questions);r.revision++;log(r,kind,now,{reason});
  }
  function reconcile(r,now,questions,live=false,rollback=false) {
    if(!r||TERMINAL.has(r.state))return false;
    if(rollback){finish(r,now,'EXPIRED',questions,'The system clock moved backwards. The attempt was closed to preserve its time limit.');return true;}
    if(now>=r.sectionDeadlines[2]) {
      const completed=live&&now-r.lastSeen<5000&&now-r.sectionDeadlines[2]<5000;
      finish(r,r.sectionDeadlines[2],completed?'COMPLETED':'EXPIRED',questions,completed?'Automatically submitted at the examination deadline.':'The examination deadline elapsed while the session was interrupted.');return true;
    }
    const section=now>=r.sectionDeadlines[1]?2:now>=r.sectionDeadlines[0]?1:0;
    if(section>r.section){
      discard(r,true);
      for(let i=r.section;i<section;i++){r.sectionClosed[i]=true;r.sectionEndedAt[i]=r.sectionDeadlines[i];log(r,'SECTION_CLOSED',r.sectionDeadlines[i],{section:i});}
      r.section=section;r.current=STARTS[section];r.responses[r.current].visited=true;r.draft=r.responses[r.current].answer;r.revision++;
      return true;
    }
    return false;
  }
  function act(r,action,now,questions) {
    if(TERMINAL.has(r.state))return {changed:false};
    if(reconcile(r,now,questions)) return {changed:true,notice:'The previous section has closed.'};
    const q=questions[r.current], response=r.responses[r.current];
    if(action.type==='DRAFT') {
      let v=String(action.value);
      if(q.type==='MCQ'&&!/^[ABCD]?$/.test(v))throw Error('Invalid option.');
      if(q.type==='TITA'&&(!/^-?[\d.]*$/.test(v)||v.length>16||(v.match(/\./g)||[]).length>1))throw Error('Use the numeric keypad to enter an answer.');
      r.draft=v;
    } else if(action.type==='CLEAR')r.draft='';
    else if(action.type==='NAV'){
      if(!Number.isInteger(action.index)||questions[action.index]?.section!==r.section)throw Error('Only the current section is available.');
      discard(r);r.current=action.index;r.responses[r.current].visited=true;r.draft=r.responses[r.current].answer;
    } else if(action.type==='SAVE'||action.type==='MARK') {
      if(q.type==='TITA'&&r.draft!==''&&!numeric(r.draft))throw Error('Enter a complete number, or clear the response.');
      response.answer=r.draft;response.marked=action.type==='MARK';response.visited=true;response.saves++;
      log(r,action.type,now,{question:q.id});
      const end=STARTS[r.section]+COUNTS[r.section]-1;
      if(r.current<end)r.current++;
      r.responses[r.current].visited=true;r.draft=r.responses[r.current].answer;
    } else throw Error('Unsupported action.');
    r.revision++;return {changed:true};
  }
  function validate(r,questions) {
    if(!r||r.schema!==1||r.paper!==DATA.version||typeof r.id!=='string'||!r.id||!['IN_PROGRESS','COMPLETED','EXPIRED'].includes(r.state))throw Error('The saved attempt record is invalid or belongs to a different paper.');
    if(!Number.isFinite(r.startTimestamp)||!Number.isInteger(r.revision)||r.revision<1||!Array.isArray(r.sectionDeadlines)||r.sectionDeadlines.length!==3||r.sectionDeadlines.some((t,i)=>t!==r.startTimestamp+(i+1)*SECTION_MS))throw Error('The saved examination deadlines are invalid.');
    if(!Number.isInteger(r.section)||r.section<0||r.section>2||!Number.isInteger(r.current)||questions[r.current]?.section!==r.section||!Array.isArray(r.responses)||r.responses.length!==questions.length||typeof r.draft!=='string'||!Number.isFinite(r.lastSeen)||!Number.isFinite(r.lastWall))throw Error('The saved response record is invalid.');
    r.responses.forEach((v,i)=>{if(typeof v.answer!=='string'||typeof v.visited!=='boolean'||typeof v.marked!=='boolean'||!Number.isFinite(v.timeMs)||v.timeMs<0||(v.answer!==''&&(questions[i].type==='MCQ'?!/^[ABCD]$/.test(v.answer):!numeric(v.answer))))throw Error('A saved response is invalid.');});
    if(TERMINAL.has(r.state)&&(!r.results||JSON.stringify(r.results)!==JSON.stringify(score(r,questions))))throw Error('The saved final result failed its consistency check.');
    return r;
  }
  return {create,act,reconcile,finish,score,status,validate,numeric,canonical};
})();
