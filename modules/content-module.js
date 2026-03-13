const DEFAULTS = window.APP_DEFAULTS;
const byId = window.byId;
const state = window.appState;

Object.assign(window.app, {
    triggerNewProject: function() {
        if (!state.isAdmin) return;
        byId('newProjectFile').click();
    },

    triggerVersionUpload: function() {
        if (!state.isAdmin) return;
        byId('versionFile').click();
    },

    extractHtmlFromClipboardPayload: function(rawText) {
        const raw = String(rawText || '');
        if (!raw.trim()) return '';

        const markerStart = '<!--StartFragment-->';
        const markerEnd = '<!--EndFragment-->';
        const markerStartIndex = raw.indexOf(markerStart);
        const markerEndIndex = raw.indexOf(markerEnd);
        if (markerStartIndex !== -1 && markerEndIndex > markerStartIndex) {
            const fragment = raw
                .slice(markerStartIndex + markerStart.length, markerEndIndex)
                .trim();
            if (fragment) return fragment;
        }

        const startFragmentMatch = raw.match(/StartFragment:(\d+)/i);
        const endFragmentMatch = raw.match(/EndFragment:(\d+)/i);
        if (startFragmentMatch && endFragmentMatch) {
            const start = Number(startFragmentMatch[1]);
            const end = Number(endFragmentMatch[1]);
            if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= raw.length) {
                const fragment = raw.slice(start, end).trim();
                if (fragment) return fragment;
            }
        }

        const startHtmlMatch = raw.match(/StartHTML:(\d+)/i);
        const endHtmlMatch = raw.match(/EndHTML:(\d+)/i);
        if (startHtmlMatch && endHtmlMatch) {
            const start = Number(startHtmlMatch[1]);
            const end = Number(endHtmlMatch[1]);
            if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= raw.length) {
                const fragment = raw.slice(start, end).trim();
                if (fragment) return fragment;
            }
        }

        return raw.trim();
    },

    isHtmlLike: function(text) {
        const html = this.extractHtmlFromClipboardPayload(text);
        if (!html) return false;

        const lower = html.toLowerCase();
        if (
            lower.includes('<!doctype html') ||
            lower.includes('<html') ||
            lower.includes('<body') ||
            lower.includes('<head')
        ) {
            return true;
        }

        if (!/<\/?[a-z][\w:-]*\b[^>]*>/i.test(html)) {
            return false;
        }

        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return Boolean(doc.body && doc.body.querySelector('*'));
        } catch (err) {
            return false;
        }
    },

    createPastedHtmlFile: function(text) {
        const blob = new Blob([text], { type: 'text/html' });
        return new File([blob], 'pasted.html', { type: 'text/html' });
    },

    processPastedHtml: function(text) {
        const html = this.extractHtmlFromClipboardPayload(text);
        if (!this.isHtmlLike(html)) return false;

        if (state.currentView === 'detail' && state.activeProjectId) {
            if (confirm('HTML detected. Create new version?')) {
                this.addVersionToProject(state.activeProjectId, this.createPastedHtmlFile(html));
            }
            return true;
        }

        if (state.currentView === 'list') {
            if (confirm('HTML detected. Create new project?')) {
                this.createProjectFromFile(this.createPastedHtmlFile(html));
            }
            return true;
        }

        return false;
    },

    readClipboardHtmlText: async function() {
        if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                if (item.types.includes('text/html')) {
                    const htmlBlob = await item.getType('text/html');
                    return await htmlBlob.text();
                }
            }
            for (const item of items) {
                if (item.types.includes('text/plain')) {
                    const textBlob = await item.getType('text/plain');
                    return await textBlob.text();
                }
            }
        }

        if (navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }

        throw new Error('Clipboard API unavailable');
    },

    pasteHtmlFromClipboard: async function() {
        if (!state.isAdmin) return;

        let text = '';
        try {
            text = await this.readClipboardHtmlText();
        } catch (err) {
            text = prompt('Unable to read clipboard directly. Paste HTML below:') || '';
        }

        if (!text.trim()) {
            this.showToast('No clipboard content');
            return;
        }

        if (!this.processPastedHtml(text)) {
            this.showToast('Clipboard is not HTML');
        }
    },

    createProjectFromFile: async function(file) {
        if (!state.isAdmin || !file) return;

        try {
            const html = await file.text();
            const meta = this.buildFallbackMetadata(html, file.name || 'upload.html');
            const projectId = this.newId();
            const versionId = this.newId();
            const path = this.getVersionPath(projectId, versionId);
            const originalFilename = this.normalizeHtmlFilename(file.name || 'upload.html');
            const now = this.nowIso();

            const htmlSaved = await this.saveGitHubFile({
                path,
                content: html,
                message: `Create HTML version ${versionId}`
            });

            await this.withIndexMutation(`Create project ${projectId}`, (index) => {
                index.projects.push({
                    id: projectId,
                    name: meta.name,
                    description: meta.description,
                    icon: meta.icon,
                    created_at: now,
                    updated_at: now,
                    versions: [
                        {
                            id: versionId,
                            display_name: originalFilename,
                            original_filename: originalFilename,
                            created_at: now,
                            path,
                            sha: htmlSaved.sha
                        }
                    ]
                });
            });

            this.showToast('Project Created');
            await this.loadProjects();
        } catch (err) {
            this.showToast('Upload failed');
        }
    },

    addVersionToProject: async function(projId, file) {
        if (!state.isAdmin || !file || !projId) return;

        try {
            const html = await file.text();
            const versionId = this.newId();
            const path = this.getVersionPath(projId, versionId);
            const originalFilename = this.normalizeHtmlFilename(file.name || 'upload.html');
            const now = this.nowIso();

            const htmlSaved = await this.saveGitHubFile({
                path,
                content: html,
                message: `Add version ${versionId} to project ${projId}`
            });

            await this.withIndexMutation(`Add version ${versionId}`, (index) => {
                const project = index.projects.find((p) => p.id === projId);
                if (!project) {
                    throw new Error('Project not found');
                }
                project.versions = Array.isArray(project.versions) ? project.versions : [];
                project.versions.push({
                    id: versionId,
                    display_name: originalFilename,
                    original_filename: originalFilename,
                    created_at: now,
                    path,
                    sha: htmlSaved.sha
                });
                project.updated_at = now;
            });

            this.showToast('New Version Uploaded');
            await this.loadProjects();
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
        if (!projId || !state.isAdmin) return;

        const nextName = byId('editNameInput').value.trim();
        const nextDesc = byId('editDescInput').value.trim();
        const nextIcon = byId('editIconInput').value.trim() || '📁';

        try {
            await this.withIndexMutation(`Update project ${projId}`, (index) => {
                const proj = index.projects.find((p) => p.id === projId);
                if (!proj) throw new Error('Project not found');

                if (nextName) proj.name = nextName;
                if (nextDesc) proj.description = nextDesc;
                proj.icon = nextIcon.slice(0, 2);
                proj.updated_at = this.nowIso();
            });

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

    aiFillProject: async function() {
        const projId = state.editingProjectId;
        if (!projId) return;
        if (!state.apiKey) {
            alert('Please set your Gemini API key in Settings.');
            return;
        }

        try {
            await this.loadIndex(false);
            const project = state.indexData.projects.find((p) => p.id === projId);
            if (!project || !project.versions || !project.versions.length) {
                throw new Error('No versions found');
            }
            const sorted = project.versions.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
            const latest = sorted[0];
            const latestFile = await this.readGitHubFile(latest.path, { required: true, requireAuth: true });
            const htmlText = latestFile.text || '';

            const prompt = (
                'You are a product naming assistant. Given HTML content, return a JSON object ' +
                'with keys "name", "description", and "icon". Keep the name <= 20 characters and the description <= 120 characters. ' +
                'The icon must be a single emoji. Return JSON only, no extra text.\\n\\nHTML:\\n' +
                htmlText.slice(0, 12000)
            );

            const payload = { contents: [{ parts: [{ text: prompt }] }] };
            const resp = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': state.apiKey
                    },
                    body: JSON.stringify(payload)
                }
            );
            if (!resp.ok) throw new Error('AI request failed');
            const data = await resp.json();
            const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
                ? data.candidates[0].content.parts[0].text
                : '';
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
        state.editingVersionPath = ver.path || '';
        state.editingVersionName = this.normalizeHtmlFilename(
            ver.display_name || ver.original_filename || `${versionId}.html`
        );
        byId('editorFileName').innerText = state.editingVersionName;
        byId('htmlEditorModal').classList.add('active');

        try {
            const file = await this.readGitHubFile(ver.path, { required: true, requireAuth: true });
            const editor = this.ensureAceEditor();
            editor.setValue(file.text || '', -1);
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
        state.editingVersionPath = '';
    },

    saveHtmlEdits: async function() {
        if (!state.isAdmin || !state.activeProjectId || !state.editingVersionId || !state.editorInstance || !state.editingVersionPath) return;
        const html = state.editorInstance.getValue();
        if (!html.trim()) {
            this.showToast('HTML is empty');
            return;
        }

        try {
            const saved = await this.saveGitHubFile({
                path: state.editingVersionPath,
                content: html,
                message: `Update HTML version ${state.editingVersionId}`
            });

            await this.withIndexMutation(`Update version ${state.editingVersionId}`, (index) => {
                const project = index.projects.find((p) => p.id === state.activeProjectId);
                if (!project) return;
                const version = (project.versions || []).find((v) => v.id === state.editingVersionId);
                if (version) version.sha = saved.sha;
                project.updated_at = this.nowIso();
            });

            this.closeHtmlEditor();
            this.showToast('HTML Saved');
            await this.loadProjects();
            await this.openProject(state.activeProjectId);
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
        if (!ver || !ver.path) return;

        const fallback = this.normalizeHtmlFilename(
            (ver.display_name || ver.original_filename) || `${versionId}.html`
        );

        try {
            const file = await this.readGitHubFile(ver.path, { required: true, requireAuth: state.isAdmin });
            const blob = new Blob([file.text || ''], { type: 'text/html;charset=utf-8' });
            this.downloadBlob(blob, fallback);
            this.showToast('Downloaded');
        } catch (err) {
            this.showToast('Download failed');
        }
    },

    downloadBackup: async function() {
        try {
            this.ensureRepoConfigured();
            const owner = encodeURIComponent(state.ghOwner);
            const repo = encodeURIComponent(state.ghRepo);
            const branch = encodeURIComponent(state.ghBranch || DEFAULTS.branch);
            const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
            const headers = { Accept: 'application/vnd.github+json' };
            if (state.ghToken) {
                headers.Authorization = `Bearer ${state.ghToken}`;
            }
            const resp = await fetch(url, { headers });
            if (!resp.ok) throw new Error('Backup failed');
            const blob = await resp.blob();
            this.downloadBlob(blob, `${state.ghRepo || 'repo'}-${state.ghBranch || DEFAULTS.branch}.zip`);
            this.showToast('Backup Downloaded');
        } catch (err) {
            this.showToast('Backup failed');
        }
    },

    renameVersion: async function(versionId) {
        if (!state.activeProject || !state.activeProject.versions) return;
        const ver = state.activeProject.versions.find((v) => v.id === versionId);
        const current = this.normalizeHtmlFilename(
            (ver && (ver.display_name || ver.original_filename)) || `${versionId}.html`
        );
        const nextRaw = prompt('New file name:', current || '');
        if (nextRaw === null) return;
        const next = this.normalizeHtmlFilename(nextRaw, current || `${versionId}.html`);
        if (!next || next === current) return;
        try {
            await this.withIndexMutation(`Rename version ${versionId}`, (index) => {
                const project = index.projects.find((p) => p.id === state.activeProjectId);
                if (!project) throw new Error('Project not found');
                const version = (project.versions || []).find((v) => v.id === versionId);
                if (!version) throw new Error('Version not found');
                version.display_name = next;
                project.updated_at = this.nowIso();
            });
            this.showToast('File Name Updated');
            await this.loadProjects();
            await this.openProject(state.activeProjectId);
        } catch (err) {
            this.showToast('Update failed');
        }
    },

    deleteProject: async function(projId) {
        if (!state.isAdmin) return;
        if (!confirm('Delete this project and all versions?')) return;

        try {
            await this.loadIndex(true);
            const project = (state.indexData.projects || []).find((p) => p.id === projId);
            if (!project) throw new Error('Project not found');

            const versions = Array.isArray(project.versions) ? project.versions : [];
            for (const ver of versions) {
                if (!ver.path) continue;
                await this.deleteGitHubFile(ver.path, `Delete version ${ver.id}`, ver.sha || null);
            }

            state.indexData.projects = state.indexData.projects.filter((p) => p.id !== projId);
            await this.saveIndex(`Delete project ${projId}`);

            this.showToast('Project Deleted');
            await this.loadProjects();
            if (state.activeProjectId === projId) this.goHome();
        } catch (err) {
            this.showToast('Delete failed');
        }
    },

    deleteVersion: async function(versionId) {
        if (!state.isAdmin) return;
        if (!confirm('Delete this version?')) return;

        try {
            await this.loadIndex(true);
            const project = (state.indexData.projects || []).find((p) => p.id === state.activeProjectId);
            if (!project) throw new Error('Project not found');
            const versions = Array.isArray(project.versions) ? project.versions : [];
            const ver = versions.find((v) => v.id === versionId);
            if (!ver) throw new Error('Version not found');

            if (ver.path) {
                await this.deleteGitHubFile(ver.path, `Delete version ${versionId}`, ver.sha || null);
            }

            project.versions = versions.filter((v) => v.id !== versionId);
            project.updated_at = this.nowIso();
            await this.saveIndex(`Delete version ${versionId}`);

            this.showToast('Version Deleted');
            await this.loadProjects();
            await this.openProject(state.activeProjectId);
        } catch (err) {
            this.showToast('Delete failed');
        }
    },

    previewHtml: async function(projId, verId) {
        await this.loadIndex(false);
        const project = (state.indexData.projects || []).find((p) => p.id === projId);
        if (!project) return;
        const version = (project.versions || []).find((v) => v.id === verId);
        if (!version || !version.path) return;

        if (!state.isAdmin) {
            window.open(this.buildRawHtmlUrl(version.path), '_blank');
            return;
        }

        try {
            const file = await this.readGitHubFile(version.path, { required: true, requireAuth: true });
            const blob = new Blob([file.text || ''], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            this.showToast('Preview failed');
        }
    }
});
