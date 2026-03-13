(() => {
const byId = window.byId;
const state = window.appState;

Object.assign(window.app, {
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
        const aiVersionPrompt = byId('aiVersionPrompt');
        aiVersionPrompt.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.createVersionWithAi();
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
                const aiVersionOpen = byId('aiVersionModal').classList.contains('active');
                const htmlEditorOpen = this.isHtmlEditorOpen();
                if (loginOpen || settingsOpen || editOpen || aiVersionOpen || htmlEditorOpen) {
                    this.closeModal('loginModal');
                    this.closeModal('settingsModal');
                    this.closeModal('editProjectModal');
                    this.closeAiVersionModal();
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
            const text = html || e.clipboardData.getData('text/plain') || e.clipboardData.getData('text');
            if (!this.isHtmlLike(text)) return;
            e.preventDefault();
            this.processPastedHtml(text);
        });

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
    }
});
})();
