import {
    BasesEntry,
    BasesPropertyId,
    QueryController,
    ViewOption,
    setIcon,
} from 'obsidian';
import { MapPoint } from '../map-renderer';
import MapPlugin from '../main';
import { MapBasesView } from './map-bases-view';
import { ArcLayer } from '@deck.gl/layers';
import { FlyToInterpolator } from '@deck.gl/core';

export const MapNetworkBasesViewType = 'map-network';

interface NetworkConnection {
    source: MapPoint;
    target: MapPoint;
    strength: number;
    type?: string;
    notes: string[];
}

interface ArcDataPoint {
    sourcePosition: [number, number];
    targetPosition: [number, number];
    color: [number, number, number, number];
    width: number;
    connection: NetworkConnection;
}

type ConnectionDirection = 'all' | 'outgoing' | 'incoming';
type AnimationStyle = 'flow' | 'pulse' | 'none';

export class MapNetworkBasesView extends MapBasesView {
    type = MapNetworkBasesViewType;

    private connections: NetworkConnection[] = [];
    private minStrength: number = 1;
    private maxStrength: number = 1;
    private connectionDirection: ConnectionDirection = 'all';
    private animationStyle: AnimationStyle = 'flow';
    private showIsolatedNodes: boolean = true;
    private arcOpacity: number = 0.6;
    private connectionTypeProperty: BasesPropertyId | null = null;
    private animationTime: number = 0;
    private animationInterval: number | null = null;

    private controlsContainer: HTMLElement | null = null;
    private strengthSlider: HTMLInputElement | null = null;
    private strengthValueDisplay: HTMLElement | null = null;
    private controlsExpanded: boolean = false;

    constructor(controller: QueryController, scrollEl: HTMLElement, plugin: MapPlugin) {
        super(controller, scrollEl, plugin);
    }

    onload(): void {
        super.onload();
        this.startAnimation();
    }

    onunload() {
        super.onunload();
        this.stopAnimation();
        this.destroyControls();
    }

    private startAnimation(): void {
        if (this.animationStyle === 'none') return;

        this.animationInterval = window.setInterval(() => {
            this.animationTime = (this.animationTime + 0.01) % 1;
            this.updateArcsOnly();
        }, 50);
    }

    private stopAnimation(): void {
        if (this.animationInterval !== null) {
            window.clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    }

    protected loadConfig(): void {
        super.loadConfig();

        this.connectionTypeProperty = this.config.getAsPropertyId('connectionType');

        const directionVal = this.config.get('connectionDirection');
        if (directionVal === 'all' || directionVal === 'outgoing' || directionVal === 'incoming') {
            this.connectionDirection = directionVal;
        }

        const animationVal = this.config.get('animationStyle');
        if (animationVal === 'flow' || animationVal === 'pulse' || animationVal === 'none') {
            this.animationStyle = animationVal;
        }

        const showIsolatedVal = this.config.get('showIsolatedNodes');
        if (typeof showIsolatedVal === 'boolean') {
            this.showIsolatedNodes = showIsolatedVal;
        }

        const opacityVal = this.config.get('arcOpacity');
        if (typeof opacityVal === 'number') {
            this.arcOpacity = opacityVal;
        }

        const savedMinStrength = this.config.get('_minStrength');
        if (savedMinStrength && typeof savedMinStrength === 'number') {
            this.minStrength = savedMinStrength;
        }
    }

    public onDataUpdated(): void {
        this.loadConfig();

        // Analyze connections
        this.analyzeConnections();

        if (this.deck) {
            this.updateMapWithNetwork();
        } else {
            super.loadConfig();
            super.renderMap();
            this.createControls();
            this.updateMapWithNetwork();
        }
    }

    private analyzeConnections(): void {
        if (!this.data) {
            this.connections = [];
            return;
        }

        // Build a map of file paths to points
        const allPoints = this.extractPointsFromData();
        const pathToPoint = new Map<string, MapPoint>();

        for (const point of allPoints) {
            if (point.file) {
                pathToPoint.set(point.file.path, point);
            }
        }

        // Build connection graph
        const connectionMap = new Map<string, NetworkConnection>();

        for (const point of allPoints) {
            if (!point.file) continue;

            const fileCache = this.app.metadataCache.getFileCache(point.file);
            if (!fileCache) continue;

            const links = fileCache.links || [];
            const embeds = fileCache.embeds || [];
            const allRefs = [...links, ...embeds];

            for (const ref of allRefs) {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(ref.link, point.file.path);
                if (!linkedFile) continue;

                const targetPoint = pathToPoint.get(linkedFile.path);
                if (!targetPoint) continue;

                // Skip self-references
                if (point.file.path === linkedFile.path) continue;

                // Create connection key (sorted for bidirectional)
                const key = this.getConnectionKey(point, targetPoint);

                if (connectionMap.has(key)) {
                    const conn = connectionMap.get(key)!;
                    conn.strength++;
                    conn.notes.push(point.file.basename);
                } else {
                    const type = this.extractConnectionType(point);
                    connectionMap.set(key, {
                        source: point,
                        target: targetPoint,
                        strength: 1,
                        type: type,
                        notes: [point.file.basename],
                    });
                }
            }
        }

        this.connections = Array.from(connectionMap.values());

        // Calculate min/max strength for filtering
        if (this.connections.length > 0) {
            this.maxStrength = Math.max(...this.connections.map(c => c.strength));
            if (this.minStrength > this.maxStrength) {
                this.minStrength = 1;
            }
        } else {
            this.maxStrength = 1;
            this.minStrength = 1;
        }

        // Update slider if it exists
        if (this.strengthSlider) {
            this.strengthSlider.max = String(this.maxStrength);
            if (parseInt(this.strengthSlider.value) > this.maxStrength) {
                this.strengthSlider.value = String(this.maxStrength);
                this.minStrength = this.maxStrength;
            }
        }
    }

    private getConnectionKey(point1: MapPoint, point2: MapPoint): string {
        if (!point1.file || !point2.file) return '';

        // Sort to make bidirectional connections use same key
        const paths = [point1.file.path, point2.file.path].sort();
        return `${paths[0]}::${paths[1]}`;
    }

    private extractConnectionType(point: MapPoint): string | undefined {
        if (!this.connectionTypeProperty || !point.file) return undefined;

        try {
            const entry = this.data?.data.find(e => e.file.path === point.file?.path);
            if (!entry) return undefined;

            const value = entry.getValue(this.connectionTypeProperty);
            return value ? value.toString() : undefined;
        } catch {
            return undefined;
        }
    }

    private createControls(): void {
        this.controlsContainer = this.mapEl.createDiv({ cls: 'bases-network-controls' });

        const headerContainer = this.controlsContainer.createDiv({ cls: 'network-controls-header' });

        const infoEl = headerContainer.createDiv({ cls: 'network-controls-info' });
        infoEl.createSpan({ text: `${this.connections.length} connections` });

        const toggleButton = headerContainer.createEl('button', { cls: 'network-toggle-button' });
        setIcon(toggleButton, 'chevron-down');
        toggleButton.addEventListener('click', () => {
            this.controlsExpanded = !this.controlsExpanded;
            const settingsContainer = this.controlsContainer?.querySelector('.network-controls-settings') as HTMLElement;
            if (this.controlsExpanded) {
                settingsContainer?.addClass('expanded');
                toggleButton.addClass('expanded');
            } else {
                settingsContainer?.removeClass('expanded');
                toggleButton.removeClass('expanded');
            }
        });

        const settingsContainer = this.controlsContainer.createDiv({ cls: 'network-controls-settings' });

        // Strength filter
        const strengthContainer = settingsContainer.createDiv({ cls: 'network-control-group' });
        strengthContainer.createDiv({ cls: 'network-control-label', text: 'Min connection strength' });

        const strengthSliderContainer = strengthContainer.createDiv({ cls: 'network-slider-container' });

        this.strengthSlider = strengthSliderContainer.createEl('input', {
            type: 'range',
            cls: 'network-slider',
        });
        this.strengthSlider.min = '1';
        this.strengthSlider.max = String(this.maxStrength);
        this.strengthSlider.value = String(this.minStrength);

        this.strengthValueDisplay = strengthSliderContainer.createDiv({
            cls: 'network-slider-value',
            text: String(this.minStrength)
        });

        this.strengthSlider.addEventListener('input', () => {
            if (!this.strengthSlider || !this.strengthValueDisplay) return;

            this.minStrength = parseInt(this.strengthSlider.value);
            this.strengthValueDisplay.textContent = String(this.minStrength);
            this.updateMapWithNetwork();
        });

        this.strengthSlider.addEventListener('change', () => {
            this.config.set('_minStrength', this.minStrength);
        });

        // Direction filter
        const directionContainer = settingsContainer.createDiv({ cls: 'network-control-group' });
        directionContainer.createDiv({ cls: 'network-control-label', text: 'Direction' });

        const directionSelect = directionContainer.createEl('select', { cls: 'network-select' });
        directionSelect.createEl('option', { value: 'all', text: 'All connections' });
        directionSelect.createEl('option', { value: 'outgoing', text: 'Outgoing only' });
        directionSelect.createEl('option', { value: 'incoming', text: 'Incoming only' });
        directionSelect.value = this.connectionDirection;

        directionSelect.addEventListener('change', () => {
            this.connectionDirection = directionSelect.value as ConnectionDirection;
            this.config.set('connectionDirection', this.connectionDirection);
            this.updateMapWithNetwork();
        });

        // Animation style
        const animationContainer = settingsContainer.createDiv({ cls: 'network-control-group' });
        animationContainer.createDiv({ cls: 'network-control-label', text: 'Animation' });

        const animationSelect = animationContainer.createEl('select', { cls: 'network-select' });
        animationSelect.createEl('option', { value: 'flow', text: 'Flow' });
        animationSelect.createEl('option', { value: 'pulse', text: 'Pulse' });
        animationSelect.createEl('option', { value: 'none', text: 'None' });
        animationSelect.value = this.animationStyle;

        animationSelect.addEventListener('change', () => {
            this.animationStyle = animationSelect.value as AnimationStyle;
            this.config.set('animationStyle', this.animationStyle);

            if (this.animationStyle === 'none') {
                this.stopAnimation();
            } else if (!this.animationInterval) {
                this.startAnimation();
            }

            this.updateMapWithNetwork();
        });

        // Opacity control
        const opacityContainer = settingsContainer.createDiv({ cls: 'network-control-group' });
        opacityContainer.createDiv({ cls: 'network-control-label', text: 'Arc opacity' });

        const opacitySliderContainer = opacityContainer.createDiv({ cls: 'network-slider-container' });

        const opacitySlider = opacitySliderContainer.createEl('input', {
            type: 'range',
            cls: 'network-slider',
        });
        opacitySlider.min = '0';
        opacitySlider.max = '1';
        opacitySlider.step = '0.1';
        opacitySlider.value = String(this.arcOpacity);

        const opacityValueDisplay = opacitySliderContainer.createDiv({
            cls: 'network-slider-value',
            text: String(this.arcOpacity)
        });

        opacitySlider.addEventListener('input', () => {
            this.arcOpacity = parseFloat(opacitySlider.value);
            opacityValueDisplay.textContent = this.arcOpacity.toFixed(1);
            this.updateMapWithNetwork();
        });

        opacitySlider.addEventListener('change', () => {
            this.config.set('arcOpacity', this.arcOpacity);
        });

        // Show isolated nodes toggle
        const isolatedContainer = settingsContainer.createDiv({ cls: 'network-control-group' });
        const isolatedLabel = isolatedContainer.createDiv({ cls: 'network-control-label-inline' });

        const isolatedCheckbox = isolatedLabel.createEl('input', {
            type: 'checkbox',
        });
        isolatedCheckbox.checked = this.showIsolatedNodes;

        isolatedLabel.createSpan({ text: 'Show isolated nodes' });

        isolatedCheckbox.addEventListener('change', () => {
            this.showIsolatedNodes = isolatedCheckbox.checked;
            this.config.set('showIsolatedNodes', this.showIsolatedNodes);
            this.updateMapWithNetwork();
        });
    }

    private destroyControls(): void {
        if (this.controlsContainer) {
            this.controlsContainer.remove();
            this.controlsContainer = null;
            this.strengthSlider = null;
            this.strengthValueDisplay = null;
        }
    }

    private updateMapWithNetwork(): void {
        if (!this.deck || !this.data) return;

        // Filter connections by strength
        const filteredConnections = this.connections.filter(c => c.strength >= this.minStrength);

        // Get all points
        const allPoints = this.extractPointsFromData();

        // Filter points based on connection involvement
        let visiblePoints = allPoints;
        if (!this.showIsolatedNodes) {
            const connectedPaths = new Set<string>();
            for (const conn of filteredConnections) {
                if (conn.source.file) connectedPaths.add(conn.source.file.path);
                if (conn.target.file) connectedPaths.add(conn.target.file.path);
            }
            visiblePoints = allPoints.filter(p => p.file && connectedPaths.has(p.file.path));
        }

        // Update base map points
        this.updatePointsAndArcs(visiblePoints, filteredConnections);
        this.lastPoints = visiblePoints;
    }

    private updateArcsOnly(): void {
        if (!this.deck || !this.data) return;

        const filteredConnections = this.connections.filter(c => c.strength >= this.minStrength);

        const currentLayers = this.deck.props.layers;
        if (!currentLayers || currentLayers.length < 2) return;

        const tileLayer = currentLayers[0];
        const markerLayer = currentLayers[1];

        const arcLayer = this.createArcLayer(filteredConnections);

        this.deck.setProps({ layers: [tileLayer, arcLayer, markerLayer] });
    }

    private updatePointsAndArcs(points: MapPoint[], connections: NetworkConnection[]): void {
        if (!this.deck) return;

        const currentLayers = this.deck.props.layers;
        if (!currentLayers || currentLayers.length === 0) return;

        const tileLayer = currentLayers[0];

        // Create arc layer
        const arcLayer = this.createArcLayer(connections);

        // Update marker layer with new points
        const markerType = this.markerType || 'pins';
        const markerSize = 100;
        const defaultColor = 'var(--color-accent)';

        const parseColor = (color: string): [number, number, number] => {
            const tempEl = document.body.createDiv();
            tempEl.style.color = color;
            document.body.appendChild(tempEl);
            const computedColor = getComputedStyle(tempEl).color;
            document.body.removeChild(tempEl);

            const rgbMatch = computedColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (rgbMatch) {
                return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
            }
            return [0, 0, 0];
        };

        const getPointColor = (point: MapPoint): string => {
            if (point.color) return point.color;

            if (this.plugin.tagSettings && point.tags && point.tags.length > 0) {
                for (const priorityTag of this.plugin.tagSettings.tagPriority) {
                    if (point.tags.includes(priorityTag)) {
                        const customization = this.plugin.tagSettings.tagCustomizations[priorityTag];
                        if (customization) return customization.color;
                    }
                }
            }
            return defaultColor;
        };

        const deckData = points.map(point => ({
            position: [point.lng, point.lat] as [number, number],
            color: parseColor(getPointColor(point)),
            radius: point.size || markerSize,
            point: point,
        }));

        // Import marker creation from base
        // We'll use a simplified inline version
        const { IconLayer, ScatterplotLayer } = require('@deck.gl/layers');
        const { setIcon } = require('obsidian');

        let markerLayer;
        if (markerType === 'pins') {
            const getIconSVG = (iconName: string): string | null => {
                try {
                    const tempDiv = document.createElement('div');
                    setIcon(tempDiv, iconName);
                    const svg = tempDiv.querySelector('svg');
                    if (svg) {
                        const clonedSvg = svg.cloneNode(true) as SVGElement;
                        clonedSvg.setAttribute('stroke-width', String(this.plugin.settings.strokeWidth));
                        if (this.plugin.settings.iconFill) {
                            clonedSvg.querySelectorAll('path, circle, rect, polygon, ellipse, line, polyline').forEach((el) => {
                                el.setAttribute('fill', 'white');
                            });
                        }
                        const serializer = new XMLSerializer();
                        return serializer.serializeToString(clonedSvg);
                    }
                } catch {
                    // Icon not available
                }
                return null;
            };

            const getPointIcon = (point: MapPoint): string | null => {
                if (this.plugin.tagSettings && point.tags && point.tags.length > 0) {
                    for (const priorityTag of this.plugin.tagSettings.tagPriority) {
                        if (point.tags.includes(priorityTag)) {
                            const customization = this.plugin.tagSettings.tagCustomizations[priorityTag];
                            if (customization && customization.icon) return customization.icon;
                        }
                    }
                }
                return null;
            };

            markerLayer = new IconLayer({
                id: 'icon-layer',
                data: deckData,
                pickable: true,
                getIcon: (d: any) => {
                    const [r, g, b] = d.color;
                    const icon = getPointIcon(d.point);
                    let innerContent = `<circle cx="12" cy="12" r="4" fill="white"/>`;
                    if (icon) {
                        const iconSVG = getIconSVG(icon);
                        if (iconSVG) {
                            innerContent = `<g transform="translate(3.5, 3.5) scale(0.7)" style="color: white;">${iconSVG}</g>`;
                        }
                    }
                    return {
                        url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
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
                getPosition: (d: any) => d.position,
                getSize: (d: any) => d.radius * 0.3,
                sizeScale: 1,
                sizeMinPixels: 8,
                sizeMaxPixels: 60,
                onClick: (info: any) => {
                    if (info.object?.point?.file) {
                        void this.app.workspace.getLeaf(false).openFile(info.object.point.file);
                    }
                },
            });
        } else {
            markerLayer = new ScatterplotLayer({
                id: 'scatterplot-layer',
                data: deckData,
                pickable: true,
                opacity: 0.8,
                stroked: false,
                filled: true,
                radiusScale: 1,
                radiusMinPixels: 3,
                radiusMaxPixels: 100,
                getPosition: (d: any) => d.position,
                getRadius: (d: any) => d.radius,
                getFillColor: (d: any) => d.color,
                onClick: (info: any) => {
                    if (info.object?.point?.file) {
                        void this.app.workspace.getLeaf(false).openFile(info.object.point.file);
                    }
                },
            });
        }

        this.deck.setProps({ layers: [tileLayer, arcLayer, markerLayer] });
    }

    private createArcLayer(connections: NetworkConnection[]): ArcLayer<ArcDataPoint> {
        const arcData: ArcDataPoint[] = connections
            .filter(conn => {
                // Validate coordinates
                return conn.source.lat != null && conn.source.lng != null &&
                       conn.target.lat != null && conn.target.lng != null &&
                       !isNaN(conn.source.lat) && !isNaN(conn.source.lng) &&
                       !isNaN(conn.target.lat) && !isNaN(conn.target.lng);
            })
            .map(conn => {
                // Calculate color based on strength
                const strengthRatio = (conn.strength - 1) / (this.maxStrength - 1 || 1);
                const baseColor: [number, number, number] = [100, 180, 255];
                const strongColor: [number, number, number] = [255, 100, 150];

                const r = Math.round(baseColor[0] + (strongColor[0] - baseColor[0]) * strengthRatio);
                const g = Math.round(baseColor[1] + (strongColor[1] - baseColor[1]) * strengthRatio);
                const b = Math.round(baseColor[2] + (strongColor[2] - baseColor[2]) * strengthRatio);

                return {
                    sourcePosition: [conn.source.lng, conn.source.lat] as [number, number],
                    targetPosition: [conn.target.lng, conn.target.lat] as [number, number],
                    color: [r, g, b, Math.round(this.arcOpacity * 255)] as [number, number, number, number],
                    width: Math.max(1, Math.log(conn.strength + 1) * 2),
                    connection: conn,
                };
            });

        return new ArcLayer<ArcDataPoint>({
            id: 'arc-layer',
            data: arcData,
            pickable: true,
            getWidth: (d: ArcDataPoint) => d.width,
            getSourcePosition: (d: ArcDataPoint) => d.sourcePosition,
            getTargetPosition: (d: ArcDataPoint) => d.targetPosition,
            getSourceColor: (d: ArcDataPoint) => d.color,
            getTargetColor: (d: ArcDataPoint) => d.color,
            greatCircle: true,
            getHeight: () => 0.3,
            getTilt: () => {
                if (this.animationStyle === 'pulse') {
                    return Math.sin(this.animationTime * Math.PI * 2) * 15;
                }
                return 0;
            },
            onClick: (info: any) => {
                if (info.object?.connection) {
                    const conn = info.object.connection as NetworkConnection;
                    // Open the source file
                    if (conn.source.file) {
                        void this.app.workspace.getLeaf(false).openFile(conn.source.file);
                    }
                }
            },
            updateTriggers: {
                getTilt: this.animationTime,
            },
        });
    }

    refresh(): void {
        this.destroyControls();
        super.refresh();
    }

    static getViewOptions(): ViewOption[] {
        const baseOptions = MapBasesView.getViewOptions();

        const networkOptions: ViewOption[] = [
            {
                displayName: 'Network',
                type: 'group',
                items: [
                    {
                        displayName: 'Connection type property',
                        type: 'property',
                        key: 'connectionType',
                        filter: (prop) => !prop.startsWith('file.'),
                        placeholder: 'None',
                    },
                    {
                        displayName: 'Connection direction',
                        type: 'dropdown',
                        key: 'connectionDirection',
                        options: {
                            "all": "All connections",
                            "outgoing": "Outgoing only",
                            "incoming": "Incoming only",
                        },
                        default: 'all',
                    },
                    {
                        displayName: 'Animation style',
                        type: 'dropdown',
                        key: 'animationStyle',
                        options: {
                            "flow": "Flow",
                            "pulse": "Pulse",
                            "none": "None",
                        },
                        default: 'flow',
                    },
                    {
                        displayName: 'Show isolated nodes',
                        type: 'toggle',
                        key: 'showIsolatedNodes',
                        default: true,
                    },
                ],
            },
            ...baseOptions,
        ];

        return networkOptions;
    }
}
