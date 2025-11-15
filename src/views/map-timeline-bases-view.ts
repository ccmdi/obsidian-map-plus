import {
    BasesEntry,
    BasesPropertyId,
    QueryController,
    ViewOption,
} from 'obsidian';
import { Deck } from '@deck.gl/core';
import { MapView as MapViewType } from '@deck.gl/core';
import { MapPoint } from '../map-renderer';
import MapPlugin from '../main';
import { MapBasesView } from './map-bases-view';

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
    private dateDisplayEl: HTMLElement | null = null;

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
        this.createSlider();
    }

    onunload() {
        super.onunload();
        this.destroySlider();
    }

    private createSlider(): void {
        const sliderContainer = this.containerEl.createDiv({ cls: 'bases-timeline-slider' });

        this.dateDisplayEl = sliderContainer.createDiv({ cls: 'timeline-date-display' });
        this.dateDisplayEl.textContent = this.getDateText();

        this.sliderEl = sliderContainer.createEl('input', {
            type: 'range',
            cls: 'timeline-slider',
        });
        this.sliderEl.min = '0';
        this.sliderEl.max = '100';
        this.sliderEl.value = '100';

        this.sliderEl.addEventListener('input', () => {
            this.updateDateRange();
            this.updateDateDisplay();
            this.applyTimelineFilter();
        });
    }

    private getDateText(): string {
        const endDate = new Date(this.dateRangeEnd);
        return endDate.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }

    private updateDateDisplay(): void {
        if (this.dateDisplayEl) {
            this.dateDisplayEl.textContent = this.getDateText();
        }
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
            // Don't call super - we'll handle rendering ourselves
            if (this.deck) {
                this.applyTimelineFilter();
            } else {
                // First render - need to call parent's loadConfig and renderMap
                super['loadConfig']();
                super['renderMap']();
                this.applyTimelineFilter();
            }
        } else {
            // No date property set, just render normally
            super.onDataUpdated();
        }
    }

    private loadConfig(): void {
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

            const uniqueId = this.extractUniqueId(entry);

            const point: MapPoint = {
                lat: coordinates[0],
                lng: coordinates[1],
                title: entry.file.basename,
                file: entry.file,
            };

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
            const value = entry.getValue(this.dateProperty);
            if (!value) return null;

            const stringValue = value.toString();
            const date = new Date(stringValue);

            if (isNaN(date.getTime())) {
                // Try parsing as timestamp
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
            return;
        }

        // Filter by date range
        let filteredEntries = this.allTimelineEntries.filter(
            entry => entry.date >= this.dateRangeStart && entry.date <= this.dateRangeEnd
        );

        // Apply uniqueness constraint
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

                // Sort by date
                group.sort((a, b) => a.date - b.date);

                // Pick based on mode
                if (this.uniquenessMode === 'most-recent') {
                    filteredEntries.push(group[group.length - 1]);
                } else if (this.uniquenessMode === 'least-recent') {
                    filteredEntries.push(group[0]);
                }
            }
        }

        // Update the view with filtered points
        this.updateMapWithFilteredPoints(filteredEntries.map(e => e.point));
    }

    private updateMapWithFilteredPoints(points: MapPoint[]): void {
        if (!this.deck || !this.data) return;

        // Directly update using updateMapPoints
        const { updateMapPoints } = require('../map-renderer');

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
                        displayName: 'Uniqueness mode',
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
