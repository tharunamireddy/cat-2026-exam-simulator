from pathlib import Path
from pypdf import PdfReader
import re,json,html,hashlib

root=Path(__file__).parent
pdf=Path('/Users/tharunreddy/Downloads/CAT_2026_ADVANCED_FULL_MOCK_STUDENT_REVISED.pdf')
reader=PdfReader(pdf)
pages=[]
for p in reader.pages:
    t=p.extract_text(extraction_mode='layout')
    t=re.sub(r'\n*CAT 2026 Advanced Challenge Mock \| Unofficial practice material[^\n]*','',t)
    pages.append(t.strip())
text='\n\n'.join(pages)
text='\n'.join(x.strip() for x in text.splitlines())
text=re.sub(r'\n{3,}','\n\n',text)
for a,b in {'totalextraction':'total extraction','controlwhile':'control while','thattrading':'that trading','mayreduce':'may reduce','notvisible':'not visible'}.items(): text=text.replace(a,b)
text=text.replace('\\[W = R_1 + 2R_2 + 3R_3,\\]','W = R₁ + 2R₂ + 3R₃').replace('\\(R_1,R_2,R_3\\)','R₁, R₂, R₃')
root.joinpath('clean-student.txt').write_text(text)

def rich(t):
    """Reflow text, preserving numbered paragraphs and actual PDF table rows."""
    blocks=re.split(r'\n\s*\n',t.strip())
    out=[]; table=[]
    def flush():
        if table:
            out.append('<div class="table-scroll"><table>'+''.join('<tr>'+''.join('<'+('th' if i==0 else 'td')+'>'+html.escape(c)+'</'+('th' if i==0 else 'td')+'>' for c in row)+'</tr>' for i,row in enumerate(table))+'</table></div>')
            table.clear()
    for b in blocks:
        if re.search(r'\S {3,}\S',b):
            table.extend([re.split(r' {3,}',l.strip()) for l in b.splitlines()])
        else:
            flush(); out.append('<p>'+html.escape(' '.join(b.splitlines()))+'</p>')
    flush()
    return ''.join(out)

sections={}
for name in ['VARC','DILR','QA']:
    sections[name]=text.split('SECTION: '+name,1)[1].split('SECTION:',1)[0]
keys={
'VARC':'B A C A C B D D B A C D B B C D C C B B 3 3 2413 2314'.split(),
'DILR':'16 A 10 B 13 9 B 2 B 11 57 B B 11 A B 2 2 35412 B 1 A'.split(),
'QA':'B 8 A 12.65 C 48 B 40 B 48 C 9 B B 135 C 150 A 588 B 10 C'.split()}
contexts={}; qs=[]
va_stops=['Original practice material','Original hard-leaning practice material','Paragraph summaries','Odd sentence out','Para-jumbles']
for si,(name,sec) in enumerate(sections.items()):
    matches=list(re.finditer(r'^Q(\d+)(?:\. | \()(.*)$',sec,re.M))
    assert len(matches)==[24,22,22][si],(name,len(matches))
    for ix,m in enumerate(matches):
        n=int(m[1]); end=matches[ix+1].start() if ix+1<len(matches) else len(sec)
        raw=sec[m.start():end].strip(); context=None
        if name=='VARC' and n<=16:
            passage=list(re.finditer(r'^Passage: (.+)\n',sec[:m.start()],re.M))[-1]
            context='V'+str((n-1)//4+1)
            content=sec[passage.end():].split('\nQuestions',1)[0]
            contexts[context]={'title':passage[1],'html':rich(content)}
        if name=='DILR':
            st=list(re.finditer(r'^CAT 2026 Advanced DILR — Set (\d) \(Q[^\n]*\)\n',sec[:m.start()],re.M))[-1]
            context='D'+st[1]
            content=sec[st.end():matches[[int(x[1]) for x in matches].index([1,6,11,15,19][int(st[1])-1])].start()].strip()
            content=re.sub(r'^Suggested time:[^\n]*\n','',content).strip()
            title,content=content.split('\n',1)
            contexts[context]={'title':title,'html':rich(content)}
            raw=re.split(r'\nCAT 2026 Advanced DILR|\nResponse format:',raw)[0]
        if name=='VARC':
            for stop in va_stops: raw=raw.split('\n'+stop)[0]
        if name=='QA': raw=raw.split('\nOriginal practice questions.')[0].split('\nOriginal CAT-style practice.')[0]
        raw=re.sub(r'^Q\d+(?:\. | )','',raw)
        kind='MCQ' if keys[name][ix] in 'ABCD' else 'TITA'
        # Keep QA topic as metadata; question prose starts after the heading.
        topic='Reading comprehension' if context and name=='VARC' else 'Verbal ability' if name=='VARC' else contexts[context]['title'] if context else ''
        if name=='QA': topic,raw=raw.split('\n',1); topic=re.sub(r'\s*\((MCQ|TITA)\).*','',topic)
        raw=re.sub(r'^\[.*?\]\s*|^\((?:MCQ|TITA)\)\s*','',raw).strip()
        opts=re.split(r'^([ABCD])\. ',raw,flags=re.M)
        body=opts[0].strip(); options=[]
        if kind=='MCQ':
            assert len(opts)==9,(name,n,opts)
            options=[rich(opts[i+1].strip()) for i in range(1,9,2)]
        else: assert len(opts)==1,(name,n)
        # Identify the source page from its question heading (before section reset).
        pnos=[]
        for pno,p in enumerate(pages,1):
            if re.search(r'(?m)^\s*Q'+str(n)+r'(?:\. | \()',p) and ([2<=pno<=12,13<=pno<=19,20<=pno<=23][si]): pnos.append(pno)
        qs.append({'id':name+'-'+str(n),'section':si,'number':n,'type':kind,'topic':topic,'context':context,'html':rich(body),'options':options,'answer':keys[name][ix], 'match':'sequence' if (name=='VARC' and n>=23) or (name=='DILR' and n==19) else 'number' if kind=='TITA' else 'option','page':pnos[0] if pnos else None})

md=Path('/Users/tharunreddy/Downloads/CAT_2026_ADVANCED_FULL_MOCK_SOLUTIONS_REVISED.md').read_text()
solsecs=[md.split('# SECTION: '+name,1)[1].split('# SECTION:',1)[0] for name in ['VARC','DILR','QA']]
for q in qs:
    si,n=q['section'],q['number']; sec=solsecs[si]
    if si==1:
        # Full derivation accompanies each question, including the shared data reconstruction.
        sets=re.split(r'^# CAT 2026 Advanced DILR — Set \d[^\n]*\n',sec,flags=re.M)[1:]
        q['solutionMarkdown']=sets[int(q['context'][1])-1].split('## Independent computational enumeration')[0].split('## Editorial verification')[0].split('## Quality controls')[0].split('## Verification method')[0].split('## Verification status')[0].strip()
    else:
        m=re.search(r'^#{2,3} Q'+str(n)+r' —[^\n]*\n',sec,re.M)
        assert m,(si,n)
        end=re.search(r'^#{1,3} |^---',sec[m.end():],re.M)
        q['solutionMarkdown']=sec[m.end():m.end()+end.start() if end else len(sec)].strip()
    if q['id']=='VARC-2': q['note']='Source-key caution: A is the intended answer. C also describes intervention-contaminated validation; the ranking of these distractors remains an editorial judgment. This simulator follows the supplied key and flags the issue for review.'
assert len(qs)==68 and all(q['page'] and q['solutionMarkdown'] for q in qs)
data={'title':'CAT 2026 · Advanced Full Mock','version':'revised-2026-11-22','sourceSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'contexts':contexts,'questions':qs}
root.joinpath('data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
print('Extracted',len(qs),'questions,',len(contexts),'contexts;',sum(q['type']=='MCQ' for q in qs),'MCQ,',sum(q['type']=='TITA' for q in qs),'TITA')
for name in sections:
    print(name,[(q['number'],q['type'],q['answer'],q['page']) for q in qs if q['id'].startswith(name+'-')])
