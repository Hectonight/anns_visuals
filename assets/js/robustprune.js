(() => {
      'use strict';

      const $ = id => document.getElementById(id);
      const canvas = $('canvas');
      const viewport = $('viewport');
      const ctx = canvas.getContext('2d');
      const els = {
        alpha: $('alphaInput'), alphaValue: $('alphaValue'), distribution: $('distributionInput'), degree: $('degreeInput'), count: $('countInput'), range: $('rangeInput'), seed: $('seedInput'),
        first: $('firstBtn'), prev: $('prevBtn'), play: $('playBtn'), next: $('nextBtn'), last: $('lastBtn'), progress: $('progressFill'), stepCount: $('stepCount'),
        phase: $('phase'), title: $('stepTitle'), text: $('stepText'),
        kept: $('statKept'), live: $('statLive'), pruned: $('statPruned'), comparisons: $('statComparisons'),
        candidateStatus: $('candidateStatus'), candidateDot: $('candidateDot'), candidateName: $('candidateName'), candidateDistance: $('candidateDistance'),
        lhs: $('lhsValue'), rhs: $('rhsValue'), relation: $('relation'), decision: $('decision'), neighbors: $('neighbors'), neighborCount: $('neighborCount'), trail: $('trail')
      };

      let points = [];
      let steps = [];
      let stepIndex = 0;
      let selectedId = null;
      let timer = null;
      let draggingId = null;
      let panning = false;
      let lastPointer = null;
      let moved = false;
      let dpr = 1;
      let needsFit = true;
      let view = { width: 1, height: 1, scale: 50, panX: 0, panY: 0 };

      function mulberry32(seed) {
        return function() {
          let t = seed += 0x6D2B79F5;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }

      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
      const anchor = { x: 0, y: 0 };
      const pointById = id => points.find(p => p.id === id);

      function generatePoints() {
        const count = Math.max(parseInt(els.count.value, 10) || 20, 6);
        const range = Math.max(parseFloat(els.range.value) || 1, .1);
        const seed = clamp(parseInt(els.seed.value, 10) || 858, 1, 999999);
        els.count.value = count;
        els.range.value = range;
        els.seed.value = seed;
        const rand = mulberry32(seed);
        points = [];
        const phase = rand() * Math.PI * 2;
        const distribution = els.distribution.value;
        const normal = () => {
          const u = Math.max(rand(), 1e-12);
          return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
        };
        const clusterCenters = [
          { x: -.45 * range, y: -.28 * range },
          { x: .46 * range, y: -.12 * range },
          { x: .02 * range, y: .48 * range }
        ];
        for (let i = 0; i < count; i++) {
          let x, y;
          if (distribution === 'disk') {
            const angle = rand() * Math.PI * 2;
            const radius = range * .88 * Math.sqrt(rand());
            x = Math.cos(angle) * radius;
            y = Math.sin(angle) * radius;
          } else if (distribution === 'square') {
            x = (rand() * 1.76 - .88) * range;
            y = (rand() * 1.76 - .88) * range;
          } else if (distribution === 'clusters') {
            const center = clusterCenters[i % clusterCenters.length];
            x = clamp(center.x + normal() * range * .12, -.92 * range, .92 * range);
            y = clamp(center.y + normal() * range * .12, -.92 * range, .92 * range);
          } else if (distribution === 'spiral') {
            const progress = count === 1 ? 0 : i / (count - 1);
            const angle = phase + i * .92 + (rand() - .5) * .2;
            const radius = range * (.08 + .78 * progress + (rand() - .5) * .045);
            x = Math.cos(angle) * radius;
            y = Math.sin(angle) * radius;
          } else if (distribution === 'line') {
            x = (rand() * 1.76 - .88) * range;
            y = normal() * range * .035;
          } else {
            const band = i % 4;
            const angle = phase + i * 2.399963 + (rand() - .5) * .42;
            const radius = range * (.22 + band * .14 + rand() * .26);
            x = Math.cos(angle) * radius;
            y = Math.sin(angle) * radius;
          }
          points.push({ id: i, x, y, old: i < Math.min(4, count) });
        }
        selectedId = null;
        needsFit = true;
        if (view.width > 1 && view.height > 1) resetView();
        rebuild(0);
      }

      function buildSteps() {
        const alpha = parseFloat(els.alpha.value);
        const R = clamp(parseInt(els.degree.value, 10) || 6, 1, 12);
        els.degree.value = R;
        let live = points.map(p => p.id);
        const kept = [];
        const gone = [];
        let comparisons = 0;
        const result = [{
          kind: 'init', round: 0, live: [...live], kept: [], gone: [], chosen: null, prunedNow: [], comparisons,
          phase: 'Initialize', title: 'Merge candidates and clear the old list',
          text: `RobustPrune begins with all ${live.length} candidates, including any old out-neighbors, removes p itself, and rebuilds Nout(p) from scratch.`
        }];

        let round = 0;
        while (live.length && kept.length < R) {
          round++;
          let chosen = live[0];
          for (const id of live) if (dist(pointById(id), anchor) < dist(pointById(chosen), anchor)) chosen = id;
          const before = [...live];
          kept.push(chosen);
          live = live.filter(id => id !== chosen);
          result.push({
            kind: 'choose', round, live: [...before], kept: [...kept], gone: [...gone], chosen, prunedNow: [], comparisons,
            phase: `Round ${round} · choose`, title: `Keep c${chosen}: the nearest remaining candidate`,
            text: `The edge p → c${chosen} is committed. Every other live candidate will now be tested for directional redundancy against c${chosen}.`
          });

          if (kept.length >= R) {
            result.push({
              kind: 'stop', round, live: [...live], kept: [...kept], gone: [...gone], chosen, prunedNow: [], comparisons,
              phase: `Round ${round} · stop`, title: `Degree bound R = ${R} reached`,
              text: `The procedure stops immediately after selecting its ${R}${R === 1 ? 'st' : R === 2 ? 'nd' : R === 3 ? 'rd' : 'th'} neighbor. Remaining candidates are not needed.`
            });
            break;
          }

          const y = pointById(chosen);
          const prunedNow = [];
          for (const id of live) {
            comparisons++;
            const z = pointById(id);
            if (alpha * dist(y, z) <= dist(anchor, z) + 1e-12) prunedNow.push(id);
          }
          live = live.filter(id => !prunedNow.includes(id));
          gone.push(...prunedNow);
          result.push({
            kind: 'prune', round, live: [...live], kept: [...kept], gone: [...gone], chosen, prunedNow: [...prunedNow], comparisons,
            phase: `Round ${round} · prune`, title: prunedNow.length ? `c${chosen} covers ${prunedNow.length} candidate${prunedNow.length === 1 ? '' : 's'}` : `c${chosen} covers no other candidate`,
            text: prunedNow.length
              ? `Every crossed point satisfies α · d(c${chosen}, z) ≤ d(p, z), so the route through c${chosen} is strong enough to make its direct edge from p redundant.`
              : `No live candidate lies in c${chosen}'s shaded prune region at α = ${alpha.toFixed(2)}. All remaining directions survive to the next round.`
          });
        }

        if (!live.length && result[result.length - 1].kind !== 'stop') {
          result.push({
            kind: 'done', round, live: [], kept: [...kept], gone: [...gone], chosen: null, prunedNow: [], comparisons,
            phase: 'Complete', title: `RobustPrune returns ${kept.length} neighbor${kept.length === 1 ? '' : 's'}`,
            text: `The candidate set is empty before the degree bound is reached. The retained edges span distinct geometric directions around p.`
          });
        }
        return result;
      }

      function rebuild(preferredStep = stepIndex) {
        stopPlaying();
        els.alphaValue.textContent = parseFloat(els.alpha.value).toFixed(2);
        steps = buildSteps();
        stepIndex = clamp(preferredStep, 0, steps.length - 1);
        renderAll();
      }

      function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
      function resizeCanvas() {
        const rect = viewport.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        view.width = rect.width;
        view.height = rect.height;
        if (needsFit && points.length) resetView();
        draw();
      }
      function toScreen(p) { return { x: view.width / 2 + view.panX + p.x * view.scale, y: view.height / 2 + view.panY - p.y * view.scale }; }
      function toWorld(x, y) { return { x: (x - view.width / 2 - view.panX) / view.scale, y: -(y - view.height / 2 - view.panY) / view.scale }; }

      function resetView() {
        const range = Math.max(parseFloat(els.range.value) || 1, .1);
        view.scale = Math.min(view.width, view.height) * .57 / range;
        view.panX = 0;
        view.panY = 0;
        needsFit = false;
      }

      function fitView() {
        if (!points.length || view.width <= 1 || view.height <= 1) return;
        let minX = 0, maxX = 0, minY = 0, maxY = 0;
        for (const p of points) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const spanX = Math.max(maxX - minX, .1), spanY = Math.max(maxY - minY, .1);
        const padX = Math.max(54, view.width * .1), padY = Math.max(54, view.height * .1);
        view.scale = clamp(Math.min((view.width - padX * 2) / spanX, (view.height - padY * 2) / spanY), 1e-9, 1e9);
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
        view.panX = -centerX * view.scale;
        view.panY = centerY * view.scale;
        needsFit = false;
      }

      function drawArrow(from, to, color, width = 2, alpha = 1) {
        const a = toScreen(from), b = toScreen(to);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const r0 = 17, r1 = 12;
        const sx = a.x + Math.cos(angle) * r0, sy = a.y + Math.sin(angle) * r0;
        const ex = b.x - Math.cos(angle) * r1, ey = b.y - Math.sin(angle) * r1;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(angle - .55) * 8, ey - Math.sin(angle - .55) * 8); ctx.lineTo(ex - Math.cos(angle + .55) * 8, ey - Math.sin(angle + .55) * 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      function drawPruneRegion(y, alpha) {
        const p = toScreen(anchor), q = toScreen(y);
        ctx.save();
        ctx.fillStyle = css('--rose');
        ctx.globalAlpha = document.documentElement.dataset.theme === 'dark' ? .12 : .095;
        if (Math.abs(alpha - 1) < 1e-6) {
          const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len, px = -uy, py = ux;
          const bx = (p.x + q.x) / 2, by = (p.y + q.y) / 2, far = 6000;
          ctx.beginPath();
          ctx.moveTo(bx + px * far, by + py * far);
          ctx.lineTo(bx - px * far, by - py * far);
          ctx.lineTo(bx - px * far + ux * far, by - py * far + uy * far);
          ctx.lineTo(bx + px * far + ux * far, by + py * far + uy * far);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = .48; ctx.strokeStyle = css('--rose'); ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(bx + px * far, by + py * far); ctx.lineTo(bx - px * far, by - py * far); ctx.stroke();
        } else {
          const a2 = alpha * alpha;
          const factor = a2 / (a2 - 1);
          const center = { x: y.x * factor, y: y.y * factor };
          const radius = alpha / (a2 - 1) * dist(anchor, y);
          const c = toScreen(center);
          ctx.beginPath(); ctx.arc(c.x, c.y, radius * view.scale, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = .5; ctx.strokeStyle = css('--rose'); ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      }

      function drawGrid() {
        ctx.save(); ctx.strokeStyle = css('--line'); ctx.globalAlpha = .45; ctx.lineWidth = 1;
        const range = Math.max(parseFloat(els.range.value) || 1, .1);
        let spacing = view.scale * range * .2;
        while (spacing < 22) spacing *= 5;
        while (spacing > 180) spacing /= 5;
        const origin = toScreen(anchor);
        for (let x = origin.x % spacing; x < view.width; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, view.height); ctx.stroke(); }
        for (let y = origin.y % spacing; y < view.height; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.width, y); ctx.stroke(); }
        ctx.globalAlpha = .8;
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(view.width, origin.y); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, view.height); ctx.stroke();
        ctx.restore();
      }

      function drawPoint(p, status, chosen, selected) {
        const s = toScreen(p);
        const colors = { live: css('--amber'), kept: css('--green'), gone: css('--rose') };
        const color = colors[status];
        ctx.save();
        if (status === 'gone') ctx.globalAlpha = .43;
        ctx.fillStyle = color; ctx.strokeStyle = selected ? css('--text') : css('--surface'); ctx.lineWidth = selected ? 3 : 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, chosen ? 11 : 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (status === 'gone') {
          ctx.globalAlpha = .8; ctx.strokeStyle = css('--rose'); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s.x - 6, s.y - 6); ctx.lineTo(s.x + 6, s.y + 6); ctx.moveTo(s.x + 6, s.y - 6); ctx.lineTo(s.x - 6, s.y + 6); ctx.stroke();
        }
        ctx.globalAlpha = status === 'gone' ? .55 : 1; ctx.fillStyle = css('--text'); ctx.font = '700 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(`c${p.id}`, s.x, s.y - 14);
        ctx.restore();
      }

      function draw() {
        if (!steps.length) return;
        const step = steps[stepIndex];
        const alpha = parseFloat(els.alpha.value);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, view.width, view.height);
        drawGrid();
        if ((step.kind === 'prune' || step.kind === 'choose') && step.chosen !== null) drawPruneRegion(pointById(step.chosen), alpha);

        for (const id of step.kept) drawArrow(anchor, pointById(id), css('--green'), id === step.chosen ? 2.8 : 1.8, id === step.chosen ? .95 : .55);
        if (step.kind === 'prune' && step.chosen !== null) {
          const y = pointById(step.chosen);
          for (const id of step.prunedNow) {
            const z = pointById(id); const a = toScreen(y), b = toScreen(z);
            ctx.save(); ctx.strokeStyle = css('--rose'); ctx.globalAlpha = .48; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
          }
        }

        const keptSet = new Set(step.kept), goneSet = new Set(step.gone);
        for (const p of points) {
          const status = goneSet.has(p.id) ? 'gone' : keptSet.has(p.id) ? 'kept' : 'live';
          drawPoint(p, status, p.id === step.chosen, p.id === selectedId);
        }
        const a = toScreen(anchor);
        ctx.save(); ctx.fillStyle = css('--cyan'); ctx.strokeStyle = css('--surface'); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(a.x, a.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#071012' : '#fffdf8'; ctx.font = '900 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('p', a.x, a.y + .5); ctx.restore();
      }

      function statusOf(id, step) {
        if (step.gone.includes(id)) return 'pruned';
        if (step.kept.includes(id)) return 'kept';
        return 'candidate';
      }

      function updateInspector() {
        const step = steps[stepIndex];
        if (selectedId === null || !pointById(selectedId)) {
          els.candidateStatus.textContent = 'none';
          els.candidateDot.textContent = '—';
          els.candidateDot.style.background = 'var(--surface-2)';
          els.candidateName.textContent = 'no candidate selected';
          els.candidateDistance.textContent = 'Click a point to inspect it';
          els.lhs.textContent = '—'; els.rhs.textContent = '—'; els.relation.textContent = '≤';
          els.decision.className = 'decision';
          els.decision.textContent = 'Showing the entire candidate set. Select a point only when you want its coverage test.';
          return;
        }
        const z = pointById(selectedId);
        const status = statusOf(selectedId, step);
        els.candidateStatus.textContent = status;
        els.candidateDot.textContent = `c${z.id}`;
        els.candidateDot.style.background = status === 'kept' ? 'var(--green)' : status === 'pruned' ? 'var(--rose)' : 'var(--amber)';
        els.candidateName.textContent = `${z.old ? 'old neighbor' : 'candidate'} c${z.id}`;
        els.candidateDistance.textContent = `d(p, c${z.id}) = ${dist(anchor, z).toFixed(3)}`;
        els.decision.className = 'decision';

        if ((step.kind === 'prune' || step.kind === 'choose') && step.chosen !== null && selectedId !== step.chosen) {
          const y = pointById(step.chosen);
          const lhs = parseFloat(els.alpha.value) * dist(y, z);
          const rhs = dist(anchor, z);
          const passes = lhs <= rhs + 1e-12;
          els.lhs.textContent = lhs.toFixed(3);
          els.rhs.textContent = rhs.toFixed(3);
          els.relation.textContent = passes ? '≤' : '>';
          if (step.kind === 'choose') {
            els.decision.textContent = passes ? `At the next step, c${step.chosen} will prune c${z.id}.` : `c${z.id} is outside c${step.chosen}'s coverage region and will survive this round.`;
          } else if (step.prunedNow.includes(z.id)) {
            els.decision.textContent = `Pruned now: routing p → c${step.chosen} → c${z.id} is sufficiently short under α = ${parseFloat(els.alpha.value).toFixed(2)}.`;
            els.decision.classList.add('bad');
          } else if (status === 'pruned') {
            els.decision.textContent = `c${z.id} was pruned in an earlier round.`;
            els.decision.classList.add('bad');
          } else {
            els.decision.textContent = `Survives this test: c${step.chosen} is not a strong enough intermediary for c${z.id}.`;
            els.decision.classList.add('good');
          }
        } else {
          els.lhs.textContent = '—'; els.rhs.textContent = dist(anchor, z).toFixed(3); els.relation.textContent = '≤';
          if (selectedId === step.chosen) els.decision.textContent = `c${z.id} is the retained witness y for this round; select another point to inspect its coverage test.`;
          else els.decision.textContent = status === 'kept' ? `c${z.id} is in the output neighborhood.` : status === 'pruned' ? `c${z.id} was removed as directionally redundant.` : 'Advance to a prune step to inspect the coverage test.';
        }
      }

      function updateNeighbors() {
        const step = steps[stepIndex];
        els.neighborCount.textContent = `${step.kept.length} / ${els.degree.value}`;
        if (!step.kept.length) { els.neighbors.innerHTML = '<div class="empty">No edges selected yet. The nearest live candidate will be chosen first.</div>'; return; }
        els.neighbors.innerHTML = step.kept.map((id, i) => {
          const p = pointById(id);
          return `<div class="neighbor"><span class="id">c${id}</span><span>${i === step.kept.length - 1 && id === step.chosen ? 'latest retained edge' : 'retained edge'}</span><span class="distance">${dist(anchor, p).toFixed(3)}</span></div>`;
        }).join('');
      }

      function updateTrail() {
        els.trail.innerHTML = steps.map((s, i) => {
          const label = s.kind === 'init' ? 'Initialize candidate pool' : s.kind === 'choose' ? `Round ${s.round}: keep c${s.chosen}` : s.kind === 'prune' ? `Round ${s.round}: prune ${s.prunedNow.length}` : s.kind === 'stop' ? `Stop at R = ${els.degree.value}` : 'Return neighborhood';
          return `<div class="event${i === stepIndex ? ' active' : ''}" data-step="${i}"><strong>${i + 1}.</strong> ${label}</div>`;
        }).join('');
        els.trail.querySelectorAll('.event').forEach(el => el.addEventListener('click', () => goTo(Number(el.dataset.step))));
      }

      function renderAll() {
        if (!steps.length) return;
        const step = steps[stepIndex];
        els.phase.textContent = step.phase;
        els.title.textContent = step.title;
        els.text.textContent = step.text;
        els.kept.textContent = `${step.kept.length} / ${els.degree.value}`;
        els.live.textContent = step.live.length;
        els.pruned.textContent = step.gone.length;
        els.comparisons.textContent = step.comparisons;
        els.stepCount.textContent = `Step ${stepIndex + 1} / ${steps.length}`;
        els.progress.style.width = `${steps.length <= 1 ? 100 : stepIndex / (steps.length - 1) * 100}%`;
        const progress = els.progress.parentElement;
        progress.setAttribute('aria-valuemax', steps.length);
        progress.setAttribute('aria-valuenow', stepIndex + 1);
        els.first.disabled = els.prev.disabled = stepIndex === 0;
        els.last.disabled = els.next.disabled = stepIndex === steps.length - 1;
        updateInspector(); updateNeighbors(); updateTrail(); draw();
      }

      function goTo(i) { stepIndex = clamp(i, 0, steps.length - 1); renderAll(); }
      function stopPlaying() { if (timer) clearInterval(timer); timer = null; els.play.textContent = '▶ Play'; }
      function togglePlay() {
        if (timer) { stopPlaying(); return; }
        if (stepIndex >= steps.length - 1) goTo(0);
        els.play.textContent = '❚❚ Pause';
        timer = setInterval(() => {
          if (stepIndex >= steps.length - 1) { stopPlaying(); return; }
          goTo(stepIndex + 1);
        }, 1150);
      }

      function pointerPosition(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
      function nearestAt(pos) {
        let best = null, bestD = 24;
        for (const p of points) { const s = toScreen(p); const d = Math.hypot(s.x - pos.x, s.y - pos.y); if (d < bestD) { bestD = d; best = p.id; } }
        return best;
      }
      canvas.addEventListener('pointerdown', event => {
        const pos = pointerPosition(event);
        const id = nearestAt(pos);
        moved = false;
        lastPointer = pos;
        canvas.setPointerCapture(event.pointerId);
        if (id === null) {
          panning = true;
        } else {
          draggingId = id;
          selectedId = id;
          renderAll();
        }
      });
      canvas.addEventListener('pointermove', event => {
        const pos = pointerPosition(event);
        if (panning && lastPointer) {
          view.panX += pos.x - lastPointer.x;
          view.panY += pos.y - lastPointer.y;
          lastPointer = pos;
          moved = true;
          draw();
          return;
        }
        if (draggingId === null) return;
        const world = toWorld(pos.x, pos.y), p = pointById(draggingId);
        p.x = world.x;
        p.y = world.y;
        moved = true; steps = buildSteps(); stepIndex = clamp(stepIndex, 0, steps.length - 1); renderAll();
      });
      canvas.addEventListener('pointerup', event => {
        canvas.releasePointerCapture(event.pointerId);
        const reshaped = draggingId !== null && moved;
        const cleared = panning && !moved;
        draggingId = null; panning = false; lastPointer = null;
        if (reshaped) rebuild(stepIndex);
        else if (cleared) { selectedId = null; renderAll(); }
      });
      canvas.addEventListener('pointercancel', () => { draggingId = null; panning = false; lastPointer = null; });
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const pos = pointerPosition(event);
        const before = toWorld(pos.x, pos.y);
        const factor = Math.exp(-event.deltaY * .0015);
        view.scale = clamp(view.scale * factor, 1e-9, 1e9);
        const after = toScreen(before);
        view.panX += pos.x - after.x;
        view.panY += pos.y - after.y;
        draw();
      }, { passive: false });

      els.alpha.addEventListener('input', () => rebuild(stepIndex));
      $('applyBtn').addEventListener('click', generatePoints);
      $('regenBtn').addEventListener('click', () => { els.seed.value = (parseInt(els.seed.value, 10) || 858) + 1; generatePoints(); });
      $('fitBtn').addEventListener('click', () => { fitView(); draw(); });
      els.first.addEventListener('click', () => goTo(0));
      els.prev.addEventListener('click', () => goTo(stepIndex - 1));
      els.play.addEventListener('click', togglePlay);
      els.next.addEventListener('click', () => goTo(stepIndex + 1));
      els.last.addEventListener('click', () => goTo(steps.length - 1));
      $('themeToggle').addEventListener('click', () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        document.documentElement.dataset.theme = dark ? 'light' : 'dark';
        $('themeToggle').textContent = dark ? '☾ Dark' : '☀ Light';
        draw();
      });
      window.addEventListener('keydown', event => {
        if (event.target.matches('input, button')) return;
        if (event.key === 'Escape') { selectedId = null; renderAll(); }
        if (event.key === 'ArrowRight') goTo(stepIndex + 1);
        if (event.key === 'ArrowLeft') goTo(stepIndex - 1);
        if (event.key === ' ') { event.preventDefault(); togglePlay(); }
      });
      new ResizeObserver(resizeCanvas).observe(viewport);
      generatePoints();
    })();
