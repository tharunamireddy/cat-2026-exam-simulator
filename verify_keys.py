"""Independent arithmetic and exhaustive checks from student-paper constraints."""
from itertools import permutations,product
from fractions import Fraction as F
from math import sqrt,isqrt
import json
from pathlib import Path

checks=[]
def check(label,value,expected):
    assert value==expected,(label,value,expected)
    checks.append({'check':label,'result':str(value)})

net=[(2,-3,1),(-3,4,-3),(2,-5,1),(-5,3,-3)]
def ledger(x,changed=False):
    a,b,c=x,24-x,12; rows=[]; dirs=[]
    for i,(da,db,dc) in enumerate(net):
        a+=da;b+=db;c+=dc
        assert min(a,b,c)>=0
        if a >= (11 if changed and i==2 else 12): a-=3;b+=3;dirs.append('AB')
        else: b-=2;a+=2;dirs.append('BA')
        assert min(a,b,c)>=0
        if b>=10: b-=2;c+=2
        else: c-=1;b+=1
        assert min(a,b,c)>=0
        rows.append((a,b,c))
    return rows,dirs
fits=[]
for x in range(8,19):
    rows,_=ledger(x)
    if rows[1][0]==9 and rows[2][2]==11: fits.append(x)
check('DILR 1 unique initial inventory',fits,[16])
rows,dirs=ledger(16)
check('DILR 2 transfer directions',dirs,['AB','AB','BA','BA'])
check('DILR 3 final B',rows[-1][1],10)
check('DILR 4 full ledger',rows,[(15,9,12),(9,14,11),(13,8,11),(10,10,7)])
check('DILR 5 counterfactual final C',ledger(16,True)[0][-1][2],13)

edges={a:int(b) for a,b in [s.split(':') for s in 'AB:3 AC:4 AD:7 BC:2 BD:3 BE:8 CB:1 CD:2 CE:6 CF:9 DE:3 DF:5 EC:2 EF:3 FE:2'.split()]}
def paths(start,dest,closed=()):
    out=[]
    def rec(p,cost):
        if p[-1]==dest: out.append((p,cost,set(p[i:i+2] for i in range(len(p)-1))));return
        for edge,v in edges.items():
            if edge[0]==p[-1] and edge[1] not in p and edge not in closed: rec(p+edge[1],cost+v)
    rec(start,0);return out
def feasible(closed=()):
    return sorted((max(a[1],b[1]),a[1]+b[1],a[0],b[0]) for a,b in product(paths('A','E',closed),paths('B','F',closed)) if not a[2]&b[2])
f=feasible()
check('DILR 6/7 optimum',f[0],(9,17,'ACDE','BDF'))
check('DILR 8 qualifying route pairs',sum(r[0]<=9 for r in f),2)
check('DILR 9 closed DE',feasible(('DE',))[0],(10,18,'ACE','BDF'))
check('DILR 10 closed DE and DF',feasible(('DE','DF'))[0][:2],(11,21))

# Recover all sales cells directly from linear constraints; test every provided total.
a=F(80,1)/F(5,2);b=a*F(3,2);d=(150-b+8)/2;e=d-10;h=d+2;g=150-a-d;i=190-g-h;f=160-d-e
sales=[[a,b,40],[d,e,f],[g,h,i]]
check('DILR 11 February C',h,57)
check('DILR sales row totals',[sum(r) for r in sales],[120,160,190])
check('DILR sales column totals',[sum(r[c] for r in sales) for c in range(3)],[150,150,170])
delta=[[6,-4,8],[4,5,-3],[0,-6,5]];stock=[10,15,12];prod=[[s+t for s,t in zip(r,z)] for r,z in zip(sales,delta)]
for c in range(3):
    stock=[v+delta[j][c] for j,v in enumerate(stock)];assert min(stock)>=0
check('DILR 12 production ratio',prod[2][2]/prod[1][1],F(3,2))
check('DILR 13 true option B',(15+4+5,sum(r[2] for r in prod)),(24,180))
check('DILR 14 reallocation capacity',stock[2],11)

def schedules(conditional=True,adj=False):
    result=[]
    for order in permutations('ABCDEF'):
        a,b,c,d,e,f=[order.index(v) for v in 'ABCDEF']
        if a<c and b-d==2 and abs(a-e)==1 and (not conditional or c<=b or f<a) and abs(a-f)>=3 and ((abs(c-d)==1)==adj):result.append(''.join(order))
    return result
check('DILR 15 schedule',schedules(),['DFBEAC'])
check('DILR 16 Y workshops',''.join(sorted(schedules()[0][j] for j in [1,4])),'AF')
check('DILR 17 without implication',len(schedules(False)),2)
check('DILR 18 C with X',sum(o.index('C') in [0,3] for o in schedules(adj=True)),2)
r1=(5,3,1,4,2);valid=[]
for r2,r3 in product(permutations(range(1,6)),repeat=2):
    totals=[a+b+c for a,b,c in zip(r1,r2,r3)]
    if r2[1]+r3[3]==10 and totals[2]==totals[3]-1 and r2[0]+r3[1]==6 and r3[0]==1:valid.append((r2,r3,totals))
check('DILR 19 unique round 2',[(x[0]) for x in valid],[(3,5,4,1,2)])
r2,r3,totals=valid[0]
check('DILR 20 totals',totals,[9,11,9,10,6])
w=sorted([a+2*b+3*c for a,b,c in zip(r1,r2,r3)],reverse=True)
check('DILR 21 weighted difference',w[0]-w[2],1)
r3=list(r3);r3[0],r3[3]=r3[3],r3[0]
check('DILR 22 changed totals',[a+b+c for a,b,c in zip(r1,r2,r3)],[13,11,9,6,6])

check('QA 1 transferred average',F(20*78-6*85,14),75)
check('QA 2 profit',((F(6804,1)/F(105,100))/6000-1)*100,8)
t=F(1,3)/(F(1,12)+F(1,18)+F(1,24));check('QA 3 B share',(3+t)/18,F(7,26))
check('QA 4 replacement',round(sqrt(160),2),12.65)
check('QA 5 price',F(53200*125//100-20*625-8*450,72),700)
check('QA 6 average',F(120,1)/(4-F(60,40)),48)
check('QA 7 root products',[a*b for a in range(1,50) for b in range(a+1,50) if b-a==5 and a*b%4==0 and a+b==a*b//4+5],[24])
func=lambda x:x*x+2*x
check('QA 8 functional value',4*(func(F(5,2))-func(F(1,2))),40)
check('QA 9 logarithm ratio',2**(4-2),4)
check('QA 10 AP/GP',[a*c for a in range(1,8) for c in range(9,24) if a+8+c==24 and 64==a*(c+4)],[48])
check('QA 11 minimizers',sum(x for x in range(-100,101) if max(abs(x-2)+abs(x-8),2*abs(x-5)+4)==6),15)
check('QA 12 admissible roots',sum(x for x in [1,2,6] if abs(x*x-5*x+4)==2*x-2),9)
check('QA 13 reciprocal roots',sum(F(1,r+1) for r in [2,4,6]),F(71,105))
check('QA 14 tangent distance',(10-F(30,12))**2,F(225,4))
check('QA 15 subtriangle',F(15,2)*F(36,22)*11,135)
check('QA 16 trapezoid',F(30,6)*(9+6+6+4),125)
check('QA 17 material cost',2*5**2+F(500,5),150)
check('QA 18 least congruent integer',next(n for n in range(11,10000,11) if n%5==2 and n%7==3 and n%9==4),2992)
def divisors(n):return sum(n%d==0 for d in range(1,n+1))
check('QA 19 least square multiple',next(12*k*k for k in range(1,100) if (12*k*k)%5 and divisors(12*k*k)==18),588)
check('QA 20 triples',sum(1 for x in range(2,19,2) for y in range(1,19) if 18-x-y>y and (x+2*y)%3==0),7)
check('QA 21 arrangements',sum(all(a!=b for a,b in zip(p,p[1:])) and p.index('A')<p.index('B') and p[-1]!='C' for p in set(permutations('AABBCC'))),10)
dp={(0,0,False):1}
for x in range(7):
    for y in range(6):
        if (x,y)==(0,0):continue
        if (x,y) in [(2,1),(4,3)]:continue
        for hit in [False,True]:
            count=dp.get((x-1,y,hit),0)+dp.get((x,y-1,hit),0)
            key=(x,y,hit or (x,y)==(3,2));dp[key]=dp.get(key,0)+count
check('QA 22 lattice routes',dp[(6,5,True)],32)
Path(__file__).with_name('key-verification.json').write_text(json.dumps(checks,indent=2))
print(f'{len(checks)} arithmetic / exhaustive checks passed. All 44 DILR and QA keys agree.')
