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
    tagSettings: MapTagSettings;
}

export const DEFAULT_SETTINGS: MapPluginSettings = {
    latKey: '',
    lngKey: '',
    strokeWidth: 2.5,
    iconFill: false,
    autoCenter: true,
    transitionDuration: 1000,
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

        renderTagCustomizations(containerEl, this.app, this.plugin);
    }
}