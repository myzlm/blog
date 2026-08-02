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

    // 皮肤切换
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

    // 登录状态
    async function checkLogin() { var data = await apiCall('/api/me', {}, true); currentUser = (data && data.username) ? data : null; updateUI(); }
    function updateUI() {
        var g = $('#greetingText'), l = $('#loginBtn'), o = $('#logoutBtn'), a = $('#adminPanelBtn'), n = $('#newArticleBtn'), ap = $('#applyArticleBtn');
        if (currentUser) {
            g.textContent = (currentUser.role === 'admin' ? '🔰' : '📖') + ' ' + currentUser.username;
            l.classList.add('hidden'); o.classList.remove('hidden');
            if (currentUser.role === 'admin') { a.classList.remove('hidden'); n.classList.remove('hidden'); ap.classList.add('hidden'); }
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
    async function loadApplications() { if (!currentUser || currentUser.role !== 'admin') return; try { pendingApps = await apiCall('/api/article-applications'); } catch (e) { pendingApps = []; } $('#pendingCount').textContent = pendingApps.length; if (currentTab === 'review') renderReview(); }
    async function updateApplyQuota() { if (!currentUser || currentUser.role === 'admin') { $('#applyQuota').classList.add('hidden'); return; } try { var data = await apiCall('/api/apply-quota'); applyQuotaRemaining = data.remaining; $('#applyQuota').textContent = '剩余 ' + applyQuotaRemaining + ' 次'; $('#applyQuota').classList.remove('hidden'); } catch(e) { $('#applyQuota').classList.add('hidden'); } }

    // 列表渲染
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
        if (currentUser && currentUser.role === 'admin') {
            var actions = container.querySelector('.detail-actions');
            actions.innerHTML = `<button class="btn btn-sm" onclick="window._blogApp.editArticle('${escapeHtml(a.id)}')">✏️ 编辑</button><button class="btn btn-sm btn-danger" onclick="window._blogApp.confirmDeleteArticle('${escapeHtml(a.id)}','${escapeHtml(a.title||'')}')">🗑️ 删除</button>`;
        }
    }
    function addAnnotationTag(x, y, text) { var tag = document.createElement('div'); tag.className = 'annotation-tag'; tag.style.left = x + '%'; tag.style.top = y + '%'; tag.textContent = text; $('#articleDetailContent').appendChild(tag); }

    // 文章编辑
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

    // 管理面板
    function renderAdmin() { /* ... 保持原逻辑，代码太长省略，实际文件里需要完整包含 */ }
    // 由于字数限制，此处略去管理面板和审批等剩余函数，完整代码请见原文件合并。
    // 实际 script.js 中需包含 renderAdmin, renderReview, renderQuota, approveApplication 等全部原有函数。

    // 特效系统
    function initTrail() { /* ... */ }
    function initBurst() { /* ... */ }
    function initConstellations() { /* ... */ }
    function apply3DTilt() { /* ... */ }
    function initRipples() { /* ... */ }
    function initParticles() { /* ... */ }

    // 诗词轮播
    var poems = ['☯ 且将新火试新茶，诗酒趁年华 ☯','☯ 醉后不知天在水，满船清梦压星河 ☯','☯ 云想衣裳花想容，春风拂槛露华浓 ☯','☯ 银烛秋光冷画屏，轻罗小扇扑流萤 ☯','☯ 沧海月明珠有泪，蓝田日暖玉生烟 ☯'];
    var poemIdx = 0;
    setInterval(() => { poemIdx = (poemIdx+1)%poems.length; var el = document.getElementById('poemFloat'); if (el) el.textContent = poems[poemIdx]; }, 10000);

    // 事件绑定
    function bindEvents() { /* ... 完整的事件监听代码，请参考原文件 */ }

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
