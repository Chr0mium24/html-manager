const CONFIG = {
    adminPwdKey: "ios_admin_pwd",
    apiKey: "gemini_api_key"
};

const byId = (id) => document.getElementById(id);

const state = {
    isAdmin: false,
    adminPassword: "",
    currentView: "list",
    activeProjectId: null,
    projects: [],
    activeProject: null,
    apiKey: "",
    editingProjectId: null,
    editingVersionId: null,
    editingVersionName: "",
    editorInstance: null
};

const app = {
    deferredInstallPrompt: null,
    isHtmlEditorOpen: function() {
        return byId('htmlEditorModal').classList.contains('active');
    },

    init: function() {
        this.updateDateHeader();
        this.bindFileInputs();
        this.restoreAdmin();
        this.restoreApiKey();
        this.loadProjects();
        this.setupGlobalListeners();
        this.render();
    },

    // ---- API helpers ----
    apiRequest: async function(path, options = {}, admin = false) {
        const opts = { ...options };
        const headers = { ...(opts.headers || {}) };
        if (admin && state.adminPassword) {
            headers['X-Admin-Password'] = state.adminPassword;
        }
        opts.headers = headers;

        const resp = await fetch(path, opts);
        if (resp.status === 401 && admin) {
            this.forceLogout();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const msg = await resp.text();
            throw new Error(msg || 'Request failed');
        }
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return resp.json();
        }
        return {};
    },

    getAdminHeaders: function() {
        const headers = {};
        if (state.adminPassword) {
            headers['X-Admin-Password'] = state.adminPassword;
        }
        return headers;
    },

    extractFileName: function(contentDisposition, fallbackName) {
        const fallback = fallbackName || 'download.bin';
        const value = contentDisposition || '';
        const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
        if (utfMatch && utfMatch[1]) {
            try {
                return decodeURIComponent(utfMatch[1]).replace(/[\\/]/g, '_');
            } catch (err) {
                return fallback;
            }
        }
        const plainMatch = value.match(/filename="?([^";]+)"?/i);
        if (plainMatch && plainMatch[1]) {
            return plainMatch[1].replace(/[\\/]/g, '_');
        }
        return fallback;
    },

    normalizeHtmlFilename: function(name, fallback = 'index.html') {
        const raw = String(name || fallback).trim();
        const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
        if (!cleaned) return fallback;
        if (cleaned.toLowerCase().endsWith('.html')) return cleaned;
        return `${cleaned}.html`;
    },

    downloadBlob: function(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'download.bin';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    },

    fetchDownload: async function(path, options = {}, admin = false, fallbackName = 'download.bin') {
        const opts = { ...options };
        const headers = { ...(opts.headers || {}) };
        if (admin) {
            Object.assign(headers, this.getAdminHeaders());
        }
        opts.headers = headers;

        const resp = await fetch(path, opts);
        if (resp.status === 401 && admin) {
            this.forceLogout();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const msg = await resp.text();
            throw new Error(msg || 'Download failed');
        }

        const blob = await resp.blob();
        const fileName = this.extractFileName(resp.headers.get('content-disposition'), fallbackName);
        this.downloadBlob(blob, fileName);
    },

    // ---- Auth ----
    restoreAdmin: function() {
        const saved = sessionStorage.getItem(CONFIG.adminPwdKey);
        if (saved) {
            this.verifyAdmin(saved, true);
        }
    },

    verifyAdmin: async function(password, silent = false) {
        try {
            await this.apiRequest('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            state.isAdmin = true;
            state.adminPassword = password;
            sessionStorage.setItem(CONFIG.adminPwdKey, password);
            this.updateAdminUI();
            if (!silent) this.showToast('Admin Enabled');
            this.loadProjects();
        } catch (err) {
            this.forceLogout();
            if (!silent) this.showToast('Admin Failed');
        }
    },

    forceLogout: function() {
        state.isAdmin = false;
        state.adminPassword = '';
        sessionStorage.removeItem(CONFIG.adminPwdKey);
        this.updateAdminUI();
        if (state.currentView === 'detail') {
            this.goHome();
        } else {
            this.render();
        }
    },

    updateAdminUI: function() {
        byId('adminBadge').style.display = state.isAdmin ? 'inline-block' : 'none';
        document.body.classList.toggle('is-admin', state.isAdmin);
    },

    toggleAdmin: function() {
        if (state.isAdmin) {
            byId('settingsModal').classList.add('active');
            byId('apiKeyInput').focus();
        } else {
            byId('loginModal').classList.add('active');
            byId('passwordInput').focus();
        }
    },

    restoreApiKey: function() {
        const saved = localStorage.getItem(CONFIG.apiKey);
        if (saved) state.apiKey = saved;
        byId('apiKeyInput').value = state.apiKey || '';
    },

    saveApiKey: function() {
        const key = byId('apiKeyInput').value.trim();
        if (key) {
            localStorage.setItem(CONFIG.apiKey, key);
            state.apiKey = key;
            this.showToast('API Key Saved');
        } else {
            localStorage.removeItem(CONFIG.apiKey);
            state.apiKey = '';
            this.showToast('API Key Cleared');
        }
    },

    login: function() {
        const pwd = byId('passwordInput').value;
        if (!pwd) return;
        this.closeModal('loginModal');
        byId('passwordInput').value = '';
        this.verifyAdmin(pwd);
    },

    logoutAdmin: function() {
        if (!state.isAdmin) return;
        this.forceLogout();
        this.closeModal('settingsModal');
        this.showToast('Logged Out');
    },

    // ---- Data ----
    loadProjects: async function() {
        try {
            const data = await this.apiRequest('/api/projects');
            state.projects = data.projects || [];
            this.render();
        } catch (err) {
            this.showToast('Failed to load');
        }
    },

    // ---- Views ----
    render: function() {
        const container = byId('contentArea');
        container.innerHTML = '';

        if (state.currentView === 'list') {
            this.renderProjectList(container);
            byId('backBtn').style.display = 'none';
            byId('headerTitleText').innerText = 'Projects';
        } else if (state.currentView === 'detail') {
            this.renderProjectDetail(container);
            byId('backBtn').style.display = 'block';
        }
    },

    renderProjectList: function(container) {
        if (state.isAdmin) {
            const cta = document.createElement('div');
            cta.className = 'upload-cta';
            cta.innerHTML = `
                <div class="upload-cta-text">
                    <strong>Upload HTML</strong>
                    Drag & drop or paste HTML (Ctrl+V) anywhere, or click to choose a file.
                </div>
                <button class="upload-cta-btn">Choose File</button>
            `;
            cta.querySelector('button').addEventListener('click', () => this.triggerNewProject());
            container.appendChild(cta);
        }

        if (!state.projects.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerText = 'No projects yet.';
            container.appendChild(empty);
            return;
        }

        state.projects.forEach((proj) => {
            const card = document.createElement('div');
            card.className = 'card';

            const latestDate = proj.latest_version?.created_at || proj.updated_at;
            const dateLabel = latestDate ? new Date(latestDate).toLocaleDateString() : 'No versions';

            const editBtnHTML = state.isAdmin
                ? `<button class="edit-btn" onclick="event.stopPropagation(); app.renameProject('${proj.id}')">✎</button>`
                : '';
            const deleteBtnHTML = state.isAdmin
                ? `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteProject('${proj.id}')">×</button>`
                : '';

            card.innerHTML = `
                <div class="project-item" onclick="app.openProject('${proj.id}')">
                    <div class="project-icon">${this.escapeHtml(proj.icon || '📁')}</div>
                    <div class="project-info">
                        <div class="project-name">${this.escapeHtml(proj.name)}</div>
                        <div class="project-desc">${this.escapeHtml(proj.description || '')}</div>
                        <div class="project-meta">Last updated: ${dateLabel}</div>
                    </div>
                    ${editBtnHTML}
                    ${deleteBtnHTML}
                </div>
            `;
            container.appendChild(card);
        });
    },

    renderProjectDetail: function(container) {
        if (!state.isAdmin) {
            this.goHome();
            return;
        }
        const proj = state.activeProject;
        if (!proj) return this.goHome();

        byId('headerTitleText').innerText = proj.name;
        if (state.isAdmin) {
            const cta = document.createElement('div');
            cta.className = 'upload-cta';
            cta.innerHTML = `
                <div class="upload-cta-text">
                    <strong>Upload Version</strong>
                    Drag & drop or paste HTML (Ctrl+V) anywhere, or click to choose a file.
                </div>
                <button class="upload-cta-btn">Choose File</button>
            `;
            cta.querySelector('button').addEventListener('click', () => this.triggerVersionUpload());
            container.appendChild(cta);
        }

        const versionsDiv = document.createElement('div');
        const versions = proj.versions || [];
        if (!versions.length) {
            versionsDiv.innerHTML = '<div class="empty-state">No HTML versions uploaded yet.</div>';
        } else {
            versions.forEach((ver) => {
                const vCard = document.createElement('div');
                vCard.className = 'card version-card';
                const dateStr = new Date(ver.created_at).toLocaleString();
                const displayName = ver.display_name || ver.original_filename || 'Version';
                const original = ver.original_filename && ver.original_filename !== displayName
                    ? `Original: ${ver.original_filename}`
                    : '';

                const editBtn = state.isAdmin
                    ? `<button class="edit-btn" onclick="event.stopPropagation(); app.editHtmlVersion('${ver.id}')">✎</button>`
                    : '';
                const downloadBtn = state.isAdmin
                    ? `<button class="download-btn" onclick="event.stopPropagation(); app.downloadVersion('${ver.id}')">↓</button>`
                    : '';
                const deleteBtn = state.isAdmin
                    ? `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteVersion('${ver.id}')">×</button>`
                    : '';

                vCard.innerHTML = `
                    <div class="project-item" onclick="app.previewHtml('${proj.id}', '${ver.id}')">
                        <div class="project-icon" style="background:#34C759; font-size:14px; font-weight:bold;">HTML</div>
                        <div class="project-info">
                            <div class="project-name">${this.escapeHtml(displayName)}</div>
                            <div class="project-desc">Uploaded: ${dateStr}</div>
                            <div class="project-meta">${this.escapeHtml(original)}</div>
                        </div>
                        ${downloadBtn}
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                `;
                versionsDiv.appendChild(vCard);
            });
        }
        container.appendChild(versionsDiv);
    },

    // ---- Navigation ----
    goHome: function() {
        state.currentView = 'list';
        state.activeProjectId = null;
        state.activeProject = null;
        this.render();
    },

    openProject: async function(id) {
        if (!state.isAdmin) {
            window.location.href = `/projects/${id}/latest`;
            return;
        }
        try {
            const data = await this.apiRequest(`/api/projects/${id}`, {}, true);
            state.activeProjectId = id;
            state.activeProject = data;
            state.currentView = 'detail';
            this.render();
        } catch (err) {
            this.showToast('Failed to open');
        }
    },

    // ---- Admin actions ----
    triggerNewProject: function() {
        if (!state.isAdmin) return;
        byId('newProjectFile').click();
    },

    triggerVersionUpload: function() {
        if (!state.isAdmin) return;
        byId('versionFile').click();
    },

    createProjectFromFile: async function(file) {
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        try {
            await this.apiRequest('/api/projects', { method: 'POST', body: form }, true);
            this.showToast('Project Created');
            await this.loadProjects();
        } catch (err) {
            this.showToast('Upload failed');
        }
    },

    addVersionToProject: async function(projId, file) {
        if (!file || !projId) return;
        const form = new FormData();
        form.append('file', file);
        try {
            await this.apiRequest(`/api/projects/${projId}/versions`, { method: 'POST', body: form }, true);
            this.showToast('New Version Uploaded');
            await this.openProject(projId);
        } catch (err) {
            this.showToast('Upload failed');
        }
    },

    renameProject: async function(projId) {
        const proj = state.projects.find((p) => p.id === projId) || state.activeProject;
        if (!proj) return;
        state.editingProjectId = projId;
        byId('editNameInput').value = proj.name || '';
        byId('editDescInput').value = proj.description || '';
        byId('editIconInput').value = proj.icon || '📁';
        byId('editProjectModal').classList.add('active');
    },

    saveProjectEdits: async function() {
        const projId = state.editingProjectId;
        if (!projId) return;
        const proj = state.projects.find((p) => p.id === projId) || state.activeProject;
        if (!proj) return;

        const nextName = byId('editNameInput').value.trim();
        const nextDesc = byId('editDescInput').value.trim();
        const nextIcon = byId('editIconInput').value.trim();

        const payload = {};
        if (nextName && nextName !== proj.name) payload.name = nextName;
        if (nextDesc && nextDesc !== (proj.description || '')) payload.description = nextDesc;
        if (nextIcon && nextIcon !== (proj.icon || '📁')) payload.icon = nextIcon;
        if (!Object.keys(payload).length) {
            this.closeModal('editProjectModal');
            return;
        }

        try {
            await this.apiRequest(
                `/api/projects/${projId}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                },
                true
            );
            this.closeModal('editProjectModal');
            this.showToast('Project Updated');
            await this.loadProjects();
            if (state.activeProjectId === projId) {
                await this.openProject(projId);
            }
        } catch (err) {
            this.showToast('Update failed');
        }
    },

    parseJsonFromText: function(text) {
        if (!text) return null;
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (err) {
            return null;
        }
    },

    aiFillProject: async function() {
        const projId = state.editingProjectId;
        if (!projId) return;
        if (!state.apiKey) {
            alert('Please set your Gemini API key in Settings.');
            return;
        }

        try {
            const htmlText = await fetch(`/projects/${projId}/latest`).then((r) => r.text());
            const prompt = (
                "You are a product naming assistant. Given HTML content, return a JSON object " +
                'with keys "name", "description", and "icon". Keep the name <= 20 characters and the description <= 120 characters. ' +
                "The icon must be a single emoji. Return JSON only, no extra text.\n\nHTML:\n" +
                htmlText.slice(0, 12000)
            );

            const payload = { contents: [{ parts: [{ text: prompt }] }] };
            const resp = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": state.apiKey
                    },
                    body: JSON.stringify(payload)
                }
            );
            if (!resp.ok) throw new Error('AI request failed');
            const data = await resp.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            const parsed = this.parseJsonFromText(text);
            if (!parsed) throw new Error('AI response invalid');

            if (parsed.name) byId('editNameInput').value = String(parsed.name).trim();
            if (parsed.description) byId('editDescInput').value = String(parsed.description).trim();
            if (parsed.icon) byId('editIconInput').value = String(parsed.icon).trim();
            this.showToast('AI Filled');
        } catch (err) {
            this.showToast('AI failed');
        }
    },

    getActiveVersion: function(versionId) {
        if (!state.activeProject || !state.activeProject.versions) return null;
        return state.activeProject.versions.find((v) => v.id === versionId) || null;
    },

    ensureAceEditor: function() {
        if (state.editorInstance) return state.editorInstance;
        if (!window.ace) throw new Error('Ace not loaded');
        const editor = window.ace.edit('aceEditor');
        editor.setTheme('ace/theme/chrome');
        editor.session.setMode('ace/mode/html');
        editor.session.setUseWrapMode(true);
        editor.setShowPrintMargin(false);
        editor.setOptions({
            tabSize: 2,
            useSoftTabs: true,
            fontSize: '14px'
        });
        state.editorInstance = editor;
        return editor;
    },

    editHtmlVersion: async function(versionId) {
        if (!state.isAdmin || !state.activeProjectId) return;
        const ver = this.getActiveVersion(versionId);
        if (!ver) return;

        state.editingVersionId = versionId;
        state.editingVersionName = this.normalizeHtmlFilename(
            ver.display_name || ver.original_filename || `${versionId}.html`
        );
        byId('editorFileName').innerText = state.editingVersionName;
        byId('htmlEditorModal').classList.add('active');

        try {
            const resp = await fetch(`/projects/${state.activeProjectId}/versions/${versionId}`);
            if (!resp.ok) throw new Error('Load failed');
            const html = await resp.text();
            const editor = this.ensureAceEditor();
            editor.setValue(html, -1);
            setTimeout(() => {
                editor.resize();
                editor.focus();
            }, 0);
        } catch (err) {
            this.closeHtmlEditor();
            this.showToast('Load HTML failed');
        }
    },

    closeHtmlEditor: function() {
        byId('htmlEditorModal').classList.remove('active');
        state.editingVersionId = null;
        state.editingVersionName = '';
    },

    saveHtmlEdits: async function() {
        if (!state.isAdmin || !state.activeProjectId || !state.editingVersionId || !state.editorInstance) return;
        const html = state.editorInstance.getValue();
        if (!html.trim()) {
            this.showToast('HTML is empty');
            return;
        }

        try {
            await this.apiRequest(
                `/api/projects/${state.activeProjectId}/versions/${state.editingVersionId}/content`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html })
                },
                true
            );
            this.closeHtmlEditor();
            this.showToast('HTML Saved');
            await this.openProject(state.activeProjectId);
            await this.loadProjects();
        } catch (err) {
            this.showToast('Save failed');
        }
    },

    downloadEditingHtml: function() {
        if (!state.editorInstance) return;
        const html = state.editorInstance.getValue();
        const filename = this.normalizeHtmlFilename(state.editingVersionName || 'edited.html');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        this.downloadBlob(blob, filename);
        this.showToast('Downloaded');
    },

    downloadVersion: async function(versionId) {
        if (!state.activeProjectId) return;
        const ver = this.getActiveVersion(versionId);
        const fallback = this.normalizeHtmlFilename(
            (ver && (ver.display_name || ver.original_filename)) || `${versionId}.html`
        );

        try {
            await this.fetchDownload(
                `/projects/${state.activeProjectId}/versions/${versionId}`,
                {},
                false,
                fallback
            );
            this.showToast('Downloaded');
        } catch (err) {
            this.showToast('Download failed');
        }
    },

    downloadBackup: async function() {
        if (!state.isAdmin) return;
        try {
            await this.fetchDownload('/api/admin/backup', {}, true, 'html-backup.zip');
            this.showToast('Backup Downloaded');
        } catch (err) {
            this.showToast('Backup failed');
        }
    },

    renameVersion: async function(versionId) {
        if (!state.activeProject || !state.activeProject.versions) return;
        const ver = state.activeProject.versions.find((v) => v.id === versionId);
        const current = ver ? ver.display_name || ver.original_filename : '';
        const next = prompt('New file name:', current || '');
        if (!next || next === current) return;
        try {
            await this.apiRequest(
                `/api/versions/${versionId}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ display_name: next })
                },
                true
            );
            this.showToast('File Name Updated');
            await this.openProject(state.activeProjectId);
        } catch (err) {
            this.showToast('Update failed');
        }
    },

    deleteProject: async function(projId) {
        if (!confirm('Delete this project and all versions?')) return;
        try {
            await this.apiRequest(`/api/projects/${projId}`, { method: 'DELETE' }, true);
            this.showToast('Project Deleted');
            await this.loadProjects();
        } catch (err) {
            this.showToast('Delete failed');
        }
    },

    deleteVersion: async function(versionId) {
        if (!confirm('Delete this version?')) return;
        try {
            await this.apiRequest(`/api/versions/${versionId}`, { method: 'DELETE' }, true);
            this.showToast('Version Deleted');
            await this.openProject(state.activeProjectId);
        } catch (err) {
            this.showToast('Delete failed');
        }
    },

    // ---- File & preview ----
    previewHtml: function(projId, verId) {
        window.open(`/projects/${projId}/versions/${verId}`, '_blank');
    },

    bindFileInputs: function() {
        const newInput = byId('newProjectFile');
        const versionInput = byId('versionFile');

        newInput.addEventListener('change', () => {
            const file = newInput.files[0];
            newInput.value = '';
            if (file) this.createProjectFromFile(file);
        });

        versionInput.addEventListener('change', () => {
            const file = versionInput.files[0];
            versionInput.value = '';
            if (file && state.activeProjectId) this.addVersionToProject(state.activeProjectId, file);
        });
    },

    setupGlobalListeners: function() {
        const passwordInput = byId('passwordInput');
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                this.login();
            }
        });
        const installBtn = byId('installBtn');
        installBtn.addEventListener('click', async () => {
            if (!this.deferredInstallPrompt) return;
            this.deferredInstallPrompt.prompt();
            try {
                await this.deferredInstallPrompt.userChoice;
            } finally {
                this.deferredInstallPrompt = null;
                installBtn.style.display = 'none';
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const loginOpen = byId('loginModal').classList.contains('active');
                const settingsOpen = byId('settingsModal').classList.contains('active');
                const editOpen = byId('editProjectModal').classList.contains('active');
                const htmlEditorOpen = this.isHtmlEditorOpen();
                if (loginOpen || settingsOpen || editOpen || htmlEditorOpen) {
                    this.closeModal('loginModal');
                    this.closeModal('settingsModal');
                    this.closeModal('editProjectModal');
                    this.closeHtmlEditor();
                    return;
                }
                if (state.currentView === 'detail') {
                    this.goHome();
                }
            }
        });
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredInstallPrompt = e;
            installBtn.style.display = 'block';
        });
        window.addEventListener('appinstalled', () => {
            this.deferredInstallPrompt = null;
            installBtn.style.display = 'none';
        });

        document.addEventListener('paste', (e) => {
            if (!state.isAdmin) return;
            if (this.isHtmlEditorOpen()) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const html = e.clipboardData.getData('text/html');
            const text = html || e.clipboardData.getData('text');
            const lower = (text || '').toLowerCase();
            const isHtml =
                lower.includes('<!doctype html') ||
                lower.includes('<html') ||
                lower.includes('<body') ||
                lower.includes('<head');

            if (!isHtml) return;
            e.preventDefault();

            if (state.currentView === 'detail' && state.activeProjectId) {
                if (confirm('HTML detected. Create new version?')) {
                    const blob = new Blob([text], { type: 'text/html' });
                    const file = new File([blob], 'pasted.html', { type: 'text/html' });
                    this.addVersionToProject(state.activeProjectId, file);
                }
                return;
            }

            if (state.currentView === 'list') {
                if (confirm('HTML detected. Create new project?')) {
                    const blob = new Blob([text], { type: 'text/html' });
                    const file = new File([blob], 'pasted.html', { type: 'text/html' });
                    this.createProjectFromFile(file);
                }
            }
        });

        // Allow dropping HTML anywhere on the page.
        document.addEventListener('dragover', (e) => {
            if (!state.isAdmin) return;
            if (this.isHtmlEditorOpen()) return;
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            if (!state.isAdmin) return;
            if (this.isHtmlEditorOpen()) return;
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (state.currentView === 'detail' && state.activeProjectId) {
                this.addVersionToProject(state.activeProjectId, file);
            } else if (state.currentView === 'list') {
                this.createProjectFromFile(file);
            }
        });
    },

    // ---- UI helpers ----
    closeModal: function(id) {
        byId(id).classList.remove('active');
    },

    showToast: function(msg) {
        const t = byId('toast');
        t.innerText = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    },

    updateDateHeader: function() {
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        byId('currentDate').innerText = new Date().toLocaleDateString('en-US', options).toUpperCase();
    },

    escapeHtml: function(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

window.addEventListener('DOMContentLoaded', () => {
    app.init();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
});
