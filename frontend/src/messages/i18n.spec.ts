import en from "./en.json";
import fr from "./fr.json";
import sw from "./sw.json";
import pt from "./pt.json";

type TranslationCatalog = Record<string, any>;

/**
 * Recursively extracts all keys from a translation object
 * Handles nested objects and returns flattened key paths
 */
function extractKeys(obj: TranslationCatalog, prefix = ""): Set<string> {
  const keys = new Set<string>();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Recursively extract keys from nested objects
      extractKeys(value, fullKey).forEach((k) => keys.add(k));
    } else {
      // Add leaf keys
      keys.add(fullKey);
    }
  }

  return keys;
}

/**
 * Compares two sets of keys and returns missing keys
 */
function findMissingKeys(
  sourceKeys: Set<string>,
  targetKeys: Set<string>,
): Set<string> {
  return new Set([...sourceKeys].filter((key) => !targetKeys.has(key)));
}

describe("Translation Catalogs", () => {
  const enKeys = extractKeys(en);
  const frKeys = extractKeys(fr);
  const swKeys = extractKeys(sw);
  const ptKeys = extractKeys(pt);

  describe("Key Completeness", () => {
    it("should have identical keys in English and French catalogs", () => {
      const missingInFr = findMissingKeys(enKeys, frKeys);
      const extraInFr = findMissingKeys(frKeys, enKeys);

      expect(missingInFr.size).toBe(0);
      expect(extraInFr.size).toBe(0);

      if (missingInFr.size > 0) {
        console.error("Missing keys in French:", Array.from(missingInFr));
      }
      if (extraInFr.size > 0) {
        console.error("Extra keys in French:", Array.from(extraInFr));
      }
    });

    it("should have identical keys in English and Swahili catalogs", () => {
      const missingInSw = findMissingKeys(enKeys, swKeys);
      const extraInSw = findMissingKeys(swKeys, enKeys);

      expect(missingInSw.size).toBe(0);
      expect(extraInSw.size).toBe(0);

      if (missingInSw.size > 0) {
        console.error("Missing keys in Swahili:", Array.from(missingInSw));
      }
      if (extraInSw.size > 0) {
        console.error("Extra keys in Swahili:", Array.from(extraInSw));
      }
    });

    it("should have identical keys in English and Portuguese catalogs", () => {
      const missingInPt = findMissingKeys(enKeys, ptKeys);
      const extraInPt = findMissingKeys(ptKeys, enKeys);

      if (missingInPt.size > 0) {
        console.error(
          "Missing keys in Portuguese:",
          Array.from(missingInPt).sort(),
        );
      }
      if (extraInPt.size > 0) {
        console.error(
          "Extra keys in Portuguese:",
          Array.from(extraInPt).sort(),
        );
      }

      expect(missingInPt.size).toBe(0);
      expect(extraInPt.size).toBe(0);
    });

    it("should have all required keys in English catalog", () => {
      const requiredKeys = [
        "nav.title",
        "nav.dashboard",
        "nav.marketplace",
        "home.title",
        "home.hero.titlePart1",
        "deals.createTitle",
        "common.loading",
        "common.error",
        "format.currency",
      ];

      const missingRequired = requiredKeys.filter((key) => !enKeys.has(key));

      expect(missingRequired).toEqual([]);

      if (missingRequired.length > 0) {
        console.error("Missing required keys:", missingRequired);
      }
    });
  });

  describe("Key Structure Consistency", () => {
    it("should have consistent nesting depth for corresponding keys", () => {
      const getDepth = (key: string): number => key.split(".").length;

      const inconsistencies: string[] = [];

      enKeys.forEach((enKey) => {
        if (frKeys.has(enKey)) {
          const enDepth = getDepth(enKey);
          const frDepth = getDepth(enKey);
          if (enDepth !== frDepth) {
            inconsistencies.push(
              `${enKey}: EN depth ${enDepth} vs FR depth ${frDepth}`,
            );
          }
        }
      });

      expect(inconsistencies).toEqual([]);
    });
  });

  describe("Translation Catalog Statistics", () => {
    it("should report key counts for all catalogs", () => {
      console.log("Translation Catalog Statistics:");
      console.log(`English keys: ${enKeys.size}`);
      console.log(`French keys: ${frKeys.size}`);
      console.log(`Swahili keys: ${swKeys.size}`);
      console.log(`Portuguese keys: ${ptKeys.size}`);

      // All catalogs should have the same number of keys
      expect(frKeys.size).toBe(enKeys.size);
      expect(swKeys.size).toBe(enKeys.size);
      expect(ptKeys.size).toBe(enKeys.size);
    });

    it("should not have empty string values in any catalog", () => {
      const checkEmptyValues = (
        catalog: TranslationCatalog,
        locale: string,
      ): string[] => {
        const emptyKeys: string[] = [];

        const traverse = (obj: TranslationCatalog, prefix = "") => {
          for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === "string" && value.trim() === "") {
              emptyKeys.push(fullKey);
            } else if (
              value !== null &&
              typeof value === "object" &&
              !Array.isArray(value)
            ) {
              traverse(value, fullKey);
            }
          }
        };

        traverse(catalog);
        return emptyKeys;
      };

      const enEmpty = checkEmptyValues(en, "en");
      const frEmpty = checkEmptyValues(fr, "fr");
      const swEmpty = checkEmptyValues(sw, "sw");
      const ptEmpty = checkEmptyValues(pt, "pt");

      expect(enEmpty).toEqual([]);
      expect(frEmpty).toEqual([]);
      expect(swEmpty).toEqual([]);
      expect(ptEmpty).toEqual([]);

      if (enEmpty.length > 0)
        console.error("Empty values in English:", enEmpty);
      if (frEmpty.length > 0) console.error("Empty values in French:", frEmpty);
      if (swEmpty.length > 0)
        console.error("Empty values in Swahili:", swEmpty);
      if (ptEmpty.length > 0)
        console.error("Empty values in Portuguese:", ptEmpty);
    });
  });

  describe("Placeholder Consistency", () => {
    it("should have matching placeholders in corresponding translations", () => {
      const extractPlaceholders = (value: string): string[] => {
        const matches = value.match(/\{[^}]+\}/g) || [];
        return matches.sort();
      };

      const mismatches: string[] = [];

      const checkPlaceholders = (
        obj: TranslationCatalog,
        otherObj: TranslationCatalog,
        prefix = "",
        locale: string,
      ) => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          const otherValue = otherObj[key];

          if (typeof value === "string" && typeof otherValue === "string") {
            const enPlaceholders = extractPlaceholders(value);
            const otherPlaceholders = extractPlaceholders(otherValue);

            if (
              JSON.stringify(enPlaceholders) !==
              JSON.stringify(otherPlaceholders)
            ) {
              mismatches.push(
                `${fullKey} (${locale}): EN has ${enPlaceholders.join(", ")} but ${locale} has ${otherPlaceholders.join(", ")}`,
              );
            }
          } else if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            checkPlaceholders(value, otherValue || {}, fullKey, locale);
          }
        }
      };

      checkPlaceholders(en, fr, "", "FR");
      checkPlaceholders(en, sw, "", "SW");
      checkPlaceholders(en, pt, "", "PT");

      expect(mismatches).toEqual([]);

      if (mismatches.length > 0) {
        console.error("Placeholder mismatches:", mismatches);
      }
    });
  });
});
