/// <reference types="vitest" />
import { defineConfig, build } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");

function buildExtensionParts() {
    return {
        name: "build-extension-parts",

        async closeBundle() {
            // -----------------------------------------
            // 1. CONTENT SCRIPT
            // Must be a classic script: NO top-level import
            // -----------------------------------------
            await build({
                configFile: false,
                root,

                build: {
                    outDir: dist,
                    emptyOutDir: false,

                    rollupOptions: {
                        input: resolve(root, "src/content/index.ts"),

                        output: {
                            format: "iife",
                            inlineDynamicImports: true,

                            entryFileNames: "content/index.js",
                            assetFileNames: "content/assets/[name]-[hash][extname]",
                        },
                    },
                },
            });

            // -----------------------------------------
            // 2. SERVICE WORKER
            // MV3 service worker IS an ES module
            // -----------------------------------------
            await build({
                configFile: false,
                root,

                build: {
                    outDir: dist,
                    emptyOutDir: false,

                    rollupOptions: {
                        input: resolve(
                            root,
                            "src/background/service-worker.ts"
                        ),

                        output: {
                            format: "es",
                            inlineDynamicImports: true,

                            entryFileNames: "background/service-worker.js",
                            assetFileNames: "background/assets/[name]-[hash][extname]",
                        },
                    },
                },
            });
        },
    };
}

export default defineConfig({
    root,

    // -----------------------------------------
    // VITEST
    // Unit tests need a DOM (content-script code).
    // -----------------------------------------
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts"],
    },

    plugins: [
        buildExtensionParts(),
    ],

    // -----------------------------------------
    // POPUP
    // Normal Vite build
    // -----------------------------------------
    build: {
        outDir: dist,
        emptyOutDir: true,

        rollupOptions: {
            input: {
                popup: resolve(root, "src/popup/index.html"),
            },
        },
    },
});