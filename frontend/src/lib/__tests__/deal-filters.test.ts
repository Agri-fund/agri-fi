import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  buildQuery,
  fromApiFilters,
  parseFilters,
  toApiFilters,
  validateFilters,
} from "../deal-filters";

describe("deal filters", () => {
  it("omits defaults from the API filters", () => {
    expect(toApiFilters(DEFAULT_FILTERS)).toEqual({});
  });

  it("round-trips a query string", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      commodity: ["cocoa", "coffee"],
      region: "Ashanti",
      minRoi: 10,
      maxAmount: 1000,
      duration: "3-6 months",
      status: "open",
      sortBy: "largest_amount",
    };
    const query = buildQuery(filters, 2, 12);
    const parsed = parseFilters(new URLSearchParams(query));
    expect(parsed).toEqual(filters);
    expect(query).toContain("page=2");
    expect(query).toContain("limit=12");
  });

  it("restores saved filters from the stored API shape", () => {
    const api = { commodity: "cocoa", minRoi: 5, sortBy: "highest_roi" };
    expect(toApiFilters(fromApiFilters(api))).toEqual(api);
  });

  it("flags reversed ranges", () => {
    expect(
      validateFilters({ ...DEFAULT_FILTERS, minRoi: 50, maxRoi: 10 }),
    ).toHaveLength(1);
    expect(
      validateFilters({ ...DEFAULT_FILTERS, minAmount: 900, maxAmount: 100 }),
    ).toHaveLength(1);
    expect(validateFilters(DEFAULT_FILTERS)).toEqual([]);
  });

  it("ignores non-numeric URL values", () => {
    expect(parseFilters(new URLSearchParams("minRoi=abc")).minRoi).toBe(0);
  });
});
