import { describe, expect, it } from 'vitest'
import {
  extractPlaylistId,
  extractVideoId,
  formatClock,
  isPlaylistUrl,
  isVideoId,
  thumbnailUrl,
} from './youtube'

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

describe('playlists', () => {
  it('extracts a playlist id from public playlist urls', () => {
    expect(
      extractPlaylistId('https://www.youtube.com/playlist?list=PLOU2XLYxmsIIAOskSyap13n9W-xOt_GP5'),
    ).toBe('PLOU2XLYxmsIIAOskSyap13n9W-xOt_GP5')
    expect(extractPlaylistId('music.youtube.com/playlist?list=OLAK5uy_kTest12345')).toBe(
      'OLAK5uy_kTest12345',
    )
  })

  it('reads the list id from a watch url without treating it as a playlist import', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'
    expect(extractPlaylistId(watch)).toBe('PL1234567890')
    expect(isPlaylistUrl(watch)).toBe(false)
  })

  it('rejects missing or too-short list ids', () => {
    expect(extractPlaylistId('https://www.youtube.com/playlist')).toBeNull()
    expect(extractPlaylistId('https://www.youtube.com/playlist?list=abc')).toBeNull()
    expect(extractPlaylistId('https://vimeo.com/playlist?list=PL1234567890')).toBeNull()
  })

  it('recognises playlist intent only when there is no video', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PL1234567890')).toBe(true)
    expect(isPlaylistUrl('https://www.youtube.com/playlist')).toBe(true)
    expect(isPlaylistUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false)
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(isPlaylistUrl('dQw4w9WgXcQ')).toBe(false)
    expect(isPlaylistUrl('https://vimeo.com/playlist?list=PL1234567890')).toBe(false)
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
