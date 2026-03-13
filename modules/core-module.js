(() => {
const CONFIG = window.APP_CONFIG;
const DEFAULTS = window.APP_DEFAULTS;
const byId = window.byId;
const state = window.appState;

Object.assign(window.app, {
    isHtmlEditorOpen: function() {
        return byId('htmlEditorModal').classList.contains('active');
    },

    init: function() {
        this.updateDateHeader();
        this.restoreApiKey();
        this.restoreGitHubConfig();
        if (typeof this.handlePreviewRoute === 'function' && this.handlePreviewRoute()) {
            return;
        }
        this.bindFileInputs();
        this.restoreAdmin();
        this.setupGlobalListeners();
        this.loadProjects();
        this.render();
    },

    nowIso: function() {
        return new Date().toISOString();
    },

    newId: function() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID().replace(/-/g, '');
        }
        return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    },

    normalizeStorageRoot: function(root) {
        const raw = String(root || DEFAULTS.storageRoot).trim();
        return raw.replace(/^\/+|\/+$/g, '');
    },

    getIndexPath: function() {
        const root = this.normalizeStorageRoot(state.ghRoot);
        return `${root}/index.json`;
    },

    getVersionPath: function(projectId, versionId) {
        const root = this.normalizeStorageRoot(state.ghRoot);
        return `${root}/projects/${projectId}/${versionId}.html`;
    },

    normalizeHtmlFilename: function(name, fallback = 'index.html') {
        const raw = String(name || fallback).trim();
        const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
        if (!cleaned) return fallback;
        if (cleaned.toLowerCase().endsWith('.html')) return cleaned;
        return `${cleaned}.html`;
    },

    encodePathSegments: function(path) {
        return String(path || '')
            .split('/')
            .filter(Boolean)
            .map((p) => encodeURIComponent(p))
            .join('/');
    },

    buildPreviewRoute: function(projectId, versionId) {
        const proj = String(projectId || '').trim();
        const ver = String(versionId || '').trim();
        if (!proj || !ver) return '';

        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('view', 'preview');
        url.searchParams.set('project', proj);
        url.searchParams.set('version', ver);
        return url.toString();
    },

    encodeBase64Utf8: function(text) {
        const bytes = new TextEncoder().encode(String(text || ''));
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    decodeBase64Utf8: function(base64) {
        const cleaned = String(base64 || '').replace(/\n/g, '');
        if (!cleaned) return '';
        const binary = atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    },

    downloadBlob: function(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'download.bin';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    },

    escapeHtml: function(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    extractTitle: function(htmlText) {
        const match = String(htmlText || '').match(/<title>(.*?)<\/title>/is);
        if (!match || !match[1]) return '';
        return match[1].replace(/\s+/g, ' ').trim().slice(0, 60);
    },

    extractMetaDescription: function(htmlText) {
        const content = String(htmlText || '');
        const meta = content.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/is);
        if (!meta || !meta[0]) return '';
        const c = meta[0].match(/content=["'](.*?)["']/is);
        if (!c || !c[1]) return '';
        return c[1].replace(/\s+/g, ' ').trim().slice(0, 160);
    },

    extractTextSnippet: function(htmlText) {
        const content = String(htmlText || '');
        const noScript = content.replace(/<script[\s\S]*?<\/script>/gi, ' ');
        const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, ' ');
        const plain = noStyle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return plain.slice(0, 160);
    },

    buildFallbackMetadata: function(htmlText, filename) {
        const base = this.normalizeHtmlFilename(filename || 'upload.html').replace(/\.html$/i, '');
        const title = this.extractTitle(htmlText);
        const name = (title || base || 'Untitled').slice(0, 60);
        const desc = (this.extractMetaDescription(htmlText) || this.extractTextSnippet(htmlText) || `${name} HTML project`).slice(0, 160);
        return { name, description: desc, icon: '📁' };
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
    }
});
})();
