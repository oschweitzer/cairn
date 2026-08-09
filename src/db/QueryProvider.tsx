import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { shouldPersistQuery } from './persistLogic'

/**
 * Cache de requêtes, persisté pour que l'application s'ouvre sur du contenu même
 * sans réseau.
 *
 * Le choix important est ici : tout n'est pas persisté. Sur le web, AsyncStorage
 * s'appuie sur localStorage, lisible par n'importe quel script de l'origine.
 * Les notes du coffre n'y ont donc rien à faire, ni celles de la corbeille.
 * Seules les clés marquées comme persistables descendent sur le disque.
 *
 * C'est aussi pour cela que les notes masquées vivent dans une clé de requête
 * distincte plutôt que dans la liste principale filtrée côté client : la
 * séparation est structurelle, pas cosmétique.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les données restent affichées pendant la revalidation, ce qui évite de
      // voir la grille se vider à chaque retour sur l'écran.
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
      // La reconnexion suffit à déclencher un rafraîchissement, inutile de
      // rejouer toutes les requêtes au moindre retour de focus.
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
        // À incrémenter si la forme des données en cache change de façon
        // incompatible, pour invalider les caches déjà sur les appareils.
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
