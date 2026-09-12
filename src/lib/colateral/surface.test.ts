import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurfaceControl, SurfaceField } from "./protocol";
import {
  clearSurfaces,
  getRegistration,
  matchControl,
  matchField,
  onSurfaceChange,
  readSurface,
  registerSurface
} from "./surface";

afterEach(() => clearSurfaces());

const FIELDS: SurfaceField[] = [
  { id: "title", label: "Clip title", value: "Beam design", kind: "text" },
  { id: "minLength", label: "Minimum length", value: 20, kind: "number", unit: "s" },
  { id: "autoPost", label: "Auto post", value: false, kind: "boolean" },
  { id: "postedTitle", label: "Posted title", value: "x", kind: "text", readOnly: true }
];

const CONTROLS: SurfaceControl[] = [
  { id: "generate", label: "Generate", group: "Clips" },
  { id: "add-row", label: "Add", group: "Clips" },
  { id: "add-account", label: "Add", group: "Accounts" },
  { id: "delete", label: "Delete all", destructive: true }
];

describe("registerSurface", () => {
  it("reads back what a page registered", () => {
    registerSurface({ route: "/clips", title: "Short Clips", fields: FIELDS, summary: "One stream, many clips" });
    const surface = readSurface("/clips");
    expect(surface.title).toBe("Short Clips");
    expect(surface.summary).toBe("One stream, many clips");
    expect(surface.fields).toHaveLength(4);
  });

  it("normalizes the route it was registered under", () => {
    registerSurface({ route: "clips/", title: "Short Clips" });
    expect(getRegistration("/clips")).not.toBeNull();
  });

  it("hands back a copy, so a host cannot write through the read", () => {
    registerSurface({ route: "/clips", title: "Short Clips", fields: FIELDS });
    const surface = readSurface("/clips");
    surface.fields[0].value = "tampered";
    expect(readSurface("/clips").fields[0].value).toBe("Beam design");
  });

  it("answers for a route nothing registered", () => {
    const surface = readSurface("/ideas", "Idea Lab");
    expect(surface).toEqual({ route: "/ideas", title: "Idea Lab", fields: [], controls: [], readings: [] });
  });

  it("does not let a page unmounting after its successor blank the live one", () => {
    const releaseFirst = registerSurface({ route: "/clips", title: "First" });
    registerSurface({ route: "/clips", title: "Second" });
    // React mounts the new page before unmounting the old one, so this release
    // arrives late and must be a no-op.
    releaseFirst();
    expect(readSurface("/clips").title).toBe("Second");
  });

  it("releases its own entry", () => {
    const release = registerSurface({ route: "/clips", title: "Short Clips" });
    release();
    expect(getRegistration("/clips")).toBeNull();
  });

  it("keeps live getters live", () => {
    let value = 1;
    registerSurface({
      route: "/clips",
      title: "Short Clips",
      get fields() {
        return [{ id: "n", label: "N", value, kind: "number" as const }];
      }
    });
    value = 2;
    expect(readSurface("/clips").fields[0].value).toBe(2);
  });

  it("tells listeners which route moved, and survives one that throws", () => {
    const angry = vi.fn(() => {
      throw new Error("no");
    });
    const calm = vi.fn();
    onSurfaceChange(angry);
    onSurfaceChange(calm);
    registerSurface({ route: "/clips", title: "Short Clips" });
    expect(calm).toHaveBeenCalledWith("/clips");
  });
});

describe("matchField", () => {
  it("matches by id, with or without the hash", () => {
    expect(matchField(FIELDS, "minLength").field?.id).toBe("minLength");
    expect(matchField(FIELDS, "#minLength").field?.id).toBe("minLength");
  });

  it("matches by the label the engineer can see, punctuation and case aside", () => {
    expect(matchField(FIELDS, "Minimum length").field?.id).toBe("minLength");
    expect(matchField(FIELDS, "minimum  LENGTH").field?.id).toBe("minLength");
  });

  it("matches a partial when only one field could be meant", () => {
    expect(matchField(FIELDS, "auto").field?.id).toBe("autoPost");
  });

  it("lets an exact id win over a label that merely contains it", () => {
    // "title" is the id of one field and a word in the label of two others.
    expect(matchField(FIELDS, "title").field?.id).toBe("title");
  });

  it("refuses to guess between two candidates", () => {
    const result = matchField(FIELDS, "titl");
    expect(result.field).toBeUndefined();
    expect(result.error).toMatch(/Clip title/);
    expect(result.error).toMatch(/Posted title/);
  });

  it("says so when nothing matches", () => {
    expect(matchField(FIELDS, "span").error).toBe('No field called "span" on this page.');
    expect(matchField(FIELDS, "  ").error).toBe("No field named.");
  });
});

describe("matchControl", () => {
  it("matches by id and by unique label", () => {
    expect(matchControl(CONTROLS, "generate").control?.id).toBe("generate");
    expect(matchControl(CONTROLS, "Delete all").control?.id).toBe("delete");
  });

  it("takes a group-qualified handle when a label is used twice", () => {
    expect(matchControl(CONTROLS, "Accounts > Add").control?.id).toBe("add-account");
    expect(matchControl(CONTROLS, "Clips > Add").control?.id).toBe("add-row");
  });

  it("names the groups instead of picking one", () => {
    const result = matchControl(CONTROLS, "Add");
    expect(result.control).toBeUndefined();
    expect(result.error).toMatch(/Clips/);
    expect(result.error).toMatch(/Accounts/);
  });
});
