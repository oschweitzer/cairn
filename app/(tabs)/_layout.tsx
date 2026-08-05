import { Tabs } from 'expo-router'
import Feather from '@expo/vector-icons/Feather'
import { useTheme } from '@/ui/ThemeProvider'
import { fonts } from '@/ui/theme'

export default function TabsLayout() {
  const { theme } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.surface.page },
        tabBarActiveTintColor: theme.accent.default,
        tabBarInactiveTintColor: theme.text.muted,
        tabBarStyle: {
          backgroundColor: theme.surface.card,
          // La couture remplace l'ombre portée pour détacher la barre du contenu.
          borderTopWidth: 1,
          borderTopColor: theme.line.hairline,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.sansMedium,
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color, size }) => <Feather name="layers" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tags"
        options={{
          title: 'Tags',
          tabBarIcon: ({ color, size }) => <Feather name="tag" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Réglages',
          tabBarIcon: ({ color, size }) => <Feather name="sliders" size={size} color={color} />,
        }}
      />
    </Tabs>
  )
}
