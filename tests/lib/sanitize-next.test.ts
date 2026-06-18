import { sanitizeNext } from '@/lib/sanitize-next'

describe('sanitizeNext', () => {
  it.each([
    ['null input', null, '/'],
    ['empty string', '', '/'],
    ['absolute http URL', 'http://evil.com', '/'],
    ['absolute https URL', 'https://evil.com', '/'],
    ['protocol-relative URL', '//evil.com/path', '/'],
    ['backslash-escaped path', '/\\evil.com', '/'],
    ['plain path', '/lists/abc', '/lists/abc'],
    ['path with query', '/invite/xyz?foo=bar', '/invite/xyz?foo=bar'],
    ['root', '/', '/'],
  ])('handles %s', (_label, input, expected) => {
    expect(sanitizeNext(input as string | null)).toBe(expected)
  })
})
