(function() {
    var API_BASE = 'https://myzlm.serveousercontent.com';
    var $ = function(s) { return document.querySelector(s); };
    var $$ = function(s) { return document.querySelectorAll(s); };

    if (typeof mermaid !== 'undefined') mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    if (typeof marked !== 'undefined') {
        var renderer = new marked.Renderer();
        renderer.code = function(code, lang) {
            if (lang === 'mermaid') return '<pre class="mermaid">' + code + '</pre>';
            try { return '<pre><code class="hljs">' + hljs.highlight(code, { language: lang || 'plaintext' }).value + '</code></pre>'; }
            catch (e) { return '<pre><code>' + code + '</code></pre>'; }
        };
        marked.use({ renderer: renderer });
    }

    function escapeHtml(t) { var m = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}; return String(t).replace(/[&<>"']/g, c => m[c]); }
    function showToast(msg, type) { type = type || 'success'; var c = $('#toastContainer'); var d = document.createElement('div'); d.className = 'toast toast-' + type; d.textContent = msg; c.appendChild(d); setTimeout(() => d.remove(), 3000); }
    function formatDate(d) { if (!d) return ''; var dt = new Date(d); var ch = ['', '元月','杏月','桃月','槐月','榴月','荷月','兰月','桂月','菊月','露月','葭月','腊月']; var m = dt.getMonth()+1; var g = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸']; var z = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥']; return g[(dt.getFullYear()-4)%10] + z[(dt.getFullYear()-4)%12] + '年·' + (ch[m]||m+'月') + dt.getDate() + '日'; }
    function calcReadTime(t) { var w = (t||'').replace(/[^\u4e00-\u9fa5a-zA-Z]/g,'').length; return Math.max(1, Math.round(w/400)); }

    var currentUser = null, articles = [], pendingApps = [], currentView = 'list', pendingDeleteId = null, activeTag = null;
    var currentTab = 'articles', applyQuotaRemaining = 0, annotationMode = false, currentAnnotationPos = null, currentArticleId = null;
    var currentSkin = 'default';

    // 权限辅助
    function isAdmin() { return currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner'); }
    function isOwner() { return currentUser && currentUser.role === 'owner'; }
    function isLoggedIn() { return !!currentUser; }

    async function apiCall(url, opt, silent) {
        opt = opt || {}; silent = silent || false;
        var config = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };
        if (opt.method) config.method = opt.method;
        if (opt.body && typeof opt.body === 'object') config.body = JSON.stringify(opt.body);
        try {
            var res = await fetch(API_BASE + url, config);
            if (!res.ok) { if (silent) return null; var d = await res.json().catch(()=>({})); throw new Error(d.error || '请求失败 ('+res.status+')'); }
            var txt = await res.text(); return txt ? JSON.parse(txt) : null;
        } catch (e) { if (silent) return null; throw e; }
    }

    // 皮肤
    function applySkin(skin) {
        document.body.classList.remove('skin-default','skin-bamboo','skin-jade');
        if (skin === 'default') document.body.classList.add('skin-default'); else document.body.classList.add('skin-'+skin);
        currentSkin = skin; localStorage.setItem('blog_skin', skin);
        document.querySelectorAll('.skin-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.skin === skin));
        clearAnnotations(); toggleAnnotationMode(false); updateAnnotateButtonVisibility();
        if (currentView === 'detail') resetJadeDecorations();
    }
    function clearAnnotations() { document.querySelectorAll('.annotation-tag').forEach(tag => tag.remove()); }
    function resetJadeDecorations() {
        var detail = $('#articleDetailContent'); if (!detail) return;
        detail.querySelectorAll('.jade-axis, .jade-seal').forEach(el => el.remove());
        if (currentSkin === 'jade') {
            var leftAxis = document.createElement('div'); leftAxis.className = 'jade-axis left';
            var rightAxis = document.createElement('div'); rightAxis.className = 'jade-axis right';
            var seal = document.createElement('div'); seal.className = 'jade-seal'; seal.textContent = '受命于天\n既寿永昌';
            detail.appendChild(leftAxis); detail.appendChild(rightAxis); detail.appendChild(seal);
            setTimeout(() => seal.classList.add('show-seal'), 2500);
            var content = detail.querySelector('.detail-content'); if (content) { content.style.animation = 'none'; void content.offsetHeight; content.style.animation = ''; }
        }
    }
    function updateAnnotateButtonVisibility() { var btn = $('#annotateToggle'); if (btn) btn.style.display = currentSkin === 'jade' ? 'block' : 'none'; }
    function toggleAnnotationMode(force) {
        annotationMode = force !== undefined ? force : !annotationMode;
        var detail = $('#articleDetailContent'); if (!detail) return;
        if (annotationMode) { detail.classList.add('annotation-mode'); $('#annotateToggle').textContent = '退出批注'; }
        else { detail.classList.remove('annotation-mode'); $('#annotateToggle').textContent = '🖌️ 朱批'; hideAnnotationInput(); }
    }
    function hideAnnotationInput() { var box = $('#annotationInputBox'); if (box) { box.style.display = 'none'; $('#annotationText').value = ''; } }

    async function checkLogin() { var data = await apiCall('/api/me', {}, true); currentUser = (data && data.username) ? data : null; updateUI(); }
    function updateUI() {
        var g = $('#greetingText'), l = $('#loginBtn'), o = $('#logoutBtn'), a = $('#adminPanelBtn'), n = $('#newArticleBtn'), ap = $('#applyArticleBtn');
        if (currentUser) {
            var roleLabel = currentUser.role === 'owner' ? '👑 盟主' : (currentUser.role === 'admin' ? '🔰 执事' : '📖 成员');
            g.textContent = roleLabel + ' ' + currentUser.username;
            l.classList.add('hidden'); o.classList.remove('hidden');
            if (isAdmin()) { a.classList.remove('hidden'); n.classList.remove('hidden'); ap.classList.add('hidden'); }
            else { a.classList.add('hidden'); n.classList.add('hidden'); ap.classList.remove('hidden'); }
        } else { g.textContent = '未登录·过客'; l.classList.remove('hidden'); o.classList.add('hidden'); a.classList.add('hidden'); n.classList.add('hidden'); ap.classList.add('hidden'); }
        if (currentView === 'list') { renderList(); renderTags(); }
        if (currentView === 'admin') renderAdmin();
        updateApplyQuota();
    }
    async function login(u, p) { var data = await apiCall('/api/login', { method: 'POST', body: { username: u, password: p } }); currentUser = { username: data.username, role: data.role }; updateUI(); showToast('欢迎回来，'+data.username); }
    async function logout() { await apiCall('/api/logout', { method: 'POST' }, true); currentUser = null; updateUI(); showToast('已登出'); switchView('list'); }
    function switchView(v) {
        currentView = v;
        $$('.view').forEach(view => view.classList.remove('active'));
        var target = $('#view' + v.charAt(0).toUpperCase() + v.slice(1)); if (target) target.classList.add('active');
        if (v === 'list') { renderList(); renderTags(); } else if (v === 'admin') { currentTab = 'articles'; renderAdmin(); }
        window.scrollTo({ top: 0 });
    }

    // 数据加载
    async function loadArticles() { try { var data = await apiCall('/api/articles'); articles = Array.isArray(data) ? data : []; } catch (e) { articles = []; } articles.sort((a,b)=> (b.pinned?1:0)-(a.pinned?1:0) || new Date(b.createdAt)-new Date(a.createdAt)); }
    async function loadApplications() { if (!isAdmin()) return; try { pendingApps = await apiCall('/api/article-applications'); } catch (e) { pendingApps = []; } $('#pendingCount').textContent = pendingApps.length; if (currentTab === 'review') renderReview(); }
    async function updateApplyQuota() { if (!isLoggedIn() || isAdmin()) { $('#applyQuota').classList.add('hidden'); return; } try { var data = await apiCall('/api/apply-quota'); applyQuotaRemaining = data.remaining; $('#applyQuota').textContent = '剩余 ' + applyQuotaRemaining + ' 次'; $('#applyQuota').classList.remove('hidden'); } catch(e) { $('#applyQuota').classList.add('hidden'); } }

    function getFiltered() { var s = $('#searchInput') ? $('#searchInput').value.trim().toLowerCase() : ''; return articles.filter(a => { var ms = true; if (s) { var t = (a.title||'').toLowerCase(), sm = (a.summary||'').toLowerCase(), tg = (a.tags||[]).join(' ').toLowerCase(); ms = t.includes(s) || sm.includes(s) || tg.includes(s); } return ms && (!activeTag || (a.tags && a.tags.includes(activeTag))); }); }
    function renderList() {
        var grid = $('#articlesGrid'), empty = $('#emptyState'); var filtered = getFiltered();
        if (!filtered.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        grid.innerHTML = filtered.map(a => `<div class="article-card${a.pinned?' pinned':''}" data-id="${escapeHtml(a.id)}"><div class="card-header"><span class="card-title">${escapeHtml(a.title)}</span><span class="card-seal">${escapeHtml(a.seal||'墨')}</span></div><p class="card-summary">${escapeHtml(a.summary||'')}</p><div class="card-meta"><span class="card-date">${formatDate(a.createdAt)}</span><span class="reading-time">${calcReadTime(a.content)} 分钟</span>${(a.tags||[]).map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}<span class="author-badge">${escapeHtml(a.author||'佚名')}</span></div></div>`).join('');
        grid.onclick = e => { var card = e.target.closest('.article-card'); if (card) viewArticle(card.dataset.id); };
        apply3DTilt();
    }
    function renderTags() { var all = {}; articles.forEach(a => (a.tags||[]).forEach(t => all[t]=true)); var arr = Object.keys(all); $('#tagFilter').innerHTML = '<span class="tag-chip' + (activeTag?'':' active') + '" data-tag="">全部</span>' + arr.map(t => `<span class="tag-chip${activeTag===t?' active':''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join(''); $('#tagFilter').onclick = e => { if (e.target.classList.contains('tag-chip')) { activeTag = e.target.dataset.tag || null; renderList(); renderTags(); } }; }

    async function viewArticle(id) { try { var a = await apiCall('/api/articles/'+encodeURIComponent(id)); if (!a) { showToast('文章不存在','error'); return; } renderDetail(a); switchView('detail'); currentArticleId = id; } catch(e) { showToast('加载失败: '+e.message,'error'); } }
    function renderDetail(a) {
        var container = $('#articleDetailContent');
        var raw = a.content || '';
        try { var contentHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw).replace(/\n/g,'<br>'); } catch(e) { contentHtml = escapeHtml(raw).replace(/\n/g,'<br>'); }
        container.innerHTML = `<div class="detail-halo"></div><div class="detail-header"><h1 class="detail-title">${escapeHtml(a.title)}</h1><div class="detail-meta"><span>📅 ${formatDate(a.createdAt)}</span>${(a.tags||[]).map(t=>`<span class="detail-tag">${escapeHtml(t)}</span>`).join('')}<span class="author-badge" style="margin-left:auto;">${escapeHtml(a.author||'佚名')}</span></div></div><div class="detail-content">${contentHtml}</div><div class="detail-actions"></div><button class="btn btn-sm annotate-btn" id="annotateToggle">🖌️ 朱批</button>`;
        container.querySelector('.detail-content').addEventListener('click', function(e) {
            if (!annotationMode || currentSkin !== 'jade') return;
            var rect = container.getBoundingClientRect();
            var x = ((e.clientX - rect.left) / rect.width * 100).toFixed(2);
            var y = ((e.clientY - rect.top) / rect.height * 100).toFixed(2);
            currentAnnotationPos = {x, y};
            $('#annotationModal').classList.add('active');
            $('#annotationText').focus();
        });
        var annotateBtn = document.getElementById('annotateToggle');
        if (annotateBtn) annotateBtn.addEventListener('click', () => toggleAnnotationMode());
        if (a.annotations) a.annotations.forEach(ann => addAnnotationTag(ann.x, ann.y, ann.text));
        resetJadeDecorations();
        updateAnnotateButtonVisibility();
        try { if (typeof renderMathInElement === 'function') renderMathInElement(container, { delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError: false }); } catch(e) {}
        try { var mn = container.querySelectorAll('.mermaid'); if (mn.length > 0) mermaid.run({ nodes: mn }); } catch(e) {}
        if (isAdmin()) {
            var actions = container.querySelector('.detail-actions');
            actions.innerHTML = `<button class="btn btn-sm" onclick="window._blogApp.editArticle('${escapeHtml(a.id)}')">✏️ 编辑</button><button class="btn btn-sm btn-danger" onclick="window._blogApp.confirmDeleteArticle('${escapeHtml(a.id)}','${escapeHtml(a.title||'')}')">🗑️ 删除</button>`;
        }
    }
    function addAnnotationTag(x, y, text) { var tag = document.createElement('div'); tag.className = 'annotation-tag'; tag.style.left = x + '%'; tag.style.top = y + '%'; tag.textContent = text; $('#articleDetailContent').appendChild(tag); }

    async function openEditor(id) {
        var modal = $('#articleModal'), titleEl = $('#articleModalTitle'), submitBtn = $('#submitArticle');
        if (id) { var a = await apiCall('/api/articles/'+encodeURIComponent(id)); if (!a) { showToast('文章不存在','error'); return; } titleEl.textContent = '✏️ 编辑文章'; submitBtn.textContent = '保 存'; $('#articleTitle').value = a.title||''; $('#articleSummary').value = a.summary||''; $('#articleTags').value = (a.tags||[]).join(', '); $('#articleSeal').value = a.seal||'墨'; $('#articleContent').value = a.content||''; $('#articlePinned').checked = !!a.pinned; $('#articleEditId').value = id; }
        else { titleEl.textContent = '📝 撰写新篇'; submitBtn.textContent = '发 布'; $('#articleTitle').value = ''; $('#articleSummary').value = ''; $('#articleTags').value = ''; $('#articleSeal').value = '墨'; $('#articleContent').value = ''; $('#articlePinned').checked = false; $('#articleEditId').value = ''; }
        modal.classList.add('active');
    }
    async function submitArticle() {
        var title = $('#articleTitle').value.trim(), content = $('#articleContent').value.trim();
        if (!title || !content) return showToast('标题和内容不能为空','error');
        var data = { title, content, summary: $('#articleSummary').value.trim(), tags: $('#articleTags').value.split(',').map(t=>t.trim()).filter(Boolean), seal: $('#articleSeal').value.trim()||'墨', pinned: $('#articlePinned').checked };
        var editId = $('#articleEditId').value;
        try { if (editId) { await apiCall('/api/articles/'+encodeURIComponent(editId), { method:'PUT', body: data }); showToast('文章已更新'); } else { await apiCall('/api/articles', { method:'POST', body: data }); showToast('文章已发布'); } $('#articleModal').classList.remove('active'); await loadArticles(); if (currentView==='list') { renderList(); renderTags(); } else if (currentView==='admin') renderAdmin(); } catch(e) { showToast('操作失败: '+e.message,'error'); }
    }
    function confirmDel(id, title) { pendingDeleteId = id; $('#confirmModal').classList.add('active'); $('#confirmModal').querySelector('p').textContent = '此操作不可恢复，确定要删除「'+(title||'这篇文章')+'」吗？'; }
    async function executeDelete() { if (!pendingDeleteId) return; try { await apiCall('/api/articles/'+encodeURIComponent(pendingDeleteId), { method:'DELETE' }); showToast('已删除'); } catch(e) { showToast('删除失败: '+e.message,'error'); } $('#confirmModal').classList.remove('active'); pendingDeleteId = null; await loadArticles(); if (currentView==='list') { renderList(); renderTags(); } else if (currentView==='admin') renderAdmin(); else if (currentView==='detail') switchView('list'); }

    function renderAdmin() {
        var container = $('#adminArticlesList'), reviewPanel = $('#reviewPanel'), quotaPanel = $('#quotaPanel');
        container.style.display = reviewPanel.style.display = quotaPanel.style.display = 'none';
        if (currentTab === 'articles') { container.style.display = 'block';
            container.innerHTML = articles.map(a => `<div class="article-manage-item" style="display:flex;justify-content:space-between;padding:0.7rem 0;border-bottom:1px dashed rgba(250,219,95,0.25);"><div><span>${escapeHtml(a.title)}</span><span style="font-size:0.75rem;color:var(--text-muted);">${formatDate(a.createdAt)} by ${escapeHtml(a.author||'佚名')}</span></div><div><button class="btn btn-sm edit-btn" data-id="${escapeHtml(a.id)}">✏️</button><button class="btn btn-sm btn-danger delete-btn" data-id="${escapeHtml(a.id)}">🗑️</button></div></div>`).join('');
            container.onclick = e => { var btn = e.target; if (btn.classList.contains('edit-btn')) openEditor(btn.dataset.id); else if (btn.classList.contains('delete-btn')) confirmDel(btn.dataset.id, btn.dataset.title); };
        } else if (currentTab === 'review') { reviewPanel.style.display = 'block'; renderReview(); } else if (currentTab === 'quota') { quotaPanel.style.display = 'block'; renderQuota(); }
    }
    function renderReview() { var container = $('#reviewList'); if (!pendingApps.length) { container.innerHTML = '<p>暂无待审核文章</p>'; return; } container.innerHTML = pendingApps.map(a => `<div class="article-manage-item" style="display:flex;justify-content:space-between;padding:0.7rem 0;border-bottom:1px dashed rgba(250,219,95,0.25);"><div><span>${escapeHtml(a.title)}</span><span style="font-size:0.75rem;">${formatDate(a.createdAt)} by ${escapeHtml(a.applicant)}</span></div><div><button class="btn btn-sm approve-btn" data-id="${escapeHtml(a.id)}">✅ 通过</button><button class="btn btn-sm btn-danger reject-btn" data-id="${escapeHtml(a.id)}">❌ 拒绝</button></div></div>`).join(''); container.onclick = e => { var id = e.target.dataset.id; if (e.target.classList.contains('approve-btn')) approveApplication(id); else if (e.target.classList.contains('reject-btn')) rejectApplication(id); }; }
    async function renderQuota() { var container = $('#quotaList'); try { var data = await apiCall('/api/apply-quota/all'); if (!data || !data.length) { container.innerHTML = '<p>暂无用户数据</p>'; return; } container.innerHTML = data.map(u => `<div class="article-manage-item" style="display:flex;justify-content:space-between;padding:0.7rem 0;border-bottom:1px dashed rgba(250,219,95,0.25);"><div><span>${escapeHtml(u.username)}</span><span style="font-size:0.75rem;">今日已用 ${u.used}/${u.limit}次</span></div><div><button class="btn btn-sm reset-quota-btn" data-username="${escapeHtml(u.username)}">🔄重置</button></div></div>`).join(''); container.onclick = e => { if (e.target.classList.contains('reset-quota-btn')) { var un = e.target.dataset.username; if (confirm('重置' + un + '的申请次数？')) resetUserQuota(un); } }; } catch (e) { container.innerHTML = '<p>加载失败</p>'; } }
    async function resetUserQuota(un) { try { await apiCall('/api/apply-quota/reset/' + encodeURIComponent(un), { method: 'POST' }); showToast('已重置'); renderQuota(); if (currentUser && currentUser.username === un) updateApplyQuota(); } catch(e) { showToast('重置失败','error'); } }
    async function approveApplication(id) { try { await apiCall('/api/article-applications/' + id + '/approve', { method: 'POST' }); showToast('已批准并发布'); } catch(e) { showToast('操作失败','error'); } await loadApplications(); await loadArticles(); if (currentView === 'list') { renderList(); renderTags(); } }
    async function rejectApplication(id) { try { await apiCall('/api/article-applications/' + id, { method: 'DELETE' }); showToast('已拒绝'); } catch(e) { showToast('操作失败','error'); } await loadApplications(); }

    function initMdImport() {
        var ib = document.getElementById('importMdBtn'), fi = document.getElementById('mdFileInput');
        if (!ib || !fi) return;
        ib.addEventListener('click', () => fi.click());
        fi.addEventListener('change', function(e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function(ev) { var ti = document.getElementById('articleTitle'); var ci = document.getElementById('articleContent'); if (ti) ti.value = f.name.replace(/\.md$/i, ''); if (ci) ci.value = ev.target.result; showToast('已导入 ' + f.name); }; r.readAsText(f, 'UTF-8'); fi.value = ''; });
    }

    // 特效系统 (保持原逻辑)
    function initTrail() {
        var canvas = document.getElementById('trailCanvas'), ctx = canvas.getContext('2d'), w, h, trail = [];
        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; }
        window.addEventListener('resize', resize); resize();
        var mouseX = w / 2, mouseY = h / 2;
        document.addEventListener('mousemove', function(e) { mouseX = e.clientX; mouseY = e.clientY; trail.push({ x: mouseX, y: mouseY, life: 1, size: 2 + Math.random() * 4, color: Math.random() > 0.5 ? 'rgba(250,219,95,' : 'rgba(125,249,255,' }); if (trail.length > 40) trail.shift(); });
        function animate() { ctx.clearRect(0, 0, w, h); for (var i = trail.length - 1; i >= 0; i--) { var p = trail[i]; p.life -= 0.025; p.size *= 0.97; if (p.life <= 0) { trail.splice(i, 1); continue; } ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fillStyle = p.color + p.life + ')'; ctx.fill(); ctx.shadowBlur = 12; ctx.shadowColor = p.color + '0.6)'; ctx.fill(); ctx.shadowBlur = 0; } requestAnimationFrame(animate); } animate();
    }
    function initBurst() {
        var canvas = document.getElementById('rippleCanvas'), ctx = canvas.getContext('2d'), bursts = [];
        document.addEventListener('click', function(e) { var count = 15 + Math.floor(Math.random() * 20); for (var i = 0; i < count; i++) { var angle = Math.random() * Math.PI * 2; var speed = 2 + Math.random() * 6; bursts.push({ x: e.clientX, y: e.clientY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, size: 1 + Math.random() * 3, color: ['#fadb5f', '#ff6b6b', '#7df9ff', '#c08eff'][Math.floor(Math.random() * 4)] }); } if (bursts.length > 200) bursts.splice(0, bursts.length - 200); });
        function drawBursts() { for (var i = bursts.length - 1; i >= 0; i--) { var b = bursts[i]; b.x += b.vx; b.y += b.vy; b.vy += 0.05; b.life -= 0.02; if (b.life <= 0) { bursts.splice(i, 1); continue; } ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI*2); ctx.fillStyle = b.color.replace(')', ',' + b.life + ')').replace('rgb', 'rgba'); if (b.color.startsWith('#')) { ctx.fillStyle = b.color + Math.floor(b.life * 255).toString(16).padStart(2, '0'); } ctx.fill(); } }
        setInterval(drawBursts, 33);
    }
    function initConstellations() {
        var canvas = document.getElementById('particleCanvas'), ctx = canvas.getContext('2d'), stars = [], w, h;
        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; }
        window.addEventListener('resize', resize); resize();
        for (var i = 0; i < 40; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, size: 0.5 + Math.random() * 1.5, twinkle: Math.random() * Math.PI * 2 });
        function drawStars() { for (var i = 0; i < stars.length; i++) { var s = stars[i]; s.twinkle += 0.02; var alpha = 0.3 + Math.sin(s.twinkle) * 0.3; ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')'; ctx.fill(); for (var j = i + 1; j < stars.length; j++) { var s2 = stars[j]; var dx = s.x - s2.x, dy = s.y - s2.y; var dist = Math.sqrt(dx*dx + dy*dy); if (dist < 150) { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s2.x, s2.y); ctx.strokeStyle = 'rgba(250,219,95,' + (0.15 * (1 - dist/150)) + ')'; ctx.lineWidth = 0.5; ctx.stroke(); } } } }
        setInterval(drawStars, 100);
    }
    function apply3DTilt() {
        var cards = document.querySelectorAll('.article-card'); cards.forEach(function(card) { card.addEventListener('mousemove', function(e) { var rect = card.getBoundingClientRect(); var x = e.clientX - rect.left; var y = e.clientY - rect.top; var cx = rect.width / 2, cy = rect.height / 2; var rotateX = (y - cy) / cy * -8; var rotateY = (x - cx) / cx * 8; card.style.transform = 'perspective(800px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale(1.02)'; }); card.addEventListener('mouseleave', function() { card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)'; }); });
    }
    function initRipples() {
        var canvas = document.getElementById('rippleCanvas'), ctx = canvas.getContext('2d'), w, h, ripples = [];
        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; } window.addEventListener('resize', resize); resize();
        document.addEventListener('click', function(e) { var colors = ['rgba(250,219,95,0.8)', 'rgba(255,107,107,0.7)', 'rgba(125,249,255,0.6)', 'rgba(200,180,140,0.7)']; ripples.push({ x: e.clientX, y: e.clientY, radius: 5, maxRadius: 60 + Math.random() * 60, opacity: 0.8, color: colors[Math.floor(Math.random() * colors.length)], speed: 1.2 + Math.random() * 0.8 }); if (ripples.length > 20) ripples.shift(); });
        function animate() { ctx.clearRect(0, 0, w, h); for (var i = ripples.length - 1; i >= 0; i--) { var r = ripples[i]; r.radius += r.speed; r.opacity -= 0.015; if (r.opacity <= 0 || r.radius > r.maxRadius) { ripples.splice(i, 1); } else { ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI*2); var g = ctx.createRadialGradient(r.x, r.y, r.radius * 0.2, r.x, r.y, r.radius); g.addColorStop(0, r.color); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.globalAlpha = r.opacity; ctx.fill(); ctx.globalAlpha = 1; } } requestAnimationFrame(animate); } animate();
    }
    function initParticles() {
        var canvas = document.getElementById('particleCanvas'), ctx = canvas.getContext('2d'), w, h, particles = [];
        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; } window.addEventListener('resize', resize); resize();
        function Particle() { this.reset(true); } Particle.prototype.reset = function(init) { this.x = Math.random() * w; this.y = init ? Math.random() * h : -20; this.size = 1 + Math.random() * 3; this.speedY = 0.3 + Math.random() * 1.5; this.speedX = (Math.random() - 0.5) * 0.8; this.opacity = 0.4 + Math.random() * 0.6; this.type = Math.random() > 0.6 ? 'petal' : (Math.random() > 0.5 ? 'gold' : 'cyan'); if (this.type === 'petal') { this.color = 'rgba(255,200,210,' + this.opacity + ')'; this.rotation = Math.random() * Math.PI * 2; this.rotSpeed = (Math.random() - 0.5) * 0.02; } else if (this.type === 'gold') this.color = 'rgba(250,219,95,' + this.opacity + ')'; else this.color = 'rgba(125,249,255,' + this.opacity + ')'; }; Particle.prototype.update = function() { this.y += this.speedY; this.x += Math.sin(this.y * 0.02) * this.speedX; if (this.type === 'petal') this.rotation += this.rotSpeed; if (this.y > h + 30 || this.x < -30 || this.x > w + 30) this.reset(false); }; Particle.prototype.draw = function(ctx) { ctx.globalAlpha = this.opacity; if (this.type === 'petal') { ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation); ctx.fillStyle = this.color; ctx.beginPath(); ctx.ellipse(0, 0, this.size * 0.6, this.size * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, 0, this.size * 0.2, this.size * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } else { ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; };
        for (var i = 0; i < 80; i++) particles.push(new Particle());
        function animate() { ctx.clearRect(0, 0, w, h); for (var i = 0; i < particles.length; i++) { particles[i].update(); particles[i].draw(ctx); } requestAnimationFrame(animate); } animate();
    }

    var poems = ['☯ 且将新火试新茶，诗酒趁年华 ☯','☯ 醉后不知天在水，满船清梦压星河 ☯','☯ 云想衣裳花想容，春风拂槛露华浓 ☯','☯ 银烛秋光冷画屏，轻罗小扇扑流萤 ☯','☯ 沧海月明珠有泪，蓝田日暖玉生烟 ☯'];
    var poemIdx = 0;
    setInterval(() => { poemIdx = (poemIdx + 1) % poems.length; var el = document.getElementById('poemFloat'); if (el) el.textContent = poems[poemIdx]; }, 10000);

    function bindEvents() {
        $('#loginBtn').addEventListener('click', () => $('#loginModal').classList.add('active'));
        $('#closeLoginModal').addEventListener('click', () => $('#loginModal').classList.remove('active'));
        $('#submitLogin').addEventListener('click', async () => { var u = $('#loginUsername').value.trim(), p = $('#loginPassword').value; if (!u || !p) return showToast('请输入账号密码','error'); try { await login(u, p); $('#loginModal').classList.remove('active'); $('#loginUsername').value = ''; $('#loginPassword').value = ''; await loadArticles(); renderList(); renderTags(); } catch(e) { showToast('登录失败: '+e.message,'error'); } });
        $('#logoutBtn').addEventListener('click', logout);
        $('#adminPanelBtn').addEventListener('click', () => switchView('admin'));
        $('#backFromAdminBtn').addEventListener('click', () => switchView('list'));
        $('#newArticleBtn').addEventListener('click', () => openEditor(null));
        $('#adminNewArticleBtn').addEventListener('click', () => openEditor(null));
        $('#closeArticleModal').addEventListener('click', () => $('#articleModal').classList.remove('active'));
        $('#cancelArticle').addEventListener('click', () => $('#articleModal').classList.remove('active'));
        $('#submitArticle').addEventListener('click', submitArticle);
        $('#backToListBtn').addEventListener('click', () => switchView('list'));
        $('#confirmDeleteBtn').addEventListener('click', executeDelete);
        $('#cancelDeleteBtn').addEventListener('click', () => $('#confirmModal').classList.remove('active'));
        $('#searchInput').addEventListener('input', () => renderList());
        var topBtn = $('#backToTop'); window.addEventListener('scroll', () => { topBtn.style.display = window.scrollY > 500 ? 'flex' : 'none'; }); topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        $('#applyArticleBtn').addEventListener('click', () => { if (applyQuotaRemaining <= 0) { showToast('今日申请次数已用尽','error'); return; } $('#applyLimitInfo').textContent = '今日还可提交 ' + applyQuotaRemaining + ' 次'; $('#applyModal').classList.add('active'); });
        $('#closeApplyModal').addEventListener('click', () => $('#applyModal').classList.remove('active'));
        $('#cancelApply').addEventListener('click', () => $('#applyModal').classList.remove('active'));
        $('#submitApply').addEventListener('click', async () => { if (applyQuotaRemaining <= 0) { showToast('今日申请次数已用尽','error'); return; } var t = $('#applyTitle').value.trim(), c = $('#applyContent').value.trim(); if (!t || !c) return showToast('标题和内容不能为空','error'); var d = { title: t, content: c, summary: $('#applySummary').value.trim(), tags: $('#applyTags').value.split(',').map(x => x.trim()).filter(Boolean), seal: $('#applySeal').value.trim() || '墨' }; try { await apiCall('/api/article-applications', { method: 'POST', body: d }); showToast('申请已提交'); $('#applyModal').classList.remove('active'); $('#applyTitle').value = ''; $('#applyContent').value = ''; $('#applySummary').value = ''; $('#applyTags').value = ''; $('#applySeal').value = '墨'; updateApplyQuota(); } catch(e) { showToast('提交失败: '+e.message,'error'); } });
        $('#articlesTabBtn').addEventListener('click', () => { currentTab = 'articles'; renderAdmin(); });
        $('#reviewTabBtn').addEventListener('click', () => { currentTab = 'review'; loadApplications(); renderAdmin(); });
        $('#quotaTabBtn').addEventListener('click', () => { currentTab = 'quota'; renderAdmin(); });
        $$('.modal-overlay').forEach(ov => { ov.addEventListener('click', function(e) { if (e.target === ov) ov.classList.remove('active'); }); });
        // 批注相关
        var submitAnnotationBtn = document.getElementById('submitAnnotation');
        if (submitAnnotationBtn) submitAnnotationBtn.addEventListener('click', async function() { var text = $('#annotationText').value.trim(); if (!text || !currentArticleId) return; var article = articles.find(a => a.id === currentArticleId); if (!article) return; if (!article.annotations) article.annotations = []; article.annotations.push({ x: currentAnnotationPos.x, y: currentAnnotationPos.y, text }); try { await apiCall('/api/articles/' + currentArticleId, { method: 'PUT', body: { annotations: article.annotations } }); showToast('朱批已保存'); addAnnotationTag(currentAnnotationPos.x, currentAnnotationPos.y, text); } catch(e) { showToast('保存失败','error'); } $('#annotationModal').classList.remove('active'); $('#annotationText').value = ''; });
        var closeAnnModal = document.getElementById('closeAnnotationModal'); if (closeAnnModal) closeAnnModal.addEventListener('click', () => $('#annotationModal').classList.remove('active'));
    }

    function initStylePanel() {
        document.getElementById('stylePanel').addEventListener('click', function(e) { if (e.target.classList.contains('skin-btn')) applySkin(e.target.dataset.skin); });
        var savedSkin = localStorage.getItem('blog_skin') || 'default'; applySkin(savedSkin);
    }

    window._blogApp = { viewArticle, editArticle: openEditor, confirmDeleteArticle: confirmDel };

    async function init() {
        initRipples(); initParticles(); initTrail(); initBurst(); initConstellations();
        initMdImport(); initStylePanel(); bindEvents();
        await loadArticles(); await checkLogin(); renderList(); renderTags();
    }
    init();
})();
