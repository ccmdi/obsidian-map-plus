import {
    BasesEntry,
    BasesPropertyId,
    QueryController,
    ViewOption,
} from 'obsidian';
import { MapPoint } from '../map-renderer';
import MapPlugin from '../main';
import { MapBasesView } from './map-bases-view';
import { updateMapPoints } from '../map-renderer';

export const MapTimelineBasesViewType = 'map-timeline';

interface TimelineEntry {
    entry: BasesEntry;
    point: MapPoint;
    date: number;
    uniqueId: string;
}

type UniquenessMode = 'most-recent' | 'least-recent' | 'all';

export class MapTimelineBasesView extends MapBasesView {
    type = MapTimelineBasesViewType;

    private sliderEl: HTMLInputElement | null = null;

    private dateProperty: BasesPropertyId | null = null;
    private uniquenessProperty: BasesPropertyId | null = null;
    private uniquenessMode: UniquenessMode = 'all';
    private dateRangeStart: number = 0;
    private dateRangeEnd: number = Date.now();
    private allTimelineEntries: TimelineEntry[] = [];

    constructor(controller: QueryController, scrollEl: HTMLElement, plugin: MapPlugin) {
        super(controller, scrollEl, plugin);
    }

    onload(): void {
        super.onload();
    }

    onunload() {
        super.onunload();
        this.destroySlider();
    }

    private createSlider(): void {
        const sliderContainer = this.mapEl.createDiv({ cls: 'bases-timeline-slider' });

        const dateInputEl = sliderContainer.createEl('input', {
            type: 'date',
            cls: 'timeline-date-input',
        });

        dateInputEl.addEventListener('change', () => {
            if (!dateInputEl.value) return;

            const selectedDate = new Date(dateInputEl.value);
            if (!isNaN(selectedDate.getTime())) {
                this.dateRangeEnd = selectedDate.getTime();
                this.updateSliderFromDate();
                this.applyTimelineFilter();
            }
        });

        this.sliderEl = sliderContainer.createEl('input', {
            type: 'range',
            cls: 'timeline-slider',
        });
        this.sliderEl.min = '0';
        this.sliderEl.max = '100';
        this.sliderEl.value = '100';

        this.sliderEl.addEventListener('input', () => {
            this.updateDateRange();
            this.updateDateInput(dateInputEl);
            this.applyTimelineFilter();
        });

        this.updateDateInput(dateInputEl);
    }

    private updateSliderFromDate(): void {
        if (!this.sliderEl || this.allTimelineEntries.length === 0) return;

        const minDate = Math.min(...this.allTimelineEntries.map(e => e.date));
        const maxDate = Math.max(...this.allTimelineEntries.map(e => e.date));
        const range = maxDate - minDate;

        if (range === 0) {
            this.sliderEl.value = '100';
        } else {
            const percentage = ((this.dateRangeEnd - minDate) / range) * 100;
            this.sliderEl.value = Math.min(100, Math.max(0, percentage)).toString();
        }
    }

    private updateDateInput(dateInputEl: HTMLInputElement): void {
        const date = new Date(this.dateRangeEnd);

        if (isNaN(date.getTime())) return;

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        dateInputEl.value = `${year}-${month}-${day}`;
    }


    private destroySlider(): void {
        if (this.sliderEl) {
            this.sliderEl.closest('.bases-timeline-slider')?.remove();
            this.sliderEl = null;
        }
    }

    public onDataUpdated(): void {
        this.loadConfig();

        if (this.dateProperty) {
            this.updateTimelineData();

            if (this.deck) {
                this.applyTimelineFilter();
            } else {
                super.loadConfig();
                super.renderMap();

                this.createSlider();
                this.applyTimelineFilter();
            }
        } else {
            super.onDataUpdated();
        }
    }

    protected loadConfig(): void {
        super.loadConfig();

        this.dateProperty = this.config.getAsPropertyId('dateProperty');
        this.uniquenessProperty = this.config.getAsPropertyId('uniquenessProperty');

        const modeVal = this.config.get('uniquenessMode');
        if (modeVal === 'most-recent' || modeVal === 'least-recent' || modeVal === 'all') {
            this.uniquenessMode = modeVal;
        }
    }

    private updateTimelineData(): void {
        if (!this.data || !this.dateProperty) {
            this.allTimelineEntries = [];
            return;
        }

        const entries: TimelineEntry[] = [];
        let minDate = Infinity;
        let maxDate = -Infinity;

        for (const entry of this.data.data) {
            const coordinates = this.extractCoordinates(entry);
            if (!coordinates) continue;

            const dateValue = this.extractDateValue(entry);
            if (dateValue === null) continue;

            const point: MapPoint = {
                lat: coordinates[0],
                lng: coordinates[1],
                title: entry.file.basename,
                file: entry.file,
            };

            const fileCache = this.app.metadataCache.getFileCache(entry.file);
            if (fileCache?.frontmatter?.tags) {
                const tags = fileCache.frontmatter.tags;
                point.tags = Array.isArray(tags) ? tags : [tags];
            }

            const uniqueId = this.extractUniqueId(entry);

            entries.push({
                entry,
                point,
                date: dateValue,
                uniqueId,
            });

            minDate = Math.min(minDate, dateValue);
            maxDate = Math.max(maxDate, dateValue);
        }

        this.allTimelineEntries = entries;
        this.dateRangeStart = minDate === Infinity ? 0 : minDate;
        this.dateRangeEnd = maxDate === -Infinity ? Date.now() : maxDate;

        if (this.sliderEl) {
            this.sliderEl.value = '100';
        }
    }

    private extractDateValue(entry: BasesEntry): number | null {
        if (!this.dateProperty) return null;

        try {
            let value = entry.getValue(this.dateProperty);
            if (!value) return null;

            if (typeof value === 'object' && value !== null && 'date' in value) {
                value = value.date;
            }

            if (value instanceof Date) {
                return value.getTime();
            }

            if (typeof value === 'number') {
                return value;
            }

            const stringValue = value.toString();
            const date = new Date(stringValue);

            if (isNaN(date.getTime())) {
                const timestamp = parseInt(stringValue);
                if (!isNaN(timestamp)) {
                    return timestamp;
                }
                return null;
            }

            return date.getTime();
        } catch {
            return null;
        }
    }

    private extractUniqueId(entry: BasesEntry): string {
        if (!this.uniquenessProperty) {
            return entry.file.path;
        }

        try {
            const value = entry.getValue(this.uniquenessProperty);
            return value ? value.toString() : entry.file.path;
        } catch {
            return entry.file.path;
        }
    }

    private updateDateRange(): void {
        if (!this.sliderEl) return;

        const sliderValue = parseInt(this.sliderEl.value);
        const totalRange = this.allTimelineEntries.length > 0
            ? Math.max(...this.allTimelineEntries.map(e => e.date)) - Math.min(...this.allTimelineEntries.map(e => e.date))
            : Date.now();

        const minDate = this.allTimelineEntries.length > 0
            ? Math.min(...this.allTimelineEntries.map(e => e.date))
            : 0;

        this.dateRangeStart = minDate;
        this.dateRangeEnd = minDate + (totalRange * sliderValue / 100);
    }


    private applyTimelineFilter(): void {
        if (this.allTimelineEntries.length === 0) {
            // No entries at all, clear the map
            this.updateMapWithFilteredPoints([]);
            return;
        }

        let filteredEntries = this.allTimelineEntries.filter(
            entry => entry.date >= this.dateRangeStart && entry.date <= this.dateRangeEnd
        );

        if (this.uniquenessProperty && this.uniquenessMode !== 'all') {
            const grouped = new Map<string, TimelineEntry[]>();

            for (const entry of filteredEntries) {
                const id = entry.uniqueId;
                if (!grouped.has(id)) {
                    grouped.set(id, []);
                }
                grouped.get(id)!.push(entry);
            }

            filteredEntries = [];
            for (const group of grouped.values()) {
                if (group.length === 0) continue;

                group.sort((a, b) => a.date - b.date);

                if (this.uniquenessMode === 'most-recent') {
                    filteredEntries.push(group[group.length - 1]);
                } else if (this.uniquenessMode === 'least-recent') {
                    filteredEntries.push(group[0]);
                }
            }
        }

        // Always update, even if empty (to clear markers when no results)
        this.updateMapWithFilteredPoints(filteredEntries.map(e => e.point));
    }

    private updateMapWithFilteredPoints(points: MapPoint[]): void {
        if (!this.deck || !this.data) return;
        const hasConfiguredCenter = this.center[0] !== 0 || this.center[1] !== 0;

        updateMapPoints(this.deck, points, {
            containerEl: this.mapEl,
            app: this.app,
            settings: this.plugin.settings,
            tagSettings: this.plugin.tagSettings,
            options: {
                markerType: this.markerType,
                center: hasConfiguredCenter ? this.center : undefined,
                zoom: hasConfiguredCenter ? this.defaultZoom : undefined,
                autoCenter: false // Don't auto-center when filtering
            }
        });

        this.lastPoints = points;
    }

    static getViewOptions(): ViewOption[] {
        const baseOptions = MapBasesView.getViewOptions();

        const timelineOptions: ViewOption[] = [
            {
                displayName: 'Timeline',
                type: 'group',
                items: [
                    {
                        displayName: 'Date property',
                        type: 'property',
                        key: 'dateProperty',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'Property',
                    },
                    {
                        displayName: 'Group by property',
                        type: 'property',
                        key: 'uniquenessProperty',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'None',
                    },
                    {
                        displayName: 'Grouping uniqueness mode',
                        type: 'dropdown',
                        key: 'uniquenessMode',
                        options: {
                            "all": "All entries",
                            "most-recent": "Most recent",
                            "least-recent": "Least recent",
                        },
                        default: 'all',
                    },
                ],
            },
            ...baseOptions,
        ];

        return timelineOptions;
    }
}
