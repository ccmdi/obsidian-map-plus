import { Plugin } from 'obsidian';
import { MapBasesView } from './views/map-bases-view';
import { MapTimelineBasesView } from './views/map-timeline-bases-view';
import { MapNetworkBasesView } from './views/map-network-bases-view';
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

        if (this.settings.enableTimelineView) {
			this.registerTimelineView();
		}

        if (this.settings.enableNetworkView) {
			this.registerNetworkView();
		}

        this.addSettingTab(new MapSettingTab(this.app, this));
    }

    async loadSettings() {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

    registerTimelineView() {
        this.registerBasesView('map-timeline', {
			name: 'Map timeline',
			icon: 'lucide-calendar',
			factory: (controller, containerEl) => new MapTimelineBasesView(controller, containerEl, this),
			options: () => MapTimelineBasesView.getViewOptions(),
		});
    }

    registerNetworkView() {
        this.registerBasesView('map-network', {
			name: 'Map network',
			icon: 'lucide-network',
			factory: (controller, containerEl) => new MapNetworkBasesView(controller, containerEl, this),
			options: () => MapNetworkBasesView.getViewOptions(),
		});
    }
}