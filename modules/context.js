window.APP_CONFIG = {
    ghTokenKey: "ghp_token",
    ghOwnerKey: "gh_owner",
    ghRepoKey: "gh_repo",
    ghBranchKey: "gh_branch",
    ghRootKey: "gh_root",
    apiKey: "gemini_api_key"
};

window.APP_DEFAULTS = {
    owner: "Chr0mium24",
    repo: "html-manager",
    branch: "content",
    storageRoot: "html-projects"
};

window.byId = (id) => document.getElementById(id);

window.appState = {
    isAdmin: false,
    ghToken: "",
    ghOwner: window.APP_DEFAULTS.owner,
    ghRepo: window.APP_DEFAULTS.repo,
    ghBranch: window.APP_DEFAULTS.branch,
    ghRoot: window.APP_DEFAULTS.storageRoot,
    currentView: "list",
    activeProjectId: null,
    projects: [],
    activeProject: null,
    apiKey: "",
    editingProjectId: null,
    editingVersionId: null,
    editingVersionName: "",
    editingVersionPath: "",
    editorInstance: null,
    versionsPageSize: 40,
    versionsOffset: 0,
    versionsHasMore: false,
    isOpeningProject: false,
    isLoadingMoreVersions: false,
    activeProjectRequestToken: 0,
    indexData: null,
    indexSha: null
};

window.app = {
    deferredInstallPrompt: null
};
