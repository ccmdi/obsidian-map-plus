import "obsidian";

declare module "obsidian" {
    interface MetadataCache {
        getTags(): Record<string, number>;
    }

    interface Workspace {
        on(name: "map:refresh-all-views", callback: () => void, ctx?: unknown): EventRef;
    }

    interface BasesViewConfig {
        data: Record<string, unknown>;
    }
}