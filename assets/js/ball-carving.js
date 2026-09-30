"use strict";

    const LIGHT_COLORS = ["#2d765d", "#547aa5", "#d39a32", "#9b6baa", "#df7a52", "#4b9ca2", "#b85d71", "#7a8f43", "#8a6b4b", "#6178b8", "#c6573e", "#397d83"];
    const DARK_COLORS = ["#57d4d0", "#f5b85a", "#af91f4", "#f0787f", "#74d99f", "#629de0", "#eb85cf", "#a4c95c", "#e99b60", "#73c0ea", "#c88bf0", "#e27970"];
    const isDark = () => document.documentElement.dataset.theme === "dark";
    const palette = () => isDark() ? DARK_COLORS : LIGHT_COLORS;
    const el = id => document.getElementById(id);
    const canvas = el("canvas");
    const ctx = canvas.getContext("2d");
    let dpr = 1, points = [], snapshots = [], treeNodes = [], step = 0, timer = null, hoverPoint = null;
    let params = {};

    function mulberry32(seed) {
      return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    function gaussian(rng) {
      const u = Math.max(rng(), 1e-9), v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function readParams() {
      const p = {
        n: clamp(+el("nodeCount").value || 120, 20, 500),
        distribution: el("distribution").value,
        seed: clamp(+el("seed").value || 1, 1, 999999),
        leaderFraction: clamp(+el("leaderFraction").value || .08, .01, .8),
        leaderCap: clamp(+el("leaderCap").value || 1000, 2, 1000),
        cmax: clamp(+el("cmax").value || 28, 3, 200),
        cmin: clamp(+el("cmin").value || 9, 1, 100),
        fanout: [0,1,2,3].map(i => clamp(+el("f"+i).value || 1, 1, 20))
      };
      p.cmin = Math.min(p.cmin, p.cmax - 1);
      return p;
    }

    function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
    function dist2(a, b) { const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }
    function unique(arr) { return [...new Set(arr)]; }

    function generatePoints() {
      const rng = mulberry32(params.seed);
      points = [];
      for (let i=0; i<params.n; i++) {
        let x, y;
        if (params.distribution === "uniform") {
          x = .07 + .86*rng(); y = .07 + .86*rng();
        } else if (params.distribution === "rings") {
          const outer = rng() > .38, angle = rng()*Math.PI*2;
          const radius = (outer ? .35 : .17) + gaussian(rng)*.018;
          x=.5+Math.cos(angle)*radius; y=.5+Math.sin(angle)*radius;
        } else if (params.distribution === "moons") {
          const upper = i % 2 === 0, angle = rng()*Math.PI;
          x = upper ? .2+.48*(angle/Math.PI) : .34+.48*(angle/Math.PI);
          y = upper ? .56-.25*Math.sin(angle) : .49+.25*Math.sin(angle);
          x += gaussian(rng)*.018; y += gaussian(rng)*.018;
        } else {
          const centers = [[.25,.3],[.68,.25],[.47,.68],[.78,.7]];
          const c = centers[Math.floor(rng()*centers.length)];
          x=c[0]+gaussian(rng)*.09; y=c[1]+gaussian(rng)*.075;
        }
        points.push({id:i, x:clamp(x,.035,.965), y:clamp(y,.04,.96)});
      }
    }

    function shuffle(arr, rng) {
      const a = arr.slice();
      for (let i=a.length-1; i>0; i--) { const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
      return a;
    }

    function membershipLoad(leaves) {
      return leaves.reduce((s,l)=>s+l.pointIds.length,0) / params.n;
    }

    function makeSnapshot(type, node, extra={}) {
      const leaves = treeNodes.filter(n=>n.status==="leaf");
      snapshots.push({
        type, nodeId: node.id, depth: node.depth, activeIds: node.pointIds.slice(),
        leaders: [], assignments: [], clusters: [], leaves: leaves.map(l=>({id:l.id, pointIds:l.pointIds.slice()})),
        title: "", text: "", line: type, ...extra,
        replica: membershipLoad(leaves)
      });
      node.lastStep = snapshots.length-1;
    }

    function mergeSmallClusters(clusters, rng) {
      const regular = clusters.filter(c=>c.pointIds.length >= params.cmin);
      const small = shuffle(clusters.filter(c=>c.pointIds.length < params.cmin), rng);
      for (const cluster of small) {
        if (cluster.consumed) continue;
        let best = -1, bestSize = Infinity;
        for (let i=0; i<regular.length; i++) {
          const mergedSize = unique([...regular[i].pointIds, ...cluster.pointIds]).length;
          if (mergedSize <= params.cmax && regular[i].pointIds.length < bestSize) { best=i; bestSize=regular[i].pointIds.length; }
        }
        if (best >= 0) {
          regular[best].pointIds = unique([...regular[best].pointIds, ...cluster.pointIds]);
          regular[best].mergedFrom.push(cluster.leaderId);
        } else {
          const other = small.find(c=>c!==cluster && !c.consumed && unique([...c.pointIds,...cluster.pointIds]).length<=params.cmax);
          if (other) {
            cluster.pointIds = unique([...cluster.pointIds,...other.pointIds]); cluster.mergedFrom.push(other.leaderId); other.consumed=true;
          }
          if (!cluster.consumed) regular.push(cluster);
        }
      }
      return regular.filter(c=>!c.consumed && c.pointIds.length);
    }

    function forcedSplit(node, rng) {
      const ids = node.pointIds.slice().sort((a,b)=>points[a].x-points[b].x || points[a].y-points[b].y);
      const chunks = [];
      for (let i=0; i<ids.length; i+=params.cmax-1) chunks.push(ids.slice(i,i+params.cmax-1));
      return chunks.map((pointIds,i)=>({leaderId:null, pointIds, mergedFrom:[], forced:true, order:i}));
    }

    function buildWalkthrough() {
      snapshots=[]; treeNodes=[]; step=0; stopPlay();
      const rng = mulberry32(params.seed ^ 0xA53C9E17);
      const root = {id:0, parentId:null, depth:0, pointIds:points.map(p=>p.id), status:"queued", childIds:[], lastStep:0, createdStep:0};
      treeNodes.push(root);
      makeSnapshot("base", root, {title:"Start with one subproblem", text:`The root contains all ${params.n} points. Ball carving recursively replaces oversized subproblems with smaller, possibly overlapping ones.`});
      const queue=[root];
      let safety=0;
      while (queue.length && safety++ < 500) {
        const node=queue.shift(); node.status="active";
        makeSnapshot("base", node, {title:`Check subproblem P${node.id}`, text:`P${node.id} has ${node.pointIds.length} points. ${node.pointIds.length <= params.cmax ? `That is at most Cmax = ${params.cmax}, so it is already a leaf.` : `That exceeds Cmax = ${params.cmax}, so we carve it.`}`});
        if (node.pointIds.length <= params.cmax) {
          node.status="leaf";
          makeSnapshot("return", node, {title:`Return P${node.id} as a leaf`, text:`This ${node.pointIds.length}-point partition is small enough for cache-friendly leaf processing.`});
          continue;
        }

        const desired=Math.max(2, Math.floor(params.leaderFraction*node.pointIds.length));
        const leaderCount=Math.min(params.leaderCap, desired, node.pointIds.length);
        const leaders=shuffle(node.pointIds,rng).slice(0,leaderCount);
        makeSnapshot("leaders", node, {leaders, title:`Sample ${leaders.length} leaders`, text:`ℓ = min(cap, max(2, ⌊Psamp · |P|⌋)) = ${leaders.length}. These randomly chosen points become local centers.`});

        const f=Math.min(params.fanout[Math.min(node.depth,3)], leaders.length);
        makeSnapshot("fanout", node, {leaders, title:`Use fanout f(${node.depth}) = ${f}`, text:`Every point will join its ${f} nearest leader${f===1?"":"s"}. ${f>1?"This is where overlapping subproblems are created.":"At this depth the assignment is disjoint."}`});

        let clusters=leaders.map(leaderId=>({leaderId, pointIds:[], mergedFrom:[]}));
        const assignments=[];
        for (const id of node.pointIds) {
          const nearest=leaders.slice().sort((a,b)=>dist2(points[id],points[a])-dist2(points[id],points[b])).slice(0,f);
          for (const leaderId of nearest) {
            clusters[leaders.indexOf(leaderId)].pointIds.push(id);
            assignments.push({pointId:id, leaderId});
          }
        }
        clusters=clusters.filter(c=>c.pointIds.length);
        makeSnapshot("assign", node, {leaders, assignments, clusters:structuredClone(clusters), title:`Assign points to nearest leaders`, text:`${node.pointIds.length} points produce ${assignments.length} memberships across ${clusters.length} balls (${(assignments.length/node.pointIds.length).toFixed(2)}× local overlap).`});

        const before=clusters.length;
        clusters=mergeSmallClusters(clusters,rng);
        makeSnapshot("merge", node, {leaders, assignments, clusters:structuredClone(clusters), title:"Merge undersized balls", text:`Clusters below Cmin = ${params.cmin} are randomly paired or absorbed when the union stays within Cmax. ${before} balls become ${clusters.length}.`});

        const nonShrinking=clusters.some(c=>c.pointIds.length>=node.pointIds.length);
        if (nonShrinking || node.depth>=12) {
          clusters=forcedSplit(node,rng);
          makeSnapshot("recurse", node, {clusters:structuredClone(clusters), title:"Apply the progress safeguard", text:"This fanout schedule produced a child as large as its parent. For a responsive teaching demo, that branch is split along the x-axis; lower fanout or a larger leader fraction avoids this safeguard.", warning:true});
        }

        node.status="branch";
        for (const cluster of clusters) {
          const child={id:treeNodes.length,parentId:node.id,depth:node.depth+1,pointIds:cluster.pointIds,status:"queued",childIds:[],lastStep:snapshots.length,createdStep:snapshots.length};
          treeNodes.push(child); node.childIds.push(child.id); queue.push(child);
        }
        makeSnapshot("recurse", node, {clusters:structuredClone(clusters), title:`Recurse into ${clusters.length} subproblems`, text:`Each ball becomes a child. Children at or below Cmax will return as leaves; larger children repeat the process at depth ${node.depth+1}.`});
      }
      const leaves=treeNodes.filter(n=>n.status==="leaf");
      snapshots.push({type:"return",line:"return",nodeId:0,depth:0,activeIds:points.map(p=>p.id),leaders:[],assignments:[],clusters:leaves.map(l=>({leaderId:null,pointIds:l.pointIds.slice(),mergedFrom:[]})),leaves:leaves.map(l=>({id:l.id,pointIds:l.pointIds.slice()})),title:"Ball carving complete",text:`Produced ${leaves.length} leaves with ${leaves.reduce((s,l)=>s+l.pointIds.length,0)} total memberships. The ${(membershipLoad(leaves)).toFixed(2)}× load measures overlap relative to the ${params.n} original points.`,replica:membershipLoad(leaves),done:true});
      renderEventLog(); render();
    }

    function resizeCanvas() {
      const r=el("vizWrap").getBoundingClientRect(); dpr=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.round(r.width*dpr); canvas.height=Math.round(r.height*dpr);
      canvas.style.width=r.width+"px"; canvas.style.height=r.height+"px"; renderCanvas();
    }

    function toScreen(p) {
      const w=canvas.width/dpr, h=canvas.height/dpr, pad=36;
      return {x:pad+p.x*(w-pad*2), y:pad+p.y*(h-pad*2)};
    }

    function clusterMap(s) {
      const map=new Map();
      s.clusters.forEach((c,i)=>c.pointIds.forEach(id=>{ if(!map.has(id)) map.set(id,[]); map.get(id).push(i); }));
      return map;
    }

    function renderCanvas() {
      if (!snapshots.length || !canvas.width) return;
      const s=snapshots[step], w=canvas.width/dpr, h=canvas.height/dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
      ctx.fillStyle=isDark()?"#0d151b":"#fbfaf5"; ctx.fillRect(0,0,w,h);

      const active=new Set(s.activeIds), leaders=new Set(s.leaders), cmap=clusterMap(s);
      if (s.assignments.length && s.activeIds.length <= 180) {
        ctx.globalAlpha=.13; ctx.lineWidth=.7;
        for (const a of s.assignments) {
          const p=toScreen(points[a.pointId]), l=toScreen(points[a.leaderId]);
          const colors=palette(); ctx.strokeStyle=colors[s.leaders.indexOf(a.leaderId)%colors.length];
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(l.x,l.y); ctx.stroke();
        }
        ctx.globalAlpha=1;
      }

      for (const p of points) {
        const q=toScreen(p), membership=cmap.get(p.id)||[];
        if (membership.length>1) {
          const colors=palette(); membership.slice(0,4).forEach((ci,j)=>{ ctx.beginPath(); ctx.strokeStyle=colors[ci%colors.length]; ctx.lineWidth=2; ctx.arc(q.x,q.y,7+j*2,0,Math.PI*2); ctx.stroke(); });
        }
        ctx.beginPath();
        const radius=leaders.has(p.id)?7.2:(hoverPoint===p.id?6.2:4.1);
        ctx.arc(q.x,q.y,radius,0,Math.PI*2);
        if (leaders.has(p.id)) ctx.fillStyle="#e86f51";
        else if (active.has(p.id)) { const colors=palette(); ctx.fillStyle=membership.length?colors[membership[0]%colors.length]:(isDark()?"#57d4d0":"#2d765d"); }
        else ctx.fillStyle=isDark()?"#52616b":"#cbc7bc";
        ctx.fill(); ctx.strokeStyle=isDark()?"#0d151b":"#fffdf8"; ctx.lineWidth=leaders.has(p.id)?2:1; ctx.stroke();
      }

      if (hoverPoint!==null) {
        const p=points[hoverPoint], q=toScreen(p), memberships=(cmap.get(p.id)||[]).length;
        const text=`p${p.id} · ${memberships || (active.has(p.id)?1:0)} current membership${memberships===1?"":"s"}`;
        ctx.font="700 11px Inter, sans-serif"; const tw=ctx.measureText(text).width;
        const x=clamp(q.x+12,6,w-tw-20), y=clamp(q.y-30,20,h-8);
        ctx.fillStyle=isDark()?"rgba(238,243,245,.94)":"rgba(21,33,29,.92)"; roundRect(ctx,x,y-15,tw+14,24,7); ctx.fill();
        ctx.fillStyle=isDark()?"#15211d":"white"; ctx.fillText(text,x+7,y+1);
      }
    }

    function roundRect(c,x,y,w,h,r) {
      c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
    }

    function renderTree() {
      const visible=treeNodes.filter(n=>n.createdStep<=step || n.id===0);
      const byDepth=new Map(); visible.forEach(n=>{ if(!byDepth.has(n.depth))byDepth.set(n.depth,[]); byDepth.get(n.depth).push(n); });
      const maxDepth=Math.max(...visible.map(n=>n.depth),0), width=Math.max(290,...[...byDepth.values()].map(a=>a.length*46));
      const height=Math.max(235,55+maxDepth*62), positions=new Map();
      byDepth.forEach((arr,d)=>arr.forEach((n,i)=>positions.set(n.id,{x:(i+1)*width/(arr.length+1),y:28+d*62})));
      const svg=el("tree"); svg.setAttribute("viewBox",`0 0 ${width} ${height}`); svg.style.width=width+"px"; svg.style.height=height+"px";
      let html="";
      visible.forEach(n=>{ if(n.parentId!==null && positions.has(n.parentId)){const a=positions.get(n.parentId),b=positions.get(n.id);html+=`<line class="tree-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}});
      const current=snapshots[step].nodeId;
      visible.forEach(n=>{const p=positions.get(n.id),cls=`tree-node ${n.id===current?"current":""} ${n.status==="leaf"?"leaf":""}`;html+=`<g class="${cls}" data-node="${n.id}" transform="translate(${p.x},${p.y})"><circle r="10"/><text y="-15">P${n.id}</text><text y="24">${n.pointIds.length}</text></g>`;});
      svg.innerHTML=html;
      svg.querySelectorAll(".tree-node").forEach(g=>g.addEventListener("click",()=>jumpTo(treeNodes[+g.dataset.node].lastStep)));
      el("treeStat").textContent=`${visible.length} node${visible.length===1?"":"s"}`;
    }

    function renderEventLog() {
      el("eventLog").innerHTML=snapshots.map((s,i)=>`<div class="event" data-step="${i}"><b>${i+1}.</b> ${s.title}</div>`).join("");
      el("eventLog").querySelectorAll(".event").forEach(x=>x.addEventListener("click",()=>jumpTo(+x.dataset.step)));
    }

    function render() {
      if (!snapshots.length) return;
      const s=snapshots[step];
      el("phase").textContent=s.type==="base"?"Base case":s.type;
      el("stepTitle").textContent=s.title; el("stepText").textContent=s.text;
      el("depthBadge").textContent=s.done?"Complete":`Depth ${s.depth} · P${s.nodeId}`;
      el("stepCount").textContent=`Step ${step+1} / ${snapshots.length}`;
      el("progressFill").style.width=`${snapshots.length===1?100:step/(snapshots.length-1)*100}%`;
      el("mActive").textContent=s.activeIds.length; el("mLeaders").textContent=s.leaders.length;
      el("mLeaves").textContent=s.leaves.length; el("mReplica").textContent=`${s.replica.toFixed(2)}×`;
      el("firstBtn").disabled=el("prevBtn").disabled=step===0;
      el("lastBtn").disabled=el("nextBtn").disabled=step===snapshots.length-1;
      document.querySelectorAll(".pseudo li").forEach(li=>li.classList.toggle("on",li.dataset.line===s.line));
      el("lineBadge").textContent=s.line==="base"?"lines 1–2":s.line;
      el("warning").style.display=s.warning?"block":"none";
      if(s.warning)el("warning").textContent="A non-shrinking branch was detected. The visualization used its progress safeguard for this step.";
      document.querySelectorAll(".event").forEach((x,i)=>x.classList.toggle("active",i===step));
      renderCanvas(); renderTree();
    }

    function jumpTo(i){ step=clamp(i,0,snapshots.length-1); render(); }
    function stopPlay(){ if(timer)clearInterval(timer); timer=null; if(el("playBtn")){el("playBtn").textContent="▶ Play";el("playBtn").classList.add("primary");} }
    function togglePlay(){
      if(timer){stopPlay();return;}
      if(step===snapshots.length-1)step=0;
      el("playBtn").textContent="❚❚ Pause"; el("playBtn").classList.remove("primary");
      timer=setInterval(()=>{if(step>=snapshots.length-1){stopPlay();return;}step++;render();}, 2050-(+el("speed").value));
    }

    function rebuild(regenerate=false) {
      params=readParams();
      if(regenerate){params.seed=params.seed%999999+1;el("seed").value=params.seed;}
      generatePoints(); buildWalkthrough(); resizeCanvas();
    }

    el("applyBtn").addEventListener("click",()=>rebuild(false));
    el("regenBtn").addEventListener("click",()=>rebuild(true));
    el("firstBtn").addEventListener("click",()=>jumpTo(0));
    el("prevBtn").addEventListener("click",()=>jumpTo(step-1));
    el("nextBtn").addEventListener("click",()=>jumpTo(step+1));
    el("lastBtn").addEventListener("click",()=>jumpTo(snapshots.length-1));
    el("playBtn").addEventListener("click",togglePlay);
    el("speed").addEventListener("input",()=>{if(timer){stopPlay();togglePlay();}});
    window.addEventListener("resize",resizeCanvas);
    window.addEventListener("keydown",e=>{if(e.key==="ArrowRight")jumpTo(step+1);if(e.key==="ArrowLeft")jumpTo(step-1);if(e.key===" "){e.preventDefault();togglePlay();}});
    canvas.addEventListener("mousemove",e=>{
      const r=canvas.getBoundingClientRect(), mx=e.clientX-r.left,my=e.clientY-r.top;
      let best=null,bestD=90;
      for(const p of points){const q=toScreen(p),d=(q.x-mx)**2+(q.y-my)**2;if(d<bestD){bestD=d;best=p.id;}}
      if(best!==hoverPoint){hoverPoint=best;renderCanvas();}
    });
    canvas.addEventListener("mouseleave",()=>{hoverPoint=null;renderCanvas();});

    el("themeToggle").addEventListener("click",()=>{
      const dark=!isDark(); document.documentElement.dataset.theme=dark?"dark":"light";
      el("themeToggle").textContent=dark?"☀ Light":"☾ Dark"; renderCanvas();
    });

    params=readParams(); generatePoints(); buildWalkthrough();
    requestAnimationFrame(resizeCanvas);
