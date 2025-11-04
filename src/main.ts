import { Plugin } from 'obsidian';
import { MapBasesView } from './views/map-bases-view';
import { MapTagSettings } from './settings/map-tag-settings';
import { MapSettingTab, MapPluginSettings, DEFAULT_SETTINGS } from './settings/map-settings';
import { ThumbnailCacheManager } from './thumbnail-cache';

export default class MapPlugin extends Plugin {
    settings: MapPluginSettings;
    thumbnailCache: ThumbnailCacheManager;

    get tagSettings(): MapTagSettings {
        return this.settings.tagSettings;
    }

    async onload() {
        await this.loadSettings();

        this.thumbnailCache = new ThumbnailCacheManager(this, this.app);

        if (this.settings.enableThumbnailCache) {
            await this.thumbnailCache.loadCache();

            setTimeout(() => {
                void this.thumbnailCache.generatePendingThumbnails();
            }, 2000);
        }

        this.registerBasesView('map', {
			name: 'Map',
			icon: 'lucide-map',
			factory: (controller, containerEl) => new MapBasesView(controller, containerEl, this),
			options: () => MapBasesView.getViewOptions(),
		});

        this.addSettingTab(new MapSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async saveTagSettings() {
        await this.saveSettings();
        this.refreshAllMapViews();
    }

    refreshAllMapViews() {
        this.app.workspace.trigger('map:refresh-all-views');
    }
}