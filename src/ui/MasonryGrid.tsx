import { useMemo } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { columnsForWidth, distributeIntoColumns } from '@/db/noteLogic'
import { space } from './theme'

/**
 * Grille en colonnes de hauteurs libres, façon Google Keep.
 *
 * React Native n'a pas d'équivalent de `column-count`, et une FlatList à
 * plusieurs colonnes aligne les lignes sur la carte la plus haute, ce qui laisse
 * de grands trous.
 *
 * La répartition et les paliers de largeur vivent dans src/db/noteLogic.ts, où ils
 * sont testés. Ce composant ne fait que mesurer la largeur et rendre le résultat.
 */
export function MasonryGrid<T>({
  items,
  estimateHeight,
  renderItem,
  keyExtractor,
  gap = space.md,
}: {
  items: T[]
  estimateHeight: (item: T) => number
  renderItem: (item: T) => React.ReactNode
  keyExtractor: (item: T) => string
  gap?: number
}) {
  const { width } = useWindowDimensions()
  const columnCount = columnsForWidth(width)

  const columns = useMemo(
    () => distributeIntoColumns(items, columnCount, estimateHeight, gap),
    [items, columnCount, estimateHeight, gap],
  )

  return (
    <View style={{ flexDirection: 'row', gap }}>
      {columns.map((column, index) => (
        <View key={index} style={{ flex: 1, gap }}>
          {column.map((item) => (
            <View key={keyExtractor(item)}>{renderItem(item)}</View>
          ))}
        </View>
      ))}
    </View>
  )
}
