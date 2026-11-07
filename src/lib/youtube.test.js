import { describe, expect, it } from 'vitest'
import { extractVideoId, formatClock, isVideoId, thumbnailUrl } from './youtube'

describe('extractVideoId', () => {
  it('accepts a bare 11-character video id', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['http://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (input, expected) => {
    expect(extractVideoId(input)).toBe(expected)
  })

  it.each([
    ['https://vimeo.com/123456', 'a non-YouTube host'],
    ['https://www.youtube.com/watch?v=short', 'an id with the wrong length'],
    ['https://www.youtube.com/playlist?list=PL123', 'a playlist without a video'],
    ['https://evil.example.com/watch?v=dQw4w9WgXcQ', 'a host that only looks like YouTube'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa', 'an ambiguous duplicate v param'],
    ['', 'empty input'],
  ])('rejects %s (%s)', (input) => {
    expect(extractVideoId(input)).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(extractVideoId(null)).toBeNull()
    expect(extractVideoId(42)).toBeNull()
    expect(extractVideoId(undefined)).toBeNull()
  })
})

describe('helpers', () => {
  it('validates video ids', () => {
    expect(isVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isVideoId('dQw4w9WgXc')).toBe(false)
    expect(isVideoId('dQw4w9WgXcQ!')).toBe(false)
  })

  it('builds a thumbnail url without an api key', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  })

  it('formats clock values safely', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9.8)).toBe('0:09')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3600)).toBe('60:00')
    expect(formatClock(NaN)).toBe('0:00')
    expect(formatClock(-4)).toBe('0:00')
  })
})
