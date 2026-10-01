(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('canvas'), viewport = $('viewport'), ctx = canvas.getContext('2d');
  const els = {
    distribution: $('distributionInput'), count: $('countInput'), seed: $('seedInput'),
    leaderFraction: $('leaderFractionInput'), leaderCap: $('leaderCapInput'), cmax: $('cmaxInput'), cmin: $('cminInput'), f0: $('f0Input'), f1: $('f1Input'),
    knn: $('knnInput'), bits: $('bitsInput'), degree: $('degreeInput'), alpha: $('alphaInput'), final: $('finalCheck'),
    first: $('firstBtn'), prev: $('prevBtn'), play: $('playBtn'), next: $('nextBtn'), last: $('lastBtn'),
    stepCount: $('stepCount'), progress: $('progressFill'), phase: $('phase'), title: $('stepTitle'), text: $('stepText'),
    leaves: $('statLeaves'), candidates: $('statCandidates'), edges: $('statEdges'), avgDegree: $('statDegree'), pipeline: $('pipeline'),
    focusStatus: $('focusStatus'), focusDot: $('focusDot'), focusName: $('focusName'), focusSub: $('focusSub'), focusList: $('focusList')
  };

  const LIGHT_LEAVES = ['#2d765d','#547aa5','#d39a32','#9b6baa','#df7a52','#4b9ca2','#b85d71','#7a8f43','#8a6b4b','#6178b8','#c6573e','#397d83'];
  const DARK_LEAVES = ['#57d4d0','#629de0','#f5b85a','#af91f4','#f0787f','#74d99f','#eb85cf','#a4c95c','#e99b60','#73c0ea','#c88bf0','#e27970'];
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  const leafPalette = () => isDark() ? DARK_LEAVES : LIGHT_LEAVES;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const key = (a,b) => `${a}>${b}`;
  const unique = values => [...new Set(values)];

  let params = {}, points = [], leaves = [], memberships = [], leafTrees = [];
  let candidateEdges = [], hashEdges = [], finalEdges = [], hashDeleted = [], finalDeleted = [];
  let step = 0, selected = null, timer = null, drag = null, dpr = 1;
  let view = {w:1,h:1,s:1,ox:0,oy:0,fitScale:1};

  const stages = [
    {phase:'Input',title:'Start with the vector dataset',text:'PiPNN builds a navigation graph without performing beam searches during construction.'},
    {phase:'Partition',title:'Return the recursive ball-carving leaves',text:''},
    {phase:'Leaf build',title:'Compute local bidirected k-NN edges',text:'Inside every completed leaf, PiPNN computes an all-pairs distance matrix and extracts a sparse bidirected k-NN graph.'},
    {phase:'Online prune',title:'Stream candidates through HashPrune',text:'Residual hashes preserve directional diversity while each point keeps a bounded reservoir.'},
    {phase:'Final prune',title:'Apply RobustPrune to each short adjacency list',text:'The optional final pass uses α to remove additional redundant edges and improve query throughput.'},
    {phase:'Output',title:'Return the searchable navigation graph',text:'The result combines nearby edges with directional coverage—without the incremental-search bottleneck.'}
  ];

  function rng(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  function gaussian(r){const u=Math.max(r(),1e-9);return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*r());}
  function shuffle(values,r){const out=values.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}

  function samplePoint(mode,i,n,r){
    let x=0,y=0;
    if(mode==='clusters'){const centers=[[-.48,-.34],[.43,-.30],[-.18,.43],[.46,.35]],c=centers[i%centers.length];x=c[0]+gaussian(r)*.14;y=c[1]+gaussian(r)*.14;}
    else if(mode==='square'){x=(r()*2-1)*.82;y=(r()*2-1)*.82;}
    else if(mode==='disk'){const a=2*Math.PI*r(),radius=.82*Math.sqrt(r());x=Math.cos(a)*radius;y=Math.sin(a)*radius;}
    else if(mode==='ring'){const a=2*Math.PI*r(),radius=.66+(r()-.5)*.16;x=Math.cos(a)*radius;y=Math.sin(a)*radius;}
    else if(mode==='spiral'){const t=i/Math.max(n-1,1)*Math.PI*4.5+(r()-.5)*.28,radius=.08+i/Math.max(n-1,1)*.7+(r()-.5)*.05;x=Math.cos(t)*radius;y=Math.sin(t)*radius;}
    else if(mode==='grid'){const side=Math.ceil(Math.sqrt(n)),row=Math.floor(i/side),col=i%side,den=Math.max(side-1,1);x=-.78+1.56*col/den+(r()-.5)*.035;y=.78-1.56*row/den+(r()-.5)*.035;}
    else {const t=i/Math.max(n-1,1);x=-.82+1.64*t;y=.5*x+(r()-.5)*.18;}
    return {id:i,x:clamp(x,-.9,.9),y:clamp(y,-.9,.9)};
  }

  function mergeSmallClusters(clusters,r){
    const regular=clusters.filter(c=>c.pointIds.length>=params.cmin);
    const small=shuffle(clusters.filter(c=>c.pointIds.length<params.cmin),r);
    for(const cluster of small){
      if(cluster.consumed)continue;
      let best=-1,bestSize=Infinity;
      for(let i=0;i<regular.length;i++){
        const merged=unique([...regular[i].pointIds,...cluster.pointIds]);
        if(merged.length<=params.cmax&&regular[i].pointIds.length<bestSize){best=i;bestSize=regular[i].pointIds.length;}
      }
      if(best>=0){regular[best].pointIds=unique([...regular[best].pointIds,...cluster.pointIds]);continue;}
      const other=small.find(c=>c!==cluster&&!c.consumed&&unique([...c.pointIds,...cluster.pointIds]).length<=params.cmax);
      if(other){cluster.pointIds=unique([...cluster.pointIds,...other.pointIds]);other.consumed=true;}
      regular.push(cluster);
    }
    return regular.filter(c=>!c.consumed&&c.pointIds.length);
  }

  function buildRecursiveLeaves(r){
    leaves=[];
    const seen=new Set();
    function addLeaf(ids,depth){const sorted=unique(ids).sort((a,b)=>a-b),signature=sorted.join(',');if(!seen.has(signature)){seen.add(signature);leaves.push({id:leaves.length,pointIds:sorted,depth});}}
    function recurse(ids,depth){
      ids=unique(ids);
      if(ids.length<=params.cmax){addLeaf(ids,depth);return;}
      const wanted=Math.max(2,Math.floor(params.leaderFraction*ids.length));
      let leaderCount=Math.min(params.leaderCap,wanted,ids.length);
      const requestedFanout=depth===0?params.f0:params.f1;
      if(leaderCount<=requestedFanout&&leaderCount<ids.length)leaderCount=Math.min(ids.length,requestedFanout+1,params.leaderCap);
      const leaders=shuffle(ids,r).slice(0,leaderCount);
      const fanout=Math.min(requestedFanout,leaders.length);
      let clusters=leaders.map(leaderId=>({leaderId,pointIds:[]}));
      for(const id of ids){
        const nearest=leaders.slice().sort((a,b)=>dist(points[id],points[a])-dist(points[id],points[b])||a-b).slice(0,fanout);
        for(const leaderId of nearest)clusters[leaders.indexOf(leaderId)].pointIds.push(id);
      }
      clusters=mergeSmallClusters(clusters.filter(c=>c.pointIds.length),r);
      if(!clusters.length||clusters.some(c=>unique(c.pointIds).length>=ids.length)){
        clusters=leaders.map(leaderId=>({leaderId,pointIds:[]}));
        for(const id of ids){const leaderId=leaders.slice().sort((a,b)=>dist(points[id],points[a])-dist(points[id],points[b])||a-b)[0];clusters[leaders.indexOf(leaderId)].pointIds.push(id);}
        clusters=clusters.filter(c=>c.pointIds.length);
      }
      if(clusters.length===1&&clusters[0].pointIds.length===ids.length){
        const sorted=ids.slice().sort((a,b)=>points[a].x-points[b].x||points[a].y-points[b].y);
        clusters=[];for(let i=0;i<sorted.length;i+=params.cmax)clusters.push({leaderId:null,pointIds:sorted.slice(i,i+params.cmax)});
      }
      for(const cluster of clusters)recurse(cluster.pointIds,depth+1);
    }
    recurse(points.map(p=>p.id),0);
    memberships=points.map(()=>[]);
    for(const leaf of leaves)for(const id of leaf.pointIds)memberships[id].push(leaf.id);
    leafTrees=leaves.map(leaf=>minimumSpanningTree(leaf.pointIds));
  }

  function minimumSpanningTree(ids){
    if(ids.length<2)return[];
    const used=new Set([ids[0]]),edges=[];
    while(used.size<ids.length){let best=null,bestDistance=Infinity;for(const a of used)for(const b of ids)if(!used.has(b)){const d=dist(points[a],points[b]);if(d<bestDistance){bestDistance=d;best=[a,b];}}if(!best)break;edges.push(best);used.add(best[1]);}
    return edges;
  }

  function buildCandidates(k){
    const candidates=new Set();
    for(const leaf of leaves)for(const id of leaf.pointIds){
      const near=leaf.pointIds.filter(other=>other!==id).sort((a,b)=>dist(points[id],points[a])-dist(points[id],points[b])||a-b).slice(0,k);
      for(const other of near){candidates.add(key(id,other));candidates.add(key(other,id));}
    }
    candidateEdges=[...candidates].map(value=>value.split('>').map(Number));
  }

  function buildHashPrune(bits,cap,r){
    const normals=Array.from({length:bits},()=>{const angle=r()*Math.PI;return{x:Math.cos(angle),y:Math.sin(angle)};});
    const bySource=Array.from({length:points.length},()=>[]);for(const [a,b] of candidateEdges)bySource[a].push(b);
    hashEdges=[];
    for(let i=0;i<points.length;i++){
      const buckets=new Map();
      for(const j of bySource[i]){
        const hash=normals.map(z=>z.x*(points[j].x-points[i].x)+z.y*(points[j].y-points[i].y)>=0?'1':'0').join('');
        const old=buckets.get(hash);
        if(old===undefined||dist(points[i],points[j])<dist(points[i],points[old])||(dist(points[i],points[j])===dist(points[i],points[old])&&j<old))buckets.set(hash,j);
      }
      const kept=[...buckets.values()].sort((a,b)=>dist(points[i],points[a])-dist(points[i],points[b])||a-b).slice(0,cap);
      for(const j of kept)hashEdges.push([i,j]);
    }
  }

  function robustAll(edges,alpha,cap){
    const bySource=Array.from({length:points.length},()=>[]);for(const [a,b] of edges)bySource[a].push(b);
    const result=[];
    for(let i=0;i<points.length;i++){
      let live=unique(bySource[i]);const kept=[];
      while(live.length&&kept.length<cap){live.sort((a,b)=>dist(points[i],points[a])-dist(points[i],points[b])||a-b);const y=live.shift();kept.push(y);live=live.filter(z=>!(alpha*dist(points[y],points[z])<dist(points[i],points[z])));}
      for(const j of kept)result.push([i,j]);
    }
    return result;
  }

  function generate(){
    stop();
    params={
      distribution:els.distribution.value,n:clamp(parseInt(els.count.value)||48,12,120),seed:clamp(parseInt(els.seed.value)||858,1,999999),
      leaderFraction:clamp(parseFloat(els.leaderFraction.value)||.18,.02,.8),leaderCap:clamp(parseInt(els.leaderCap.value)||8,2,20),
      cmax:clamp(parseInt(els.cmax.value)||14,4,80),cmin:clamp(parseInt(els.cmin.value)||5,1,40),f0:clamp(parseInt(els.f0.value)||2,1,8),f1:clamp(parseInt(els.f1.value)||1,1,8),
      k:clamp(parseInt(els.knn.value)||2,1,5),bits:clamp(parseInt(els.bits.value)||3,1,8),cap:clamp(parseInt(els.degree.value)||8,2,20),alpha:clamp(parseFloat(els.alpha.value)||1.2,1,3)
    };
    params.cmin=Math.min(params.cmin,params.cmax-1);
    els.count.value=params.n;els.seed.value=params.seed;els.leaderFraction.value=params.leaderFraction;els.leaderCap.value=params.leaderCap;els.cmax.value=params.cmax;els.cmin.value=params.cmin;els.f0.value=params.f0;els.f1.value=params.f1;els.knn.value=params.k;els.bits.value=params.bits;els.degree.value=params.cap;els.alpha.value=params.alpha;
    const dataRng=rng(params.seed);points=Array.from({length:params.n},(_,i)=>samplePoint(params.distribution,i,params.n,dataRng));
    buildRecursiveLeaves(rng(params.seed^0xA53C9E17));
    buildCandidates(params.k);
    buildHashPrune(params.bits,params.cap,rng(params.seed^0x72A4B19D));
    finalEdges=els.final.checked?robustAll(hashEdges,params.alpha,params.cap):hashEdges.slice();
    const hashKeep=new Set(hashEdges.map(e=>key(e[0],e[1]))),finalKeep=new Set(finalEdges.map(e=>key(e[0],e[1])));
    hashDeleted=candidateEdges.filter(e=>!hashKeep.has(key(e[0],e[1])));finalDeleted=els.final.checked?hashEdges.filter(e=>!finalKeep.has(key(e[0],e[1]))):[];
    const membershipsTotal=leaves.reduce((sum,leaf)=>sum+leaf.pointIds.length,0),maxLeaf=Math.max(...leaves.map(leaf=>leaf.pointIds.length));
    stages[1].text=`Recursive ball carving returned ${leaves.length} completed leaves. Every leaf has at most ${maxLeaf} points (Cmax = ${params.cmax}); ${membershipsTotal} total memberships give ${(membershipsTotal/points.length).toFixed(2)}× overlap.`;
    selected=null;step=0;if(view.w>1)fitView();render();
  }

  function resize(){const r=viewport.getBoundingClientRect(),oldW=view.w,oldH=view.h,initialized=oldW>1&&oldH>1;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);canvas.style.width=`${r.width}px`;canvas.style.height=`${r.height}px`;view.w=r.width;view.h=r.height;if(initialized){view.ox+=(r.width-oldW)/2;view.oy+=(r.height-oldH)/2;}else fitView();draw();}
  function fitView(){if(!points.length||view.w<=1||view.h<=1)return;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}const spanX=Math.max(maxX-minX,.1),spanY=Math.max(maxY-minY,.1),pad=Math.max(48,Math.min(view.w,view.h)*.09);view.s=Math.min((view.w-pad*2)/spanX,(view.h-pad*2)/spanY);view.fitScale=view.s;view.ox=view.w/2-(minX+maxX)/2*view.s;view.oy=view.h/2+(minY+maxY)/2*view.s;}
  const screen=p=>({x:view.ox+p.x*view.s,y:view.oy-p.y*view.s}),world=(x,y)=>({x:(x-view.ox)/view.s,y:-(y-view.oy)/view.s});
  function edgeSegment(a,b,visibleKeys){const p=screen(points[a]),q=screen(points[b]);if(!visibleKeys.has(key(b,a)))return{p,q};const dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy)||1,nx=-dy/len*3.2,ny=dx/len*3.2;return{p:{x:p.x+nx,y:p.y+ny},q:{x:q.x+nx,y:q.y+ny}};}
  function drawLeafOutput(){
    const colors=leafPalette();
    for(const leaf of leaves){const color=colors[leaf.id%colors.length];for(const [a,b] of leafTrees[leaf.id]){const p=screen(points[a]),q=screen(points[b]);ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.34;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();}const center=leaf.pointIds.reduce((acc,id)=>({x:acc.x+points[id].x/leaf.pointIds.length,y:acc.y+points[id].y/leaf.pointIds.length}),{x:0,y:0});const anchor=leaf.pointIds.slice().sort((a,b)=>dist(points[a],center)-dist(points[b],center))[0],p=screen(points[anchor]);ctx.save();ctx.fillStyle=color;ctx.globalAlpha=.95;ctx.font='800 10px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(`b${leaf.id}`,p.x,p.y-16);ctx.restore();}
  }
  function drawMembershipRing(id,p){const memberLeaves=memberships[id],colors=leafPalette();if(!memberLeaves.length)return;const gap=.11,count=memberLeaves.length;for(let i=0;i<count;i++){const start=-Math.PI/2+i*Math.PI*2/count+gap,end=-Math.PI/2+(i+1)*Math.PI*2/count-gap;ctx.save();ctx.strokeStyle=colors[memberLeaves[i]%colors.length];ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,10,start,end);ctx.stroke();ctx.restore();}}
  function edgeSetForStage(){if(step<2)return[];if(step===2)return candidateEdges;if(step===3)return hashEdges;return finalEdges;}
  function deletionLayersForStage(){if(step===3)return[{edges:hashDeleted,color:'--rose',dash:[6,4]}];if(step===4)return[{edges:hashDeleted,color:'--rose',dash:[6,4]},{edges:finalDeleted,color:'--violet',dash:[2,4]}];return[];}
  function draw(){
    if(!points.length)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,view.w,view.h);
    ctx.save();ctx.strokeStyle=css('--line');ctx.globalAlpha=.42;for(let x=view.ox%(view.s*.2);x<view.w;x+=view.s*.2){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,view.h);ctx.stroke();}for(let y=view.oy%(view.s*.2);y<view.h;y+=view.s*.2){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(view.w,y);ctx.stroke();}ctx.restore();
    if(step===1)drawLeafOutput();
    const edges=edgeSetForStage(),layers=deletionLayersForStage(),deletedCount=layers.reduce((n,layer)=>n+layer.edges.length,0),focusOnly=edges.length+deletedCount>850,visibleKeys=new Set([...edges,...layers.flatMap(layer=>layer.edges)].map(e=>key(e[0],e[1])));
    for(const layer of layers)for(const [a,b] of layer.edges){if(focusOnly&&selected!==null&&a!==selected)continue;const {p,q}=edgeSegment(a,b,visibleKeys);ctx.save();ctx.strokeStyle=css(layer.color);ctx.globalAlpha=a===selected?.94:.28;ctx.lineWidth=a===selected?2.6:1.25;ctx.setLineDash(layer.dash);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();}
    for(const [a,b] of edges){if(focusOnly&&selected!==null&&a!==selected)continue;const {p,q}=edgeSegment(a,b,visibleKeys);ctx.save();ctx.strokeStyle=step===2?css('--muted'):css('--green');ctx.globalAlpha=a===selected?.86:step===2?.15:.22;ctx.lineWidth=a===selected?2:1;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();}
    for(let i=0;i<points.length;i++){const p=screen(points[i]);ctx.save();ctx.fillStyle=css('--amber');ctx.strokeStyle=i===selected?css('--text'):css('--surface');ctx.lineWidth=i===selected?3:2;ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();if(step===1)drawMembershipRing(i,p);if(i===selected){ctx.save();ctx.fillStyle=css('--text');ctx.font='700 10px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(`x${i}`,p.x,p.y-15);ctx.restore();}}
  }

  function render(){const s=stages[step],edges=edgeSetForStage(),deletionText=step===3?` ${hashDeleted.length.toLocaleString()} red dashed edges are removed by HashPrune.`:step===4?` Red dashed edges were removed by HashPrune; ${finalDeleted.length.toLocaleString()} violet dotted edges are removed now by RobustPrune.`:'';els.phase.textContent=s.phase;els.title.textContent=s.title;els.text.textContent=s.text+deletionText;els.stepCount.textContent=`Step ${step+1} / ${stages.length}`;els.progress.style.width=`${step/(stages.length-1)*100}%`;els.first.disabled=els.prev.disabled=step===0;els.last.disabled=els.next.disabled=step===stages.length-1;els.leaves.textContent=step>=1?leaves.length:0;els.candidates.textContent=step>=2?candidateEdges.length.toLocaleString():0;els.edges.textContent=edges.length.toLocaleString();els.avgDegree.textContent=(edges.length/points.length).toFixed(1);updatePipeline();updateFocus();draw();}
  function updatePipeline(){const names=['Dataset','Recursive RBC leaves','Leaf k-NN','HashPrune','RobustPrune','Final graph'];els.pipeline.innerHTML=names.map((name,i)=>`<div class="pipe-step ${i===step?'active':i<step?'done':''}"><span class="pipe-num">${i+1}</span><div><strong>${name}</strong><span>${['input X','partition','pick','prune & add','optional final pass','return G'][i]}</span></div></div>`).join('');}
  function updateFocus(){if(selected===null){els.focusStatus.textContent='none';els.focusDot.textContent='—';els.focusName.textContent='no point selected';els.focusSub.textContent='click a point to inspect it';els.focusList.innerHTML='<div class="mini-row"><span>view</span><b>entire graph</b></div>';return;}const p=points[selected],memberLeaves=memberships[selected]||[],cand=candidateEdges.filter(e=>e[0]===selected),hash=hashEdges.filter(e=>e[0]===selected),fin=finalEdges.filter(e=>e[0]===selected),hashRemoved=hashDeleted.filter(e=>e[0]===selected).length,robustRemoved=finalDeleted.filter(e=>e[0]===selected).length;els.focusStatus.textContent=`x${selected}`;els.focusDot.textContent=`x${selected}`;els.focusName.textContent=`point x${selected}`;els.focusSub.textContent=`(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;els.focusList.innerHTML=`<div class="mini-row"><span>leaf memberships</span><b>${memberLeaves.map(id=>`b${id}`).join(', ')||'—'}</b></div><div class="mini-row"><span>picked candidates</span><b>${cand.length}</b></div><div class="mini-row"><span>after HashPrune</span><b>${hash.length}</b></div>${step===3||step===4?`<div class="mini-row"><span>deleted by HashPrune</span><b>${hashRemoved}</b></div>`:''}${step===4?`<div class="mini-row"><span>deleted by RobustPrune</span><b>${robustRemoved}</b></div>`:''}<div class="mini-row"><span>final degree</span><b>${fin.length}</b></div>`;}
  function go(i){step=clamp(i,0,stages.length-1);render();}
  function stop(){if(timer)clearInterval(timer);timer=null;if(els.play)els.play.textContent='▶ Play';}
  function play(){if(timer){stop();return;}if(step===stages.length-1)go(0);els.play.textContent='❚❚ Pause';timer=setInterval(()=>{if(step===stages.length-1){stop();return;}go(step+1);},1250);}
  function pointerPosition(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function selectAt(pos){let best=null,bestDistance=22;for(let i=0;i<points.length;i++){const p=screen(points[i]),d=Math.hypot(p.x-pos.x,p.y-pos.y);if(d<bestDistance){bestDistance=d;best=i;}}selected=best;render();}

  canvas.addEventListener('pointerdown',e=>{const pos=pointerPosition(e);drag={x:pos.x,y:pos.y,ox:view.ox,oy:view.oy,moved:false};canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-panning');});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const pos=pointerPosition(e),dx=pos.x-drag.x,dy=pos.y-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;view.ox=drag.ox+dx;view.oy=drag.oy+dy;draw();});
  canvas.addEventListener('pointerup',e=>{const pos=pointerPosition(e),wasClick=drag&&!drag.moved;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);drag=null;canvas.classList.remove('is-panning');if(wasClick)selectAt(pos);});
  canvas.addEventListener('pointercancel',()=>{drag=null;canvas.classList.remove('is-panning');});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const pos=pointerPosition(e),before=world(pos.x,pos.y),factor=Math.exp(-e.deltaY*.0015),minScale=Math.max(view.fitScale*.12,1e-9),maxScale=Math.max(view.fitScale*40,minScale);view.s=clamp(view.s*factor,minScale,maxScale);view.ox=pos.x-before.x*view.s;view.oy=pos.y+before.y*view.s;draw();},{passive:false});
  els.first.onclick=()=>go(0);els.prev.onclick=()=>go(step-1);els.play.onclick=play;els.next.onclick=()=>go(step+1);els.last.onclick=()=>go(stages.length-1);
  $('applyBtn').onclick=generate;$('regenBtn').onclick=()=>{els.seed.value=(parseInt(els.seed.value)||858)%999999+1;generate();};$('fitBtn').onclick=()=>{fitView();draw();};
  $('themeToggle').onclick=()=>{const dark=isDark();document.documentElement.dataset.theme=dark?'light':'dark';$('themeToggle').textContent=dark?'☾ Dark':'☀ Light';draw();};
  window.addEventListener('keydown',e=>{if(/^(INPUT|SELECT)$/.test(document.activeElement?.tagName||''))return;if(e.key==='Escape'){selected=null;render();}if(e.key==='ArrowRight'){e.preventDefault();go(step+1);}if(e.key==='ArrowLeft'){e.preventDefault();go(step-1);}if(e.key===' '){e.preventDefault();play();}});
  new ResizeObserver(resize).observe(viewport);generate();
})();
