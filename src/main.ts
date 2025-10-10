import { Plugin } from 'obsidian';
import { MapBasesView } from './views/map-bases-view';
import { MapTagSettings, DEFAULT_MAP_TAG_SETTINGS } from './settings/map-tag-settings';
import { MapSettingTab } from './settings/map-settings';

interface MapPluginSettings {
    latKey: string;
    lngKey: string;
    strokeWidth: number;
    iconFill: boolean;
    autoCenter: boolean;
    tagSettings: MapTagSettings;
}

const DEFAULT_SETTINGS: MapPluginSettings = {
    latKey: '',
    lngKey: '',
    strokeWidth: 2.5,
    iconFill: false,
    autoCenter: true,
    tagSettings: DEFAULT_MAP_TAG_SETTINGS
};

export default class MapPlugin extends Plugin {
    settings: MapPluginSettings;

    get tagSettings(): MapTagSettings {
        return this.settings.tagSettings;
    }

    async onload() {
        await this.loadSettings();

        this.registerBasesView('map', {
			name: 'Map',
			icon: 'lucide-map',
			factory: (controller, containerEl) => new MapBasesView(controller, containerEl, this),
			options: MapBasesView.getViewOptions,
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

    onunload() {}
}