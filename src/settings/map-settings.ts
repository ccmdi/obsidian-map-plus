import { PluginSettingTab, App, Setting } from "obsidian";
import MapPlugin from "../main";
import { renderTagCustomizations } from "./map-tag-settings";

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
            .setName('Stroke width')
            .setDesc('Stroke width for icons')
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

        renderTagCustomizations(containerEl, this.app, this.plugin);
    }
}