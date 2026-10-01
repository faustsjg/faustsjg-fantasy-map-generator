import { describe, expect, it } from "vitest";
import { round, sanitizeId, setInlineStyleProperty, withAnnotation, withAnnotations } from "./stringUtils";

describe("setInlineStyleProperty", () => {
  it("should add a property to an empty style", () => {
    expect(setInlineStyleProperty(null, "text-shadow", "white 0 0 4px")).toBe("text-shadow: white 0 0 4px");
  });

  it("should preserve other properties when setting one", () => {
    expect(setInlineStyleProperty("transform: translate(1.5em, -0.5em)", "text-shadow", "white 0 0 4px")).toBe(
      "transform: translate(1.5em, -0.5em); text-shadow: white 0 0 4px"
    );
  });

  it("should replace an existing value in place of duplicating it", () => {
    expect(
      setInlineStyleProperty("text-shadow: red 1px 1px; transform: translate(1em, 0em)", "text-shadow", "none")
    ).toBe("transform: translate(1em, 0em); text-shadow: none");
  });

  it("should drop the property on an empty value and return null when nothing remains", () => {
    expect(setInlineStyleProperty("text-shadow: red 1px 1px; transform: translate(1em, 0em)", "text-shadow", "")).toBe(
      "transform: translate(1em, 0em)"
    );
    expect(setInlineStyleProperty("text-shadow: red 1px 1px", "text-shadow", "")).toBeNull();
  });
});

describe("round", () => {
  it("should be able to handle undefined input", () => {
    expect(round(undefined)).toBe("");
  });
});

describe("sanitizeId", () => {
  it("should allow non-latin letters", () => {
    expect(sanitizeId("Привет Мир")).toBe("привет-мир");
    expect(sanitizeId("城市 名称")).toBe("城市-名称");
  });

  it("should remove invalid punctuation and keep unicode letters", () => {
    expect(sanitizeId("Olá, Мир! 城市@#")).toBe("olá-мир-城市");
  });

  it("should prefix ids starting with any unicode number", () => {
    expect(sanitizeId("123Town")).toBe("_123town");
    expect(sanitizeId("١Town")).toBe("_١town");
  });
});

describe("withAnnotation", () => {
  it("appends a new annotation to a plain name", () => {
    expect(withAnnotation("Kingdom of X", "absorbed Y")).toBe("Kingdom of X (absorbed Y)");
  });

  it("replaces a single earlier annotation instead of stacking onto it", () => {
    expect(withAnnotation("Kingdom of X (absorbed Y)", "absorbed Z")).toBe("Kingdom of X (absorbed Z)");
  });

  it("replaces multiple earlier annotations accumulated over several events at once", () => {
    expect(withAnnotation("Kingdom of X (rebelled against Y) (absorbed Z)", "absorbed W")).toBe(
      "Kingdom of X (absorbed W)"
    );
  });
});

describe("withAnnotations", () => {
  it("joins several annotations from the same round into one trailing group", () => {
    expect(withAnnotations("Kingdom of X", ["absorbed Y", "absorbed Z"])).toBe("Kingdom of X (absorbed Y, absorbed Z)");
  });

  it("still replaces any earlier annotation(s) rather than stacking onto them", () => {
    expect(withAnnotations("Kingdom of X (absorbed Y)", ["absorbed Z", "absorbed W"])).toBe(
      "Kingdom of X (absorbed Z, absorbed W)"
    );
  });

  it("strips any trailing annotation and adds none, when passed an empty list", () => {
    expect(withAnnotations("Kingdom of X (absorbed Y)", [])).toBe("Kingdom of X");
  });
});
