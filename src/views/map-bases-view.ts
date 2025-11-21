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
    protected coordinatesProp: BasesPropertyId | null = null;
    protected coverProp: BasesPropertyId | null = null;
    protected polygonProp: BasesPropertyId | null = null;
    private mapHeight: number = DEFAULT_MAP_HEIGHT;
    protected defaultZoom: number = DEFAULT_MAP_ZOOM;
    protected center: [number, number] = [0, 0];
    protected markerType: 'pins' | 'dots' = 'pins';
    private tileLayer: string = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    private savedViewState: { latitude: number; longitude: number; zoom: number } | null = null;
    protected lastPoints: MapPoint[] = [];

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

        this.register(
            this.containerEl.onWindowMigrated(() => {
                if (this.deck) {
                    this.destroyMap();
                    this.renderMap();
                }
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

    public focus(): void {
        this.containerEl.focus({ preventScroll: true });
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

    public onDataUpdated(): void {
        const configChanged = this.loadConfig();

        // If map exists, just update points. Otherwise create map.
        if (this.deck) {
            this.updatePointsOnly(configChanged);
        } else {
            this.renderMap();
        }
    }

    protected loadConfig(): boolean {
        const oldValues = {
            coordinates: this.coordinatesProp,
            polygon: this.polygonProp,
            markerType: this.markerType,
            tileLayer: this.tileLayer,
        };

        this.coordinatesProp = this.config.getAsPropertyId('coordinates');
        this.coverProp = this.config.getAsPropertyId('coverImage');
        this.polygonProp = this.config.getAsPropertyId('polygonPoints');
        this.mapHeight = (this.config.get('mapHeight') as number) || DEFAULT_MAP_HEIGHT;
        this.defaultZoom = (this.config.get('defaultZoom') as number) || DEFAULT_MAP_ZOOM;

        const centerVal = this.config.get('center');
        if (centerVal && typeof centerVal === 'string') {
            const parts = centerVal.split(',').map(p => parseFloat(p.trim()));
            this.center = (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]))
                ? [parts[0], parts[1]]
                : [0, 0];
        } else {
            this.center = [0, 0];
        }

        const markerTypeVal = this.config.get('markerType');
        if (markerTypeVal === 'pins' || markerTypeVal === 'dots') {
            this.markerType = markerTypeVal;
        }

        this.tileLayer = (this.config.get('tileLayer') as string) || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

        const tileLayerChanged = oldValues.tileLayer !== this.tileLayer;
        const renderConfigChanged = oldValues.coordinates !== this.coordinatesProp
            || oldValues.polygon !== this.polygonProp
            || oldValues.markerType !== this.markerType; 
            // TODO: not sure if we care if it's the first render or not, something to consider

        if (this.deck) {
            if (tileLayerChanged) {
                this.destroyMap();
            } else if (renderConfigChanged) {
                this.lastPoints = [];
            }
        }

        return renderConfigChanged;
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
        const height = isEmbedded ? `${this.mapHeight}px` : '100%';

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

        const hasConfiguredCenter = this.center[0] !== 0 || this.center[1] !== 0;
        let centerToUse: [number, number];
        let zoomToUse: number;

        if (hasConfiguredCenter) {
            centerToUse = this.center;
            zoomToUse = this.defaultZoom;
        } else if (this.savedViewState) {
            centerToUse = [this.savedViewState.latitude, this.savedViewState.longitude];
            zoomToUse = this.savedViewState.zoom;
        } else {
            centerToUse = this.center;
            zoomToUse = this.defaultZoom;
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
                markerType: this.markerType,
                tileLayer: this.tileLayer,
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

    

    private updatePointsOnly(configChanged = false): void {
        if (!this.deck || !this.data) return;

        const points = this.extractPointsFromData();

        if (arePointsEqual(points, this.lastPoints)) {
            console.warn('onDataUpdated triggered but points are unchanged - skipping update');
            return;
        }
        const locationsChanged = configChanged ? false : haveLocationsChanged(points, this.lastPoints);

        this.lastPoints = points;

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
                autoCenter: this.plugin.settings.autoCenter && !hasConfiguredCenter && locationsChanged
            }
        });
    }

    protected extractPointsFromData(callback?: (entry: BasesEntry) => Partial<MapPoint>): MapPoint[] {
        if (!this.data) return [];

        const points: MapPoint[] = [];
        for (const entry of this.data.data) {
            const coordinates = this.extractCoordinates(entry);
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

            if (this.coverProp) {
                const coverVal = entry.getValue(this.coverProp);
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
                    if (prop === this.coordinatesProp) continue;

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

            if (this.polygonProp) {
                const polygonVal = entry.getValue(this.polygonProp);
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

    protected extractCoordinates(entry: BasesEntry): [number, number] | null {
        if (this.coordinatesProp) {
            try {
                const value = entry.getValue(this.coordinatesProp);
                if (value) {
                    // Handle list values [lat, lng]
                    if (value instanceof ListValue) {
                        if (value.length() >= 2) {
                            const lat = this.parseCoordinate(value.get(0));
                            const lng = this.parseCoordinate(value.get(1));
                            if (lat !== null && lng !== null) {
                                return [lat, lng];
                            }
                        }
                    }
                    // Handle string values "lat,lng"
                    else if (value instanceof StringValue) {
                        const stringData = value.toString().trim();
                        const parts = stringData.split(',');
                        if (parts.length >= 2) {
                            const lat = this.parseCoordinate(parts[0].trim());
                            const lng = this.parseCoordinate(parts[1].trim());
                            if (lat !== null && lng !== null) {
                                return [lat, lng];
                            }
                        }
                    }
                }
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

    private extractPolygonCoordinates(value: unknown): [number, number][] | null {
        try {
            // Handle ListValue (array from frontmatter)
            if (value instanceof ListValue) {
                const coords: [number, number][] = [];
                for (let i = 0; i < value.length(); i++) {
                    const item = value.get(i);

                    // Each item should be a list of [lat, lng]
                    if (item instanceof ListValue && item.length() >= 2) {
                        const lat = this.parseCoordinate(item.get(0));
                        const lng = this.parseCoordinate(item.get(1));
                        if (lat !== null && lng !== null) {
                            coords.push([lat, lng]);
                        }
                    }
                    // Or could be a string "lat,lng"
                    else if (item instanceof StringValue) {
                        const parts = item.toString().split(',');
                        if (parts.length >= 2) {
                            const lat = this.parseCoordinate(parts[0].trim());
                            const lng = this.parseCoordinate(parts[1].trim());
                            if (lat !== null && lng !== null) {
                                coords.push([lat, lng]);
                            }
                        }
                    }
                }
                return coords.length > 0 ? coords : null;
            }

            // Handle string value with multiple coordinate pairs
            if (value instanceof StringValue) {
                const stringData = value.toString().trim();
                // Try to parse as JSON array
                try {
                    const parsed = JSON.parse(stringData);
                    if (Array.isArray(parsed)) {
                        const coords: [number, number][] = [];
                        for (const item of parsed) {
                            if (Array.isArray(item) && item.length >= 2) {
                                const lat = this.parseCoordinate(item[0]);
                                const lng = this.parseCoordinate(item[1]);
                                if (lat !== null && lng !== null) {
                                    coords.push([lat, lng]);
                                }
                            }
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
