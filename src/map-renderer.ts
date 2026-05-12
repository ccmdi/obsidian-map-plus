import { App, TFile, setIcon, Menu } from 'obsidian';
import { Deck, PickingInfo, MapViewState, FlyToInterpolator, Layer } from '@deck.gl/core';
import { BitmapLayer, IconLayer, ScatterplotLayer, PolygonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import type { TileLayerProps, _Tile2DHeader as Tile2DHeader } from '@deck.gl/geo-layers';
import type { MjolnirEvent } from 'mjolnir.js';
import { MapView as MapViewType } from '@deck.gl/core';

import { MapTagSettings } from './settings/map-tag-settings';
import type MapPlugin from './main';
import type { ThumbnailCacheManager } from './thumbnail-cache';
import { LatLng } from './types/LatLng';
import { MapPoint } from './types/MapPoint';

function easeCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export let currentViewState: MapViewState | null = null;

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
        imageBounds?: [[number, number], [number, number]];
        autoCenter?: boolean;
        onMarkerClick?: (point: MapPoint, event: MjolnirEvent) => void;
        onTilesLoaded?: () => void;
        onSetMapCenter?: (lat: number, lng: number) => void;
        onSetDefaultZoom?: (zoom: number) => void;
    };
}


function parseColor(color: string): [number, number, number] {
    const tempEl = activeDocument.body.createDiv();
    tempEl.style.color = color;
    activeDocument.body.appendChild(tempEl);
    const computedColor = getComputedStyle(tempEl).color;
    activeDocument.body.removeChild(tempEl);

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
        const tempDiv = createDiv();
        setIcon(tempDiv, iconName);
        const svg = tempDiv.querySelector('svg');
        if (svg) {
            const clonedSvg = svg.cloneNode(true);
            if (clonedSvg.instanceOf(SVGElement)) {
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

    // Ignore right-clicks (button === 2)
    const srcEvent = event?.srcEvent;
    if (srcEvent && 'button' in srcEvent && srcEvent.button === 2) {
        return;
    }

    if (options.onMarkerClick) {
        options.onMarkerClick(info.object.point, event);
        return;
    }

    if (info.object.point.file) {
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
        if (p.location.lat < minLat) minLat = p.location.lat;
        if (p.location.lat > maxLat) maxLat = p.location.lat;
        if (p.location.lng < minLng) minLng = p.location.lng;
        if (p.location.lng > maxLng) maxLng = p.location.lng;
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

interface PolygonData {
    polygon: [number, number][];
    color: [number, number, number];
    point: MapPoint;
}

function createPolygonLayer(
    points: MapPoint[],
    tagSettings: MapTagSettings | undefined,
    defaultColor: string,
    options: MapRendererOptions['options'],
    app: App
) {
    const polygonData: PolygonData[] = [];

    for (const point of points) {
        if (point.polygon && point.polygon.length > 0) {
            // Convert LatLng.Verified to [lng, lat] for deck.gl
            const polygon: [number, number][] = point.polygon.map(coord => LatLng.toArrayLngLat(coord));

            polygonData.push({
                polygon,
                color: parseColor(getPointColor(point, tagSettings, defaultColor)),
                point,
            });
        }
    }

    if (polygonData.length === 0) return null;

    return new PolygonLayer({
        id: 'polygon-layer',
        data: polygonData,
        pickable: true,
        stroked: true,
        filled: true,
        wireframe: false,
        lineWidthMinPixels: 2,
        getPolygon: (d: PolygonData) => d.polygon,
        getFillColor: (d: PolygonData) => [...d.color, 100] as [number, number, number, number],
        getLineColor: (d: PolygonData) => d.color,
        getLineWidth: 2,
        onClick: (info: PickingInfo<PolygonData>, event: MjolnirEvent) => {
            if (info.object) {
                handlePointClick({ ...info, object: { position: [0, 0], color: [0, 0, 0], radius: 0, point: info.object.point } }, event, options, app);
            }
        },
    });
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
        position: LatLng.toArrayLngLat(point.location),
        color: parseColor(getPointColor(point, tagSettings, defaultColor)),
        radius: point.size || markerSize,
        point: point,
    }));

    const currentLayers = deck.props.layers;
    if (!currentLayers || currentLayers.length === 0) return;

    const tileLayer = currentLayers[0];

    const markerLayer = createMarkerLayer(deckData, markerType, settings, tagSettings, options, app);
    const polygonLayer = createPolygonLayer(points, tagSettings, defaultColor, options, app);

    const layers = [tileLayer];
    if (polygonLayer) layers.push(polygonLayer);
    layers.push(markerLayer);

    deck.setProps({ layers });

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

    const isLocalImage = !tileLayer.startsWith('http://') && !tileLayer.startsWith('https://');

    containerEl.empty();
    containerEl.style.setProperty('--bases-map-height', options.height || '100%');

    const mapCanvas = containerEl.createEl('canvas', { cls: 'map-canvas' });

    // Pre-load background layer
    let backgroundLayer;
    if (isLocalImage && options.imageBounds) {
        try {
            const file = app.vault.getAbstractFileByPath(tileLayer);
            if (file && file instanceof TFile) {
                const resourcePath = app.vault.getResourcePath(file);
                const [[minLat, minLng], [maxLat, maxLng]] = options.imageBounds;

                backgroundLayer = new BitmapLayer({
                    id: 'background-image',
                    image: resourcePath,
                    bounds: [minLng, minLat, maxLng, maxLat],
                    pickable: false,
                });
            } else {
                console.error('Image file not found:', tileLayer);
            }
        } catch (error) {
            console.error('Error loading local image:', error);
        }
    }

    if (!backgroundLayer) {
        // Use tile layer (default behavior)
        backgroundLayer = new TileLayer({
            id: 'tile-layer',
            data: tileLayer,
            minZoom: 0,
            maxZoom: 19,
            tileSize: 256,
            refinementStrategy: 'best-available',
            renderSubLayers: (props: TileLayerProps<HTMLImageElement> & {
                id: string;
                data: HTMLImageElement;
                _offset: number;
                tile: Tile2DHeader<HTMLImageElement>;
            }) => {
                const boundingBox = props.tile.boundingBox;
                if (!boundingBox || boundingBox.length !== 2) return null;
                const [[west, south], [east, north]] = boundingBox;
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
        });
    }

    const tooltip = containerEl.createDiv({ cls: 'map-tooltip' });

    const numPoints = points.length;
    const deckData: DeckDataPoint[] = new Array<DeckDataPoint>(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const point = points[i];
        deckData[i] = {
            position: LatLng.toArrayLngLat(point.location),
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

        // Hide tooltip before clearing to prevent empty tooltip flash
        tooltip.removeClass('visible');

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

        const titleEl = tooltip.createDiv({ cls: 'map-tooltip-title' });
        titleEl.textContent = point.title;

        // show properties
        if (point.properties && point.properties.length > 0) {
            const propsContainer = tooltip.createDiv({ cls: 'map-tooltip-property-container' });

            point.properties.forEach(prop => {
                if (prop.name.toLowerCase() === 'tags') return;

                const propEl = propsContainer.createDiv({ cls: 'map-tooltip-property' });

                const labelEl = propEl.createSpan({ cls: 'map-tooltip-property-label' });
                labelEl.textContent = prop.name + ':';

                const valueEl = propEl.createSpan({ cls: 'map-tooltip-property-value' });

                // render value
                if (typeof prop.value === 'string' || typeof prop.value === 'number') {
                    valueEl.textContent = String(prop.value);
                } else if (Array.isArray(prop.value)) {
                    valueEl.textContent = prop.value.join(', ');
                } else if (prop.value === null) {
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
            const tagsEl = tooltip.createDiv({ cls: 'map-tooltip-tags' });
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
                activeWindow.setTimeout(() => {
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
        layers: (() => {
            const markerLayer = createMarkerLayer(deckData, markerType, settings, tagSettings, options, app);
            const polygonLayer = createPolygonLayer(points, tagSettings, markerColor, options, app);

            const layers: Layer[] = [backgroundLayer];
            if (polygonLayer) layers.push(polygonLayer);
            layers.push(markerLayer);

            return layers;
        })(),
        onViewStateChange: ({ viewState: newViewState }) => {
            currentViewState = newViewState;
        }
    });

    mapCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = mapCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const viewState = currentViewState;

        if (viewState) {
            const viewport = deck.getViewports()[0];
            const [lng, lat] = viewport?.unproject([x, y]) || [0, 0];

            const menu = new Menu();
            
            menu.addItem((item) => {
                item
                    .setTitle('Copy coordinates')
                    .setIcon('copy')
                    .onClick(async () => {
                        await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                    });
            });

            if (options.onSetMapCenter) {
                menu.addItem((item) => {
                    item
                        .setTitle('Set as map center')
                        .setIcon('map-pin')
                        .onClick(() => {
                            options.onSetMapCenter?.(lat, lng);
                        });
                });
            }

            if (options.onSetDefaultZoom) {
                menu.addItem((item) => {
                    const currentZoom = viewState.zoom;
                    item
                        .setTitle('Set default zoom')
                        .setIcon('zoom-in')
                        .onClick(() => {
                            options.onSetDefaultZoom?.(currentZoom);
                        });
                });
            }

            menu.addItem((item) => {
                item
                    .setTitle('Open in web')
                    .setIcon('globe')
                    .onClick(() => {
                        window.open(`https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`, '_blank');
                    });
            });

            menu.showAtMouseEvent(e);
        }
    });

    return deck;
}
