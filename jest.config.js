module.exports = {
  //verbose: true,  // Move verbose here
  //collectCoverage: true,  // Move collectCoverage here
  collectCoverageFrom: ['<rootDir>/backend/**/*.js'],  // Move collectCoverageFrom here
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/backend/tests/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],  // This line remains here
    },
  ],
};
