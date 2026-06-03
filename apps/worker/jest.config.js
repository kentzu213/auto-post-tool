/**
 * Jest config for the worker package.
 *
 * Property-based tests (fast-check) for worker tenant isolation (Property 9,
 * task 18.3) run against an in-memory fake of the Prisma calls — no live DB.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
};
