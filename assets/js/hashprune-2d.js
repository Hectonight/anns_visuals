"use strict";
    const $ = id => document.getElementById(id);
    const canvas = $("canvas"), ctx = canvas.getContext("2d"), viewport = $("viewport");
    const LIGHT_PLANE_COLORS=[[45,118,93],[211,154,50],[84,122,165],[232,111,81],[155,107,170],[75,156,162],[184,93,113],[122,143,67]],DARK_PLANE_COLORS=[[87,212,208],[245,184,90],[175,145,244],[240,120,127],[116,217,159],[98,157,224],[235,133,207],[164,201,92]];
    const LIGHT_BUCKET_COLORS=["#2d765d","#d39a32","#547aa5","#e86f51","#9b6baa","#4b9ca2","#b85d71","#7a8f43","#8a6b4b","#6178b8","#c6573e","#397d83"],DARK_BUCKET_COLORS=["#57d4d0","#f5b85a","#af91f4","#f0787f","#74d99f","#629de0","#eb85cf","#a4c95c","#e99b60","#73c0ea","#c88bf0","#e27970"];
    const isDark=()=>document.documentElement.dataset.theme==="dark";
    let params={}, target={x:0,y:0,z:0}, candidates=[], normals=[], steps=[], step=0, selected=null, timer=null;
    let camera={zoom:1,panX:0,panY:0}, drag=null, projected=[], dpr=1;

    function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
    function mulberry32(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
    function dot(a,b){return a.x*b.x+a.y*b.y+a.z*b.z;}
    function norm(a){return Math.hypot(a.x,a.y,a.z);}
    function normalize(a){const n=norm(a)||1;return{x:a.x/n,y:a.y/n,z:a.z/n};}
    function cross(a,b){return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
    function add(a,b){return{x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}
    function mul(a,s){return{x:a.x*s,y:a.y*s,z:a.z*s};}

    function readParams(){return{
      bits:clamp(+( $("bitsInput").value)||4,1,8),
      count:clamp(+( $("countInput").value)||24,4,48),
      cap:clamp(+( $("capInput").value)||8,1,16),
      seed:clamp(+( $("seedInput").value)||858,1,999999)
    };}

    function signature(c, count=params.bits){return normals.slice(0,count).map(n=>dot(n,c)>=0?"1":"0").join("");}
    function colorForHash(hash){let x=0;for(const ch of hash)x=(x*2+(ch==="1"?1:0))>>>0;const colors=isDark()?DARK_BUCKET_COLORS:LIGHT_BUCKET_COLORS;return colors[x%colors.length];}

    function generate(){
      params=readParams(); const rng=mulberry32(params.seed);
      normals=[]; candidates=[];
      for(let i=0;i<params.bits;i++){
        const angle=rng()*Math.PI;
        normals.push({x:Math.cos(angle),y:Math.sin(angle),z:0});
      }
      for(let i=0;i<params.count;i++){
        const angle=rng()*Math.PI*2;
        let dir={x:Math.cos(angle),y:Math.sin(angle),z:0};
        if(i>0 && i%5===0){const base=candidates[Math.floor(rng()*i)];dir=normalize({x:base.x+(rng()-.5)*.22,y:base.y+(rng()-.5)*.22,z:0});}
        const r=.38+Math.pow(rng(),.68)*1.3;
        candidates.push({id:i,x:dir.x*r,y:dir.y*r,z:dir.z*r,distance:r,action:null});
      }
      selected=null; buildSteps(); renderTrail(); render();
    }

    function computeReservoir(upto){
      const map=new Map(), actions=[];
      for(let i=0;i<=upto && i<candidates.length;i++){
        const c=candidates[i], hash=signature(c), existing=map.get(hash); let action;
        if(existing){
          if(c.distance<existing.distance){map.set(hash,c);action={kind:"replace",removedId:existing.id,text:`c${i} collides with c${existing.id} in ${hash}; the nearer c${i} replaces it.`};}
          else action={kind:"reject",rejectedId:c.id,text:`c${i} collides with c${existing.id} in ${hash}; the nearer c${existing.id} stays.`};
        }else if(map.size<params.cap){map.set(hash,c);action={kind:"insert",text:`Bucket ${hash} is new and the reservoir has room, so c${i} is inserted.`};}
        else{
          const farthest=[...map.entries()].sort((a,b)=>b[1].distance-a[1].distance)[0];
          if(c.distance<farthest[1].distance){map.delete(farthest[0]);map.set(hash,c);action={kind:"evict",removedId:farthest[1].id,text:`Reservoir full: c${i} is nearer than farthest c${farthest[1].id}, so c${farthest[1].id} is evicted.`};}
          else action={kind:"reject",rejectedId:c.id,text:`Reservoir full: c${i} is farther than c${farthest[1].id}, the current farthest entry, so it is rejected.`};
        }
        actions.push(action);
      }
      return {map,action:actions.at(-1)||null,actions};
    }

    function buildSteps(){
      steps=[{phase:"Residualize",bits:0,stream:-1,title:"Center every direction on p",text:"HashPrune does not hash the absolute candidate coordinates. It hashes each residual vector c − p, so every hyperplane shown here passes through the query point p."}];
      for(let i=1;i<=params.bits;i++){
        const groups=new Set(candidates.map(c=>signature(c,i))).size;
        steps.push({phase:"Hash bits",bits:i,stream:-1,activePlane:i-1,title:`Reveal bit ${i} with H${i}`,text:`H${i} tests the sign of H${i} · (c − p). The ${i}-bit prefixes now divide the candidates into ${groups} directional region${groups===1?"":"s"}.`});
      }
      steps.push({phase:"Buckets",bits:params.bits,stream:-1,title:"Candidates sharing a signature collide",text:"A full bit string identifies an angular region—a probabilistic cone around p. Candidates in the same bucket point in similar directions."});
      for(let i=0;i<candidates.length;i++){
        const r=computeReservoir(i), action=r.action;
        steps.push({phase:"HashPrune stream",bits:params.bits,stream:i,title:`Insert candidate c${i}`,text:action.text,action:action.kind});
      }
      const final=computeReservoir(candidates.length-1);
      steps.push({phase:"Complete",bits:params.bits,stream:candidates.length-1,title:"A sparse, directionally diverse neighborhood",text:`HashPrune keeps ${final.map.size} candidates from ${params.count} inputs. Each stored signature contributes at most one nearby direction, and the capacity limit bounds memory.`});
      step=0;
    }

    function state(){
      const s=steps[step], reservoir=s.stream>=0?computeReservoir(s.stream):{map:new Map(),action:null,actions:[]};
      const visible=candidates.slice(0,s.stream>=0?s.stream+1:candidates.length);
      const groups=new Map();
      for(const c of visible){const h=signature(c,s.bits);if(!groups.has(h))groups.set(h,[]);groups.get(h).push(c);}
      return {s,reservoir,groups};
    }

    function project(v){
      const w=canvas.width/dpr,h=canvas.height/dpr,scale=Math.min(w,h)*.25*camera.zoom;
      return{x:w/2+camera.panX+v.x*scale,y:h/2+camera.panY-v.y*scale,z:0,scale};
    }
    function rgba(rgb,a){return`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;}

    function resize(){const r=viewport.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";draw();}

    function drawGrid(){
      ctx.strokeStyle=isDark()?"rgba(116,145,158,.08)":"rgba(57,68,63,.09)";ctx.lineWidth=1;
      for(let i=-4;i<=4;i++){
        const a=project({x:-4,y:i*.5,z:0}),b=project({x:4,y:i*.5,z:0});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        const c=project({x:i*.5,y:-4,z:0}),d=project({x:i*.5,y:4,z:0});ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(d.x,d.y);ctx.stroke();
      }
    }

    function drawHalfPlane(normal,rgb,opacity,active){
      const w=canvas.width/dpr,h=canvas.height/dpr,p=project(target),nEnd=project(normal);
      const nx=nEnd.x-p.x,ny=nEnd.y-p.y,len=Math.hypot(nx,ny)||1,sx=nx/len,sy=ny/len,tx=-sy,ty=sx,e=Math.max(w,h)*2;
      ctx.beginPath();ctx.moveTo(p.x+tx*e,p.y+ty*e);ctx.lineTo(p.x-tx*e,p.y-ty*e);ctx.lineTo(p.x-tx*e+sx*e*2,p.y-ty*e+sy*e*2);ctx.lineTo(p.x+tx*e+sx*e*2,p.y+ty*e+sy*e*2);ctx.closePath();
      ctx.fillStyle=rgba(rgb,active?Math.max(.18,opacity*1.7):opacity);ctx.fill();
      ctx.beginPath();ctx.moveTo(p.x+tx*e,p.y+ty*e);ctx.lineTo(p.x-tx*e,p.y-ty*e);ctx.strokeStyle=rgba(rgb,active?.95:.55);ctx.lineWidth=active?2.4:1.2;ctx.stroke();
      const label=project(mul(normal,1.76));ctx.fillStyle=rgba(rgb,.98);ctx.font="700 11px Inter, sans-serif";ctx.fillText(`H${normals.indexOf(normal)+1} +`,label.x+5,label.y-4);
    }

    function drawWedgeLabels(bits){
      if(!$("sectorsCheck").checked||bits<1)return;
      const samples=180,segments=[];let last=null,start=0;
      for(let i=0;i<=samples;i++){
        const a=(i%samples)/samples*Math.PI*2,c={x:Math.cos(a),y:Math.sin(a),z:0},hash=signature(c,bits);
        if(last===null)last=hash;
        if(hash!==last||i===samples){segments.push({hash:last,start,end:i-1});start=i;last=hash;}
      }
      for(const seg of segments){const mid=((seg.start+seg.end)/2)/samples*Math.PI*2,q=project({x:Math.cos(mid)*1.92,y:Math.sin(mid)*1.92,z:0});ctx.fillStyle=colorForHash(seg.hash);ctx.font="800 10px ui-monospace, monospace";ctx.textAlign="center";ctx.fillText(seg.hash,q.x,q.y);}
      ctx.textAlign="left";
    }

    function candidateStatus(id,reservoir,streamIndex){
      if(streamIndex<id)return"pending";
      if([...reservoir.map.values()].some(c=>c.id===id))return"retained";
      if(reservoir.actions.slice(id+1).some(a=>a.removedId===id))return"evicted";
      return"rejected";
    }

    function drawCross(q,radius){
      const size=radius+3;ctx.save();ctx.strokeStyle=isDark()?"#ff8d92":"#d94f3d";ctx.lineWidth=2.5;ctx.lineCap="round";
      ctx.beginPath();ctx.moveTo(q.x-size,q.y-size);ctx.lineTo(q.x+size,q.y+size);ctx.moveTo(q.x+size,q.y-size);ctx.lineTo(q.x-size,q.y+size);ctx.stroke();ctx.restore();
    }

    function draw(){
      if(!steps.length||!canvas.width)return; const {s,reservoir}=state(),w=canvas.width/dpr,h=canvas.height/dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);drawGrid();
      const showPlanes=$("planesCheck").checked, showVectors=$("vectorsCheck").checked, showLabels=$("labelsCheck").checked;
      const planeOpacity=+$("opacityInput").value;
      if(showPlanes){
        normals.forEach((n,i)=>{
          if(i>=s.bits)return;drawHalfPlane(n,(isDark()?DARK_PLANE_COLORS:LIGHT_PLANE_COLORS)[i],planeOpacity,s.activePlane===i);
        });
      }
      drawWedgeLabels(s.bits);
      const p0=project(target), streamIndex=s.stream, keptIds=new Set([...reservoir.map.values()].map(c=>c.id));
      if(showVectors){
        candidates.forEach(c=>{
          const q=project(c), current=c.id===streamIndex, inspected=c.id===selected;
          ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(q.x,q.y);
          ctx.strokeStyle=isDark()?(current?"rgba(245,184,90,.88)":inspected?"rgba(87,212,208,.8)":"rgba(142,164,176,.17)"):(current?"rgba(232,111,81,.88)":inspected?"rgba(45,118,93,.82)":"rgba(80,98,89,.18)");ctx.lineWidth=current?2.2:inspected?1.7:.75;ctx.stroke();
        });
      }
      const marks=candidates.map(c=>({c,q:project(c)}));projected=[];
      for(const {c,q} of marks){
        const hash=signature(c,s.bits), current=c.id===streamIndex, inspected=c.id===selected, processed=streamIndex>=0&&c.id<=streamIndex, retained=processed&&keptIds.has(c.id), removed=processed&&!retained;
        const radius=current?8:inspected?7:retained?6:4.5;
        ctx.beginPath();ctx.arc(q.x,q.y,radius,0,Math.PI*2);
        ctx.fillStyle=current?(isDark()?"#f5b85a":"#e86f51"):colorForHash(hash||"0");ctx.globalAlpha=streamIndex>=0&&!processed?.24:removed&&!current?.38:1;ctx.fill();ctx.globalAlpha=1;
        ctx.strokeStyle=isDark()?"#0a1116":"#fffdf8";ctx.lineWidth=1.2;ctx.stroke();
        if(retained){ctx.beginPath();ctx.arc(q.x,q.y,radius+4,0,Math.PI*2);ctx.strokeStyle=isDark()?"#74d99f":"#2d765d";ctx.lineWidth=3;ctx.globalAlpha=.98;ctx.stroke();ctx.globalAlpha=1;}
        if(removed)drawCross(q,radius);
        if(inspected){ctx.beginPath();ctx.arc(q.x,q.y,radius+8,0,Math.PI*2);ctx.strokeStyle=isDark()?"#ffffff":"#15211d";ctx.lineWidth=2;ctx.stroke();}
        if(showLabels&&(current||inspected||retained||params.count<=18)){ctx.fillStyle=isDark()?"#dce5e9":"#39443f";ctx.font="700 10px Inter, sans-serif";ctx.fillText(`c${c.id}`,q.x+9,q.y-9);}
        projected.push({id:c.id,x:q.x,y:q.y});
      }
      ctx.beginPath();ctx.arc(p0.x,p0.y,9,0,Math.PI*2);ctx.fillStyle=isDark()?"#eef3f5":"#fffdf8";ctx.fill();ctx.strokeStyle=isDark()?"#57d4d0":"#194f3c";ctx.lineWidth=3;ctx.stroke();
      ctx.fillStyle=isDark()?"#eef3f5":"#15211d";ctx.font="800 12px Inter, sans-serif";ctx.fillText("p",p0.x+12,p0.y-8);
    }

    function renderInspector(st){
      if(selected===null){$("candidateDot").textContent="—";$("candidateDot").style.background="var(--surface-3)";$("candidateName").textContent="no candidate selected";$("candidateDistance").textContent="Click a point to inspect it";$("bitStrip").innerHTML="";$("decision").className="decision";$("decision").textContent="The graph is unfiltered. Select a candidate only when you want its individual hash decision.";$("candidateStatus").textContent="none";return;}
      const c=candidates[selected], full=signature(c), revealed=st.s.bits;
      $("candidateDot").textContent=`c${c.id}`;$("candidateDot").style.background=colorForHash(full);$("candidateName").textContent=`candidate c${c.id}`;
      $("candidateDistance").textContent=`‖c − p‖ = ${c.distance.toFixed(3)}`;
      $("bitStrip").innerHTML=[...full].map((b,i)=>`<span class="bit ${i>=revealed?"pending":b==="1"?"one":"zero"}">${i>=revealed?"·":b}</span>`).join("");
      let text="Reveal the hyperplanes to build this candidate’s signature.", cls="decision";
      if(st.s.stream>=0){
        if(selected<=st.s.stream){const status=candidateStatus(selected,st.reservoir,st.s.stream);if(status==="evicted"){const removalIndex=st.reservoir.actions.findIndex((a,i)=>i>selected&&a.removedId===selected),a=st.reservoir.actions[removalIndex];text=`c${selected} was retained, but was later evicted when c${removalIndex} arrived. ${a.text}`;cls+=" bad";}else{const r=computeReservoir(selected),a=r.action;text=a.text;cls+=status==="rejected"?" bad":" good";}}
        else text=`c${selected} has not entered the stream yet.`;
      }else if(revealed===params.bits)text=`Full signature ${full}. ${st.groups.get(full).length} candidate${st.groups.get(full).length===1?"":"s"} occupy this directional bucket.`;
      $("decision").className=cls;$("decision").textContent=text;
      $("candidateStatus").textContent=st.s.stream>=0?candidateStatus(selected,st.reservoir,st.s.stream):"selected";
    }

    function renderReservoir(st){
      const entries=[...st.reservoir.map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
      let html=entries.map(([hash,c])=>`<div class="slot filled ${c.id===st.s.stream?"current":""}"><b>${hash}</b><span>c${c.id} · ${c.distance.toFixed(2)}</span></div>`).join("");
      for(let i=entries.length;i<params.cap;i++)html+=`<div class="slot">empty</div>`;
      $("reservoir").innerHTML=html;$("reservoirCount").textContent=`${entries.length} / ${params.cap}`;
    }

    function renderBuckets(st){
      const complete=st.s.bits===params.bits;
      const rows=[...st.groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
      $("buckets").innerHTML=rows.map(([hash,list])=>{
        const winner=list.slice().sort((a,b)=>a.distance-b.distance)[0];
        return`<div class="bucket"><code>${hash||"—"}</code><span class="members">${list.map(c=>`c${c.id}`).join(", ")}</span><span class="winner">${complete?`c${winner.id}`:""}</span></div>`;
      }).join("");
    }

    function render(){
      if(!steps.length)return; const st=state(),s=st.s;
      $("phase").textContent=s.phase;$("stepTitle").textContent=s.title;$("stepText").textContent=s.text;
      $("stepCount").textContent=`Step ${step+1} / ${steps.length}`;$("progressFill").style.width=`${step/(steps.length-1)*100}%`;
      $("viewportLabel").textContent=s.stream>=0?`Streaming c${s.stream} · ${signature(candidates[s.stream])}`:s.bits?`${s.bits} of ${params.bits} dividing lines active`:"2D residual plane around p";
      const collisions=[...st.groups.values()].reduce((n,a)=>n+Math.max(0,a.length-1),0);
      $("statBits").textContent=`${s.bits} / ${params.bits}`;$("statBuckets").textContent=st.groups.size;$("statCollisions").textContent=collisions;$("statKept").textContent=`${st.reservoir.map.size} / ${params.cap}`;
      $("firstBtn").disabled=$("prevBtn").disabled=step===0;$("lastBtn").disabled=$("nextBtn").disabled=step===steps.length-1;
      document.querySelectorAll(".event").forEach((e,i)=>e.classList.toggle("active",i===step));
      renderInspector(st);renderReservoir(st);renderBuckets(st);draw();
    }

    function renderTrail(){
      $("trail").innerHTML=steps.map((s,i)=>`<div class="event" data-step="${i}"><b>${i+1}.</b> ${s.title}</div>`).join("");
      $("trail").querySelectorAll(".event").forEach(e=>e.addEventListener("click",()=>jump(+e.dataset.step)));
    }
    function jump(i){step=clamp(i,0,steps.length-1);render();}
    function stop(){if(timer)clearInterval(timer);timer=null;$("playBtn").textContent="▶ Play";$("playBtn").classList.add("primary");}
    function play(){if(timer){stop();return;}if(step===steps.length-1)step=0;$("playBtn").textContent="❚❚ Pause";$("playBtn").classList.remove("primary");timer=setInterval(()=>{if(step>=steps.length-1){stop();return;}step++;render();},850);}
    function rebuild(newSeed=false){stop();if(newSeed){$("seedInput").value=(+$("seedInput").value||1)%999999+1;}generate();resize();}

    $("applyBtn").addEventListener("click",()=>rebuild(false));$("regenBtn").addEventListener("click",()=>rebuild(true));
    $("firstBtn").addEventListener("click",()=>jump(0));$("prevBtn").addEventListener("click",()=>jump(step-1));$("playBtn").addEventListener("click",play);$("nextBtn").addEventListener("click",()=>jump(step+1));$("lastBtn").addEventListener("click",()=>jump(steps.length-1));
    ["planesCheck","vectorsCheck","labelsCheck","sectorsCheck","opacityInput"].forEach(id=>$(id).addEventListener("input",draw));
    canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,panX:camera.panX,panY:camera.panY,moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;camera.panX=drag.panX+dx;camera.panY=drag.panY+dy;draw();});
    canvas.addEventListener("pointerup",e=>{if(drag&&!drag.moved){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bestD=180;for(const p of projected){const d=(p.x-x)**2+(p.y-y)**2;if(d<bestD){bestD=d;best=p.id;}}selected=best;renderInspector(state());draw();}drag=null;});
    canvas.addEventListener("wheel",e=>{e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),.58,2.1);draw();},{passive:false});
    window.addEventListener("resize",resize);window.addEventListener("keydown",e=>{if(e.key==="Escape"){selected=null;renderInspector(state());draw();}if(e.key==="ArrowRight")jump(step+1);if(e.key==="ArrowLeft")jump(step-1);if(e.key===" "){e.preventDefault();play();}});
    $("themeToggle").addEventListener("click",()=>{const dark=!isDark();document.documentElement.dataset.theme=dark?"dark":"light";$("themeToggle").textContent=dark?"☀ Light":"☾ Dark";renderInspector(state());draw();});
    params=readParams();generate();requestAnimationFrame(resize);
