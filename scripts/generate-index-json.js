#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function toPosixPath(value) {
    return String(value || '').split(path.sep).join('/');
}

function normalizeStorageRoot(value) {
    return String(value || 'html-projects').trim().replace(/^\.\/+|\/+$/g, '');
}

function isHtmlFileName(name) {
    return /\.html?$/i.test(String(name || ''));
}

function extractTitle(htmlText) {
    const match = String(htmlText || '').match(/<title>(.*?)<\/title>/is);
    if (!match || !match[1]) return '';
    return match[1].replace(/\s+/g, ' ').trim().slice(0, 60);
}

function extractMetaDescription(htmlText) {
    const content = String(htmlText || '');
    const meta = content.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/is);
    if (!meta || !meta[0]) return '';
    const value = meta[0].match(/content=["'](.*?)["']/is);
    if (!value || !value[1]) return '';
    return value[1].replace(/\s+/g, ' ').trim().slice(0, 160);
}

function extractTextSnippet(htmlText) {
    const content = String(htmlText || '');
    const noScript = content.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    return noStyle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function normalizeHtmlFilename(name, fallback = 'index.html') {
    const raw = String(name || fallback).trim();
    const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    if (!cleaned) return fallback;
    if (cleaned.toLowerCase().endsWith('.html')) return cleaned;
    return `${cleaned}.html`;
}

function buildFallbackMetadata(htmlText, filename, projectId) {
    const base = normalizeHtmlFilename(filename || `${projectId}.html`).replace(/\.html$/i, '');
    const title = extractTitle(htmlText);
    const name = (title || base || projectId || 'Untitled').slice(0, 60);
    const description = (
        extractMetaDescription(htmlText) ||
        extractTextSnippet(htmlText) ||
        `${name} HTML project`
    ).slice(0, 160);
    return { name, description, icon: '📁' };
}

function toIso(dateMs) {
    return new Date(dateMs).toISOString();
}

function maxIso(a, b) {
    if (!a) return b || '';
    if (!b) return a || '';
    return a > b ? a : b;
}

function minIso(a, b) {
    if (!a) return b || '';
    if (!b) return a || '';
    return a < b ? a : b;
}

async function safeReadDir(dirPath) {
    try {
        return await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
        if (err && err.code === 'ENOENT') return [];
        throw err;
    }
}

async function safeReadFile(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (err) {
        return '';
    }
}

async function safeReadJson(filePath) {
    try {
        const text = await fs.readFile(filePath, 'utf8');
        return JSON.parse(text);
    } catch (err) {
        return null;
    }
}

async function collectHtmlFiles(projectDir) {
    const files = [];
    const direct = await safeReadDir(projectDir);
    for (const entry of direct) {
        if (!entry.isFile() || !isHtmlFileName(entry.name)) continue;
        files.push(path.join(projectDir, entry.name));
    }
    return files;
}

function normalizeExistingProjectMaps(project) {
    const byPath = new Map();
    const byId = new Map();
    const versions = Array.isArray(project && project.versions) ? project.versions : [];
    for (const version of versions) {
        const id = String(version && version.id ? version.id : '');
        const filePath = String(version && version.path ? version.path : '');
        if (id) byId.set(id, version);
        if (filePath) byPath.set(filePath, version);
    }
    return { byPath, byId };
}

async function main() {
    const rootArg = String(process.argv[2] || 'html-projects').trim();
    if (!rootArg) {
        console.error('Invalid storage root.');
        process.exitCode = 1;
        return;
    }

    const cwd = process.cwd();
    const rootDir = path.resolve(cwd, rootArg);
    const relativeRoot = normalizeStorageRoot(toPosixPath(path.relative(cwd, rootDir)));
    if (!relativeRoot || relativeRoot.startsWith('..')) {
        console.error('Storage root must be inside current working directory.');
        process.exitCode = 1;
        return;
    }

    const storageRoot = relativeRoot;
    const projectsDir = path.join(rootDir, 'projects');
    const indexPath = path.join(rootDir, 'index.json');

    const existingIndex = await safeReadJson(indexPath);
    const existingProjects = Array.isArray(existingIndex && existingIndex.projects)
        ? existingIndex.projects
        : [];
    const existingProjectMap = new Map(
        existingProjects.map((project) => [String(project && project.id ? project.id : ''), project])
    );

    const projectEntries = await safeReadDir(projectsDir);
    const projectIds = projectEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const projects = [];
    for (const projectId of projectIds) {
        const projectDir = path.join(projectsDir, projectId);
        const htmlFiles = await collectHtmlFiles(projectDir);
        if (!htmlFiles.length) continue;

        const existingProject = existingProjectMap.get(projectId);
        const { byPath: existingVersionsByPath, byId: existingVersionsById } =
            normalizeExistingProjectMaps(existingProject);
        const versionsById = new Map();

        for (const filePath of htmlFiles) {
            let stat;
            try {
                stat = await fs.stat(filePath);
            } catch (err) {
                continue;
            }

            const filename = normalizeHtmlFilename(path.basename(filePath));
            const versionId = path.basename(filename, path.extname(filename));
            if (!versionId) continue;

            const relativeToRoot = toPosixPath(path.relative(rootDir, filePath));
            const repoPath = `${storageRoot}/${relativeToRoot}`;
            const existingVersion = existingVersionsByPath.get(repoPath) || existingVersionsById.get(versionId);
            const createdAt = String(existingVersion && existingVersion.created_at
                ? existingVersion.created_at
                : toIso(stat.mtimeMs));

            const next = {
                id: versionId,
                display_name: normalizeHtmlFilename(
                    existingVersion && existingVersion.display_name
                        ? existingVersion.display_name
                        : filename
                ),
                original_filename: normalizeHtmlFilename(
                    existingVersion && existingVersion.original_filename
                        ? existingVersion.original_filename
                        : filename
                ),
                created_at: createdAt,
                path: repoPath,
                sha: existingVersion && existingVersion.sha ? existingVersion.sha : null,
                _sourceFilePath: filePath
            };

            const prev = versionsById.get(versionId);
            if (!prev || String(next.created_at) > String(prev.created_at)) {
                versionsById.set(versionId, next);
            }
        }

        const versions = Array.from(versionsById.values())
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        if (!versions.length) continue;

        const latest = versions[0];
        const latestHtml = await safeReadFile(latest._sourceFilePath);
        const fallback = buildFallbackMetadata(latestHtml, latest.original_filename, projectId);

        const newestVersionAt = versions.reduce((acc, item) => maxIso(acc, item.created_at), '');
        const oldestVersionAt = versions.reduce((acc, item) => minIso(acc, item.created_at), '');

        const projectCreatedAt = minIso(
            String(existingProject && existingProject.created_at ? existingProject.created_at : ''),
            oldestVersionAt
        );
        const projectUpdatedAt = maxIso(
            String(existingProject && existingProject.updated_at ? existingProject.updated_at : ''),
            newestVersionAt
        );

        projects.push({
            id: projectId,
            name: String(existingProject && existingProject.name ? existingProject.name : fallback.name),
            description: String(
                existingProject && existingProject.description
                    ? existingProject.description
                    : fallback.description
            ),
            icon: String(existingProject && existingProject.icon ? existingProject.icon : fallback.icon),
            created_at: projectCreatedAt || newestVersionAt,
            updated_at: projectUpdatedAt || newestVersionAt,
            versions: versions.map(({ _sourceFilePath, ...version }) => version)
        });
    }

    projects.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

    await fs.mkdir(rootDir, { recursive: true });
    const nextIndex = {
        version: 1,
        updated_at: new Date().toISOString(),
        projects
    };
    await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8');

    const versionCount = projects.reduce((sum, project) => sum + project.versions.length, 0);
    console.log(`Generated ${toPosixPath(path.relative(cwd, indexPath))}`);
    console.log(`Projects: ${projects.length}`);
    console.log(`Versions: ${versionCount}`);
}

main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
});
