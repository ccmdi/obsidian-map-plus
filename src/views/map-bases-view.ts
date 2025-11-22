import {
    BasesEntry,
    BasesPropertyId,
    BasesView,
    ListValue,
    NumberValue,
    QueryController,
    StringValue,
    ViewOption,
} from 'obsidian';
import { Deck } from '@deck.gl/core';
import { MapView as MapViewType } from '@deck.gl/core';
import { createMapRenderer, MapPoint, updateMapPoints } from '../map-renderer';
import MapPlugin from '../main';
import { arePointsEqual, haveLocationsChanged } from '../pointutils';

export const MapBasesViewType = 'map';

const DEFAULT_MAP_HEIGHT = 400;
const DEFAULT_MAP_ZOOM = 4;

export class MapBasesView extends BasesView {
    type = MapBasesViewType;
    scrollEl: HTMLElement;
    containerEl: HTMLElement;
    mapEl: HTMLElement;
    plugin: MapPlugin;

    protected deck: Deck<MapViewType[]> | null = null;
    
    protected savedViewState: { latitude: number; longitude: number; zoom: number } | null = null;
    protected lastPoints: MapPoint[] = [];
    protected watchProps = ['center', 'defaultZoom'];
    protected lastConfigState: Record<string, unknown> = {};

    constructor(controller: QueryController, scrollEl: HTMLElement, plugin: MapPlugin) {
        super(controller);
        this.scrollEl = scrollEl;
        this.containerEl = scrollEl.createDiv({ cls: 'bases-map-container is-loading' });
        this.mapEl = this.containerEl.createDiv('bases-map');
        this.plugin = plugin;
    }

    onload(): void {
        this.registerEvent(
            this.app.workspace.on('map:refresh-all-views', () => {
                this.refresh();
            })
        );

        //TODO: maximizing in other window still breaks WebGL context
        this.register(
            this.containerEl.onWindowMigrated(() => {
                this.refresh();
            })
        );
    }

    refresh(): void {
        this.destroyMap();
        this.onDataUpdated();
    }

    onunload() {
        this.destroyMap();
    }

    onResize(): void {
        if (this.deck) {
            this.deck.setProps({ width: '100%', height: '100%' });
        }
    }
    
    private destroyMap(): void {
        if (this.deck) {
            try {
                // @ts-expect-error - accessing protected viewState
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const viewState = this.deck.viewState?.MapView;
                if (viewState) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    this.savedViewState = viewState;
                }
                this.deck.finalize();
            } catch (e) {
                console.error('Error finalizing deck:', e);
            }
            this.deck = null;
            this.lastPoints = [];
        }
    }

    private getCoordinatesProp(): BasesPropertyId | null {
        return this.config.getAsPropertyId('coordinates');
    }

    private getCoverProp(): BasesPropertyId | null {
        return this.config.getAsPropertyId('coverImage');
    }

    private getPolygonProp(): BasesPropertyId | null {
        return this.config.getAsPropertyId('polygonPoints');
    }

    private getMapHeight(): number {
        return (this.config.get('mapHeight') as number) || DEFAULT_MAP_HEIGHT;
    }

    private getDefaultZoom(): number {
        return (this.config.get('defaultZoom') as number) || DEFAULT_MAP_ZOOM;
    }

    private getCenter(): [number, number] {
        return this.parseLatLngOrZero(this.config.get('center'));
    }

    private getMarkerType(): 'pins' | 'dots' {
        const markerTypeVal = this.config.get('markerType');
        if (markerTypeVal === 'pins' || markerTypeVal === 'dots') {
            return markerTypeVal;
        }
        return 'pins';
    }

    private getTileLayer(): string {
        return (this.config.get('tileLayer') as string) || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    }

    private hasConfigMeaningfullyChanged(): boolean {
        if(this.hasConfigPropertyChanged('center')) {
            const centerRaw = this.config.get('center');
            // Meaningful if it's empty OR if it's valid
            if (!centerRaw || this.parseLatLng(centerRaw) !== null) {
                return true;
            }
        }
        if (this.hasConfigPropertyChanged('defaultZoom')) {
            const centerRaw = this.parseLatLng(this.config.get('center'));
            // Only meaningful if center is valid AND non-empty (non-zero)
            if (centerRaw !== null && (centerRaw[0] !== 0 || centerRaw[1] !== 0)) {
                return true;
            }
        }
        return false;
    }

    hasConfigPropertyChanged(property: string): boolean {
        const oldValue = this.lastConfigState[property] ?? '';
        const newValue = this.config.get(property) ?? '';
        return oldValue !== newValue;
    }

    public onDataUpdated(): void {
        // If map exists, just update points. Otherwise create map.
        if (this.deck) {
            this.updateMap();
        } else {
            this.renderMap();
        }
    }

    protected renderMap(): void {
        if (!this.data) {
            this.containerEl.removeClass('is-loading');
            return;
        }
        
        const loadingOverlay = this.containerEl.createDiv({ cls: 'map-loading-overlay' });
        const spinner = loadingOverlay.createDiv();

        const svg = spinner.createSvg('svg');
        svg.setAttr('width', '40');
        svg.setAttr('height', '40');
        svg.setAttr('viewBox', '0 0 40 40');
        svg.setAttr('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttr('stroke', 'var(--interactive-accent)');

        const g1 = svg.createSvg('g');
        g1.setAttr('fill', 'none');
        g1.setAttr('fill-rule', 'evenodd');

        const g2 = g1.createSvg('g');
        g2.setAttr('transform', 'translate(2 2)');
        g2.setAttr('stroke-width', '4');

        const circle = g2.createSvg('circle');
        circle.setAttr('stroke-opacity', '.2');
        circle.setAttr('cx', '18');
        circle.setAttr('cy', '18');
        circle.setAttr('r', '18');

        const path = g2.createSvg('path');
        path.setAttr('d', 'M36 18c0-9.94-8.06-18-18-18');

        const animateTransform = path.createSvg('animateTransform');
        animateTransform.setAttr('attributeName', 'transform');
        animateTransform.setAttr('type', 'rotate');
        animateTransform.setAttr('from', '0 18 18');
        animateTransform.setAttr('to', '360 18 18');
        animateTransform.setAttr('dur', '1s');
        animateTransform.setAttr('repeatCount', 'indefinite');

        const points = this.extractPointsFromData();

        const isEmbedded = this.isEmbedded();
        const mapHeight = this.getMapHeight();
        const height = isEmbedded ? `${mapHeight}px` : '100%';

        const tagSettings = this.plugin.tagSettings;
        const settings = this.plugin.settings;

        let tilesLoaded = false;
        let overlayHidden = false;

        const hideOverlay = () => {
            if (overlayHidden) return;
            overlayHidden = true;
            loadingOverlay.addClass('fade-out');
            setTimeout(() => {
                loadingOverlay.remove();
            }, 300);
        };

        const center = this.getCenter();
        const hasConfiguredCenter = center[0] !== 0 || center[1] !== 0;
        let centerToUse: [number, number];
        let zoomToUse: number;

        if (hasConfiguredCenter) {
            centerToUse = center;
            zoomToUse = this.getDefaultZoom();
        } else if (this.savedViewState) {
            centerToUse = [this.savedViewState.latitude, this.savedViewState.longitude];
            zoomToUse = this.savedViewState.zoom;
        } else {
            centerToUse = center;
            zoomToUse = this.getDefaultZoom();
        }

        this.deck = createMapRenderer({
            containerEl: this.mapEl,
            points,
            app: this.app,
            settings: settings,
            tagSettings: tagSettings,
            thumbnailCache: this.plugin.thumbnailCache,
            options: {
                center: centerToUse,
                zoom: zoomToUse,
                height: height,
                markerType: this.getMarkerType(),
                tileLayer: this.getTileLayer(),
                onTilesLoaded: () => {
                    tilesLoaded = true;
                    hideOverlay();
                }
            }
        });

        this.lastPoints = points;

        this.containerEl.removeClass('is-loading');

        setTimeout(() => {
            if (!tilesLoaded) {
                hideOverlay();
            }
        }, 1000);
    }

    private isEmbedded(): boolean {
        let element = this.scrollEl.parentElement;
        while (element) {
            if (element.hasClass('bases-embed') || element.hasClass('block-language-base')) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    }

    private updateMap(): void {
        if (!this.deck || !this.data) return;

        const points = this.extractPointsFromData();

        if (arePointsEqual(points, this.lastPoints)) {
            console.warn('onDataUpdated triggered but points are unchanged - skipping update');
            return;
        }

        this.updateRenderedPoints(points);
    }

    protected updateRenderedPoints(points: MapPoint[], autofit: boolean | undefined = undefined): void {
        if (!this.deck) return;

        const center = this.getCenter();
        const hasConfiguredCenter = center[0] !== 0 || center[1] !== 0;
        const locationsChanged = haveLocationsChanged(points, this.lastPoints);
        const configChanged = this.hasConfigMeaningfullyChanged();

        this.lastConfigState = { ...this.config.data };

        const shouldAutoCenter = this.plugin.settings.autoCenter && (autofit === true || (autofit === undefined && (locationsChanged || configChanged)));

        this.lastPoints = points;

        updateMapPoints(this.deck, points, {
            containerEl: this.mapEl,
            app: this.app,
            settings: this.plugin.settings,
            tagSettings: this.plugin.tagSettings,
            options: {
                markerType: this.getMarkerType(),
                center: hasConfiguredCenter ? center : undefined,
                zoom: hasConfiguredCenter ? this.getDefaultZoom() : undefined,
                autoCenter: shouldAutoCenter
            }
        });
    }

    protected extractPointsFromData(callback?: (entry: BasesEntry) => Partial<MapPoint>): MapPoint[] {
        if (!this.data) return [];

        const points: MapPoint[] = [];
        const coordinatesProp = this.getCoordinatesProp();
        const coverProp = this.getCoverProp();
        const polygonProp = this.getPolygonProp();

        for (const entry of this.data.data) {
            const coordinates = this.extractCoordinates(entry, coordinatesProp);
            if (!coordinates) continue;

            let point: MapPoint = {
                lat: coordinates[0],
                lng: coordinates[1],
                title: entry.file.basename,
                file: entry.file,
            };

            const fileCache = this.app.metadataCache.getFileCache(entry.file);
            if (fileCache?.frontmatter?.tags) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const tags = fileCache.frontmatter.tags;
                point.tags = Array.isArray(tags) ? tags : [tags];
            }

            if (coverProp) {
                const coverVal = entry.getValue(coverProp);
                if (coverVal) {
                    point.cover = coverVal.toString();

                    if (this.plugin.settings.enableThumbnailCache) {
                        void this.plugin.thumbnailCache.markForGeneration(point.cover, entry.file);
                    }
                }
            }

            const properties: Array<{ name: string; value: string }> = [];
            if (this.data.properties) {
                for (const prop of this.data.properties.slice(0, 20)) {
                    if (prop === coordinatesProp) continue;

                    try {
                        const value = entry.getValue(prop);
                        if (value && value.isTruthy()) {
                            properties.push({
                                name: this.config.getDisplayName(prop),
                                value: value.toString()
                            });
                        }
                    } catch {
                        // Property value not available
                    }
                }
            }

            if (properties.length > 0) {
                point.properties = properties;
            }

            if (polygonProp) {
                const polygonVal = entry.getValue(polygonProp);
                if (polygonVal) {
                    const polygonCoords = this.extractPolygonCoordinates(polygonVal);
                    if (polygonCoords) {
                        point.polygon = polygonCoords;
                    }
                }
            }

            point = {...point, ...callback?.(entry)};

            points.push(point);
        }

        return points;
    }

    protected extractCoordinates(entry: BasesEntry, coordinatesProp: BasesPropertyId | null): [number, number] | null {
        if (coordinatesProp) {
            try {
                const value = entry.getValue(coordinatesProp);
                const coords = this.parseLatLng(value);
                if (coords) return coords;
            } catch (error) {
                console.error(`Error extracting coordinates for ${entry.file.name}:`, error);
            }
        }

        // Fallback to global settings if coordinates property not set or failed
        if (this.plugin.settings.latKey && this.plugin.settings.lngKey) {
            try {
                const fileCache = this.app.metadataCache.getFileCache(entry.file);
                if (fileCache?.frontmatter) {
                    const latValue = this.extractFromFrontmatter(fileCache.frontmatter, this.plugin.settings.latKey);
                    const lngValue = this.extractFromFrontmatter(fileCache.frontmatter, this.plugin.settings.lngKey);

                    if (latValue !== undefined && lngValue !== undefined) {
                        const lat = this.parseCoordinate(latValue);
                        const lng = this.parseCoordinate(lngValue);
                        if (lat !== null && lng !== null) {
                            return [lat, lng];
                        }
                    }
                }
            } catch (error) {
                console.error(`Error extracting coordinates from frontmatter for ${entry.file.name}:`, error);
            }
        }

        return null;
    }

    private extractFromFrontmatter(frontmatter: Record<string, unknown>, key: string): unknown {
        const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            const arrayKey = arrayMatch[1];
            const index = parseInt(arrayMatch[2]);
            const arrayValue = frontmatter[arrayKey];
            if (Array.isArray(arrayValue) && index >= 0 && index < arrayValue.length) {
                return arrayValue[index];
            }
            return undefined;
        }

        // Regular property access
        return frontmatter[key];
    }

    private parseCoordinate(value: unknown): number | null {
        if (value instanceof NumberValue) {
            const numData = Number(value.toString());
            return isNaN(numData) ? null : numData;
        }
        if (value instanceof StringValue) {
            const num = parseFloat(value.toString());
            return isNaN(num) ? null : num;
        }
        if (typeof value === 'string') {
            const num = parseFloat(value);
            return isNaN(num) ? null : num;
        }
        if (typeof value === 'number') {
            return isNaN(value) ? null : value;
        }
        return null;
    }

    private parseLatLng(value: unknown): [number, number] | null {
        // Handle ListValue from frontmatter: [40.7128, -74.0060]
        if (value instanceof ListValue && value.length() >= 2) {
            const lat = this.parseCoordinate(value.get(0));
            const lng = this.parseCoordinate(value.get(1));
            if (lat !== null && lng !== null) {
                return [lat, lng];
            }
        }

        // Handle plain JavaScript array from JSON.parse: [40.7128, -74.0060]
        if (Array.isArray(value) && value.length >= 2) {
            const lat = this.parseCoordinate(value[0]);
            const lng = this.parseCoordinate(value[1]);
            if (lat !== null && lng !== null) {
                return [lat, lng];
            }
        }

        // Handle string: "40.7128, -74.0060" or StringValue wrapper
        if (value instanceof StringValue || typeof value === 'string') {
            const str = value instanceof StringValue ? value.toString() : value;
            const parts = str.split(',').map(p => parseFloat(p.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return [parts[0], parts[1]];
            }
        }

        return null;
    }

    private parseLatLngOrZero(value: unknown): [number, number] {
        return this.parseLatLng(value) ?? [0, 0];
    }

    private extractPolygonCoordinates(value: unknown): [number, number][] | null {
        try {
            // Handle ListValue (array from frontmatter)
            if (value instanceof ListValue) {
                const coords: [number, number][] = [];
                for (let i = 0; i < value.length(); i++) {
                    const coord = this.parseLatLng(value.get(i));
                    if (coord) coords.push(coord);
                }
                return coords.length > 0 ? coords : null;
            }

            // Handle string value as JSON array
            if (value instanceof StringValue) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const parsed = JSON.parse(value.toString().trim());
                    if (Array.isArray(parsed)) {
                        const coords: [number, number][] = [];
                        for (const item of parsed) {
                            const coord = this.parseLatLng(item);
                            if (coord) coords.push(coord);
                        }
                        return coords.length > 0 ? coords : null;
                    }
                } catch {
                    // Not JSON, ignore
                }
            }
        } catch (error) {
            console.error('Error extracting polygon coordinates:', error);
        }

        return null;
    }

    static getViewOptions(): ViewOption[] {
        return [
            {
                displayName: 'Display',
                type: 'group',
                items: [
                    {
                        displayName: 'Embedded height',
                        type: 'slider',
                        key: 'mapHeight',
                        min: 200,
                        max: 800,
                        step: 20,
                        default: DEFAULT_MAP_HEIGHT,
                    },
                    {
                        displayName: 'Center coordinates (lat,lng)',
                        type: 'text',
                        key: 'center',
                        placeholder: '0,0',
                    },
                    {
                        displayName: 'Zoom level',
                        type: 'slider',
                        key: 'defaultZoom',
                        min: 1,
                        max: 18,
                        step: 0.5,
                        default: DEFAULT_MAP_ZOOM,
                    },
                    {
                        displayName: 'Marker type',
                        type: 'dropdown',
                        key: 'markerType',
                        options: {
                            "pins": "Pins",
                            "dots": "Dots",
                        },
                        default: 'pins',
                    },
                ],
            },
            {
                displayName: 'Markers',
                type: 'group',
                items: [
                    {
                        displayName: 'Coordinates property',
                        type: 'property',
                        key: 'coordinates',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'Property',
                    },
                    {
                        displayName: 'Cover image property',
                        type: 'property',
                        key: 'coverImage',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'Property',
                    },
                    {
                        displayName: 'Polygon points property',
                        type: 'property',
                        key: 'polygonPoints',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'Property',
                    },
                ],
            },
            {
                displayName: 'Background',
                type: 'group',
                items: [
                    {
                        displayName: 'Tile layer URL',
                        type: 'text',
                        key: 'tileLayer',
                        placeholder: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                    },
                ],
            },
        ];
    }
}