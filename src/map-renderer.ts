import { App, TFile, setIcon } from 'obsidian';
import { Deck, PickingInfo, MapViewState, FlyToInterpolator } from '@deck.gl/core';
import { BitmapLayer, IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import type { TileLayerProps, _Tile2DHeader as Tile2DHeader } from '@deck.gl/geo-layers';
import type { MjolnirEvent } from 'mjolnir.js';
import { MapView as MapViewType } from '@deck.gl/core';

import { MapTagSettings } from './settings/map-tag-settings';
import type MapPlugin from './main';
import type { ThumbnailCacheManager } from './thumbnail-cache';

function easeCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type PropertyValue = string | number | boolean | string[] | null;

interface MapProperty {
    name: string;
    value: PropertyValue;
}

export interface MapPoint {
    lat: number;
    lng: number;
    title: string;
    color?: string;
    size?: number;
    cover?: string;
    file?: TFile;
    tags?: string[];
    properties?: MapProperty[];
}

interface TileIndex {
    index: {
        x: number;
        y: number;
        z: number;
    };
}

interface DeckDataPoint {
    position: [number, number];
    color: [number, number, number];
    radius: number;
    point: MapPoint;
}
export interface MapRendererOptions {
    containerEl: HTMLElement;
    points: MapPoint[];
    app: App;
    settings: MapPlugin['settings'];
    tagSettings?: MapTagSettings;
    thumbnailCache?: ThumbnailCacheManager;
    options: {
        center?: [number, number];
        zoom?: number;
        height?: string;
        markerType?: 'pins' | 'dots';
        markerSize?: number;
        markerColor?: string;
        tileLayer?: string;
        autoCenter?: boolean;
        onMarkerClick?: (point: MapPoint, event: MjolnirEvent) => void;
        onTilesLoaded?: () => void;
    };
}


function parseColor(color: string): [number, number, number] {
    const tempEl = document.body.createDiv();
    tempEl.style.color = color;
    document.body.appendChild(tempEl);
    const computedColor = getComputedStyle(tempEl).color;
    document.body.removeChild(tempEl);

    const rgbMatch = computedColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
        return [
            parseInt(rgbMatch[1]),
            parseInt(rgbMatch[2]),
            parseInt(rgbMatch[3])
        ];
    }

    return [0, 0, 0];
}

function getPointColor(point: MapPoint, tagSettings: MapTagSettings | undefined, defaultColor: string): string {
    if (point.color) {
        return point.color;
    }

    if (tagSettings && point.tags && point.tags.length > 0) {
        for (const priorityTag of tagSettings.tagPriority) {
            if (point.tags.includes(priorityTag)) {
                const customization = tagSettings.tagCustomizations[priorityTag];
                if (customization) {
                    return customization.color;
                }
            }
        }
    }

    return defaultColor;
}

function getPointIcon(point: MapPoint, tagSettings: MapTagSettings | undefined): string | null {
    if (tagSettings && point.tags && point.tags.length > 0) {
        for (const priorityTag of tagSettings.tagPriority) {
            if (point.tags.includes(priorityTag)) {
                const customization = tagSettings.tagCustomizations[priorityTag];
                if (customization && customization.icon) {
                    return customization.icon;
                }
            }
        }
    }
    return null;
}

const iconSVGCache = new Map<string, string | null>();

function getIconSVG(iconName: string, strokeWidth: number, fill: boolean): string | null {
    const cacheKey = `${iconName}-${strokeWidth}-${fill}`;

    if (iconSVGCache.has(cacheKey)) {
        return iconSVGCache.get(cacheKey)!;
    }

    try {
        const tempDiv = document.createElement('div');
        setIcon(tempDiv, iconName);
        const svg = tempDiv.querySelector('svg');
        if (svg) {
            const clonedSvg = svg.cloneNode(true);
            if (clonedSvg instanceof SVGElement) {
                clonedSvg.setAttribute('stroke-width', String(strokeWidth));
                if (fill) {
                    clonedSvg.querySelectorAll('path, circle, rect, polygon, ellipse, line, polyline').forEach((el) => {
                        el.setAttribute('fill', 'white');
                    });
                }
                const serializer = new XMLSerializer();
                const svgContent = serializer.serializeToString(clonedSvg);
                iconSVGCache.set(cacheKey, svgContent);
                return svgContent;
            }
        }
    } catch {
        // Icon not available
    }

    iconSVGCache.set(cacheKey, null);
    return null;
}

function handlePointClick(info: PickingInfo<DeckDataPoint>, event: MjolnirEvent, options: MapRendererOptions['options'], app: App) {
    if (!info.object) return;

    if (options.onMarkerClick) {
        options.onMarkerClick(info.object.point, event);
        return;
    }

    if (info.object.point.file) {
        const srcEvent = event?.srcEvent;
        const newTab =
            (srcEvent && 'button' in srcEvent && srcEvent.button === 1) ||
            srcEvent?.ctrlKey ||
            srcEvent?.metaKey;
        void app.workspace.getLeaf(newTab).openFile(info.object.point.file).catch(console.error);
    }
}

function calculateBounds(points: MapPoint[], containerEl: HTMLElement): { latitude: number; longitude: number; zoom: number } {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const p of points) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
    }

    const centerLat = (maxLat + minLat) / 2;
    const centerLng = (maxLng + minLng) / 2;

    // Add padding (20% on each side)
    const padding = 1.4; // 1 + 0.2*2 for both sides
    const latRange = (maxLat - minLat) * padding;
    const lngRange = (maxLng - minLng) * padding;

    // Handle single point or very clustered points
    const minRange = 0.01; // Roughly ~1km
    const adjustedLatRange = Math.max(latRange, minRange);
    const adjustedLngRange = Math.max(lngRange, minRange);

    // Get container dimensions
    const width = containerEl.clientWidth || 800;
    const height = containerEl.clientHeight || 600;

    // Calculate zoom level to fit bounds
    // At zoom level z, the world is 256 * 2^z pixels wide
    const WORLD_SIZE = 256;
    const latZoom = Math.log2(height / (adjustedLatRange * WORLD_SIZE / 180));
    const lngZoom = Math.log2(width / (adjustedLngRange * WORLD_SIZE / 360));

    // Use the smaller zoom to ensure everything fits, and clamp
    const zoom = Math.max(1, Math.min(18, Math.min(latZoom, lngZoom) - 0.5));

    return {
        latitude: centerLat,
        longitude: centerLng,
        zoom: zoom,
    };
}

function createMarkerLayer(
    data: DeckDataPoint[],
    markerType: 'pins' | 'dots',
    settings: MapPlugin['settings'],
    tagSettings: MapTagSettings | undefined,
    options: MapRendererOptions['options'],
    app: App
) {
    if (markerType === 'pins') {
        return new IconLayer({
            id: 'icon-layer',
            data: data,
            pickable: true,
            getIcon: (d: DeckDataPoint) => {
                const [r, g, b] = d.color;
                const icon = getPointIcon(d.point, tagSettings);

                let innerContent = `<circle cx="12" cy="12" r="4" fill="white"/>`;

                if (icon) {
                    const iconSVG = getIconSVG(icon, settings.strokeWidth, settings.iconFill);
                    if (iconSVG) {
                        innerContent = `<g transform="translate(3.5, 3.5) scale(0.7)" style="color: white;">${iconSVG}</g>`;
                    }
                }

                return {
                    url:
                        'data:image/svg+xml;charset=utf-8,' +
                        encodeURIComponent(
                            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
                                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z" fill="rgb(${r},${g},${b})"/>
                                ${innerContent}
                            </svg>`
                        ),
                    width: 24,
                    height: 36,
                    anchorY: 36,
                };
            },
            getPosition: (d: DeckDataPoint) => d.position,
            getSize: (d: DeckDataPoint) => d.radius * 0.3,
            sizeScale: 1,
            sizeMinPixels: 8,
            sizeMaxPixels: 60,
            onClick: (info: PickingInfo<DeckDataPoint>, event: MjolnirEvent) => handlePointClick(info, event, options, app),
        });
    } else {
        return new ScatterplotLayer({
            id: 'scatterplot-layer',
            data: data,
            pickable: true,
            opacity: 0.8,
            stroked: false,
            filled: true,
            radiusScale: 1,
            radiusMinPixels: 3,
            radiusMaxPixels: 100,
            getPosition: (d: DeckDataPoint) => d.position,
            getRadius: (d: DeckDataPoint) => d.radius,
            getFillColor: (d: DeckDataPoint) => d.color,
            onClick: (info: PickingInfo<DeckDataPoint>, event: MjolnirEvent) => handlePointClick(info, event, options, app),
        });
    }
}

export function updateMapPoints(deck: Deck<MapViewType[]>, points: MapPoint[], config: Pick<MapRendererOptions, 'containerEl' | 'settings' | 'tagSettings' | 'options' | 'app'>): void {
    const { containerEl, settings, tagSettings, options, app } = config;

    const markerType = options.markerType || 'pins';
    const markerSize = options.markerSize || 100;
    const defaultColor = options.markerColor || 'var(--color-accent)';
    const autoCenter = options.autoCenter !== false; // Default to true

    const deckData: DeckDataPoint[] = points.map(point => ({
        position: [point.lng, point.lat] as [number, number],
        color: parseColor(getPointColor(point, tagSettings, defaultColor)),
        radius: point.size || markerSize,
        point: point,
    }));

    const currentLayers = deck.props.layers;
    if (!currentLayers || currentLayers.length === 0) return;

    const tileLayer = currentLayers[0];

    const markerLayer = createMarkerLayer(deckData, markerType, settings, tagSettings, options, app);

    deck.setProps({ layers: [tileLayer, markerLayer] });

    let shouldTransition = false;
    let targetViewState = null;

    const hasConfiguredCenter = options.center && (options.center[0] !== 0 || options.center[1] !== 0);

    if (hasConfiguredCenter && options.zoom) {
        if (!options.center) return;

        shouldTransition = true;
        targetViewState = {
            latitude: options.center[0],
            longitude: options.center[1],
            zoom: options.zoom,
            pitch: 0,
            bearing: 0,
        };
    } else if (autoCenter && points.length > 0) {
        shouldTransition = true;
        targetViewState = {
            ...calculateBounds(points, containerEl),
            pitch: 0,
            bearing: 0,
        };
    }

    if (shouldTransition && targetViewState) {
        deck.setProps({
            initialViewState: {
                MapView: {
                    ...targetViewState,
                    transitionDuration: settings.transitionDuration,
                    transitionInterpolator: new FlyToInterpolator(),
                    transitionEasing: easeCubic,
                }
            }
        });
    }
}

export function createMapRenderer(config: MapRendererOptions): Deck<MapViewType[]> {
    const { containerEl, points, app, settings, tagSettings, options } = config;
    containerEl.addClass('map-container');

    const markerType = options.markerType || 'pins';
    const markerSize = options.markerSize || 100;
    const markerColor = options.markerColor || 'var(--color-accent)';
    const tileLayer = options.tileLayer || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

    containerEl.empty();
    containerEl.style.setProperty('--bases-map-height', options.height || '100%');

    const mapCanvas = containerEl.createEl('canvas', { cls: 'map-canvas' });

    const tooltip = containerEl.createEl('div', { cls: 'map-tooltip' });

    const numPoints = points.length;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const deckData: DeckDataPoint[] = new Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const point = points[i];
        deckData[i] = {
            position: [point.lng, point.lat] as [number, number],
            color: parseColor(getPointColor(point, tagSettings, markerColor)),
            radius: point.size || markerSize,
            point: point,
        };
    }

    // calculate bounds
    let initialViewState: MapViewState;
    const hasConfiguredCenter = options.center && (options.center[0] !== 0 || options.center[1] !== 0);

    if (hasConfiguredCenter && options.zoom) {
        initialViewState = {
            longitude: options.center![1],
            latitude: options.center![0],
            zoom: options.zoom,
            pitch: 0,
            bearing: 0,
        };
    } else if (points.length > 0) {
        const bounds = calculateBounds(points, containerEl);
        initialViewState = {
            ...bounds,
            pitch: 0,
            bearing: 0,
        };
    } else {
        initialViewState = {
            longitude: 0,
            latitude: 0,
            zoom: 2,
            pitch: 0,
            bearing: 0,
        };
    }
    
    let currentCursor = 'grab';
    let currentPoint: MapPoint | null = null;
    let tooltipUpdateId = 0;
    let tilesLoadedCalled = false;

    const updateTooltip = async (point: MapPoint, x: number, y: number) => {
        const thisUpdateId = ++tooltipUpdateId;
        tooltip.textContent = '';
        const renderPromises: Promise<void>[] = [];

        // show cover image
        if (point.cover && point.file) {
            let thumbnailSrc: string | null = null;

            if (config.thumbnailCache && settings.enableThumbnailCache) {
                thumbnailSrc = await config.thumbnailCache.getThumbnail(point.cover, point.file);
            }

            // Check if this update is still valid after async operation
            if (thisUpdateId !== tooltipUpdateId) return;

            if (thumbnailSrc) {
                const img = new Image();
                img.classList.add('map-tooltip-cover-image');
                img.src = thumbnailSrc;

                const imagePromise = img.decode()
                    .then(() => {
                        if (thisUpdateId === tooltipUpdateId) {
                            tooltip.insertBefore(img, tooltip.firstChild);
                        }
                    })
                    .catch(() => {
                        if (thisUpdateId === tooltipUpdateId) {
                            tooltip.insertBefore(img, tooltip.firstChild);
                        }
                    });

                renderPromises.push(imagePromise);
            } else {
                const coverFile = app.metadataCache.getFirstLinkpathDest(point.cover, point.file.path);
                if (coverFile) {
                    const img = new Image();
                    img.classList.add('map-tooltip-cover-image');

                    const src = app.vault.getResourcePath(coverFile);
                    img.src = src;

                    const imagePromise = img.decode()
                        .then(() => {
                            if (thisUpdateId === tooltipUpdateId) {
                                tooltip.insertBefore(img, tooltip.firstChild);
                            }
                        })
                        .catch(() => {
                            if (thisUpdateId === tooltipUpdateId) {
                                tooltip.insertBefore(img, tooltip.firstChild);
                            }
                        });

                    renderPromises.push(imagePromise);
                }
            }
        }

        const titleEl = tooltip.createEl('div', { cls: 'map-tooltip-title' });
        titleEl.textContent = point.title;

        // show properties
        if (point.properties && point.properties.length > 0) {
            const propsContainer = tooltip.createEl('div', { cls: 'map-tooltip-property-container' });

            point.properties.forEach(prop => {
                if (prop.name.toLowerCase() === 'tags') return;

                const propEl = propsContainer.createEl('div', { cls: 'map-tooltip-property' });

                const labelEl = propEl.createEl('span', { cls: 'map-tooltip-property-label' });
                labelEl.textContent = prop.name + ':';

                const valueEl = propEl.createEl('span', { cls: 'map-tooltip-property-value' });

                // render value
                if (typeof prop.value === 'string' || typeof prop.value === 'number') {
                    valueEl.textContent = String(prop.value);
                } else if (Array.isArray(prop.value)) {
                    valueEl.textContent = prop.value.join(', ');
                } else if (prop.value === null) {
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    valueEl.textContent = 'null';
                } else if (typeof prop.value === 'boolean') {
                    valueEl.textContent = String(prop.value);
                } else {
                    valueEl.textContent = JSON.stringify(prop.value);
                }
            });
        }

        // show tags
        if (point.tags && point.tags.length > 0) {
            const tagsEl = tooltip.createEl('div', { cls: 'map-tooltip-tags' });
            point.tags.forEach((tag) => {
                const tagEl = tagsEl.createEl('a', { cls: 'tag' });
                tagEl.textContent = `#${tag}`;
            });
        }

        // Wait for all images to load before showing tooltip
        await Promise.all(renderPromises);

        if (thisUpdateId === tooltipUpdateId) {
            tooltip.style.setProperty('--tooltip-x', `${x + 15}px`);
            tooltip.style.setProperty('--tooltip-y', `${y - 30}px`);
            tooltip.addClass('visible');
        }
    };

    const deck = new Deck({
        canvas: mapCanvas,
        initialViewState: { MapView: initialViewState },
        controller: {
            inertia: true,
            scrollZoom: { speed: 0.02, smooth: true },
            touchRotate: false,
            keyboard: false,
            dragRotate: false,
            dragPan: true,
        },
        views: [new MapViewType({
            repeat: true,
            orthographic: true,
        })],
        onAfterRender: () => {
            if (options.onTilesLoaded && !tilesLoadedCalled) {
                tilesLoadedCalled = true;
                setTimeout(() => {
                    options.onTilesLoaded?.();
                }, 200);
            }
        },
        getCursor: () => currentCursor,
        onHover: (info: PickingInfo<DeckDataPoint>) => {
            if (!info) return;
            if (info.object) {
                // Only update if it's a different point
                if (currentPoint !== info.object.point) {
                    currentPoint = info.object.point;
                    void updateTooltip(info.object.point, info.x, info.y);
                } else {
                    tooltip.style.setProperty('--tooltip-x', `${info.x + 15}px`);
                    tooltip.style.setProperty('--tooltip-y', `${info.y - 30}px`);
                }
                currentCursor = 'pointer';
            } else {
                currentPoint = null;
                tooltip.removeClass('visible');
                currentCursor = 'grab';
            }
        },
        layers: [
            new TileLayer({
                id: 'tile-layer',
                data: tileLayer,
                minZoom: 0,
                maxZoom: 19,
                tileSize: 256,
                refinementStrategy: 'best-available',
                // Converts each loaded tile (HTMLImageElement) into a BitmapLayer
                // positioned at the tile's geographic bounds for rendering
                renderSubLayers: (props: TileLayerProps<HTMLImageElement> & {
                    id: string;
                    data: HTMLImageElement;
                    _offset: number;
                    tile: Tile2DHeader<HTMLImageElement>;
                }) => {
                    // eslint-disable-next-line @typescript-eslint/no-deprecated
                    const bbox = props.tile.bbox;
                    if (!('west' in bbox)) return null;
                    const { west, south, east, north } = bbox;
                    return new BitmapLayer({
                        ...props,
                        data: undefined,
                        image: props.data,
                        bounds: [west, south, east, north],
                    });
                },
                getTileData: ({ index: { x, y, z } }: TileIndex) => {
                    const url = tileLayer
                        .replace('{s}', ['a', 'b', 'c'][Math.abs(x + y) % 3])
                        .replace('{z}', String(z))
                        .replace('{x}', String(x))
                        .replace('{y}', String(y))
                        .replace('{r}', '');
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload = () => resolve(img);
                        img.onerror = reject;
                        img.src = url;
                    });
                },
            }),
            createMarkerLayer(deckData, markerType, settings, tagSettings, options, app),
        ],
    });

    return deck;
}
