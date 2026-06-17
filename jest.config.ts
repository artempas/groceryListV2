import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
}

// nextJest prepends /node_modules/ to transformIgnorePatterns, blocking ESM packages
// like jose. We wrap the config factory to override that pattern so jose is transformed.
const jestConfig = createJestConfig(config)
export default async () => {
  const cfg = await jestConfig()
  cfg.transformIgnorePatterns = ['/node_modules/(?!(jose)/)']
  return cfg
}
