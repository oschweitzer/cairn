import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { shouldPersistQuery } from './persistLogic'

/**
 * Query cache, persisted so the app opens on content even without a network.
 *
 * The important choice is here: not everything is persisted. On the web,
 * AsyncStorage sits on localStorage, readable by any script from the origin. So
 * vault notes have no business there, and neither do trashed ones. Only the keys
 * marked as persistable go down to the disk.
 *
 * That is also why hidden notes live under a separate query key rather than in
 * the main list filtered on the client: the separation is structural, not
 * cosmetic.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays on display during revalidation, which avoids watching the
      // grid empty itself every time the screen is revisited.
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
      // Reconnecting is enough to trigger a refresh, no need to replay every
      // query on the slightest return of focus.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
})

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'cairn.query-cache',
  throttleTime: 1000,
})

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        // Bump this if the shape of cached data changes incompatibly, to
        // invalidate the caches already on devices.
        buster: 'v1',
        dehydrateOptions: {
          // Neither the vault nor the trash goes down to the disk, and neither
          // does a query that has not succeeded yet. See `persistLogic.ts`.
          shouldDehydrateQuery: (query) => shouldPersistQuery(query.queryKey, query.state.status),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

export { queryClient }
