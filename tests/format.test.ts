import { describe, it, expect } from "vitest";
import { codeLabel } from "@/lib/format";

describe("codeLabel", () => {
  it("shows the name once when the code is the name", () => {
    expect(codeLabel({ code: "Catering", name: "Catering" })).toBe("Catering");
    // codes are cut to 40 characters, so a long item name starts with its code
    expect(codeLabel({ code: "Concrete forming and finishing — found", name: "Concrete forming and finishing — foundations" })).toBe("Concrete forming and finishing — foundations");
  });
  it("shows code and name when they differ", () => {
    expect(codeLabel({ code: "03-100", name: "Concrete" })).toBe("03-100 Concrete");
    expect(codeLabel({ code: "NB-476", name: "" })).toBe("NB-476");
  });
});
