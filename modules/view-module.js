const byId = window.byId;
const state = window.appState;

Object.assign(window.app, {
    loadProjects: async function() {
        try {
            if (!state.ghOwner || !state.ghRepo) {
                state.projects = [];
                this.render();
                return;
            }
            const index = await this.loadIndex(false);
            state.projects = this.summarizeProjects(index);
            this.render();
        } catch (err) {
            state.projects = [];
            this.render();
            this.showToast('Failed to load from GitHub');
        }
    },

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
                <div class="upload-cta-actions">
                    <button class="upload-cta-btn">Choose File</button>
                    <button class="upload-cta-btn upload-cta-btn-secondary">Paste File</button>
                </div>
            `;
            const buttons = cta.querySelectorAll('button');
            const chooseBtn = buttons[0];
            const pasteBtn = buttons[1];
            chooseBtn.addEventListener('click', () => this.triggerNewProject());
            pasteBtn.addEventListener('click', () => this.pasteHtmlFromClipboard());
            container.appendChild(cta);
        }

        if (!state.projects.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerText = state.ghOwner && state.ghRepo
                ? 'No projects yet.'
                : 'Set GitHub owner/repo in Settings.';
            container.appendChild(empty);
            return;
        }

        state.projects.forEach((proj) => {
            const card = document.createElement('div');
            card.className = 'card';

            const latestDate = proj.latest_version ? proj.latest_version.created_at : proj.updated_at;
            const dateLabel = latestDate ? new Date(latestDate).toLocaleDateString() : 'No versions';

            const deleteBtnHTML = state.isAdmin
                ? `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteProject('${proj.id}')">×</button>`
                : '';
            const projectIconAttrs = state.isAdmin
                ? `onclick="event.stopPropagation(); app.renameProject('${proj.id}')" title="Project Settings" style="cursor:pointer;"`
                : '';

            card.innerHTML = `
                <div class="project-item" onclick="app.openProject('${proj.id}')">
                    <div class="project-icon" ${projectIconAttrs}>${this.escapeHtml(proj.icon || '📁')}</div>
                    <div class="project-info">
                        <div class="project-name">${this.escapeHtml(proj.name)}</div>
                        <div class="project-desc">${this.escapeHtml(proj.description || '')}</div>
                        <div class="project-meta">Last updated: ${dateLabel}</div>
                    </div>
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
        if (!proj) {
            this.goHome();
            return;
        }

        byId('headerTitleText').innerText = proj.name || 'Project';

        const cta = document.createElement('div');
        cta.className = 'upload-cta';
        cta.innerHTML = `
            <div class="upload-cta-text">
                <strong>Upload Version</strong>
                Drag & drop or paste HTML (Ctrl+V) anywhere, or click to choose a file.
            </div>
            <div class="upload-cta-actions">
                <button class="upload-cta-btn">Choose File</button>
                <button class="upload-cta-btn upload-cta-btn-secondary">Paste File</button>
            </div>
        `;
        const buttons = cta.querySelectorAll('button');
        const chooseBtn = buttons[0];
        const pasteBtn = buttons[1];
        chooseBtn.addEventListener('click', () => this.triggerVersionUpload());
        pasteBtn.addEventListener('click', () => this.pasteHtmlFromClipboard());
        container.appendChild(cta);

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

                const downloadBtn = `<button class="download-btn" onclick="event.stopPropagation(); app.downloadVersion('${ver.id}')">↓</button>`;
                const editBtn = `<button class="edit-btn" title="Edit HTML" onclick="event.stopPropagation(); app.editHtmlVersion('${ver.id}')">&lt;/&gt;</button>`;
                const deleteBtn = `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteVersion('${ver.id}')">×</button>`;

                vCard.innerHTML = `
                    <div class="project-item" onclick="app.previewHtml('${proj.id}', '${ver.id}')">
                        <div class="project-icon" style="background:#306db9; font-size:14px; font-weight:bold; cursor:pointer;" title="Rename Version" onclick="event.stopPropagation(); app.renameVersion('${ver.id}')">HTML</div>
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

    goHome: function() {
        state.currentView = 'list';
        state.activeProjectId = null;
        state.activeProject = null;
        state.versionsOffset = 0;
        state.versionsHasMore = false;
        state.isOpeningProject = false;
        state.isLoadingMoreVersions = false;
        state.activeProjectRequestToken += 1;
        this.render();
    },

    openProject: async function(id) {
        const index = await this.loadIndex(false).catch(() => null);
        if (!index) {
            this.showToast('Failed to open');
            return;
        }

        const project = (index.projects || []).find((p) => p.id === id);
        if (!project) {
            this.showToast('Project not found');
            return;
        }

        const versions = (project.versions || [])
            .slice()
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        if (!state.isAdmin) {
            const latest = versions[0];
            if (!latest || !latest.path) {
                this.showToast('No versions to preview');
                return;
            }
            window.location.href = this.buildRawHtmlUrl(latest.path);
            return;
        }

        state.activeProjectId = id;
        state.activeProject = {
            ...project,
            versions
        };
        state.currentView = 'detail';
        this.render();
    },

    loadMoreVersions: async function() {
        this.showToast('Pagination is not needed in GitHub mode');
    }
});
