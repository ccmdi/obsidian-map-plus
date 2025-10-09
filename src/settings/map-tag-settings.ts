import { App, PluginSettingTab, Setting, Modal, TextComponent, setIcon, getIconIds, SuggestModal } from 'obsidian';
import type MapPlugin from '../main';

export interface TagCustomization {
    color: string;
    icon?: string;
}

export interface MapTagSettings {
    tagCustomizations: Record<string, TagCustomization>;
    tagPriority: string[];
}

export const DEFAULT_MAP_TAG_SETTINGS: MapTagSettings = {
    tagCustomizations: {},
    tagPriority: []
};

export class MapTagSettingTab extends PluginSettingTab {
    plugin: MapPlugin;

    constructor(app: App, plugin: MapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        renderTagCustomizations(containerEl, this.app, this.plugin);
    }
}

export function renderTagCustomizations(containerEl: HTMLElement, app: App, plugin: MapPlugin) {
    containerEl.createEl('h3', { text: 'Tags' });
    containerEl.createEl('p', {
        text: 'Drag to reorder priority. Higher tags take precedence.',
        cls: 'setting-item-description'
    });

    const customizationsContainer = containerEl.createDiv('tag-customizations-container');
    displayTagCustomizations(customizationsContainer, app, plugin);

    new Setting(containerEl)
        .setName('Tag customization')
        .addButton(button => button
            .setButtonText('Add')
            .setCta()
            .onClick(() => {
                addNewTagCustomization(customizationsContainer, app, plugin);
            }));
}

function displayTagCustomizations(container: HTMLElement, app: App, plugin: MapPlugin) {
    container.empty();

    const tagSettings = plugin.tagSettings;

    tagSettings.tagPriority.forEach((tag, index) => {
        const customization = tagSettings.tagCustomizations[tag];
        if (customization) {
            createTagCustomizationSetting(container, tag, customization, index, app, plugin);
        }
    });

    if (tagSettings.tagPriority.length === 0) {
        const emptyMessage = container.createDiv();
        emptyMessage.textContent = 'No tags configured yet. Add a tag customization below.';
        emptyMessage.classList.add('map-empty-state');
    }
}

function createTagCustomizationSetting(container: HTMLElement, tag: string, customization: TagCustomization, index: number, app: App, plugin: MapPlugin) {
    const settingEl = container.createDiv('draggable-setting');
    settingEl.draggable = true;

    const handle = settingEl.createSpan('drag-handle');
    handle.textContent = '⋮⋮';

    const tagLabel = settingEl.createDiv('tag-label');
    tagLabel.createSpan().textContent = `#${tag}`;

    const colorInput = settingEl.createEl('input', { type: 'color', cls: 'color-input' });
    colorInput.value = customization.color;

    colorInput.onchange = async () => {
        plugin.tagSettings.tagCustomizations[tag].color = colorInput.value;
        await plugin.saveTagSettings();
    };

    const iconBtn = settingEl.createEl('button', { cls: 'icon-btn' });
    if (customization.icon) {
        setIcon(iconBtn, customization.icon);
    } else {
        iconBtn.textContent = '';
    }
    iconBtn.onclick = () => {
        new IconPickerModal(app, customization.icon || '', (icon) => {
            plugin.tagSettings.tagCustomizations[tag].icon = icon;
            plugin.saveTagSettings();
            displayTagCustomizations(container, app, plugin);
        }).open();
    };

    settingEl.createDiv({cls: 'spacer'});
    const deleteBtn = settingEl.createEl('button', { text: '×', cls: 'delete-btn' });

    deleteBtn.onclick = async () => {
        delete plugin.tagSettings.tagCustomizations[tag];
        const priorityIndex = plugin.tagSettings.tagPriority.indexOf(tag);
        if (priorityIndex > -1) {
            plugin.tagSettings.tagPriority.splice(priorityIndex, 1);
        }
        await plugin.saveTagSettings();
        displayTagCustomizations(container, app, plugin);
    };

    settingEl.addEventListener('dragstart', (e) => {
        settingEl.addClass('dragging');
        e.dataTransfer?.setData('text/plain', index.toString());
    });

    settingEl.addEventListener('dragend', () => {
        settingEl.removeClass('dragging');
    });

    settingEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        settingEl.addClass('drag-over');
    });

    settingEl.addEventListener('dragleave', () => {
        settingEl.removeClass('drag-over');
    });

    settingEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        settingEl.removeClass('drag-over');

        const draggedIndex = parseInt(e.dataTransfer?.getData('text/plain') || '0');
        const targetIndex = index;

        if (draggedIndex !== targetIndex) {
            const draggedItem = plugin.tagSettings.tagPriority.splice(draggedIndex, 1)[0];
            plugin.tagSettings.tagPriority.splice(targetIndex, 0, draggedItem);

            await plugin.saveTagSettings();
            displayTagCustomizations(container, app, plugin);
        }
    });
}

function addNewTagCustomization(container: HTMLElement, app: App, plugin: MapPlugin) {
    new TagSuggestModal(app, (tagName: string) => {
        new AddTagModal(app, tagName, (color: string, icon?: string) => {
            plugin.tagSettings.tagCustomizations[tagName] = { color, icon };
            if (!plugin.tagSettings.tagPriority.includes(tagName)) {
                plugin.tagSettings.tagPriority.push(tagName);
            }
            plugin.saveTagSettings();
            displayTagCustomizations(container, app, plugin);
        }).open();
    }).open();
}

class TagSuggestModal extends SuggestModal<string> {
    private onSelect: (tag: string) => void;

    constructor(app: App, onSelect: (tag: string) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder('Type tag name...');
    }

    getSuggestions(query: string): string[] {
        const tags = new Set<string>();
        const allTags = this.app.metadataCache.getTags();
        console.log(allTags);
        Object.keys(allTags).forEach(tag => {
            const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
            tags.add(cleanTag);
        });

        const allTagsList = Array.from(tags);
        const lowerQuery = query.toLowerCase().replace('#', '');

        if (!lowerQuery) return allTagsList.slice(0, 10);

        return allTagsList
            .filter(tag => tag.toLowerCase().includes(lowerQuery))
            .slice(0, 10);
    }

    renderSuggestion(tag: string, el: HTMLElement): void {
        el.createEl('div', { text: `#${tag}` });
    }

    onChooseSuggestion(tag: string): void {
        this.onSelect(tag);
    }
}

export class AddTagModal extends Modal {
    private onSubmit: (color: string, icon?: string) => void;
    private tagName: string;
    private selectedIcon: string = '';

    constructor(app: App, tagName: string, onSubmit: (color: string, icon?: string) => void) {
        super(app);
        this.tagName = tagName;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('add-tag-modal');
        contentEl.createEl('h2', { text: `Customize #${this.tagName}` });

        const form = contentEl.createDiv();

        const colorIconContainer = form.createDiv({ cls: 'color-icon-container' });

        const colorInput = colorIconContainer.createEl('input', { type: 'color', cls: 'color-input' });
        colorInput.value = 'var(--color-accent)';

        const iconContainer = colorIconContainer.createDiv({ cls: 'icon-container' });

        const iconPreview = iconContainer.createEl('div', { cls: 'icon-preview' });

        const iconBtn = iconContainer.createEl('button', { text: 'Choose Icon', cls: 'icon-btn' });

        iconBtn.onclick = () => {
            new IconPickerModal(this.app, this.selectedIcon, (icon) => {
                this.selectedIcon = icon;
                iconPreview.empty();
                if (icon) {
                    setIcon(iconPreview, icon);
                }
            }).open();
        };

        const buttonContainer = form.createDiv({ cls: 'button-container' });

        const addButton = buttonContainer.createEl('button', { text: 'Add' });
        addButton.classList.add('mod-cta');
        addButton.onclick = () => {
            this.onSubmit(colorInput.value, this.selectedIcon);
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class IconPickerModal extends Modal {
    private onSubmit: (icon: string) => void;
    private currentIcon: string;
    private searchInput: TextComponent;

    constructor(app: App, currentIcon: string, onSubmit: (icon: string) => void) {
        super(app);
        this.currentIcon = currentIcon;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('icon-picker-modal');
        contentEl.createEl('h2', { text: 'Choose Icon' });

        const searchContainer = contentEl.createDiv({ cls: 'search-container' });
        
        this.searchInput = new TextComponent(searchContainer);
        this.searchInput.setPlaceholder('Search icons...');

        const iconsContainer = contentEl.createDiv({ cls: 'icons-grid' });

        const allIcons = getIconIds();
        const renderIcons = (filter: string = '') => {
            iconsContainer.empty();

            let filtered: string[];
            if (filter) {
                const lowerFilter = filter.toLowerCase();
                filtered = [];
                for (let i = 0; i < allIcons.length && filtered.length < 100; i++) {
                    if (allIcons[i].toLowerCase().includes(lowerFilter)) {
                        filtered.push(allIcons[i]);
                    }
                }
            } else {
                filtered = allIcons.slice(0, 100);
            }

            filtered.forEach(iconName => {
                const iconBtn = iconsContainer.createEl('button', { cls: 'icon-picker-item' });
                if (this.currentIcon === iconName) {
                    iconBtn.classList.add('selected');
                }

                try {
                    setIcon(iconBtn, iconName);
                } catch (e) {
                    return;
                }

                iconBtn.onclick = () => {
                    this.onSubmit(iconName);
                    this.close();
                };

                iconBtn.setAttribute('aria-label', iconName);
            });
        };

        renderIcons();

        this.searchInput.onChange((value) => {
            renderIcons(value);
        });

        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });

        const clearButton = buttonContainer.createEl('button', { text: 'Clear Icon' });
        clearButton.onclick = () => {
            this.onSubmit('');
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
