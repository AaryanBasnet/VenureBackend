module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  setupFiles: ["<rootDir>/test/jest.env.js"],
  // The first run downloads a MongoDB binary for mongodb-memory-server
  testTimeout: 120000,
};
