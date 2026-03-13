(() => {
const DEFAULTS = window.APP_DEFAULTS;
const state = window.appState;

Object.assign(window.app, {
    ensureRepoConfigured: function() {
        if (state.ghOwner && state.ghRepo) {
            return;
        }
        throw new Error('Please set GitHub owner/repo in Settings first');
    },

    buildRepoContentsApiPath: function(path) {
        this.ensureRepoConfigured();
        const owner = encodeURIComponent(state.ghOwner);
        const repo = encodeURIComponent(state.ghRepo);
        const encodedPath = this.encodePathSegments(path);
        return `/repos/${owner}/${repo}/contents/${encodedPath}`;
    },

    githubRequest: async function(path, options = {}, requireAuth = false) {
        const isAbsolute = /^https?:\/\//i.test(path);
        const url = isAbsolute ? path : `https://api.github.com${path}`;

        const opts = { ...options };
        const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
        if ((requireAuth || state.ghToken) && state.ghToken) {
            headers.Authorization = `Bearer ${state.ghToken}`;
        }
        opts.headers = headers;

        const resp = await fetch(url, opts);

        if (!resp.ok) {
            let message = `GitHub API error (${resp.status})`;
            try {
                const data = await resp.json();
                if (data && data.message) message = data.message;
            } catch (err) {
                const text = await resp.text().catch(() => '');
                if (text) message = text;
            }
            const error = new Error(message);
            error.status = resp.status;
            throw error;
        }

        if (resp.status === 204) return {};

        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return resp.json();
        }
        return resp.blob();
    },

    readGitHubFile: async function(path, options = {}) {
        const { required = true, requireAuth = false } = options;
        const apiPath = `${this.buildRepoContentsApiPath(path)}?ref=${encodeURIComponent(state.ghBranch || DEFAULTS.branch)}`;

        try {
            const data = await this.githubRequest(apiPath, {}, requireAuth);
            if (!data || Array.isArray(data) || data.type !== 'file') {
                throw new Error('Expected a file, but found directory or unknown type');
            }
            return {
                path,
                sha: data.sha,
                text: this.decodeBase64Utf8(data.content || ''),
                size: data.size || 0,
                downloadUrl: data.download_url || ''
            };
        } catch (err) {
            if (!required && err.status === 404) {
                return null;
            }
            throw err;
        }
    },

    saveGitHubFile: async function(payload) {
        const { path, content, message } = payload;
        let { sha } = payload;

        if (!sha) {
            const existing = await this.readGitHubFile(path, { required: false, requireAuth: true });
            sha = existing ? existing.sha : undefined;
        }

        const body = {
            message: message || `Update ${path}`,
            content: this.encodeBase64Utf8(content),
            branch: state.ghBranch || DEFAULTS.branch
        };
        if (sha) body.sha = sha;

        const data = await this.githubRequest(this.buildRepoContentsApiPath(path), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, true);

        return {
            sha: data && data.content ? data.content.sha : null,
            commitSha: data && data.commit ? data.commit.sha : null
        };
    },

    deleteGitHubFile: async function(path, message = '', knownSha = null) {
        let sha = knownSha;
        if (!sha) {
            const existing = await this.readGitHubFile(path, { required: false, requireAuth: true });
            if (!existing) return;
            sha = existing.sha;
        }

        const body = {
            message: message || `Delete ${path}`,
            sha,
            branch: state.ghBranch || DEFAULTS.branch
        };

        await this.githubRequest(this.buildRepoContentsApiPath(path), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, true);
    },

    emptyIndex: function() {
        return {
            version: 1,
            updated_at: this.nowIso(),
            projects: []
        };
    },

    normalizeIndexData: function(raw) {
        const index = raw && typeof raw === 'object' ? raw : {};
        const projects = Array.isArray(index.projects) ? index.projects : [];

        index.version = typeof index.version === 'number' ? index.version : 1;
        index.updated_at = index.updated_at || this.nowIso();
        index.projects = projects.map((proj) => {
            const versions = Array.isArray(proj.versions) ? proj.versions : [];
            return {
                id: String(proj.id || this.newId()),
                name: String(proj.name || 'Untitled'),
                description: String(proj.description || ''),
                icon: String(proj.icon || '📁'),
                created_at: proj.created_at || this.nowIso(),
                updated_at: proj.updated_at || this.nowIso(),
                versions: versions.map((ver) => ({
                    id: String(ver.id || this.newId()),
                    display_name: this.normalizeHtmlFilename(ver.display_name || ver.original_filename || 'index.html'),
                    original_filename: this.normalizeHtmlFilename(ver.original_filename || ver.display_name || 'index.html'),
                    created_at: ver.created_at || this.nowIso(),
                    path: String(ver.path || ''),
                    sha: ver.sha || null
                }))
            };
        });

        return index;
    },

    loadIndex: async function(forceReload = false) {
        if (!forceReload && state.indexData) {
            return state.indexData;
        }

        this.ensureRepoConfigured();
        const indexPath = this.getIndexPath();

        const file = await this.readGitHubFile(indexPath, {
            required: false,
            requireAuth: state.isAdmin
        });

        if (!file) {
            const empty = this.emptyIndex();
            state.indexData = empty;
            state.indexSha = null;
            return empty;
        }

        let parsed = null;
        try {
            parsed = JSON.parse(file.text || '{}');
        } catch (err) {
            throw new Error(`Invalid JSON in ${indexPath}`);
        }

        const normalized = this.normalizeIndexData(parsed);
        state.indexData = normalized;
        state.indexSha = file.sha;
        return normalized;
    },

    saveIndex: async function(message = 'Update index') {
        if (!state.indexData) state.indexData = this.emptyIndex();
        state.indexData.updated_at = this.nowIso();

        const saved = await this.saveGitHubFile({
            path: this.getIndexPath(),
            content: JSON.stringify(state.indexData, null, 2),
            message,
            sha: state.indexSha
        });

        state.indexSha = saved.sha;
    },

    withIndexMutation: async function(message, mutator) {
        for (let i = 0; i < 2; i += 1) {
            await this.loadIndex(true);
            const result = await mutator(state.indexData);
            try {
                await this.saveIndex(message);
                return result;
            } catch (err) {
                if ((err.status === 409 || err.status === 422) && i === 0) {
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Index save conflict; please retry');
    },

    summarizeProjects: function(index) {
        const projects = (index.projects || []).map((proj) => {
            const versions = (proj.versions || [])
                .slice()
                .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
            const latest = versions[0] || null;

            const item = {
                id: proj.id,
                name: proj.name,
                description: proj.description,
                icon: proj.icon || '📁',
                created_at: proj.created_at,
                updated_at: proj.updated_at,
                latest_version: latest
                    ? {
                        id: latest.id,
                        display_name: latest.display_name,
                        created_at: latest.created_at,
                        path: latest.path
                    }
                    : null
            };

            if (state.isAdmin) {
                item.versions_count = versions.length;
            }
            return item;
        });

        projects.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        return projects;
    },

    findLatestVersion: function(index) {
        const projects = index && Array.isArray(index.projects) ? index.projects : [];
        let latest = null;
        let latestStamp = '';

        projects.forEach((project) => {
            const versions = Array.isArray(project.versions) ? project.versions : [];
            versions.forEach((version) => {
                const versionPath = String(version.path || '').trim();
                if (!versionPath) return;
                const stamp = String(version.created_at || project.updated_at || project.created_at || '');
                if (!latest || stamp > latestStamp) {
                    latest = {
                        projectId: String(project.id || ''),
                        projectName: String(project.name || ''),
                        versionId: String(version.id || ''),
                        path: versionPath,
                        createdAt: stamp
                    };
                    latestStamp = stamp;
                }
            });
        });

        return latest;
    },

    buildRawHtmlUrl: function(path) {
        const ownerRaw = String(state.ghOwner || '').trim();
        const repoRaw = String(state.ghRepo || '').trim();
        const branchRaw = String(state.ghBranch || DEFAULTS.branch).trim();
        const cleanPath = String(path || '').replace(/^\/+/, '').trim();

        if (!ownerRaw || !repoRaw || !branchRaw || !cleanPath) {
            return '';
        }

        const owner = encodeURIComponent(ownerRaw);
        const repo = encodeURIComponent(repoRaw);
        const branch = encodeURIComponent(branchRaw);
        const encodedPath = this.encodePathSegments(cleanPath);
        if (!encodedPath) {
            return '';
        }

        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
    }
});
})();
