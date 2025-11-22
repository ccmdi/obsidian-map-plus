import "obsidian";

declare module "obsidian" {
    interface MetadataCache {
        getTags(): Record<string, number>;
    }

    interface Workspace {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on(name: "map:refresh-all-views", callback: () => void, ctx?: any): EventRef;
    }

    interface BasesViewConfig {
        data: Record<string, unknown>;
    }
}