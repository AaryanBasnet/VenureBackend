const {
  computeDepositAmount,
  DEPOSIT_PERCENTAGE_MIN,
  DEPOSIT_PERCENTAGE_MAX,
} = require("../services/quotationService");

describe("computeDepositAmount", () => {
  describe("percentage", () => {
    it("computes the correct amount within the allowed range", () => {
      expect(computeDepositAmount({ depositType: "percentage", depositValue: 20, totalPrice: 100000 })).toBe(20000);
    });

    it("accepts the boundary values", () => {
      expect(() =>
        computeDepositAmount({ depositType: "percentage", depositValue: DEPOSIT_PERCENTAGE_MIN, totalPrice: 100000 })
      ).not.toThrow();
      expect(() =>
        computeDepositAmount({ depositType: "percentage", depositValue: DEPOSIT_PERCENTAGE_MAX, totalPrice: 100000 })
      ).not.toThrow();
    });

    it("rejects a percentage below the minimum", () => {
      expect(() =>
        computeDepositAmount({ depositType: "percentage", depositValue: DEPOSIT_PERCENTAGE_MIN - 1, totalPrice: 100000 })
      ).toThrow(/between/);
    });

    it("rejects a percentage above the maximum", () => {
      expect(() =>
        computeDepositAmount({ depositType: "percentage", depositValue: DEPOSIT_PERCENTAGE_MAX + 1, totalPrice: 100000 })
      ).toThrow(/between/);
    });
  });

  describe("fixed", () => {
    it("accepts a value strictly between 0 and totalPrice", () => {
      expect(computeDepositAmount({ depositType: "fixed", depositValue: 15000, totalPrice: 100000 })).toBe(15000);
    });

    it("rejects zero or negative", () => {
      expect(() => computeDepositAmount({ depositType: "fixed", depositValue: 0, totalPrice: 100000 })).toThrow();
      expect(() => computeDepositAmount({ depositType: "fixed", depositValue: -5000, totalPrice: 100000 })).toThrow();
    });

    it("rejects a value equal to or greater than totalPrice", () => {
      expect(() => computeDepositAmount({ depositType: "fixed", depositValue: 100000, totalPrice: 100000 })).toThrow();
      expect(() => computeDepositAmount({ depositType: "fixed", depositValue: 150000, totalPrice: 100000 })).toThrow();
    });
  });

  it("rejects an invalid deposit type", () => {
    expect(() => computeDepositAmount({ depositType: "bogus", depositValue: 10, totalPrice: 100000 })).toThrow();
  });
});
