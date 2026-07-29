import { describe, expect, it } from 'vitest'
import {
  automaticallyAssignedSpaceIds,
  descendantSpaceIds,
  meetingSpaceIds,
  sanitizeMeetingSpaces,
  spacePath
} from './meetingSpaces'
import type { MeetingRecord, MeetingSpace } from './types'

const spaces: MeetingSpace[] = [
  {
    id: 'company',
    name: 'Company',
    description: '',
    icon: '🏢',
    autoAddTitles: []
  },
  {
    id: 'product',
    name: 'Product',
    description: 'Product work',
    icon: '🧭',
    parentId: 'company',
    autoAddTitles: ['Product weekly']
  }
]

it('builds paths and descendant filters without cycles', () => {
  expect(spacePath(spaces[1], spaces)).toBe('Company / Product')
  expect([...descendantSpaceIds('company', spaces)]).toEqual(['company', 'product'])
})

it('migrates a legacy flat label to a real space id', () => {
  const meeting = { space: ' product ' } as MeetingRecord
  expect(meetingSpaceIds(meeting, spaces)).toEqual(['product'])
})

it('auto-adds exact recurring titles without fuzzy inference', () => {
  expect(automaticallyAssignedSpaceIds('Product weekly', undefined, spaces)).toEqual([
    'product'
  ])
  expect(automaticallyAssignedSpaceIds('Product week', undefined, spaces)).toEqual([])
})

it('auto-adds an exact recurring calendar series id', () => {
  const withSeries = [
    {
      ...spaces[1],
      autoAddTitles: ['series:google:weekly-product']
    }
  ]
  expect(
    automaticallyAssignedSpaceIds(
      'A renamed occurrence',
      'google:weekly-product',
      withSeries
    )
  ).toEqual(['product'])
})

describe('sanitizeMeetingSpaces', () => {
  it('removes duplicates and invalid parents', () => {
    expect(
      sanitizeMeetingSpaces([
        ...spaces,
        { ...spaces[1], name: 'Duplicate' },
        {
          id: 'orphan',
          name: 'Orphan',
          description: '',
          icon: '',
          parentId: 'missing',
          autoAddTitles: [' Weekly ', 'Weekly']
        }
      ])
    ).toEqual([
      ...spaces,
      {
        id: 'orphan',
        name: 'Orphan',
        description: '',
        icon: '📁',
        parentId: undefined,
        autoAddTitles: ['Weekly']
      }
    ])
  })
})
