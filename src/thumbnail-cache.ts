import { App, TFile, normalizePath } from 'obsidian';
import type MapPlugin from './main';

export interface ThumbnailCacheEntry {
    dataUrl: string;
    sourceModified: number;
    size: number;
}

export interface ThumbnailCacheMetadata {
    entries: Record<string, ThumbnailCacheEntry>;
    pendingGeneration: string[];
}

const THUMBNAIL_MAX_SIZE = 25000; // 25kb target
const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 200;

export class ThumbnailCacheManager {
    private plugin: MapPlugin;
    private app: App;
    private cache: ThumbnailCacheMetadata;
    private cacheLoaded: boolean = false;
    private generationInProgress: boolean = false;

    constructor(plugin: MapPlugin, app: App) {
        this.plugin = plugin;
        this.app = app;
        this.cache = {
            entries: {},
            pendingGeneration: []
        };
    }

    async loadCache(): Promise<void> {
        if (this.cacheLoaded) return;

        try {
            const data = await this.plugin.loadData();
            if (data && data.thumbnailCache) {
                this.cache = data.thumbnailCache;
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
        const data = await this.plugin.loadData() || {};
        data.thumbnailCache = this.cache;
        await this.plugin.saveData(data);
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
                return cached.dataUrl;
            } else {
                delete this.cache.entries[cacheKey];
                await this.saveCache();
            }
        }

        return null;
    }

    async generateThumbnail(coverPath: string, sourceFile: TFile): Promise<string | null> {
        const coverFile = this.app.metadataCache.getFirstLinkpathDest(coverPath, sourceFile.path);
        if (!coverFile) return null;

        try {
            const arrayBuffer = await this.app.vault.readBinary(coverFile);
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

            while (dataUrl.length > THUMBNAIL_MAX_SIZE && quality > 0.1) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }

            const cacheKey = coverFile.path;
            this.cache.entries[cacheKey] = {
                dataUrl,
                sourceModified: coverFile.stat.mtime,
                size: dataUrl.length
            };

            await this.saveCache();
            return dataUrl;
        } catch (e) {
            console.error('Failed to generate thumbnail:', e);
            return null;
        }
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
                try {
                    const arrayBuffer = await this.app.vault.readBinary(file);
                    const blob = new Blob([arrayBuffer]);
                    const bitmap = await createImageBitmap(blob);

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) continue;

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

                    while (dataUrl.length > THUMBNAIL_MAX_SIZE && quality > 0.1) {
                        quality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }

                    this.cache.entries[imagePath] = {
                        dataUrl,
                        sourceModified: file.stat.mtime,
                        size: dataUrl.length
                    };
                } catch (e) {
                    console.error(`Failed to generate thumbnail for ${imagePath}:`, e);
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

    async clearCache(): Promise<void> {
        await this.loadCache();
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
