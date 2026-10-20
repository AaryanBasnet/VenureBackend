const { createVenueSchema, updateVenueSchema } = require("../validators/venueValidators");
const Venue = require("../model/venue");

const base = {
  venueName: "Himalayan Vista Resort",
  category: "hotel-resort",
  location: { address: "Nagarkot", city: "Nagarkot", state: "Bagmati", country: "Nepal" },
};

const goldPackage = {
  name: "Gold Package",
  tagline: "Classic Nepali celebration",
  pricePerPlate: 2850,
  minPlates: 60,
  highlights: ["Bara, choila, kachila", "Buff or chicken sekuwa with pulao"],
};

describe("venue packages, drink options and contact phone", () => {
  it("accepts per-plate packages and drink options on create", () => {
    const parsed = createVenueSchema.parse({
      ...base,
      packages: [goldPackage],
      drinkOptions: [{ name: "Hard drinks", items: ["Beer", "Whisky"] }],
      contactPhone: "+977 9800000000",
    });
    expect(parsed.packages[0].pricePerPlate).toBe(2850);
    expect(parsed.drinkOptions[0].items).toHaveLength(2);
  });

  it("defaults to no packages or drinks", () => {
    const parsed = createVenueSchema.parse(base);
    expect(parsed.packages).toEqual([]);
    expect(parsed.drinkOptions).toEqual([]);
  });

  it("parses JSON strings from multipart form data", () => {
    const parsed = updateVenueSchema.parse({ packages: JSON.stringify([goldPackage]) });
    expect(parsed.packages[0].name).toBe("Gold Package");
  });

  it("rejects a negative price, more than six packages, and a bad phone number", () => {
    expect(() => createVenueSchema.parse({ ...base, packages: [{ ...goldPackage, pricePerPlate: -1 }] })).toThrow();
    expect(() => createVenueSchema.parse({ ...base, packages: Array(7).fill(goldPackage) })).toThrow();
    expect(() => createVenueSchema.parse({ ...base, contactPhone: "call me" })).toThrow();
  });

  it("lets an empty contact phone through, so an owner can clear it", () => {
    expect(updateVenueSchema.parse({ contactPhone: "" }).contactPhone).toBe("");
  });

  it("the Venue model enforces the same limits", () => {
    const venue = new Venue({
      ...base,
      owner: "64b000000000000000000001",
      location: base.location,
      packages: Array(7).fill(goldPackage),
    });
    const error = venue.validateSync();
    expect(error.errors.packages).toBeDefined();
  });
});
