import { App, TFile, normalizePath } from 'obsidian';
import type MapPlugin from './main';

export interface ThumbnailCacheEntry {
    thumbnailPath: string;
    sourceModified: number;
    size: number;
}

export interface ThumbnailCacheMetadata {
    entries: Record<string, ThumbnailCacheEntry>;
    pendingGeneration: string[];
}

const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 200;
const CACHE_DIR = '.obsidian/plugins/mapplus/.cache';

export class ThumbnailCacheManager {
    private plugin: MapPlugin;
    private app: App;
    private cache: ThumbnailCacheMetadata;
    private cacheLoaded: boolean = false;
    private generationInProgress: boolean = false;
    private cacheDir: string;

    constructor(plugin: MapPlugin, app: App) {
        this.plugin = plugin;
        this.app = app;
        this.cache = {
            entries: {},
            pendingGeneration: []
        };
        this.cacheDir = normalizePath(CACHE_DIR);
    }

    async loadCache(): Promise<void> {
        if (this.cacheLoaded) return;

        try {
            await this.ensureCacheDir();

            const metadataPath = normalizePath(`${this.cacheDir}/metadata.json`);
            const exists = await this.app.vault.adapter.exists(metadataPath);

            if (exists) {
                const content = await this.app.vault.adapter.read(metadataPath);
                this.cache = JSON.parse(content);
            }

            this.cacheLoaded = true;
        } catch (e) {
            console.error('Failed to load thumbnail cache:', e);
            this.cache = {
                entries: {},
                pendingGeneration: []
            };
            this.cacheLoaded = true;
        }
    }

    async saveCache(): Promise<void> {
        try {
            await this.ensureCacheDir();

            const metadataPath = normalizePath(`${this.cacheDir}/metadata.json`);
            await this.app.vault.adapter.write(metadataPath, JSON.stringify(this.cache, null, 2));
        } catch (e) {
            console.error('Failed to save thumbnail cache:', e);
        }
    }

    private async ensureCacheDir(): Promise<void> {
        const exists = await this.app.vault.adapter.exists(this.cacheDir);
        if (!exists) {
            await this.app.vault.adapter.mkdir(this.cacheDir);
        }
    }

    private getThumbnailFilename(sourcePath: string): string {
        const hash = this.hashString(sourcePath);
        return `thumb_${hash}.jpg`;
    }

    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    async getThumbnail(coverPath: string, sourceFile: TFile): Promise<string | null> {
        if (!this.plugin.settings.enableThumbnailCache) {
            return null;
        }

        await this.loadCache();

        const coverFile = this.app.metadataCache.getFirstLinkpathDest(coverPath, sourceFile.path);
        if (!coverFile) return null;

        const cacheKey = coverFile.path;
        const cached = this.cache.entries[cacheKey];

        if (cached) {
            if (cached.sourceModified === coverFile.stat.mtime) {
                const thumbnailExists = await this.app.vault.adapter.exists(cached.thumbnailPath);
                if (thumbnailExists) {
                    const arrayBuffer = await this.app.vault.adapter.readBinary(cached.thumbnailPath);
                    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
                    return URL.createObjectURL(blob);
                }
            }

            delete this.cache.entries[cacheKey];
            await this.saveCache();
        }

        return null;
    }

    private async generateThumbnailFromFile(file: TFile): Promise<{ thumbnailPath: string; size: number } | null> {
        try {
            const targetSize = this.plugin.settings.thumbnailTargetSize * 1000;
            const arrayBuffer = await this.app.vault.readBinary(file);
            const blob = new Blob([arrayBuffer]);
            const bitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            const aspectRatio = bitmap.width / bitmap.height;
            let width = THUMBNAIL_WIDTH;
            let height = THUMBNAIL_HEIGHT;

            if (aspectRatio > width / height) {
                height = width / aspectRatio;
            } else {
                width = height * aspectRatio;
            }

            canvas.width = width;
            canvas.height = height;

            ctx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();

            let quality = 0.7;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);

            while (dataUrl.length > targetSize && quality > 0.1) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }

            const base64Data = dataUrl.split(',')[1];
            const binaryData = atob(base64Data);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                bytes[i] = binaryData.charCodeAt(i);
            }

            const thumbnailFilename = this.getThumbnailFilename(file.path);
            const thumbnailPath = normalizePath(`${this.cacheDir}/${thumbnailFilename}`);

            await this.ensureCacheDir();
            await this.app.vault.adapter.writeBinary(thumbnailPath, bytes.buffer);

            return {
                thumbnailPath,
                size: bytes.length
            };
        } catch (e) {
            console.error('Failed to generate thumbnail:', e);
            return null;
        }
    }

    async generateThumbnail(coverPath: string, sourceFile: TFile): Promise<string | null> {
        const coverFile = this.app.metadataCache.getFirstLinkpathDest(coverPath, sourceFile.path);
        if (!coverFile) return null;

        const result = await this.generateThumbnailFromFile(coverFile);
        if (!result) return null;

        const cacheKey = coverFile.path;
        this.cache.entries[cacheKey] = {
            thumbnailPath: result.thumbnailPath,
            sourceModified: coverFile.stat.mtime,
            size: result.size
        };

        await this.saveCache();

        const arrayBuffer = await this.app.vault.adapter.readBinary(result.thumbnailPath);
        const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
        return URL.createObjectURL(blob);
    }

    async markForGeneration(coverPath: string, sourceFile: TFile): Promise<void> {
        const coverFile = this.app.metadataCache.getFirstLinkpathDest(coverPath, sourceFile.path);
        if (!coverFile) return;

        await this.loadCache();

        const cacheKey = coverFile.path;
        if (!this.cache.pendingGeneration.includes(cacheKey) && !this.cache.entries[cacheKey]) {
            this.cache.pendingGeneration.push(cacheKey);
            await this.saveCache();
        }
    }

    async generatePendingThumbnails(onProgress?: (current: number, total: number) => void): Promise<void> {
        if (this.generationInProgress || !this.plugin.settings.enableThumbnailCache) {
            return;
        }

        await this.loadCache();

        if (this.cache.pendingGeneration.length === 0) {
            return;
        }

        this.generationInProgress = true;

        const pending = [...this.cache.pendingGeneration];
        const total = pending.length;

        for (let i = 0; i < pending.length; i++) {
            const imagePath = pending[i];

            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (file instanceof TFile) {
                const result = await this.generateThumbnailFromFile(file);
                if (result) {
                    this.cache.entries[imagePath] = {
                        thumbnailPath: result.thumbnailPath,
                        sourceModified: file.stat.mtime,
                        size: result.size
                    };
                }
            }

            const idx = this.cache.pendingGeneration.indexOf(imagePath);
            if (idx > -1) {
                this.cache.pendingGeneration.splice(idx, 1);
            }

            await this.saveCache();

            if (onProgress) {
                onProgress(i + 1, total);
            }
        }

        this.generationInProgress = false;
    }

    async rebuildCache(onProgress?: (current: number, total: number) => void): Promise<void> {
        if (this.generationInProgress || !this.plugin.settings.enableThumbnailCache) {
            return;
        }

        await this.loadCache();

        const allImagePaths = Object.keys(this.cache.entries);
        if (allImagePaths.length === 0) {
            return;
        }

        this.generationInProgress = true;

        const total = allImagePaths.length;

        for (let i = 0; i < allImagePaths.length; i++) {
            const imagePath = allImagePaths[i];

            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (file instanceof TFile) {
                const oldEntry = this.cache.entries[imagePath];
                if (oldEntry) {
                    try {
                        const exists = await this.app.vault.adapter.exists(oldEntry.thumbnailPath);
                        if (exists) {
                            await this.app.vault.adapter.remove(oldEntry.thumbnailPath);
                        }
                    } catch (e) {
                        console.error(`Failed to remove old thumbnail ${oldEntry.thumbnailPath}:`, e);
                    }
                }

                const result = await this.generateThumbnailFromFile(file);
                if (result) {
                    this.cache.entries[imagePath] = {
                        thumbnailPath: result.thumbnailPath,
                        sourceModified: file.stat.mtime,
                        size: result.size
                    };
                }
            }

            await this.saveCache();

            if (onProgress) {
                onProgress(i + 1, total);
            }
        }

        this.generationInProgress = false;
    }

    async clearCache(): Promise<void> {
        await this.loadCache();

        const thumbnailPaths = Object.values(this.cache.entries).map(entry => entry.thumbnailPath);
        for (const path of thumbnailPaths) {
            try {
                const exists = await this.app.vault.adapter.exists(path);
                if (exists) {
                    await this.app.vault.adapter.remove(path);
                }
            } catch (e) {
                console.error(`Failed to remove thumbnail ${path}:`, e);
            }
        }

        this.cache = {
            entries: {},
            pendingGeneration: []
        };
        await this.saveCache();
    }

    getCacheStats(): { count: number; totalSize: number; pending: number } {
        const entries = Object.values(this.cache.entries);
        return {
            count: entries.length,
            totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
            pending: this.cache.pendingGeneration.length
        };
    }

    isGenerating(): boolean {
        return this.generationInProgress;
    }
}
