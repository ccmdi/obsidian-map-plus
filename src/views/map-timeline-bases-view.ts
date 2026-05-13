import {
    BasesEntry,
    BasesPropertyId,
    QueryController,
    ViewOption,
    setIcon,
} from 'obsidian';
import { MapPoint } from '../types/MapPoint';
import MapPlugin from '../main';
import { MapBasesView } from './map-bases-view';

export const MapTimelineBasesViewType = 'map-timeline';
const MAP_SLIDER_UPDATE_DEBOUNCE_TIME = 10;
const MAP_UPDATE_DEBOUNCE_TIME = 50;
const DATE_FORMAT_DAILY = 'YYYY-MM-DD';
const DATE_FORMAT_MONTHLY = 'YYYY-MM';

interface TimelineMapPoint extends MapPoint {
    date: number;
    endDate: number | null;
    uniqueId: string;
}

type UniquenessMode = 'most-recent' | 'least-recent' | 'all';
type TimelineGranularity = 'daily' | 'monthly' | 'yearly';

export class MapTimelineBasesView extends MapBasesView {
    type = MapTimelineBasesViewType;

    private sliderEl: HTMLInputElement | null = null;
    private playButton: HTMLButtonElement | null = null;
    // private liveUpdateTimeout?: number;
    private allTimelineEntries: TimelineMapPoint[] = [];
    private dataUpdateTimeout?: number;

    private isPlaying: boolean = false;
    private playbackInterval: number | null = null;
    private playbackSpeed: number = 1;
    private controlsExpanded: boolean = false;
    private programmaticSliderUpdate: boolean = false;

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

    refresh(): void {
        this.destroySlider();
        super.refresh();
    }

    private getDateProperty(): BasesPropertyId | null {
        return this.config.getAsPropertyId('dateProperty');
    }

    private getEndDateProperty(): BasesPropertyId | null {
        return this.config.getAsPropertyId('endDateProperty');
    }

    private getUniquenessProperty(): BasesPropertyId | null {
        return this.config.getAsPropertyId('uniquenessProperty');
    }

    private getUniquenessMode(): UniquenessMode {
        const modeVal = this.config.get('uniquenessMode');
        if (modeVal === 'most-recent' || modeVal === 'least-recent' || modeVal === 'all') {
            return modeVal;
        }
        return 'all';
    }

    private getGranularity(): TimelineGranularity {
        const saved = this.config.get('_granularity');
        if (saved === 'daily' || saved === 'monthly' || saved === 'yearly') {
            return saved;
        }
        return 'daily';
    }

    private getDateRangeEnd(): number {
        const saved = this.config.get('_dateRangeEnd');
        if (saved && typeof saved === 'number') {
            return saved;
        }
        return Date.now();
    }

    private setDateRangeEnd(value: number): void {
        this.config.set('_dateRangeEnd', value);
    }

    private getDateRangeStart(): number {
        if (this.allTimelineEntries.length === 0) return 0;
        return Math.min(...this.allTimelineEntries.map(e => e.date));
    }

    private createSlider(): void {
        const sliderContainer = this.mapEl.createDiv({ cls: 'bases-timeline-slider' });

        this.makeDraggable(sliderContainer);

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

        granularitySelect.value = this.getGranularity();

        granularitySelect.addEventListener('change', () => {
            this.config.set('_granularity', granularitySelect.value);
            this.updateDateInput(dateInputEl);
        });

        dateInputEl.addEventListener('change', () => {
            if (!dateInputEl.value) return;

            const timestamp = this.parseDateInput(dateInputEl.value);
            if (timestamp !== null) {
                this.setDateRangeEnd(timestamp);
                this.updateSliderFromDate();
                this.updateRenderedPoints(this.applyTimelineFilter(), false);
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
            if (this.isPlaying) {
                this.stopPlayback();
            }
            this.programmaticSliderUpdate = true;
            this.updateDateRange();
            this.updateDateInput(dateInputEl);
        });

        this.sliderEl.addEventListener('change', () => {
            const filteredPoints = this.applyTimelineFilter();

            if (this.mapUpdateTimeout) {
                window.clearTimeout(this.mapUpdateTimeout);
            }
            this.mapUpdateTimeout = window.setTimeout(() => {
                this.updateRenderedPoints(filteredPoints, true);
            }, MAP_UPDATE_DEBOUNCE_TIME);
        });

        // Expand/collapse toggle
        const toggleContainer = sliderContainer.createDiv({ cls: 'timeline-controls-toggle' });
        const toggleButton = toggleContainer.createEl('button', { cls: 'timeline-toggle-button' });
        setIcon(toggleButton, 'chevron-down');
        toggleButton.addEventListener('click', () => {
            this.controlsExpanded = !this.controlsExpanded;
            const playbackContainer = sliderContainer.querySelector('.timeline-playback-controls') as HTMLElement;
            if (this.controlsExpanded) {
                playbackContainer.addClass('expanded');
                toggleButton.addClass('expanded');
                sliderContainer.addClass('has-expanded-controls');
            } else {
                playbackContainer.removeClass('expanded');
                toggleButton.removeClass('expanded');
                sliderContainer.removeClass('has-expanded-controls');
            }
        });

        // Playback controls
        const playbackContainer = sliderContainer.createDiv({ cls: 'timeline-playback-controls' });

        this.playButton = playbackContainer.createEl('button', {
            cls: 'timeline-play-button',
        });
        setIcon(this.playButton, 'play');
        this.playButton.addEventListener('click', () => {
            this.togglePlayback();
        });

        const speedSelect = playbackContainer.createEl('select', {
            cls: 'timeline-speed-select',
        });
        speedSelect.createEl('option', { value: '0.1', text: '0.1x' });
        speedSelect.createEl('option', { value: '0.5', text: '0.5x' });
        speedSelect.createEl('option', { value: '1', text: '1x' });
        speedSelect.createEl('option', { value: '2', text: '2x' });
        speedSelect.createEl('option', { value: '5', text: '5x' });
        speedSelect.value = '1';

        speedSelect.addEventListener('change', () => {
            this.playbackSpeed = parseFloat(speedSelect.value);
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
            const percentage = ((this.getDateRangeEnd() - minDate) / range) * 100;
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
        const date = new Date(this.getDateRangeEnd());
        if (isNaN(date.getTime())) return;

        const year = date.getFullYear();
        const month = this.padNumber(date.getMonth() + 1, 2);
        const day = this.padNumber(date.getDate(), 2);

        const granularity = this.getGranularity();

        if (granularity === 'yearly') {
            dateInputEl.value = `${year}`;
            dateInputEl.placeholder = 'YYYY';
        } else if (granularity === 'monthly') {
            dateInputEl.value = `${year}-${month}`;
            dateInputEl.placeholder = DATE_FORMAT_MONTHLY;
        } else {
            dateInputEl.value = `${year}-${month}-${day}`;
            dateInputEl.placeholder = DATE_FORMAT_DAILY;
        }
    }


    private destroySlider(): void {
        if (this.isPlaying) {
            this.stopPlayback();
        }
        if (this.sliderEl) {
            this.sliderEl.closest('.bases-timeline-slider')?.remove();
            this.sliderEl = null;
            this.playButton = null;
        }
    }

    private togglePlayback(): void {
        if (this.isPlaying) {
            this.stopPlayback();
        } else {
            this.startPlayback();
        }
    }

    private startPlayback(): void {
        if (this.isPlaying || !this.sliderEl || this.allTimelineEntries.length === 0) return;

        const minDate = Math.min(...this.allTimelineEntries.map(e => e.date));
        const maxDate = Math.max(...this.allTimelineEntries.map(e => e.date));
        const totalRange = maxDate - minDate;

        let currentDateRangeEnd = this.getDateRangeEnd();

        // If at end, restart from beginning
        if (currentDateRangeEnd >= maxDate) {
            currentDateRangeEnd = minDate;
            this.setDateRangeEnd(currentDateRangeEnd);
            this.updateSliderFromDate();
            this.updateRenderedPoints(this.applyTimelineFilter(), false);
        }

        this.isPlaying = true;
        if (this.playButton) {
            setIcon(this.playButton, 'pause');
        }

        // Advance date directly based on time intervals
        const tickInterval = 100; // 100ms base tick
        this.playbackInterval = window.setInterval(() => {
            if (!this.sliderEl || this.allTimelineEntries.length === 0) {
                this.stopPlayback();
                return;
            }

            // Calculate date increment based on speed
            // At 1x speed, complete timeline in ~100 seconds
            const dateIncrement = (totalRange / 100000) * tickInterval * this.playbackSpeed;

            currentDateRangeEnd = Math.min(maxDate, currentDateRangeEnd + dateIncrement);
            this.setDateRangeEnd(currentDateRangeEnd);
            this.updateSliderFromDate();

            const dateInputEl = this.sliderEl.parentElement?.querySelector('.timeline-date-input') as HTMLInputElement;
            if (dateInputEl) {
                this.updateDateInput(dateInputEl);
            }

            this.updateRenderedPoints(this.applyTimelineFilter(), false);

            // Stop at end
            if (currentDateRangeEnd >= maxDate) {
                this.stopPlayback();
            }
        }, tickInterval);
    }

    private stopPlayback(): void {
        this.isPlaying = false;
        if (this.playButton) {
            setIcon(this.playButton, 'play');
        }
        if (this.playbackInterval !== null) {
            window.clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
    }

    public onDataUpdated(): void {
        if (this.getDateProperty()) {
            super.beforeOnDataUpdated();
            this.updateTimelineData();

            if (!this.deck) {
                super.renderMap();
            }

            if (!this.sliderEl) {
                this.createSlider();
            }

            if (this.dataUpdateTimeout) {
                window.clearTimeout(this.dataUpdateTimeout);
            }

            const shouldAutofit = !this.programmaticSliderUpdate;
            this.programmaticSliderUpdate = false;

            this.dataUpdateTimeout = window.setTimeout(() => {
                const autofit = shouldAutofit ? undefined : false;
                this.updateRenderedPoints(this.applyTimelineFilter(), autofit);
            }, MAP_SLIDER_UPDATE_DEBOUNCE_TIME);
        } else {
            this.destroySlider();
            super.onDataUpdated();
        }
    }

    private updateTimelineData(): void {
        const dateProperty = this.getDateProperty();
        if (!this.data || !dateProperty) {
            this.allTimelineEntries = [];
            return;
        }

        let minDate = Infinity;
        let maxDate = -Infinity;

        const points = this.extractPointsFromData((entry): Partial<TimelineMapPoint> => {
            const dateValue = this.extractDateValue(entry, dateProperty);
            if (dateValue === null) return {};

            const endDateValue = this.extractDateValue(entry, this.getEndDateProperty());
            const uniqueId = this.extractUniqueId(entry);

            minDate = Math.min(minDate, dateValue);
            maxDate = Math.max(maxDate, dateValue);

            return { date: dateValue, endDate: endDateValue, uniqueId };
        }) as TimelineMapPoint[];

        this.allTimelineEntries = points.filter(p => p.date !== undefined);

        const savedDateRangeEnd = this.config.get('_dateRangeEnd');
        if (!savedDateRangeEnd || typeof savedDateRangeEnd !== 'number') {
            this.setDateRangeEnd(maxDate === -Infinity ? Date.now() : maxDate);
        }

        if (this.sliderEl) {
            this.updateSliderFromDate();
        }
    }

    private extractDateValue(entry: BasesEntry, property: BasesPropertyId | null): number | null {
        if (!property) return null;

        try {
            const value = entry.getValue(property)?.toString();
            if (!value) return null;


            if (/^-?\d+$/.test(value)) {
                const timestamp = parseInt(value);
                if (!isNaN(timestamp)) {
                    return timestamp;
                }
            }

            // custom date format
            const parsed = this.parseDateInput(value);
            if (parsed !== null) {
                return parsed;
            }

            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date.getTime();
        } catch {
            return null;
        }
    }

    private extractUniqueId(entry: BasesEntry): string {
        const uniquenessProperty = this.getUniquenessProperty();
        if (!uniquenessProperty) {
            return entry.file.path;
        }

        try {
            const value = entry.getValue(uniquenessProperty);
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

        this.setDateRangeEnd(minDate + (totalRange * sliderValue / 100));
    }


    private applyTimelineFilter(): TimelineMapPoint[] {
        const dateRangeStart = this.getDateRangeStart();
        const dateRangeEnd = this.getDateRangeEnd();

        let filteredPoints = this.allTimelineEntries.filter(point => {
            const inDateRange = point.date >= dateRangeStart && point.date <= dateRangeEnd;
            // Entity must have started by the current time
            if (!inDateRange) return false;

            // Entity must not have ended before the current time (null = ongoing/no end date)
            if (point.endDate !== null && point.endDate < dateRangeEnd) {
                return false;
            }

            return true;
        });

        const uniquenessProperty = this.getUniquenessProperty();
        const uniquenessMode = this.getUniquenessMode();

        if (uniquenessProperty && uniquenessMode !== 'all') {
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

                if (uniquenessMode === 'most-recent') {
                    filteredPoints.push(group[group.length - 1]);
                } else if (uniquenessMode === 'least-recent') {
                    filteredPoints.push(group[0]);
                }
            }
        }
        return filteredPoints;
    }

    static getViewOptions(): ViewOption[] {
        const baseOptions: ViewOption[] = MapBasesView.getViewOptions();

        const timelineOptions: ViewOption[] = [
            {
                displayName: 'Timeline',
                type: 'group',
                items: [
                    {
                        displayName: 'Start date property',
                        type: 'property',
                        key: 'dateProperty',
                        filter: (prop: BasesPropertyId) => !prop.startsWith('file.'),
                        placeholder: 'Property',
                    },
                    {
                        displayName: 'End date property',
                        type: 'property',
                        key: 'endDateProperty',
                        filter: (prop: BasesPropertyId) => !prop.startsWith('file.'),
                        placeholder: 'None',
                    },
                    {
                        displayName: 'Group by property',
                        type: 'property',
                        key: 'uniquenessProperty',
                        filter: (prop: BasesPropertyId) => !prop.startsWith('file.'),
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