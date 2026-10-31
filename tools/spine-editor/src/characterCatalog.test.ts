import { expect, test } from "bun:test";
import { characterDirectoryLabel, parseCharacterDirectoryLabels } from "./characterCatalog";

test("character catalog labels variants with their display name and asset id", () => {
  const labels = parseCharacterDirectoryLabels({
    characters: {
      Seia: {
        variants: [
          { variant: "Base", directory: "CH0070_home", assetId: "CH0070" },
          { variant: "Swimsuit", directory: "CH0295_home", assetId: "CH0295" },
        ],
        extras: [{ type: "scene", directory: "Seia_scene" }],
      },
    },
  });
  expect(characterDirectoryLabel("CH0070_home", labels)).toBe("Seia (CH0070)");
  expect(characterDirectoryLabel("CH0295_home", labels)).toBe("Seia Swimsuit (CH0295)");
  expect(characterDirectoryLabel("Seia_scene", labels)).toBe("Seia Scene");
  expect(characterDirectoryLabel("unknown_home", labels)).toBe("unknown_home");
});
