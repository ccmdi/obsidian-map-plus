import { MapPoint } from "./map-renderer";


export function haveLocationsChanged(points1: MapPoint[], points2: MapPoint[]): boolean {
    // Check if count changed
    if (points1.length !== points2.length) return true;

    // Check if any location (lat/lng) changed
    for (let i = 0; i < points1.length; i++) {
        if (points1[i].lat !== points2[i].lat || points1[i].lng !== points2[i].lng) {
            return true;
        }
    }

    return false;
}

export function arePointsEqual(points1: MapPoint[], points2: MapPoint[]): boolean {
    if (points1.length !== points2.length) return false;

    for (let i = 0; i < points1.length; i++) {
        const p1 = points1[i];
        const p2 = points2[i];

        if (p1.lat !== p2.lat || 
            p1.lng !== p2.lng || 
            p1.title !== p2.title || 
            p1.color !== p2.color || 
            p1.size !== p2.size || 
            p1.cover !== p2.cover ||
            p1.file?.path !== p2.file?.path) {
            return false;
        }

        const tags1 = p1.tags || [];
        const tags2 = p2.tags || [];
        if (tags1.length !== tags2.length || !tags1.every((tag, idx) => tag === tags2[idx])) {
            return false;
        }

        const props1 = p1.properties || [];
        const props2 = p2.properties || [];
        if (props1.length !== props2.length) {
            return false;
        }
        for (let j = 0; j < props1.length; j++) {
            if (props1[j].name !== props2[j].name || props1[j].value !== props2[j].value) {
                return false;
            }
        }
    }

    return true;
}