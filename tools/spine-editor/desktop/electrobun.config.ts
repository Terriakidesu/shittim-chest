import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Shittim Chest Spine Editor",
    identifier: "dev.terriakidesu.shittim-chest.spine-editor",
    version: "0.1.0",
    description: "Private development editor for Blue Archive Spine lobby assets.",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "build/editor": "views/editor",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
