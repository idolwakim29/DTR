const { mockDeep, mockReset } = require('jest-mock-extended');

const prismaMock = mockDeep();

// Use this to reset the mock between tests
beforeEach(() => {
  mockReset(prismaMock);
});

module.exports = prismaMock;
