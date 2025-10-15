import { PluginSettingTab, App, Setting } from "obsidian";
import MapPlugin from "../main";
import { DEFAULT_MAP_TAG_SETTINGS, MapTagSettings, renderTagCustomizations } from "./map-tag-settings";

export interface MapPluginSettings {
    latKey: string;
    lngKey: string;
    strokeWidth: number;
    iconFill: boolean;
    autoCenter: boolean;
    transitionDuration: number;
    enableThumbnailCache: boolean;
    thumbnailTargetSize: number;
    tagSettings: MapTagSettings;
}

export const DEFAULT_SETTINGS: MapPluginSettings = {
    latKey: '',
    lngKey: '',
    strokeWidth: 2.5,
    iconFill: false,
    autoCenter: true,
    transitionDuration: 1000,
    enableThumbnailCache: false,
    thumbnailTargetSize: 25,
    tagSettings: DEFAULT_MAP_TAG_SETTINGS
};

export class MapSettingTab extends PluginSettingTab {
    plugin: MapPlugin;

    constructor(app: App, plugin: MapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('map-settings-container');

        containerEl.createEl('h2', { text: 'Map' });

        new Setting(containerEl)
            .setName('Latitude key')
            .setDesc('Frontmatter key for latitude (default for all bases)')
            .addText(text => text
                .setPlaceholder('lat')
                .setValue(this.plugin.settings.latKey)
                .onChange(async (value) => {
                    this.plugin.settings.latKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Longitude key')
            .setDesc('Frontmatter key for longitude (default for all bases)')
            .addText(text => text
                .setPlaceholder('lng')
                .setValue(this.plugin.settings.lngKey)
                .onChange(async (value) => {
                    this.plugin.settings.lngKey = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Stroke width for icons')
            .addSlider(slider => slider
                .setLimits(0.5, 5, 0.1)
                .setValue(this.plugin.settings.strokeWidth)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.strokeWidth = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllMapViews();
                }));

        new Setting(containerEl)
            .setName('Fill icons')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.iconFill)
                .onChange(async (value) => {
                    this.plugin.settings.iconFill = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllMapViews();
                }));

        new Setting(containerEl)
            .setName('Auto-center on update')
            .setDesc('Automatically zoom and center map when data changes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCenter)
                .onChange(async (value) => {
                    this.plugin.settings.autoCenter = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Transition duration')
            .setDesc('Duration of the transition when changing view state')
            .addSlider(slider => slider
                .setLimits(0, 2000, 100)
                .setValue(this.plugin.settings.transitionDuration)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.transitionDuration = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Performance' });

        const thumbnailToggle = new Setting(containerEl)
            .setName('Enable thumbnail cache')
            .setDesc('Cache small thumbnails of location cover images for faster hover performance')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableThumbnailCache)
                .onChange(async (value) => {
                    this.plugin.settings.enableThumbnailCache = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        await this.plugin.thumbnailCache.loadCache();
                        setTimeout(() => {
                            this.plugin.thumbnailCache.generatePendingThumbnails();
                        }, 500);
                    }

                    this.display();
                }));

        if (this.plugin.settings.enableThumbnailCache) {
            new Setting(containerEl)
                .setName('Thumbnail target size')
                .setDesc('Target file size for cached thumbnails (in KB)')
                .addSlider(slider => slider
                    .setLimits(10, 50, 5)
                    .setValue(this.plugin.settings.thumbnailTargetSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.thumbnailTargetSize = value;
                        await this.plugin.saveSettings();
                    }));

            const stats = this.plugin.thumbnailCache.getCacheStats();
            const sizeKB = (stats.totalSize / 1024).toFixed(1);
            const isGenerating = this.plugin.thumbnailCache.isGenerating();

            const cacheInfo = new Setting(containerEl)
                .setName('Thumbnail cache status')
                .setDesc(`${stats.count} thumbnails cached (${sizeKB} KB)`);

            if (stats.pending > 0 || isGenerating) {
                cacheInfo.setDesc(`${stats.count} thumbnails cached (${sizeKB} KB), ${stats.pending} pending`);
            }

            if (stats.count > 0 || stats.pending > 0) {
                cacheInfo.addButton(button => button
                    .setButtonText('Rebuild cache')
                    .onClick(async () => {
                        button.setDisabled(true);
                        button.setButtonText('Rebuilding...');

                        await this.plugin.thumbnailCache.rebuildCache((current, total) => {
                            button.setButtonText(`Rebuilding ${current}/${total}...`);
                        });

                        button.setButtonText('Rebuild cache');
                        button.setDisabled(false);
                        this.display();
                    }));
            }

            new Setting(containerEl)
                .setName('Clear thumbnail cache')
                .setDesc('Delete all cached thumbnails to free up space')
                .addButton(button => button
                    .setButtonText('Clear cache')
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.thumbnailCache.clearCache();
                        this.display();
                    }));
        }

        renderTagCustomizations(containerEl, this.app, this.plugin);
    }
}