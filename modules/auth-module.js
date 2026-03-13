(() => {
const CONFIG = window.APP_CONFIG;
const DEFAULTS = window.APP_DEFAULTS;
const byId = window.byId;
const state = window.appState;

Object.assign(window.app, {
    restoreGitHubConfig: function() {
        const storedOwner = (localStorage.getItem(CONFIG.ghOwnerKey) || '').trim();
        const storedRepo = (localStorage.getItem(CONFIG.ghRepoKey) || '').trim();
        state.ghOwner = storedOwner || DEFAULTS.owner || '';
        state.ghRepo = storedRepo || DEFAULTS.repo || '';
        state.ghBranch = (localStorage.getItem(CONFIG.ghBranchKey) || DEFAULTS.branch).trim() || DEFAULTS.branch;
        state.ghRoot = this.normalizeStorageRoot(localStorage.getItem(CONFIG.ghRootKey) || DEFAULTS.storageRoot);

        byId('ghOwnerInput').value = state.ghOwner;
        byId('ghRepoInput').value = state.ghRepo;
        byId('ghBranchInput').value = state.ghBranch;
        byId('ghRootInput').value = state.ghRoot;
    },

    restoreApiKey: function() {
        const saved = localStorage.getItem(CONFIG.apiKey);
        if (saved) state.apiKey = saved;
        byId('apiKeyInput').value = state.apiKey || '';
    },

    saveApiKey: function() {
        const apiKey = byId('apiKeyInput').value.trim();
        const owner = byId('ghOwnerInput').value.trim() || DEFAULTS.owner || '';
        const repo = byId('ghRepoInput').value.trim() || DEFAULTS.repo || '';
        const branch = (byId('ghBranchInput').value.trim() || DEFAULTS.branch);
        const root = this.normalizeStorageRoot(byId('ghRootInput').value.trim() || DEFAULTS.storageRoot);

        if (apiKey) {
            localStorage.setItem(CONFIG.apiKey, apiKey);
            state.apiKey = apiKey;
        } else {
            localStorage.removeItem(CONFIG.apiKey);
            state.apiKey = '';
        }

        state.ghOwner = owner;
        state.ghRepo = repo;
        state.ghBranch = branch;
        state.ghRoot = root;

        localStorage.setItem(CONFIG.ghOwnerKey, owner);
        localStorage.setItem(CONFIG.ghRepoKey, repo);
        localStorage.setItem(CONFIG.ghBranchKey, branch);
        localStorage.setItem(CONFIG.ghRootKey, root);

        byId('ghOwnerInput').value = owner;
        byId('ghRepoInput').value = repo;

        state.indexData = null;
        state.indexSha = null;

        this.showToast('Settings Saved');
        this.loadProjects();
    },

    restoreAdmin: function() {
        const persistent = localStorage.getItem(CONFIG.ghTokenKey);
        const legacy = sessionStorage.getItem(CONFIG.ghTokenKey);
        const saved = persistent || legacy;
        if (!persistent && legacy) {
            localStorage.setItem(CONFIG.ghTokenKey, legacy);
        }
        if (saved) {
            this.verifyAdmin(saved, true);
        }
        this.updateAdminUI();
    },

    verifyAdmin: async function(token, silent = false) {
        const trimmed = String(token || '').trim();
        if (!trimmed) {
            if (!silent) this.showToast('Token required');
            return;
        }

        try {
            state.ghToken = trimmed;
            await this.githubRequest('/user', {}, true);
            if (state.ghOwner && state.ghRepo) {
                const owner = encodeURIComponent(state.ghOwner);
                const repo = encodeURIComponent(state.ghRepo);
                await this.githubRequest(`/repos/${owner}/${repo}`, {}, true);
            }
            state.isAdmin = true;
            localStorage.setItem(CONFIG.ghTokenKey, trimmed);
            sessionStorage.removeItem(CONFIG.ghTokenKey);
            this.updateAdminUI();
            if (!silent) {
                if (!state.ghOwner || !state.ghRepo) {
                    this.showToast('Token OK, now set owner/repo in Settings');
                } else {
                    this.showToast('GitHub Token Verified');
                }
            }
            await this.loadProjects();
        } catch (err) {
            this.forceLogout();
            if (!silent) this.showToast('Token Verify Failed');
        }
    },

    forceLogout: function() {
        state.isAdmin = false;
        state.ghToken = '';
        localStorage.removeItem(CONFIG.ghTokenKey);
        sessionStorage.removeItem(CONFIG.ghTokenKey);
        this.updateAdminUI();
        if (state.currentView === 'detail') {
            this.goHome();
        } else {
            this.render();
        }
    },

    updateAdminUI: function() {
        const authBtn = byId('authActionBtn');
        byId('adminBadge').style.display = state.isAdmin ? 'inline-block' : 'none';
        document.body.classList.toggle('is-admin', state.isAdmin);
        authBtn.innerText = state.isAdmin ? 'Logout' : 'Admin Login';
        authBtn.classList.remove('btn-primary', 'btn-danger');
        authBtn.classList.add(state.isAdmin ? 'btn-danger' : 'btn-primary');
    },

    toggleAdmin: function() {
        byId('settingsModal').classList.add('active');
        byId('ghOwnerInput').focus();
    },

    login: function() {
        const token = byId('passwordInput').value;
        if (!token) return;
        this.closeModal('loginModal');
        byId('passwordInput').value = '';
        this.verifyAdmin(token);
    },

    logoutAdmin: function() {
        if (!state.isAdmin) {
            this.closeModal('settingsModal');
            byId('loginModal').classList.add('active');
            byId('passwordInput').focus();
            return;
        }
        this.forceLogout();
        this.closeModal('settingsModal');
        this.showToast('Logged Out');
    }
});
})();
