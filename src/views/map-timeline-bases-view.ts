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

interface TimelineMapPoint extends MapPoint {
    date: number;
    uniqueId: string;
}

type UniquenessMode = 'most-recent' | 'least-recent' | 'all';
type TimelineGranularity = 'daily' | 'monthly' | 'yearly';

export class MapTimelineBasesView extends MapBasesView {
    type = MapTimelineBasesViewType;

    private sliderEl: HTMLInputElement | null = null;

    private dateProperty: BasesPropertyId | null = null;
    private uniquenessProperty: BasesPropertyId | null = null;
    private uniquenessMode: UniquenessMode = 'all';
    private granularity: TimelineGranularity = 'daily';
    private dateRangeStart: number = 0;
    private dateRangeEnd: number = Date.now();
    private allTimelineEntries: TimelineMapPoint[] = [];

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

        const inputContainer = sliderContainer.createDiv({ cls: 'timeline-input-container' });

        const dateInputEl = inputContainer.createEl('input', {
            type: 'text',
            cls: 'timeline-date-input',
        });

        const granularitySelect = inputContainer.createEl('select', {
            cls: 'timeline-granularity-select',
        });

        granularitySelect.createEl('option', { value: 'daily', text: 'Daily' });
        granularitySelect.createEl('option', { value: 'monthly', text: 'Monthly' });
        granularitySelect.createEl('option', { value: 'yearly', text: 'Yearly' });

        granularitySelect.value = this.granularity;

        granularitySelect.addEventListener('change', () => {
            this.granularity = granularitySelect.value as TimelineGranularity;
            this.config.set('_granularity', this.granularity);
            this.updateDateInput(dateInputEl);
        });

        dateInputEl.addEventListener('change', () => {
            if (!dateInputEl.value) return;

            const timestamp = this.parseDateInput(dateInputEl.value);
            if (timestamp !== null) {
                this.dateRangeEnd = timestamp;
                this.config.set('_dateRangeEnd', timestamp);
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
            this.config.set('_dateRangeEnd', this.dateRangeEnd);
            this.updateDateInput(dateInputEl);
            this.applyTimelineFilter();
        });

        this.updateDateInput(dateInputEl);
        this.updateSliderFromDate();
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

    private parseDateInput(dateString: string): number | null {
        // Try full date format (YYYY-MM-DD)
        let match = dateString.match(/^(-?\d+)-(\d{1,2})-(\d{1,2})$/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);
            const day = parseInt(match[3]);

            if (month < 1 || month > 12 || day < 1 || day > 31) return null;

            const date = new Date(0);
            date.setFullYear(year);
            date.setMonth(month - 1);
            date.setDate(day);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        }

        // Try year-month format (YYYY-MM)
        match = dateString.match(/^(-?\d+)-(\d{1,2})$/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);

            if (month < 1 || month > 12) return null;

            const date = new Date(0);
            date.setFullYear(year);
            date.setMonth(month - 1);
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        }

        // Try year only format (YYYY)
        match = dateString.match(/^(-?\d+)$/);
        if (match) {
            const year = parseInt(match[1]);
            const date = new Date(0);
            date.setFullYear(year);
            date.setMonth(0);
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        }

        return null;
    }

    private padNumber(num: number, length: number): string {
        const str = String(num);
        return str.length >= length ? str : '0'.repeat(length - str.length) + str;
    }

    private updateDateInput(dateInputEl: HTMLInputElement): void {
        const date = new Date(this.dateRangeEnd);

        if (isNaN(date.getTime())) return;

        const year = date.getFullYear();
        const month = this.padNumber(date.getMonth() + 1, 2);
        const day = this.padNumber(date.getDate(), 2);

        if (this.granularity === 'yearly') {
            dateInputEl.value = `${year}`;
            dateInputEl.placeholder = 'YYYY';
        } else if (this.granularity === 'monthly') {
            dateInputEl.value = `${year}-${month}`;
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            dateInputEl.placeholder = 'YYYY-MM';
        } else {
            dateInputEl.value = `${year}-${month}-${day}`;
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            dateInputEl.placeholder = 'YYYY-MM-DD';
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

        const savedGranularity = this.config.get('_granularity');
        if (savedGranularity === 'daily' || savedGranularity === 'monthly' || savedGranularity === 'yearly') {
            this.granularity = savedGranularity;
        }

        const savedDateRangeEnd = this.config.get('_dateRangeEnd');
        if (savedDateRangeEnd && typeof savedDateRangeEnd === 'number') {
            this.dateRangeEnd = savedDateRangeEnd;
        }
    }

    private updateTimelineData(): void {
        if (!this.data || !this.dateProperty) {
            this.allTimelineEntries = [];
            return;
        }

        let minDate = Infinity;
        let maxDate = -Infinity;

        const points = this.extractPointsFromData((entry): Partial<TimelineMapPoint> => {
            const dateValue = this.extractDateValue(entry);
            if (dateValue === null) return {};

            const uniqueId = this.extractUniqueId(entry);

            minDate = Math.min(minDate, dateValue);
            maxDate = Math.max(maxDate, dateValue);

            return { date: dateValue, uniqueId };
        }) as TimelineMapPoint[];

        this.allTimelineEntries = points.filter(p => p.date !== undefined);

        this.dateRangeStart = minDate === Infinity ? 0 : minDate;

        const savedDateRangeEnd = this.config.get('_dateRangeEnd');
        if (!savedDateRangeEnd || typeof savedDateRangeEnd !== 'number') {
            this.dateRangeEnd = maxDate === -Infinity ? Date.now() : maxDate;
        }

        if (this.sliderEl) {
            this.updateSliderFromDate();
        }
    }

    private extractDateValue(entry: BasesEntry): number | null {
        if (!this.dateProperty) return null;

        try {
            let value: unknown = entry.getValue(this.dateProperty);
            if (!value) return null;
            
            // date property
            if (typeof value === 'object' && value !== null && 'date' in value) {
                value = (value as { date?: unknown }).date;
                if (!value) return null;
            }

            // date obj
            if (value instanceof Date) {
                return value.getTime();
            }
            
            // timestamps
            if (typeof value === 'number') {
                return value;
            }

            const stringValue = String(value).trim();

            if (/^-?\d+$/.test(stringValue)) {
                const timestamp = parseInt(stringValue);
                if (!isNaN(timestamp)) {
                    return timestamp;
                }
            }

            // custom date format
            const parsed = this.parseDateInput(stringValue);
            if (parsed !== null) {
                return parsed;
            }

            const date = new Date(stringValue);
            return isNaN(date.getTime()) ? null : date.getTime();
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

        let filteredPoints = this.allTimelineEntries.filter(
            point => point.date >= this.dateRangeStart && point.date <= this.dateRangeEnd
        );

        if (this.uniquenessProperty && this.uniquenessMode !== 'all') {
            const grouped = new Map<string, TimelineMapPoint[]>();

            for (const point of filteredPoints) {
                const id = point.uniqueId;
                if (!grouped.has(id)) {
                    grouped.set(id, []);
                }
                grouped.get(id)!.push(point);
            }

            filteredPoints = [];
            for (const group of grouped.values()) {
                if (group.length === 0) continue;

                group.sort((a, b) => a.date - b.date);

                if (this.uniquenessMode === 'most-recent') {
                    filteredPoints.push(group[group.length - 1]);
                } else if (this.uniquenessMode === 'least-recent') {
                    filteredPoints.push(group[0]);
                }
            }
        }

        // Always update, even if empty (to clear markers when no results)
        this.updateMapWithFilteredPoints(filteredPoints);
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
