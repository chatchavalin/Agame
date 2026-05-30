const fs=require('fs'),vm=require('vm');const path='/home/claude/Agame/js/';
const s={};s.self=s;s.window=s;s.globalThis=s;s.console={log:console.log};s.Date=Date;s.Math=Math;s.importScripts=function(){};
vm.createContext(s);
for(const f of ['constants.js','utils.js','evaluator.js'])vm.runInContext(fs.readFileSync(path+f,'utf8'),s,{filename:f});
const ev=s.AMath.evaluator;const validate=(faces)=>ev.validateEquation(faces).valid;
const NUMS=['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20'];
const DIGITS=['0','1','2','3','4','5','6','7','8','9'];const NUMSET=new Set(NUMS);const OPS=['+','-','×','÷'];const ALLFACES=[].concat(NUMS,OPS,['=']);
function frac(arr){const t=ev.tokenize(arr);if(t.error||!t.tokens)return null;const r=ev.evaluateSegment(t.tokens);return r.ok?r.value:null;}
function isDigit(f){return f!==null&&/^[0-9]$/.test(f);}
function solveOneHole(faces,holeIdx){const eq=faces.indexOf('=');if(eq<0)return null;function g(x){const t=faces.slice();t[holeIdx]=String(x);const L=frac(t.slice(0,eq)),R=frac(t.slice(eq+1));if(!L||!R)return null;return L.num*R.den-R.num*L.den;}const g0=g(0),g1=g(1);if(g0===null||g1===null)return null;const m=g1-g0;if(m===0)return null;if((-g0)%m!==0)return null;const x=(-g0)/m;return NUMSET.has(String(x))?String(x):null;}
function skeletonSolve(template){const blanks=[];template.forEach((t,i)=>{if(t===null)blanks.push(i);});const results=new Set();
  function rec(bi,faces){if(bi===blanks.length){if(validate(faces))results.add(faces.join(' '));return;}
    const idx=blanks[bi];const adjDigit=isDigit(faces[idx-1])||isDigit(faces[idx+1]);
    for(const r of [].concat(OPS,['='])){const f2=faces.slice();f2[idx]=r;rec(bi+1,f2);}
    if(adjDigit){for(const d of DIGITS){const f2=faces.slice();f2[idx]=d;rec(bi+1,f2);}}
    else if(bi===blanks.length-1){const f2=faces.slice();f2[idx]='?';const v=solveOneHole(f2,idx);if(v){f2[idx]=v;rec(bi+1,f2);}else{for(const num of NUMS){const f3=faces.slice();f3[idx]=num;rec(bi+1,f3);}}}
    else {for(const num of NUMS){const f2=faces.slice();f2[idx]=num;rec(bi+1,f2);}}}
  rec(0,template.slice());return results;}
function brute(template){const blanks=[];template.forEach((t,i)=>{if(t===null)blanks.push(i);});const results=new Set();
  function rec(bi,faces){if(bi===blanks.length){if(validate(faces))results.add(faces.join(' '));return;}for(const f of ALLFACES){const f2=faces.slice();f2[blanks[bi]]=f;rec(bi+1,f2);}}
  rec(0,template.slice());return results;}
function rnd(a){return a[Math.floor(Math.random()*a.length)];}
for(const NB of [1,2,3]){
  let mism=0,tSk=0,tBr=0,iters=NB===3?3000:8000;
  for(let it=0;it<iters;it++){
    const len=6+Math.floor(Math.random()*4);const tmpl=[];for(let i=0;i<len;i++)tmpl.push(rnd(ALLFACES));
    const pos=[];while(pos.length<NB){const p=Math.floor(Math.random()*len);if(!pos.includes(p))pos.push(p);}pos.forEach(p=>tmpl[p]=null);
    let a=Date.now();const B=brute(tmpl);tBr+=Date.now()-a;a=Date.now();const S=skeletonSolve(tmpl);tSk+=Date.now()-a;
    for(const b of B){if(!S.has(b)){mism++;break;}}
    for(const x of S){if(!B.has(x)){console.log('EXTRA',x);break;}}
  }
  console.log(NB+'-blank:',iters,'templates | MISSES:',mism,'| speedup',(tBr/tSk).toFixed(1)+'x');
}
