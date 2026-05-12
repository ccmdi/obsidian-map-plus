import { TFile } from "obsidian";
import { LatLng } from "./LatLng";

type PropertyValue = string | number | boolean | string[] | null;

interface MapProperty {
    name: string;
    value: PropertyValue;
}

export interface MapPoint {
    location: LatLng.Verified;
    title: string;
    color?: string;
    size?: number;
    cover?: string;
    file?: TFile;
    tags?: string[];
    properties?: MapProperty[];
    polygon?: LatLng.Verified[];
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- groups related MapPoint utility functions
export namespace MapPoint {
    export function areSamePlace(point1: MapPoint, point2: MapPoint): boolean {
        return point1.location.lat === point2.location.lat && point1.location.lng === point2.location.lng;
    }

    export function areEqual(point1: MapPoint[], point2: MapPoint[]): boolean;
    export function areEqual(point1: MapPoint, point2: MapPoint): boolean;

    export function areEqual(
        point1: MapPoint | MapPoint[], 
        point2: MapPoint | MapPoint[]
    ): boolean {
        // Handle array case
        if (Array.isArray(point1) && Array.isArray(point2)) {
            if (point1.length !== point2.length) return false;
            for (let i = 0; i < point1.length; i++) {
                if (!areEqual(point1[i], point2[i])) return false;
            }
            return true;
        }
        
        // Handle single MapPoint case
        if (!Array.isArray(point1) && !Array.isArray(point2)) {
            if (!LatLng.equals(point1.location, point2.location) ||
                point1.title !== point2.title ||
                point1.color !== point2.color ||
                point1.size !== point2.size ||
                point1.cover !== point2.cover ||
                point1.file?.path !== point2.file?.path) {
                return false;
            }

            const tags1 = point1.tags || [];
            const tags2 = point2.tags || [];
            if (tags1.length !== tags2.length || !tags1.every((tag, idx) => tag === tags2[idx])) {
                return false;
            }

            const props1 = point1.properties || [];
            const props2 = point2.properties || [];
            if (props1.length !== props2.length) {
                return false;
            }
            for (let j = 0; j < props1.length; j++) {
                if (props1[j].name !== props2[j].name || props1[j].value !== props2[j].value) {
                    return false;
                }
            }

            return true;
        }
        
        return false;
    }

    export function haveLocationsChanged(points1: MapPoint[], points2: MapPoint[]): boolean {
        return !areEqual(points1, points2);
    }
}

